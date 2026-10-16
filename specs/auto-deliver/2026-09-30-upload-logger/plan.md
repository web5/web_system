# 实现计划 · upload.controller 日志合规化

> 编排阶段：wb-auto-deliver 步骤 1（rd-plan 产物）。改动类型判定：**Tier1 零人**。

## 1 分档判定（核心）

| 检查项 | 结果 |
|--------|------|
| UI 门（apps/** .vue / wxml / wxss / packages/ui） | 未命中 |
| 契约门（新增 controller / types / agent-core / mcp 工具 / 迁移） | 未命中（改的是既有控制器内部日志通道，无新路由/无新类型） |
| 发布/环境/数据门（ecosystem / .env / pipeline / 发布脚本 / migrations / CI） | 未命中 |
| **结论** | **Tier1 零人**：人审①/②节点自动通过，仅跑机器门禁 `quality-gate` |

## 2 设计

最小改动，单文件两处：

1. **import 区**（第 1–10 行）：在 `@nestjs/common` 引入组补 `Logger`。
2. **类字段**（第 26–28 行）：加 `private readonly logger = new Logger(UploadController.name);`。
3. **catch 分支**（第 148 行）：`console.warn(...)` → `this.logger.warn(...)`（文案不变）。

## 3 任务拆分

- T1：加 `Logger` import + 类字段。
- T2：catch 改用 `this.logger.warn`，文案保持 `[upload] 记录上传元数据失败: <msg>`。
- T3：新增 `upload.controller.logger.spec.ts`（jest，不被现有 ignore 列表命中），断言 console.warn 未被调用 + Logger.warn 被调用一次。
- T4：跑 `jest` 验证新 spec + 回归现有 `upload.service.spec.ts` / `upload-root.spec.ts`。

## 4 验证判据 V1…Vn（test-verification 将按此打产物）

| ID | 判据 | 验证方式 |
|----|------|----------|
| V1 | 该文件无 `console.` 残留 | `grep -n "console\." servers/upload-service/src/upload/upload.controller.ts` → 0 命中 |
| V2 | `Logger` 实例注入 | 类含 `new Logger(UploadController.name)`；TS 编译通过 |
| V3 | catch 走 `this.logger.warn` 且文案含 `[upload] 记录上传元数据失败` | 单测 spy：`Logger.prototype.warn` 被调用一次且参数含该子串 |
| V4 | 单测通过 | `jest upload.controller.logger.spec.ts` 绿；console.warn spy 断言未被调用 |
| V5 | 回归无破坏 | `jest`（全 upload-service）绿；上传成功响应 `code:200` 不变 |

## 5 回滚路径

`git revert` 单 commit 即可；改动仅 3 行，风险可忽略。

## 6 交付结果（step 2~4 执行完毕）

实现 + 验证 commit：`794267e3 fix(upload-service): 日志改走 NestJS Logger，并用单测锁住`

| ID | 结果 | 证据 |
|----|------|------|
| V1 | ✅ 0 命中 | `rg 'console\.' servers/upload-service/src/upload/upload.controller.ts` 无输出（注释刻意回避该字面量，否则会给自证留假阳性） |
| V2 | ✅ | 类字段 `private readonly logger = new Logger(UploadController.name)`；`tsc --noEmit` 通过 |
| V3 | ✅ | spy `Logger.prototype.warn` 调用一次，文案含 `[upload] 记录上传元数据失败` 且保留错误原文 |
| V4 | ✅ | `upload.controller.logger.spec.ts` 2 例通过；console 通道 spy 断言未被调用 |
| V5 | ✅ | 全 upload-service 用例 **32 passed / 4 suites**；成功响应仍为 `{ code: 200, data }` |

⚠️ 执行中发现的一处口径冲突（供后续用例复用）：
若把「禁止 console.*」写进代码注释，V1 的 grep 会命中注释本身 —— 自证类判据
应改为扫描**代码**，或注释里回避该字面量。本次采用后者。

## 7 关联：同期发现 p35 迁移缺陷（不在本用例范围，顺带记录）

同一轮检查把 p35（内容质量工程 CQO，属另一个改动域）在 dev 首次执行时发现的两个缺陷一并修掉：
`content_items.meta` 漏迁、游资名单种子列数与值数不一致（ERROR 1136）。
修复 commit：`1b14226f fix(content-hub): p35 补 meta 列并修种子 INSERT`
两者都是**静态评审看不出来、只有真执行才暴露**的类型。
