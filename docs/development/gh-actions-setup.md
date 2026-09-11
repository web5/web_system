# GitHub Actions 自动发布 · 一次性配置手册

> 机制说明（怎么跑、看什么、怎么排障）：[`gh-actions-release.md`](./gh-actions-release.md)
> 设计取舍：[`specs/ci-cd/gh-actions-release.md`](../../specs/ci-cd/gh-actions-release.md)
>
> 本页只回答两件事：**本机要配什么**、**GitHub 要开什么权限 / 哪些凭据从哪来**。
> 从头照做一遍约 10 分钟，之后无需再碰。

---

## 0. 总览：一共要配 7 项

| # | 位置 | 项 | 必填 | §
|---|---|---|---|---|
| 1 | 本机 | self-hosted runner（label 必须含 `local-release`） | ✅ | §1.2 |
| 2 | 本机 | runner 的 `PATH`（含 node/pm2） | ✅ | §1.3 |
| 3 | 本机 | 发布目录 `~/web_system_release` | ✅（通常已有） | §1.4 |
| 4 | GitHub | Secrets：`RELEASE_HOOK_URL`、`RELEASE_HOOK_SECRET` | ✅ | §2 / §3 |
| 5 | GitHub | Variables：`RELEASE_DIR` | 可选 | §3 |
| 6 | GitHub | Actions → Workflow permissions = **Read and write** | ✅ | §3 |
| 7 | GitHub | master 分支保护要求 `quality-gate` 通过 | 可选 | §3 |

> **凭据一共只有 2 个秘密**：`RELEASE_HOOK_SECRET`（长期，§2.2）与 runner 注册 token（一次性，§2.3）。
>
> ⚠️ **不再需要 `DEPLOY_CONSOLE_TOKEN`**（2026-09-11 起）。CI 轮询流水线状态已改用
> 同一把 hook 密钥做 HMAC 验签（`GET /api/hooks/pipelines/:jobId`）。
> 原因：控制台 JWT 是 `expiresIn: 24h` 的**短期登录态** —— 填进 secrets 次日就 401，
> 表现为「发布其实成功了，但 job 报错/卡住」；且它权限覆盖发布/取消/审批，交给 CI 等于放大凭据面。

---

## 1. 本机准备

### 1.1 先用这几条确认前提

```bash
# ① node / pm2 的**稳定**路径（不能是 fnm_multishells 那种会话临时目录）
ls -d ~/.local/share/fnm/node-versions/*/installation/bin
ls -l ~/.local/share/fnm/node-versions/v20.20.2/installation/bin/pm2   # 应是个有效软链

# ② 发布目录存在且干净
git -C ~/web_system_release status --porcelain        # 应无输出
git -C ~/web_system_release log --oneline -1

# ③ 平台密钥已配（§2.2 会用到）
grep -c '^RELEASE_HOOK_SECRET=' ~/web_system_release/servers/deploy-console/.env   # 应为 1
```

本项目用 **fnm** 管理 node，默认版本是 `v20.20.2`，pm2 也装在该版本下，
所以 runner 要用的稳定路径是：

```
/Users/geekwen/.local/share/fnm/node-versions/v20.20.2/installation/bin
```

### 1.2 安装 self-hosted runner

deploy-console 与发布目录都在本机，GitHub 托管 runner 到不了，必须本机注册：

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner

# 版本号与 REG_TOKEN 从「Settings → Actions → Runners → New self-hosted runner」页面复制，
# 或用 §2.3 的 API 方式取 token
curl -o runner.tar.gz -L \
  https://github.com/actions/runner/releases/download/v<VER>/actions-runner-osx-arm64-<VER>.tar.gz
tar xzf runner.tar.gz

./config.sh --url https://github.com/web5/web_system --token <REG_TOKEN> \
  --labels local-release \
  --name mac-release \
  --work _work

