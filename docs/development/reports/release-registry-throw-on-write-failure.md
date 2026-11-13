# 修复 release-registry 新表写失败「只告警」→「抛出」（不留半发布）

> 类型：缺陷修复（后端 deploy-console）
> 关联设计：`docs/development/reports/half-release-guard-design.md`（半发布治理三合一，哲学基准）
> 负责人：rd-engineer（编码 + TDD 红转绿）· 方案由 rd-dept 出具
> 方案真源：`~/AiWorkspace/20-私域资产/研发方案与发布规范-v2.md`（技术方案九子项）
> 门禁凭证：`Plan: docs/development/reports/release-registry-throw-on-write-failure.md`
> 用户拍板：2026-11-13「按默认来」= 方向①（改抛出）

---

## 0. 元信息

| 项 | 值 |
|---|---|
| 版本 | v1（2026-11-13） |
| 负责人 | rd-engineer |
| 关联需求/事故 | 半发布治理（2026-11-12 设计稿哲学对齐） |
| 仓库 | `/Users/geekwen/workspace/web_system`（主库，master = `1eb7c341`） |
| 涉及服务 | `servers/deploy-console` |
| 原型 sha / PR / commitId | 无 UI 改动；PR 待提交后回填 |

---

## 1. 背景与目标

### 1.1 问题陈述

`servers/deploy-console/src/registry/release-registry.service.ts` 的 `syncAppEnvPointerInner`（约 227-261 行）在当前实现里，本地库 `deploy_app_env_versions` 写失败时只 `logger.warn` 后 `return`，把失败吞掉。其上层 `setPointer` 因此 `resolves` 成功 → 调用方（流水线 `pointer` 步骤、编排收尾兜底）认为发布成功，但实际 `deploy_app_env_versions`（**gateway 前端唯一读取源**）没写上新版本 = 静默「半发布」。

这直接违反 `half-release-guard-design.md` 确立的底线：「本地成功 + 云库失败 = 流水线显示成功、prod 实际仍跑旧版本…宁可让任务红掉，也不要静默不一致」。该设计稿第 2 条（云库镜像失败 → 抛出）已落地；**第 1 条（本地写失败）却被旧注释「只告警（2026-10-08）」挡住**，本次补齐。

### 1.2 目标用户与场景

- **直接受影响**：prod 访问 env-dir 应用的终端用户（gateway 读的表停旧版 → 错版前端/旧 API）。
- **操作者**：经 deploy-console 发布流水线的研发/运维；巡检 agent。

### 1.3 验收目标

1. `setPointer` 时 `appVersionRepo.save`（新表）失败 → 调用方收到 rejected、发布判 failed，不再静默 succeeded。
2. 既有 2 个防御用例（半成品，工作区未提交）由红转绿；整包 jest 全绿。
3. 不改动「云库镜像失败 → 抛出」既有语义；不改动幂等/未登记模块早退逻辑。

---

## 2. 方案

### 2.1 改动面（唯一代码文件）

`servers/deploy-console/src/registry/release-registry.service.ts`：

1. `syncAppEnvPointerInner` 的 catch 块（现有 `this.logger.warn(...); return; // 本地都没写成功，没有可信数据可镜像`）：
   - 保留 `logger.warn`（运维排障线索）；
   - 改为 **`throw e;`**（不改写错误信息，保住 spec 断言的 `'db down'`）；
   - 删除 `return;` 行（抛出即不会走到镜像，天然「没有可信数据可镜像」）。
2. 三处注释更新，记录 2026-11-13 决策翻转：
   - 207-219 行方法 doc「失败语义」第 1 条：「本地库写失败 → **只告警**（2026-10-08）」→「本地库写失败 → **抛出**（2026-11-13 翻转，取代 2026-10-08 的只告警：deploy_app_env_versions 已是 gateway 前端唯一读取源，静默成功=半发布事故放大器，宁可任务红）」；第 2 条（云库镜像失败抛出）保留。
   - catch 内旧注释随新语义改写。
   - 264-275 行另一方法 doc 中「`syncAppEnvPointer` 用于 `setPointer` 的**附赠同步**：本地失败只告警」→「本地失败抛出（2026-11-13 翻转，不留半发布）」。

