# web_system 网络架构（dev 环境流量与运维链路）

> ❌ **本文已废弃并瘦身（2026-11-04）**。原文 113 行停留在 2026-08 拓扑，正文已全部移除，
> 仅在 git 历史中保留。保留本文件只为让旧链接能跳到正确位置。
>
> 主要原因：pm2 服务数写 6 个（实际 12 个）、无 prod 运行目录与静态外置、
> 无 deploy-console 本地库/云库按环境分流、安全组端口清单与现状不符。
> 配图 `.drawio` / `.svg` 同样过期，仅供历史追溯。

## 现在该看哪里

| 你要问的 | 唯一真源 |
|---|---|
| 环境拓扑 / 域名 / 机器角色 | [`system-overview.md`](./system-overview.md) §9「环境拓扑」 |
| 端口 / 服务清单 | [`../README.md`](../README.md) §5、[`system-overview.md`](./system-overview.md) §3 |
| 全部文档路由 | [`../INDEX.md`](../INDEX.md) |
| 发布能力入口 | `~/skills/web-system-deploy/SKILL.md`；[`../README.md`](../README.md) §7.1 |
| 安全披露 / 公开仓库去敏 | [`../SECURITY.md`](../SECURITY.md) |

> 🔴 历史正文只作考古，不作事实来源。检索到「pm2 服务 × 6」「Caddy :80」「{{GATEWAY_HOST}}」
> 等字样，一律判定为 2026-08 快照，不得据此动手。
