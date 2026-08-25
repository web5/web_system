---
name: web-system-dev-machine
description: web_system dev 机器 SSH 访问技能——通过 SSH 免密登录 dev 服务器（ubuntu@175.27.189.123），在服务器上执行命令、运行脚本（拉取 arXiv 论文、调用 content-hub 接口、公众号建稿/发布等）。当定时任务/自动化需要登录 dev 机器执行论文抓取、内容生成、公众号发布等操作时调用本技能。
version: 1.0.0
agent_created: true
---

# web_system dev 机器 SSH 访问 Skill

> 本技能是自动化任务访问 dev 服务器的唯一通道。dev 机器承载 content-hub（:6007）、mcp-gateway（:6006）等后端服务，论文抓取脚本与公众号发布脚本都在 dev 机器或可通过 SSH 执行。

## 1. 连接信息

| 项 | 值 |
|------|-----|
| SSH 目标 | `ubuntu@175.27.189.123` |
| 认证方式 | 密钥免密（`~/.ssh/id_ed25519_servers`），BatchMode=yes |
| 连接超时 | ConnectTimeout=8 |
| 关键服务 | content-hub `http://127.0.0.1:6007`、mcp-gateway `http://127.0.0.1:6006` |
| 部署目录 | `/data/web_system/` |

### 1.1 基础连接命令

```bash
# 测试连通
ssh -o ConnectTimeout=8 -o BatchMode=yes ubuntu@175.27.189.123 "echo ok"

# 执行单条命令
ssh -o ConnectTimeout=8 -o BatchMode=yes ubuntu@175.27.189.123 "curl -s http://127.0.0.1:6007/api/market-pulse"

# 执行多条命令（分号分隔）
ssh -o ConnectTimeout=8 -o BatchMode=yes ubuntu@175.27.189.123 "cd /workspace/daily-paper && python3 fetch_arxiv.py"
```

### 1.2 执行远程脚本（复杂逻辑）

复杂逻辑（含多步、循环、heredoc）建议用「本地文件 → base64 → 远程解出 → 执行」方式，避免引号嵌套问题：

```bash
# 1) 本地写好脚本，base64 编码
B64=$(base64 < /path/to/remote-script.sh)

# 2) 传输并执行
ssh -o ConnectTimeout=15 ubuntu@175.27.189.123 \
  "echo '$B64' | base64 -d > /tmp/remote.sh && chmod +x /tmp/remote.sh && bash /tmp/remote.sh && rm -f /tmp/remote.sh"
```

### 1.3 传输文件到 dev

```bash
# 单文件
scp -o ConnectTimeout=10 /local/file.py ubuntu@175.27.189.123:/tmp/

# 目录（用 tar 管道）
tar czf - /local/dir | ssh ubuntu@175.27.189.123 "cd /data && tar xzf -"
```

---

## 2. dev 机器上的论文学习脚本

> 论文学习流程脚本位于 dev 机器 `/workspace/daily-paper/`（如该目录不存在，先创建并上传脚本，见下方「2.2 初始化」）。

### 2.1 论文流程（在 dev 机器执行）

```bash
cd /workspace/daily-paper

# 1) 拉取 arXiv（cs.AI/CL/CV/LG，按提交时间倒序）
python3 fetch_arxiv.py            # → arxiv_raw.json

# 2)（本地/任务内）阅读 arxiv_raw.json → 挑选 10 篇 → summaries.json + selected_ids.txt

# 3) 渲染日报
python3 build_report.py           # → daily_paper_YYYY-MM-DD.md
```

> `fetch_arxiv.py` / `build_report.py` 已部署在 dev 机器 `/workspace/daily-paper/`（2026-08-24 初始化完成，本地源在 `web_system/scripts/mcp-fallback/`）。若需要把 `arxiv_raw.json` 拉回本地处理，用 `scp ubuntu@175.27.189.123:/workspace/daily-paper/arxiv_raw.json /tmp/`。

### 2.2 目录/脚本初始化（已就绪，仅脚本损坏时参考）

