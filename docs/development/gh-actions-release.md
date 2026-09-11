# GitHub Actions 自动发布（合并到 `feature/test` → 本机 local）

> 设计：`specs/ci-cd/gh-actions-release.md`｜workflow：`.github/workflows/release.yml`
> 定位：**本地开发主线的自动发布通道**。其他模块也可继续用控制台/MCP 手动发布。

---

## 1. 一句话流程

```
功能分支 → PR（base = feature/test）→ 合并
   └─ release.yml（self-hosted runner）
        ├─ 改动含 servers/deploy-console → 直连执行：脚本同步发布目录 + 构建 + 重启 + 探活
        └─ 其余模块 → 投递发布平台 hook → 平台流水线（锁/审计/回滚/版本指针）
```

触发**只有** `feature/test`（2026-09-11 决策：master 不自动发布，需要时用 `workflow_dispatch`）。

---

## 2. 前置条件（一次性配置）

> **逐步操作手册（本机 + GitHub 各配什么、每个凭据怎么取/生成/轮换）：
> [`gh-actions-setup.md`](./gh-actions-setup.md)** —— 首次配置照它从上到下做一遍即可。
> 下面只列清单与要点。

### 2.1 self-hosted runner（必须）

`deploy-console` 与发布目录都在本机，GitHub 托管 runner 到不了，必须在本机注册：

| 项 | 值 |
|---|---|
| label | **`local-release`**（workflow 是 `runs-on: [self-hosted, local-release]`，不匹配会一直 `queued`） |
| 运行身份 | 当前登录用户（需能读写发布目录、执行 `pm2`、读 `~/.ssh`） |
| 安装 | `~/actions-runner` 下 `config.sh` → `./svc.sh install && ./svc.sh start`（开机自启） |

⚠️ **最容易踩的坑**：runner **不读 shell rc**（`.zshrc` 不生效），PATH 里可能没有 node/pm2（本项目用 fnm 管理 node），表现为 `nest: command not found` / `pm2: command not found`。
给 runner 配环境文件（`~/actions-runner/.env`），改完 `./svc.sh stop && ./svc.sh start`：

```
PATH=/Users/geekwen/.local/share/fnm/node-versions/v20.20.2/installation/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin
```

### 2.2 仓库 Variables（非敏感）

| 名称 | 用途 | 默认 |
|---|---|---|
| `RELEASE_DIR` | 发布目录绝对路径 | 未配时用 `/Users/geekwen/web_system_release` |

### 2.3 仓库 Secrets

| 名称 | 取值 |
|---|---|
| `RELEASE_HOOK_URL` | `http://127.0.0.1:6200` |
| `RELEASE_HOOK_SECRET` | 与发布平台 `servers/deploy-console/.env` 的 `RELEASE_HOOK_SECRET` **一致** |

> **触发与轮询共用这一把密钥**做 HMAC 验签（轮询走 `GET /api/hooks/pipelines/:jobId`），
> 因此**不再需要** `DEPLOY_CONSOLE_TOKEN` —— 控制台 JWT 是 `expiresIn: 24h` 的短期登录态，
> 放进 secrets 次日即 401；且权限覆盖发布/取消/审批，交给 CI 等于放大凭据面。
>
> 取密钥（复制到 GitHub Secrets）：
> ```bash
> grep '^RELEASE_HOOK_SECRET=' ~/web_system_release/servers/deploy-console/.env | cut -d= -f2-
> ```

---

## 3. 一次发布看什么

| 看什么 | 在哪 |
|---|---|
| Actions 运行记录（含每个模块的结果） | 仓库 **Actions → release** |
| 平台侧流水线（版本/日志/审计） | 控制台「发布流水线」页（`https://local.kedouai.com/console/`） |
| deploy-console 直连发布的输出 | Actions job 日志（等同于在发布目录跑 `publish-deploy-console.sh`） |
| 当前各模块版本 | 控制台首页 / `GET /api/deploy/modules` |

**分流的判据**：`git diff` 本次 push 的改动路径，取 `servers/*` 与 `apps/*` 的目录名 = moduleKey。

---

## 4. 手动触发

Actions → release → **Run workflow**：
- `env`：目标环境（默认 `local`）
- `modules`：模块 key，逗号分隔；留空 = 自动解析本次改动

---

## 5. 常见失败与处置

| 现象 | 原因 | 处置 |
|---|---|---|
| job 一直 `queued` / 无 runner | runner 未启动或 label 不匹配 | `cd ~/actions-runner && ./svc.sh status`；确认 label 为 `local-release` |
| CI 报 401「签名校验失败」 | 平台 `.env` 与 GitHub Secret 的密钥不一致 | 对齐两边后重跑（手册 §2.2） |
| CI 报 401「时间戳超出允许窗口」 | 本机时钟偏差 > 5 分钟（窗口 300s） | 校准系统时间 |
| `nest: command not found` / `pm2: command not found` | runner 的 PATH 缺 node/pm2（见 §2.1） | 配 `.env` 后 `./svc.sh stop && ./svc.sh start` |
| 提示"发布目录有未提交改动，拒绝发布" | 发布目录被手工改脏 | 在发布目录 `git status` 处理干净后重跑 job |
| `ff-only 快进失败` | 发布目录有分叉提交 | 进发布目录查 `git log --oneline origin/feature/test..HEAD`，人工处理后重跑 |
| 某模块 `发布失败（failed）` | 平台流水线失败 | 按 job 日志里的 jobId 去控制台看该流水线日志 |
| 6023/6200 端口被占、服务起不来 | 端口被非 pm2 进程（孤儿）占用 | `scripts/publish-deploy-console.sh` 已内建清理与一致性校验；仍失败时按 `docs/development/local-release-runbook.md` 处理 |
| 改动只有文档，却跑了发布 | 不会 —— 解析不到 `servers/apps` 改动时 job 直接跳过 | 若确实发生，检查是否误改了模块目录下的非代码文件 |

---

## 6. 与其它发布通道的关系

| 通道 | 场景 | 是否走平台治理 |
|---|---|---|
| **本 workflow**（`feature/test` 合并） | 日常联调自动发 local | 普通模块 ✅；deploy-console ❌（直连，见设计文档 §五 B） |
| 控制台手动发布 | 任意模块/环境（含 prod 审批） | ✅ |
| MCP 工具 `publish_pipeline` | AI/CLI 触发 | ✅ |
| `workflow_dispatch`（本 workflow） | 补发/指定模块 | 同上两类分流 |

> 注：本地轮询 watcher（`scripts/watch-integration.mjs` + pm2 `web-release-watcher`）已于 2026-09-11 **停用**，由本 workflow 取代。脚本保留在仓库里，如需兜底可临时启动：`pm2 start scripts/watch-integration.mjs --name web-release-watcher --interpreter node`。