./svc.sh install     # 装成 LaunchAgent（开机自启）
./svc.sh start
./svc.sh status      # 看到 running 即 OK
```

要点：

- `--labels local-release` **不能省**：workflow 是 `runs-on: [self-hosted, local-release]`，label 不匹配 job 会一直 `queued`
- runner 以**当前登录用户（geekwen）**运行，这是必要的：它要读写 `~/web_system_release`、执行 `pm2`、读 `~/.ssh`
- 注册 token 一次性、1 小时有效；过期只需重新 `./config.sh`（已注册的 runner 不受影响）

### 1.3 runner 的 PATH（最容易踩的坑）

runner **不读你的 shell rc**（`.zshrc` / `.zprofile` 都不生效），所以看不到 fnm 下的 node/pm2，
现象是构建阶段报 `nest: command not found` / 重启阶段报 `pm2: command not found`。

写一个 `~/actions-runner/.env`（runner 启动时自动加载）：

```
PATH=/Users/geekwen/.local/share/fnm/node-versions/v20.20.2/installation/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin
```

生效：

```bash
cd ~/actions-runner && ./svc.sh stop && ./svc.sh start
```

自检（应打印出版本号，而不是 not found）：

```bash
cd ~/actions-runner && ./run.sh --version >/dev/null 2>&1; \
  env -i HOME=$HOME PATH=/Users/geekwen/.local/share/fnm/node-versions/v20.20.2/installation/bin:/usr/bin:/bin \
  bash -lc 'node -v; pm2 -v'
```

### 1.4 发布目录

`~/web_system_release`（独立 clone，是服务的运行现场）：

- 必须存在、是 git 仓库、**工作区干净** —— `release-deploy-console.sh` 检测到脏改动会拒绝发布（避免覆盖人工修改）
- 路径可用仓库 Variable `RELEASE_DIR` 覆盖；不配则用上面这个默认值

---

## 2. 凭据从哪来（重点）

### 2.0 三个"名字"里只有两个是秘密

| 名称 | 性质 | 有效期 | 权限范围 | 放哪 |
|---|---|---|---|---|
| `RELEASE_HOOK_URL` | 地址，不是秘密 | — | — | GitHub Secrets |
| `RELEASE_HOOK_SECRET` | **共享 HMAC 密钥** | 长期（人工轮换） | 只能触发发布 / 查状态 | 平台 `.env` + GitHub Secrets |
| runner 注册 token | 一次性注册票据 | 1 小时 | 只能注册 runner | 用完即弃，不必保存 |
| ~~`DEPLOY_CONSOLE_TOKEN`~~ | ~~控制台 JWT~~ | ~~24 小时~~ | ~~发布/取消/审批~~ | **已不需要**（见 §0） |
| `GITHUB_PR_TOKEN`（可选） | 本地 PAT | 长期 | `repo` + `workflow` | 仓库根 `.env`（本机脚本/agent 用） |

### 2.1 `RELEASE_HOOK_URL`

发布平台在本机的地址（runner 就在本机，走回环即可）：

```
http://127.0.0.1:6200
```

### 2.2 `RELEASE_HOOK_SECRET`（核心密钥）

**是什么**：平台与 CI 共用的 HMAC-SHA256 密钥（64 位 hex）。CI 用它签名，平台用它验签；
请求还带时间戳（窗口 300s 防重放）与 `deliveryId`（幂等）。

**从哪取**（已配好的机器）：

```bash
grep '^RELEASE_HOOK_SECRET=' ~/web_system_release/servers/deploy-console/.env | cut -d= -f2-
```

**首次配置 / 需要轮换时生成一个**：

```bash
NEW=$(openssl rand -hex 32)                       # 生成 64 位 hex
printf 'RELEASE_HOOK_SECRET=%s\n' "$NEW" >> ~/web_system_release/servers/deploy-console/.env
pm2 restart web-deploy-console --update-env       # 平台侧生效
echo "$NEW"                                       # 复制到 GitHub Secrets → RELEASE_HOOK_SECRET
```

要点：

- 两边**必须完全一致**；不一致的表现是 CI 报 HTTP 401「签名校验失败」
- 只存在于**运行环境的 `.env`**（仓库 `.gitignore` 已忽略 `**/.env*`）与 GitHub Secrets，**永不提交、永不进日志**
- 轮换顺序：先生成新值 → 同时更新平台 `.env` 与 GitHub Secret → 重启平台（中间几秒 CI 会 401，重跑即可）
- `servers/deploy-console/.env.example` 已列出该键（含生成方式），可作对照

**自测**（本机手搓一次签名，验证平台认这个密钥）：

```bash
SECRET=$(grep '^RELEASE_HOOK_SECRET=' ~/web_system_release/servers/deploy-console/.env | cut -d= -f2-)
TS=$(date +%s)
SIG=$(RELEASE_HOOK_SECRET="$SECRET" node -e 'const c=require("crypto");const [ts,b]=process.argv.slice(1);process.stdout.write("sha256="+c.createHmac("sha256",process.env.RELEASE_HOOK_SECRET).update(ts+"."+b).digest("hex"))' "$TS" "")
# 用一个真实 jobId 查状态（GET 的签名对象是空串）
curl -s "http://127.0.0.1:6200/api/hooks/pipelines/<某个 jobId>" \
  -H "X-Hub-Signature-256: $SIG" -H "X-Ws-Timestamp: $TS"
