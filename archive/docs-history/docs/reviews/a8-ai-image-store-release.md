# 发布评审 · A8（ai-service 生成图改调 internal/uploads/store）

> 判据源：`docs/development/release-review-checklist.md`；改动：`servers/ai-service`（bianbian 落盘改造 + 新增 `UPLOAD_SERVICE_URL`）。

阻塞: 0
重要: 2

## A. 运行面

| # | 结论 | 证据 |
|---|---|---|
| A1 | ✅ 待发布时执行 | 本次仅代码合入，发布走 `scripts/publish-deploy-console.sh` 之外的服务发布流程（构建在发布目录） |
| A3 | ✅ 无需 | 未改 `packages/*` |
| A4 | ✅ | 本地：`lsof -ti tcp:6008` == pm2 `web-upload` pid（45865），upload-service online 43h |
| A5 | ✅ | `web-upload` 已在 pm2 登记 |

## B. 配置面

| # | 结论 | 证据 / 待办 |
|---|---|---|
| B1 | ✅ 约束 | 发布 ai-service 用干净 env（`env -i` / pm2 delete+start），**不用 `--update-env`** |
| B2 | ✅ 一致 | ai-service 与 upload-service 的 `INTERNAL_API_KEY` **完全相同**（dev 侧比对通过，长度 47；本机同值） |
| B3 | ✅ 已完成 | 新增 `UPLOAD_SERVICE_URL`：本地 .env 配 6008；**dev 已补 `UPLOAD_SERVICE_URL=http://127.0.0.1:6008`** 并重启 ai-service（online，restarts=1）；prod 待 upload-service 上线后同法配置 |
| B4 | ✅ | 无 `REPLACE_` 占位符 |
| B5 | ✅ | 配置源为各服务 `.env`，无外部注入覆盖 |

## C. 数据面

| # | 结论 | 说明 |
|---|---|---|
| C1/C2/C3 | ✅ 不适用 | 无迁移、无 DDL |
| C5 | ✅ 不适用 | 无 DB 能力绑定变更 |
| C6 | ✅ 有回滚 | ① 代码回滚（旧版仍本地落盘）；② 运行时降级：store 调用失败自动回退存 MaaS 远端 URL，`aiImage` 字段语义本就兼容「本地 URL 或远端 URL」 |

## D. 前端面

✅ 不适用（未改前端；`aiImage` 值域不变，Portal / 小程序零改动）

## E. 验证记录

- 单测：`servers/ai-service` 新增 8 例（此前 0 spec），全通过；`tsc --noEmit` 与 `nest build` 通过
- 契约实测：`POST http://127.0.0.1:6008/internal/uploads/store`（multipart + `x-internal-key`）→ `{code:0,data:{url:"/api/uploads/bianbian/…png"}}`
- 访问实测：`https://local.kedouai.com/api/uploads/bianbian/…png` → 200

## dev 已验证（2026-09-24）

- dev `ai-service/.env` 补 `UPLOAD_SERVICE_URL=http://127.0.0.1:6008`，重启后 online（restarts=1，无错误日志）
- 用 **ai-service 自己的 `INTERNAL_API_KEY`** 调 `127.0.0.1:6008/internal/uploads/store` → `{code:0, data:{url:/api/uploads/bianbian/…png}}`
- 产物落在**统一根** `/data/web_system/uploads/bianbian/`（不再是 ai-service 的 `cwd/uploads`）→ 收口目标达成
- 公网访问 `https://dev.kedouai.com/api/uploads/bianbian/…png` → **200**

## 待办（发布前）

1. ✅ dev 已完成（见上）
2. prod：upload-service **未运行且端口未登记**（见 `dev-env-config-inventory.md`）→ 需先起服务、配 `UPLOAD_SERVICE_URL` 再上 A8；未起前 prod 新生成图会走回退（存远端 URL，功能可用但不符合收口目标）