### 2.2 测试（半成品，工作区已就绪，勿动断言）

`servers/deploy-console/src/registry/release-registry.service.spec.ts`（工作区 `M` 状态，2 个用例已改）：

- `setPointer 双写：新表（deploy_app_env_versions）写失败 → 抛出，不静默「半发布」`（断言 `rejects.toThrow('db down')`）
- `分流：本地 deploy_app_env_versions 写失败 → 抛出且不镜像（不留「半发布」）`（断言 `rejects.toThrow('db down')` + `mirrorPointer` 不被调用）

rd-tester 实测现状（2026-11-13）：该 spec **33 用例中 2 失败**（实现 resolved undefined）；其余 31 全绿。改实现后期望 33/33。

### 2.3 影响面（调用方）

`setPointer` / `syncAppEnvPointer` 调用方：`pointer.executor.ts`、`pipeline.service.ts` 编排收尾兜底、`internal-release.controller.ts`。这些调用方当前**未**捕获本方法抛错（半发布治理设计稿已确认它们期望 strict 语义），故抛出会正确上抛为发布失败。改动前 rd-engineer 须只读核对是否有外层 catch 把新抛错再吞掉，若有须上报而非自行处理。

---

## 3. 验证判据

| # | 判据 | 验证方式 |
|---|---|---|
| V1 | 单 spec 红转绿 | `cd servers/deploy-console && npx jest src/registry/release-registry.service.spec.ts` → Tests: 33 passed, 0 failed |
| V2 | 整包回归全绿（CI 同跑法） | `cd servers/deploy-console && npx jest --runInBand` → 全绿 |
| V3 | 无外层 catch 吞错 | `grep -rn "setPointer\|syncAppEnvPointer" src/ --include="*.ts" | grep -v spec` 报告调用方吞错情况（应无） |
| V4 | 门禁 | commit 不带 `Design: pass`（纯后端 PR 零摩擦，R11 不触发）；R23 TestScope 仅 warning，非公共层改动 |

---

## 4. 文件面

| 文件 | 改动 |
|---|---|
| `servers/deploy-console/src/registry/release-registry.service.ts` | catch 改 throw + 三处注释 |
| `servers/deploy-console/src/registry/release-registry.service.spec.ts` | 工作区半成品 2 用例（已改，随本次提交） |

---

## 5. 实施顺序

| 序 | 步骤 |
|---|---|
| S1 | TDD：实现 catch 改 throw（不碰 spec 断言） |
| S2 | 单 spec 33/33 + 整包 jest 全绿取证 |
| S3 | 分支提交 → PR → auto-merge → master ff → 清理临时分支 |
| S4 | 交付 lead 做台账闭环（#8860 / #8865） |

## 6. 回滚

纯行为变更、无 DDL、无新增表。回滚 = revert 该 commit 即恢复「只告警」旧语义。

## 7. 风险

| # | 风险 | 爆炸半径 | 缓解 |
|---|---|---|---|
| R1 | 抛出后某些调用方未预期 reject → 发布判 failed 比例上升 | 仅影响新表写失败的发布（本就不应成功） | V3 核对无外层吞错；半发布治理设计稿已确认调用方期望 strict |
| R2 | 瞬时 DB 抖动被放大为发布失败 | 该次发布重试即可 | 保留 warn 日志供排障；与云库镜像失败既有语义一致 |

## 8. 需要用户拍板（已拍板）

| # | 问题 | 结论 |
|---|---|---|
| P1 | 新表写失败语义：改抛出 vs 维持告警 | **改抛出**（2026-11-13「按默认来」= 方向①） |

## 9. 执行记录

- rd-engineer 接手执行（2026-11-13）：按方案改 catch 为 throw + 三处注释，跑测试后提交 PR。
