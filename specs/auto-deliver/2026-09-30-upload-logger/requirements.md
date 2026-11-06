# 需求规格 · upload.controller 日志合规化（Tier1 验证用例）

> 来源：全自动交付编排中枢 `wb-auto-deliver` 端到端验证用例。
> 状态：**已交付**（2026-10-16）— 实现与验证见 `plan.md` §6，commit `794267e3`。
> 改动域：`servers/upload-service/src/upload/upload.controller.ts`（单文件、纯内部）。

## 1 背景

web_system monorepo 横切铁律（`.codebuddy/rules/coding-best-practices.md` 一.6）：**日志统一走 NestJS `Logger`，禁止 `console.log`**。
`UploadController.persist()` 的 catch 分支仍用 `console.warn`（第 148 行），是唯一残留点，违反该铁律，且破坏日志集中与级别可控。

## 2 目标

将 `UploadController` 内的 `console.warn` 替换为 `NestJS Logger`，语义不变（仍是「元数据写失败只告警，不让上传在用户眼里失败」）。

## 3 验收判据（EARS + 反例）

| ID | 判据 | 反例 / 边界 |
|----|------|-------------|
| AC1 | 当 `UploadController` 被实例化时，类必须持有 `Logger` 实例（`new Logger(UploadController.name)`） | 不得用 `console.*` 充当日志通道 |
| AC2 | 当 `persist()` 的 `recordUpload` 抛错时，系统 SHALL 通过 `this.logger.warn(...)` 输出含 `[upload] 记录上传元数据失败` 的告警 | 不得调用 `console.warn` |
| AC3 | 源码中该控制器不得再出现 `console.log/warn/error` | grep `console\.` 于该文件须 0 命中 |
| AC4 | 新增单元测试 SHALL 证明：recordUpload 抛错时 `console.warn` 未被调用、且 `Logger.warn` 被调用一次含预期文案 | recordUpload 成功时不得产生任何 warn 日志 |
| AC5 | 上传成功响应语义不变（`{ code: 200, data }`） | 不影响 `avatar/drawing/general` 等上传接口行为 |

## 4 待确认

- 无。改动可逆、纯内部、不命中任何门禁（见 plan.md 分档判定）。

## 5 影响面（自检）

- 不新增/修改任何 `@Get/@Post` 路由 → 不命中「新增对外接口评审门」。
- 不碰 `packages/types`、`agent-core`、迁移、`ecosystem.config`、`.env`、发布脚本、CI → 不命中契约/发布/数据门。
- 不碰 `apps/**`、`.vue`、`*.wxml` → 不命中 UI 门。