# 期望 200 + {"jobId":...,"status":"succeeded",...}；签名错=401 签名校验失败；时间戳超 300s=401 疑似重放
```

### 2.3 runner 注册 token

**方式 A（页面，最简单）**：GitHub 仓库 → Settings → Actions → Runners → **New self-hosted runner**
→ 页面的 `./config.sh --token <XXX>` 里那串就是（1 小时有效）。

**方式 B（API，便于脚本化）**：

```bash
cd /Users/geekwen/workspace1/web_system
PAT=$(grep '^GITHUB_PR_TOKEN=' .env | cut -d= -f2-)      # 需要 repo 权限，见 §2.4
curl -s -X POST -H "Authorization: Bearer $PAT" \
  https://api.github.com/repos/web5/web_system/actions/runners/registration-token \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"
```

取完直接用于 §1.2 的 `./config.sh --token`；过期重取即可。

### 2.4 （可选）PAT `GITHUB_PR_TOKEN`

**用途**：本机脚本 / AI agent 通过 API 建 PR、合并 PR。
**不需要**为 `auto-pr` workflow 配它 —— 那个 workflow 用的是 GitHub 内置 `GITHUB_TOKEN`。

**怎么建**：GitHub → 右上头像 → Settings → Developer settings →
Personal access tokens →

- **Classic**：勾 `repo`（读写仓库、建 PR、合并）+ `workflow`（推送 `.github/workflows/**` 改动）
- **Fine-grained**：仓库 `web_system` → Contents = Read and write、Pull requests = Read and write、Workflows = Read and write

**放哪**：仓库根 `.env` 的 `GITHUB_PR_TOKEN=...`（已 gitignore）。

**校验**：

```bash
PAT=$(grep '^GITHUB_PR_TOKEN=' .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $PAT" https://api.github.com/user \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['login'],'| scopes:',d.get('scopes','(fine-grained)'))"
```

> 提交包含 workflow 文件改动的分支时，**没有 `workflow` scope 会被 GitHub 拒绝**（`refusing to allow a Personal Access Token to create or update workflow`）。

---

## 3. GitHub 仓库设置

**Settings → Secrets and variables → Actions**

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `RELEASE_HOOK_URL` | `http://127.0.0.1:6200` |
| Secret | `RELEASE_HOOK_SECRET` | §2.2 取到的 64 位 hex |
| Variable | `RELEASE_DIR` | `/Users/geekwen/web_system_release`（可选） |

**Settings → Actions → General → Workflow permissions**：选 **Read and write permissions**
（`auto-pr` 要 `pull-requests: write` 才能建 PR；仓库设置是上限，设成只读时 workflow 里声明再高也无效）

**Settings → Actions → Runners**：装完 §1.2 后这里应出现 `mac-release`，状态 `Idle`（绿色）

**Settings → Branches → master 保护（可选但推荐）**：Require status checks to pass →
勾 `quality-gate / 红线扫描 (R1~R5)` 与 `quality-gate / 改动包 build/test`

---

## 4. 配完自检（5 步，每步都有明确期望）

```bash
# ① runner 在线
#    GitHub → Settings → Actions → Runners：mac-release = Idle

# ② PATH 正确
cd ~/actions-runner && ./svc.sh status
env -i HOME=$HOME PATH=/Users/geekwen/.local/share/fnm/node-versions/v20.20.2/installation/bin:/usr/bin:/bin \
  bash -lc 'node -v && pm2 -v'

# ③ 平台活着
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6200/api/pipelines    # 401（需 JWT）即正常

# ④ 密钥可用（用 §2.2 的自测脚本，期望 200）

# ⑤ 端到端：随便推一个 commit 到 feature/test
#    → Actions → release 应开始跑；若本次只改文档，结论是「本次无需要发布的模块」并成功
```

最省事的端到端验证：**合并一个只改 `apps/admin` 的小 PR 到 `feature/test`**
→ 应只发布 admin（其余模块不动）；再合并一个改 `servers/deploy-console` 的
→ 走直连路径（发布目录同步 + 构建 + 干净重启 + 探活）。

---

## 5. 排障速查

| 现象 | 原因 | 处置 |
|---|---|---|
| job 长期 `queued`、无 runner 接手 | runner 未启动 / label 不匹配 | `cd ~/actions-runner && ./svc.sh status`；确认 label 含 `local-release` |
| `nest: command not found` / `pm2: command not found` | runner 的 PATH 缺 node/pm2 | §1.3 配 `.env` 后 `./svc.sh stop && ./svc.sh start` |
| CI 报 401「签名校验失败」 | 两边密钥不一致 | 重新对齐平台 `.env` 与 GitHub Secret（§2.2） |
| CI 报 401「时间戳超出允许窗口」 | 本机与 GitHub runner 时钟偏差 > 5 分钟 | 校准系统时间（时间戳窗口 300s） |
| CI 报 404「流水线不存在」 | jobId 传错 / 平台被重建导致该记录已清 | 看 job 日志里的 jobId；重跑该次发布 |
| 「发布目录有未提交改动，拒绝发布」 | 发布目录被手工改脏 | 进发布目录 `git status` 清理后再重跑 |
| 「ff-only 快进失败」 | 发布目录有分叉提交 | `git -C ~/web_system_release log --oneline origin/feature/test..HEAD` 人工处理后重跑 |
| 某个模块 `发布失败（failed）` | 平台流水线失败 | 按日志里的 jobId 去控制台「发布流水线」页看 |
| 6200 端口被占、服务起不来 | 端口被非 pm2 进程（孤儿）占用 | `publish-deploy-console.sh` 内建清理；仍失败见 `local-release-runbook.md` |
| 改了文档却跑了发布 | 不会 —— 解析不到 `servers/apps` 改动会直接跳过 | 若发生，检查是否误改了模块目录下的文件 |

---

## 6. 安全边界（为什么这样设计）

- **HMAC 而非共享密码**：CI 不持有任何登录态，只持一把**只有"触发发布 + 查状态"能力**的密钥；
  请求体参与签名、时间戳 300s 窗口防重放、`deliveryId` 唯一键保证重复投递不产生第二条流水线
- **平台治理不绕过**：CI 只投递意图，锁 / 审批 / 审计 / 回滚 / 版本指针仍由平台流水线执行
  （唯一例外是 deploy-console 自身，它不能走平台流水线，原因见 `gh-actions-release.md`）
- **密钥不进命令行**：CI 里密钥通过 `env` 注入，`curl` 用 `$VAR` 引用，不出现在 `ps` / 日志中
- **轮换建议**：每季度或人员变动时按 §2.2 轮换一次；泄露时立即轮换（旧密钥即刻失效）
