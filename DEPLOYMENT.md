# Web System 部署指南

> ❌ **本文已废弃并瘦身（2026-11-04）**。原文停留在 2026-09 口径，约 320 行正文已全部移除，
> 仅在 git 历史中保留：`git show 84667dee:DEPLOYMENT.md`。
> **保留本文件只为让旧链接能跳到正确位置**，不要再往这里补内容。

作废原因（原文与现状的冲突，逐条可复核）：

| 原文口径 | 现状 |
|---|---|
| 端口全篇 `3000/3001/3002/3003/3004` | dev/prod 均 **6000 系**（gateway 6000 / deploy-console 6200） |
| 目录 `apps/admin-web` | `apps/admin` |
| `scp` + `pm2 restart all --update-env` 当部署 | 发布走 deploy-console 流水线；`--update-env` 会固化会话变量，是**反模式** |
| `DB_DATABASE=web_system`、`git pull` 当部署 | 非当前口径，见工程总入口 |
| `PORT=3000` / `HOST=0.0.0.0` 等 `.env.production` 段 | 已作废，配置按服务目录 `.env` 收口 |
| 无微前端 manifest / env-dir 指针 / 静态外置 / 云库双数据源 | 均已落地，见架构总览 |

## 现在该看哪里（按问题路由）

| 你要问的 | 唯一真源 | 入口 |
|---|---|---|
| **架构与部署现状总览** | 系统平台架构与部署总览 | [`docs/architecture/system-overview.md`](./docs/architecture/system-overview.md) |
| 端口 / 服务清单 / 目录 / 技术栈 | 工程总入口 | [`README.md`](./README.md) §2 / §5 / §7 |
| **怎么发布某个模块** | `web-system-deploy` skill | `~/skills/web-system-deploy/SKILL.md`；后端预演 `bash ~/skills/web-system-deploy/scripts/publish.sh plan dev <svc>` |
| 全部文档怎么找 | 文档总索引 | [`docs/INDEX.md`](./docs/INDEX.md) |
| 本地起服务 / 验证 | 本地开发指南 | [`docs/development/local-dev-guide.md`](./docs/development/local-dev-guide.md)、[`docs/development-guide.md`](./docs/development-guide.md) |
| 数据库迁移 | `apply-migrations.sh` | `bash scripts/apply-migrations.sh dev\|prod\|local`（`DRY_RUN=1` 预演）；说明见 `docs/development-guide.md` |
| 红线 / 动作门 / commit trailer | 协作指令速查 | [`docs/协作指令速查.md`](./docs/协作指令速查.md) |
| 常见问题排查（原 §四） | 速查卡 §4 工程红线 | 原 §四的 3000 端口、`pm2 restart --update-env`、`lsof -i :3000` **全部作废**，勿复用 |
| Nginx / 网关配置 | 架构总览 + 仓库根配置文件 | `nginx-*.conf` / `local.nginx.conf`；原文 §二 的 3000 反代已作废 |

> 🔴 **历史正文只作考古，不作事实来源**。检索到 `PORT=3000`、`admin-web`、`deploy-dev.sh`、
> `pm2 restart all --update-env` 等字样，一律判定为 2026-09 快照，不得据此动手。
