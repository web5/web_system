# 契约评审报告 · C7 Agent 生成参数与模型清单

阻塞: 0
重要: 2

- 评审对象：`feat/llm-tuning-multi-model`（基于 origin/master `e072bea2`）
- 判据源：`docs/api/contracts.md` §7（C7，含 C7-a…C7-h）与 §8（契约变更纪律）
- 评审日期：2026-10-10
- 评审方式：**只读**全仓消费方排查（列出 import 型 / 手写型 / 字面量型全部命中点）+ 实现者逐条回应；
  报告落盘 `docs/api/reviews/`，供后续 commit trailer `Contract: pass` 引用

---

## 0. 本次改了什么契约

| 变更 | 类型 | 说明 |
|---|---|---|
| `AgentDefinition` 新增 `maxTokens` / `topP` / `thinking` | **契约面新增**（C7） | `packages/agent-core/src/interfaces/agent.interface.ts` |
| `AgentDefinition.temperature` 由 `number \| undefined` 放宽为 `number \| null` | 契约面放宽 | 让 DB 的 nullable 列能直落，不用再 `?? undefined` |
| `agent_definitions` / `agent_definition_versions` 各加三列 | 数据面 | 迁移 `archive/migrations/p35-*.mjs` |
| ai-service Agent 链路模型装配 → 字典驱动 | 装配面 | 新增 `servers/ai-service/src/agent/model-catalog.service.ts` |

---

## 1. 阻塞项（0）

无。**发现 1 项已在本次实现中修复**（见 §3 修复记录），2 项降为「重要」。

---

## 2. 重要项（2）

| # | 项 | 位置 | 判据 | 建议 |
|---|---|---|---|---|
| I-1 | admin 定义表单没有新三字段，`SaveAgentDefPayload` 缺 `maxTokens` / `topP` / `thinking` | `apps/admin/src/api/agent-defs.ts:43,74`、`views/Agents/AgentDefList.vue:133-144` | C7-a（三处同步）的**UI 侧未闭环**：后台不能配，只能通过 DB / 迁移回填 | **走 UI 门**补表单（原型 → 独立交互质检 → 人确认 → 单独 commit + `Proto: <sha>`）。已登记为 `contracts.md` §9 **D10** |
| I-2 | 表单把 `null` 强转成 `0.7`（`def.temperature ?? 0.7`、默认值写死 0.7） | `apps/admin/src/views/Agents/AgentDefList.vue:261,354` | 违反 **C7-e**：`null` 的语义是「沿用客户端默认」，被转 0.7 后一保存就写死，存量「未配置」的定义被改写 | 同 I-1 一起改：默认值改 `null`，回填不兜底；UI 上给出「留空 = 沿用默认」提示 |

---

## 3. 一致性核对结果

### C7-a 三处同步 ✅

| 环节 | 位置 | 状态 |
|---|---|---|
| 契约面字段 | `interfaces/agent.interface.ts` | ✅ 四字段齐全 |
| DB 列（当前 + 版本快照） | `agent-definition.entity.ts` / `agent-definition-version.entity.ts` | ✅ 各三列 |
| 引擎入参 | `agent-engine.ts` 构造 `ChatOptions` | ✅ 只透传非 null |
| 下发映射 | 两个 `agent-def-sync.service.ts` | ✅ 均已补 + `parseThinking()` 兜脏数据 |

### entity → AgentDefinition 映射点：只有 2 处 ✅

全仓确认**没有第三处**：`servers/ai-service/src/agent/agent-def-sync.service.ts` 与
`servers/ai-agent/src/agent/agent-def-sync.service.ts`。
`agent-def.service.ts#getPublished()` 直接返回原始 entity（新 `@Column` 自动进 JSON），
因此不存在「漏下发」的第三条通道。

### `temperature` 放宽为 `| null` 的行为面 ✅ 无断链

全仓**不存在** `=== undefined` / `!== undefined` / `if (x.temperature)` 真值判断的写法；
`ChatOptions.temperature` 仍保持 `number | undefined`（`base-ai.client.ts:102`），
`AgentEngine` 只在 `!= null` 时赋值 → null 不会漏到客户端的 `?? 0.7` 兜底。
> ⚠️ 后续若图省事把 `ChatOptions` 也放宽成 `| null`，会让 hy3/tokenhub 共 6 处 `?? 0.7` 失效 —— **不要改**。

### 包级再导出 ✅ 已登记