`/workspace/daily-paper` 与两个脚本已在 dev 机器就绪。若脚本损坏需重新上传：
```bash
ssh ubuntu@175.27.189.123 "mkdir -p /workspace/daily-paper"
scp /Users/geekwen/workspace/web_system/scripts/mcp-fallback/fetch_arxiv.py \
    /Users/geekwen/workspace/web_system/scripts/mcp-fallback/build_report.py \
    ubuntu@175.27.189.123:/tmp/
ssh ubuntu@175.27.189.123 "sudo mv /tmp/fetch_arxiv.py /tmp/build_report.py /workspace/daily-paper/ && sudo chown -R ubuntu:ubuntu /workspace/daily-paper"
```

---

## 3. 降级数据源（脚本缺失时直接拉 arXiv）

当 `fetch_arxiv.py` 不可用时，直接在 dev 机器上用 curl 拉 arXiv：

```bash
ssh ubuntu@175.27.189.123 \
  "curl -sL -A 'Mozilla/5.0' 'http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.CV+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&start=0&max_results=10' -o /workspace/daily-paper/arxiv_raw.xml && echo done"
```

> arXiv API 会 301 重定向到 https，curl 必须加 `-L`；返回 Atom XML（非 JSON）。脚本化解析可复用 `web_system/scripts/mcp-fallback/remote-paper-publish.sh` 里的 Python 解析逻辑。

---

## 4. 公众号发布（content-hub 直连）

dev 机器上 content-hub 提供公众号 REST 接口（无需 MCP，直接 curl）：

| 接口 | 方法 | 路径 |
|------|------|------|
| 建草稿 | POST | `http://127.0.0.1:6007/api/content/wechat/draft` |
| 一键发布 | POST | `http://127.0.0.1:6007/api/content/wechat/publish` |

```bash
# 建草稿
ssh ubuntu@175.27.189.123 "curl -s -X POST http://127.0.0.1:6007/api/content/wechat/draft \
  -H 'Content-Type: application/json' \
  -d '{\"title\":\"标题\",\"html\":\"<body><p>正文</p></body>\"}'"

# 一键发布（加 --publish 语义：走 publish 接口）
```

**封面约束（必读）**：`html` 正文首段必须包含公网图片 `<img src="https://..." />`，否则服务端返回「缺少封面」错误。推荐占位图：`https://dummyimage.com/800x400/4A90E2/fff.png&text=arXiv+Daily`。

**凭证**：dev 公众号 AppID 为 `wxc945245618717a06`（content-hub 进程环境已配置 WECHAT_MP_APP_ID/SECRET），无需在脚本中填密钥。

---

## 5. 不可协商门禁

| # | 门禁 | 约束 |
|---|------|------|
| 1 | 只读优先 | 默认只执行只读/查询命令；写操作（建稿/发布/文件写入）需任务明确要求 |
| 2 | 禁止危险命令 | 禁止 `rm -rf`（除非明确指向 /tmp 临时文件）、禁止修改 dev 机器系统配置、禁止重启线上服务（content-hub 重启需明确授权） |
| 3 | 路径安全 | 业务文件只写 `/workspace/daily-paper/` 与 `/tmp/`；不碰 `/data/web_system` 部署目录 |
| 4 | 失败上报 | SSH 失败/命令失败要如实上报原始错误，不编造结果 |
| 5 | 凭证保密 | 不输出 WECHAT_MP_APP_SECRET 等敏感值，日志/汇报中脱敏 |

---

## 6. 常见错误处理

| 现象 | 处理 |
|------|------|
| `Connection timed out` / `Permission denied` | 检查本机 SSH 密钥（`~/.ssh/id_ed25519_servers`）与网络；如实上报 |
| 命令 not found（python3/curl 缺失） | 用 `which` 定位，或改用可用解释器（python/python3） |
| content-hub 返回 401 | 走 MCP 链路（`web-system-wechat-mp` 技能）而非直连；或检查接口鉴权配置 |
| 「缺少封面」错误 | HTML 首段补 `<img src="https://...">` 后重试 |
| arXiv 301/空响应 | curl 加 `-L`；检查 UA；稍后重试 |
