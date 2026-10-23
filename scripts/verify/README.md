# scripts/verify/ — 发布后固定验收脚本

发布完成后跑**固定、不靠人记**的验收清单。退出码 0 = 全部通过，非 0 = 有失败。

## 脚本清单

| 脚本 | 用途 | 用法 |
|---|---|---|
| `verify-deploy-console.sh` | deploy-console 发布后验收（端口/静态页/API/pm2/崩溃循环） | `bash scripts/verify/verify-deploy-console.sh [--host local\|dev\|prod] [--quick]` |
| `verify-frontend.sh` | 微前端模块发布后验收（manifest/静态资源/index.html） | `bash scripts/verify/verify-frontend.sh <env> <moduleKey> [versionTag]` |
| `verify-backend.sh` | 后端服务验收（wrapper → 真源在 deploy-console 内） | `bash scripts/verify/verify-backend.sh <env> <moduleKey> [versionTag]` |
| `verify-business-chain.sh` | 跨服务业务链路（gateway→auth→user→ai） | `bash scripts/verify/verify-business-chain.sh <env>` |

## 快速用法

```bash
# deploy-console 发布后（本地）
bash scripts/verify/verify-deploy-console.sh

# deploy-console 发布后（dev 机）
bash scripts/verify/verify-deploy-console.sh --host dev

# 前端模块发布后
bash scripts/verify/verify-frontend.sh dev portal

# 后端服务发布后
bash scripts/verify/verify-backend.sh dev user-service

# 业务链路验收
bash scripts/verify/verify-business-chain.sh dev
```

## 设计原则

1. **固定清单** — 写死检查项，不依赖人记
2. **退出码判红** — 0 = 通过，非 0 = 失败（CI/发布脚本据此判定）
3. **幂等** — 可以反复跑，不改任何状态
4. **独立** — 不依赖其他脚本，单文件可执行

## 与现有脚本的关系

| 现有脚本 | 关系 |
|---|---|
| `health-check.sh` | 运维巡检（日常健康检查），本目录是**发布验收**（发布后必须过） |
| `dev-verify.sh` | 开发者本地验证（DB + 单测 + 集成 + 健康），本目录只做发布验收 |
| `publish-deploy-console.sh` 内嵌复检 | 发布脚本仍保留内嵌复检 + 自动回滚，本目录是**额外的固定验收层** |
| `pipeline/verify-backend.sh` | 已 DEPRECATED，真源在 deploy-console 侧 |