`src/index.ts` 对 `interfaces/agent.interface` 是 `export *`：契约面新增字段对所有 import 方
**编译期即自动可见**，删字段会直接编译失败（比静默失效好）。
（旧结论「无包级再导出」见 `docs/reviews/contract-review-2026-10-08-intent-routing.md:207`，已过时；
新增判据 **C7-g** 写进 contracts.md。）

### 向后兼容 C7-e ✅

新增字段全为 `null` 时，`AgentEngine` 构造出空 `ChatOptions {}`，等于「不传」，
客户端走 `?? 0.7` 兜底 —— 与改动前**逐字节一致**，`packages/agent-core` 70 个单测全绿佐证。

### ai-service 模型字典化 ✅ 无覆盖冲突

`ModelCatalogService#apply()` 的 `registry.clear()` 只作用于 **agent-core 的 `ClientRegistry`**
（由 `agent.module.ts` 的 `clientRegistryProvider` 创建），与 ai-service 自研的
`servers/ai-service/src/common/client.registry.ts`（普通 chat 链路，另一套客户端实现）
**不是同一个实例**，互不干扰。`hy3` 每轮重建后被补回，清单里混入 `hy3` 会被忽略并 WARN。

### 迁移脚本 ✅ 幂等

`information_schema` 守卫加列、无回填、三列全 nullable；表不存在则跳过。
`EMIT_SQL=1` 已本地验证输出 6 条 `ALTER TABLE`。

---

## 4. 修复记录（评审中发现 → 本次已修）

| 项 | 处理 |
|---|---|
| **老前端保存会清空新三字段**（原 `row.maxTokens = payload.maxTokens ?? null`） | 改为**「传了才覆盖」**（`payload.maxTokens !== undefined` 才赋值），并把这条升格为契约 **C7-h**。这样：老前端保存不清空、新前端带值才更新、要清空显式传 `null`；`temperature` 沿用原有全量语义，避免动到既有行为造成回归 |

---

## 5. 建议项（非阻塞）

| # | 项 | 位置 |
|---|---|---|
| S-1 | e2e 用 `row as unknown as AgentDefinition` 零字段断言，绕过 `typeof` 校验与 `parseThinking()` | `servers/ai-agent/e2e/contract-risk/run-eval.ts:96` |
| S-2 | 两个 `*/.codebuddy` 种子 SQL 列名口径过期（蛇形 `system_prompt` / `max_steps`），且未含新列 | `scripts/seed-music-agent.sql:38`、`specs/kedou-ai-minigram/agent-translate.sql:15` |
| S-3 | `ai-service` 普通 chat 链路仍走自研 `common/http/deepseek.client.ts`（官方直连、独立 key），与 TokenHub 双轨 | 建议后续收敛到 TokenHub（属 D9 残留） |

---

## 6. 结论（契约门）

**阻塞项 0，可以带 `Contract: pass` 提交**。

本次的核心风险不在「加字段」，而在「同一个参数散落在契约面 / DB 列 / 引擎入参 / UI 表单四处」——
这正是 C7 存在的理由；四处中本次闭环了三处，UI 侧（I-1 / I-2）因需过 UI 门单独排队，
已用后端 C7-h 兜住「被清空」的最坏情况，避免边做 UI 边丢数据。

---

## 7. 附：数据面自查（交付环节 · 发布门 C 面）

命中面：`archive/migrations/p35-agent-def-tuning-params.mjs`（新增，**本次未执行**）。

| 判据 | 结论 |
|---|---|
| 落到哪个库 | `agent_definitions` / `agent_definition_versions` 在 **`web_system`**（业务库）；与 `web_system_deploy`（流水线库）无关，不会落错库 |
| 是否破坏存量 | 三列全 nullable，**无回填、无 UPDATE、无 DROP**；存量行保持 NULL = 沿用旧行为 |
| 幂等性 | `information_schema` 守卫加列 + 表不存在则跳过；重复跑全部跳过 |
| 回滚路径 | 脚本头部注释写了两条 `DROP COLUMN`（且需与代码侧一起回，单删列会让运行代码查不到列） |
| 执行顺序（纪律第 8 条） | **先发带新列的代码 → 再跑迁移 → 最后在后台填值**；顺序反了就是「绑定即故障」 |
| 环境差异 | dev 库在 dev 机本地 MySQL；prod 在云数据库（本机连不上 → `EMIT_SQL=1` 导出 SQL 再 scp 执行，已本地验证输出 6 条 DDL） |

**结论：阻塞项 0，可带 `Release: pass` 提交**（迁移本身的执行留作独立运维动作，不在本次 commit 内执行）。
