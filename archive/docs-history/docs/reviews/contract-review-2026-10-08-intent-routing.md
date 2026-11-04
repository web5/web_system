阻塞: 0
重要: 3

# 契约评审报告 · 意图路由修复（intent-routing）

> 评审角色：`contract-reviewer`（独立第三方 · 只评审与回流，不改码）
> 判据源：`docs/api/contracts.md`（C1–C6 · §7 变更纪律）
> 评审对象：分支 `docs/architecture-overview-v1` 的**未提交工作区改动**（`git status --short` / `git diff`）
> 评审时间：2026-10-08

---

## 0. 结论摘要

| # | 评审重点 | 结论 |
|---|---|---|
| 1 | agent-core 公开包新增 `thinking?` 可选字段 + 新增导出 `ThinkingOption` | ✅ **非破坏性**。类型面零外部消费方；两个服务的 `tsc --noEmit` 均 EXIT=0 |
| 2 | `thinkingPayload` 优先级语义（按调用 > env > 按模型推断） | ✅ **对既有调用逐字段等价**；⚠️ 但显式传值会绕过 env，且会让 hy3 兜底路径首次携带 `thinking` 字段（未验证网关兼容性） |
| 3 | `archive/migrations/p34-agent-routing-fix.mjs` 数据迁移 | ❌ **阻塞 1**：`translate.keywords` 为整数组覆盖写 + 无备份/回滚 → 运营自定义词不可逆丢失 |
| 4 | `AgentDefSyncService` 新增构造参数 `ClientRegistry` | ✅ **非契约变化**（模块内 DI，未跨模块 export）；spec 已同步 |
| 5 | `INTENT_MODEL` / `INTENT_TIMEOUT_MS` 默认值改动 | ⚠️ **有条件通过**：默认值本身正确，但生效前提是目标环境注册键与之一致 —— 注册键真相源是 DB 字典 `llm_models`，**未验证** |

整体：**❌ 阻塞（退回整改）** —— 阻塞项仅 1 条（p34 的 keywords 覆盖写），整改成本很低。

机器门禁提示（本次提交会同时命中两条，见 §2.6）：
- **R13**：`archive/migrations/*` 命中契约面 → commit 须带 `Contract: <本报告路径>`，且报告头部 `阻塞:` 须为 0。
- **R14**：`servers/*/.env.*` 命中发布面（`servers/ai-agent/.env.example` 改动）→ 另需 `Release: pass` 或 `Release: <发布评审报告路径>`。

---

## 1. 改动面（13 个文件，均来自 `git status --short`）

| 文件 | 类别 | 是否命中 R13/R14 触发面 |
|---|---|---|
| `packages/agent-core/src/clients/base-ai.client.ts` | 公开包类型 | 否（`clients/*` 不在 `is_contract_file`） |
| `packages/agent-core/src/clients/tokenhub.client.ts` | 公开包实现 | 否 |
| `packages/agent-core/src/clients/hy3.client.ts` | 公开包实现 | 否 |
| `packages/agent-core/src/core/intent-classifier.ts` | 包内逻辑 | 否 |
| `packages/agent-core/src/core/intent-classifier.spec.ts` | 测试 | 否 |
| `servers/ai-agent/src/agent/intent/intent.service.ts` | 服务配置默认值 | 否 |
| `servers/ai-agent/src/agent/agent-def-sync.service.ts` | 服务内部 DI | 否 |
| `servers/ai-agent/src/agent/agent-def-sync.service.spec.ts` | 测试 | 否 |
| `servers/ai-agent/src/agent/agent.module.ts` | 服务装配 | 否 |
| `servers/ai-agent/src/contract/tools/contract-cleaner.tool.ts` | 服务内部 | 否 |
| `servers/ai-service/src/agent-def/agent-def.service.ts` | DB seed 数据源 | 否 |
| `servers/ai-agent/.env.example` | 配置样例 | **R14**（`servers/*/.env.*`） |
| `archive/migrations/p34-agent-routing-fix.mjs`（新文件，190 行） | 数据迁移 | **R13**（`archive/migrations/*`，行数远超阈值 5） |

> 说明：契约面按 `contracts.md` §1 的判据「只要两方（或以上）各自维护同一事实，它就是契约」纳入评审 —— 本包虽未命中 R13 路径，但它是 `StreamEventType` 等 C2 契约的真相源所在包且被 36 个源码文件消费，故按契约面评审。

---

## 2. 逐条判据结论

### 2.1 重点 1：公开包新增可选字段 `thinking?` 与导出 `ThinkingOption` —— 是否破坏性？

**结论：✅ 非破坏性。** 判据：`contracts.md` §7 第 5 条（破坏性变更须附消费方清单）+ §8 D6 教训（删/改名须查 **import 型** 消费方；本次为**新增**，方向相反）。

证据链：

| 步骤 | 命令 | 输出要点 |
|---|---|---|
| 导出面确认 | `sed -n '15,20p' packages/agent-core/src/index.ts` | `export * from './clients/base-ai.client';` → `ThinkingOption` 确实进入包公开面 |
| 新名字是否被别处占用（命名冲突面） | `grep -rn "ThinkingOption" --exclude-dir=node_modules --exclude-dir=dist .` | **仅 4 处，全在 agent-core 内**（base-ai.client.ts:95/110、tokenhub.client.ts:21/56）；无同名第三方声明 |
| 是否存在包再导出（歧义放大器） | `grep -rn "export \* from '@kedouai/agent-core'" ...` | **0 处** |
| 包级 `ChatOptions` 的外部引用 | `grep -rn "ChatOptions"` | 外部命中**全部是各自的副本**：`servers/ai-service/src/common/http/base-ai.client.ts:56`、`servers/content-hub/src/common/llm.ts:11`；**无任何外部文件引用本包导出的 `ChatOptions`** |
| 编译验证（包自身） | `cd packages/agent-core && npx tsc -p tsconfig.build.json --noEmit` | EXIT=0，无输出 |
| 编译验证（最大消费方） | `cd servers/ai-agent && npx tsc -p tsconfig.json --noEmit` | EXIT=0，无输出 |

补充事实（解释「为什么 ai-service 不受影响」）：`servers/ai-service` 维护了 `base-ai.client.ts` / `client.registry.ts` / `agent-def-sync.service.ts` 的**并行副本**（例如 `servers/ai-service/src/common/http/base-ai.client.ts:56` 有自己的 `ChatOptions`，无 `thinking` 字段）。本次**不会**传导到 ai-service；这是既有漂移（非本次引入），见 §5。

**行为静默改变面**：新增字段为可选，且只有客户端实现读到它时才生效；未传值分支逐字段等价于改造前（见 §2.2）。✅

---

### 2.2 重点 2：`thinkingPayload` 优先级语义 —— 既有调用是否静默改变？

**结论：✅ 不传 `options.thinking` 时逐字段等价；⚠️ 有一处新风险（重要 I3）。** 判据：无直接判据条目；按 §1 判据「契约 = 多方维护的同一事实」+ §7 第 5 条「静默失效」精神评审。

**改造前后对照（关键判据：不传 `options.thinking` 时 payload 必须逐字段一致）**

TokenHub（`tokenhub.client.ts`，3 处 payload：chatWithTools / chatWithToolsStream / chatStream）：

```
改造前：  ...resolveThinking(this.modelId)
改造后：  ...thinkingPayload(this.modelId, options?.thinking)

thinkingPayload(modelId, override):
  if (override) return { thinking: override };   // ← 仅这条路径是新行为
  return resolveThinking(modelId);               // ← override 为 undefined 时与改造前逐字段相同
```

- 不传 `thinking` → `resolveThinking(modelId)`（读 `TOKENHUB_THINKING`，否则 DeepSeek 系 `enabled/1024`，其余 `{}`）→ **与改造前逐字段一致** ✅
- 传 `thinking` → `env TOKENHUB_THINKING` 被**完全绕过**（这是设计意图，注释已写明）

Hy3（`hy3.client.ts`，3 处 payload）：

```
改造前：  payload 无 thinking 键
改造后：  ...this.thinkingPayload(options)
          thinkingPayload(options) = options?.thinking ? { thinking: options.thinking } : {}
```

- 不传 → 展开 `{}`，**不产生任何键**，键集与顺序与改造前一致 ✅

**谁会传 `thinking`（消费方清单）**：`grep -rn "thinking"` 全仓 → 生产代码里**只有 `intent-classifier.ts:212`** 一处（`thinking: { type: 'disabled' }`），其余为注释/文档/spec。

因此下列既有调用 payload **不变**（命令：`grep -rn "temperature:" servers/ai-agent/src` + `grep -rn "\.chat(\|chatWithTools(\|chatStream(" servers/ai-agent/src packages/kedou-agent/src`）：

| 调用 | 位置 | 传入 options | 是否受影响 |
|---|---|---|---|
| 主对话（AgentEngine） | agent-engine | grep 无 `temperature:`/`maxTokens` 字面量，不传 options | 否 |
| OCR 清洗 | `servers/ai-agent/src/ocr/ocr.service.ts:142` | `{temperature:0.2, maxTokens:3000}` | 否 |
| 合同清洗 | `servers/ai-agent/src/contract/tools/contract-cleaner.tool.ts:80` | `{temperature:0.2, maxTokens:3000}` | 否（本次另改了 `getOrFallback` 键，见 §2.7） |
| 用户记忆更新 | `servers/ai-agent/src/agent/user-memory-update.hook.ts:77` | `{temperature:0.2, maxTokens:800}` | 否 |
| 记忆压缩 | `packages/agent-core/src/memory/compaction.ts:53` | `{temperature:0.2, maxTokens:800}` | 否 |
| 意图分类 | `packages/agent-core/src/core/intent-classifier.ts:212` | `{temperature:0, maxTokens:256, thinking:{type:'disabled'}}` | **是（本次修复目标）** |

⚠️ **新风险（重要 I3）**：`intent.service.ts:105` 走的是 `getOrFallback(this.modelId)`，模型未注册时**静默回落 hy3**。此时分类请求会带上 `thinking:{type:'disabled'}` 打到 `HY3_BASE_URL`（`hy3.client.ts:81`：默认与 TokenHub 同一网关 `tokenhub.tencentmaas.com/v1`，但可被 env 改走其它端点）。改造前 hy3 路径**从未**下发过该字段 —— 若目标网关不认该字段而返回 4xx，分类调用将 100% 走 L4 兜底（正是本次要修的现象）。**未验证**：评审未连网关，无法实测；放行条件见 §4。

---

### 2.3 重点 3：`p34-agent-routing-fix.mjs` 数据迁移

**结论：❌ 阻塞（1 条）+ 重要（2 条）。** 判据：`contracts.md` §7 第 4 条（DB 侧改动必须在运行代码已同步之后，顺序反了就是「绑定即故障」）、第 5 条（破坏性变更写迁移路径）；具体做法以**本仓既有事实**为准（用户要求），不以规则文字为准。

**仓库既有事实（实测）**：

| 脚本 | 类型 | 幂等做法 | 回滚做法 | 目标库声明 |
|---|---|---|---|---|
| p13 / p14 / p15 / p22 | UPDATE 改写 | 条件守卫 | **改写前 dump 到 `/tmp/pNN-backup-<ts>.json`** | — |
| p32（同表 `agent_definitions`） | 加列 + 回填 | `description IS NULL OR description=''`（**不覆盖运营值**） | **头部给出回滚 SQL** | — |
| p31 / p29 | DDL | information_schema 守卫 | 无 | **运行时打印 `目标库: db@host:port`** |
| **p34（本次）** | UPDATE 改写 | 部分具备 | **无** | **无** |

逐项结论：

1. **幂等性 —— model ✅ / keywords ❌**
   - model：`UPDATE ... WHERE id=? AND model='deepseek-v4-flash'` → 重复跑第二次 `affectedRows=0` → 幂等；且只在值**恰好是短名**时才改写，运营改成其它 id 不会被覆盖 ✅
   - keywords：`WHERE keywords IS NULL OR JSON_VALID(keywords)=0 OR (6 个新词缺任一个)` → **只要运营自定义时漏了这 6 个词中的任意一个，整数组被替换为硬编码的 14 词列表**，运营自己加的词（如「西班牙语怎么说」）**永久丢失** ❌
   - 佐证（为何自定义值确实可能存在）：`agent-definition.entity.ts:36` 注释写明 keywords「后台可改」；`agent-def.service.ts:384` 的 `seed()` 是「缺失补录」(`if (existing) continue`)，**不会**覆盖运营值 —— 也就是说 p34 是唯一的覆盖向量。

2. **回滚路径 —— ❌（重要 I2）**：p34 无 `/tmp` dump、无回滚 SQL 段。与本仓 UPDATE 改写类脚本（p13/p14/p15/p22）惯例不符。
   - 缓解事实：`agent_definition_versions` 保存 keywords 快照，publish 过的版本理论上可从 admin「恢复旧版本」找回 —— 但这是**人工绕路**，不是迁移自带的回滚路径；且 p34 头部已声明**刻意不回写版本表**（与 p32 两表都写的做法相反），作者用 `assertModelRegistered` 的 error 日志兜底。此项列为**已知取舍**，不计阻塞，但必须在上线说明里写清。

3. **目标库声明 —— ❌（重要 I1）**：p34 只从 `DB_*` env / `servers/deploy-console/.env` 取连接参数，**运行时不打印目标库**（p31/p29 有 `[pNN] 目标库: db@host:port`）。跨库误写风险正是 `is_contract_file` 里为 `archive/migrations/*` 加的注释理由。

4. **前置校验缺失 —— ❌（重要 I1，与上一项同源）**：`CORRECT_MODEL='deepseek/deepseek-v4-flash'` 是硬编码，脚本**没有**像 p32 那样先 probe 目标库。
   - 反例（改完反而更差）：注册键的真相源是 **DB 字典 `llm_models`**（`model-catalog.service.ts:73-74`：`MODEL_DICT_CODE` 默认 `llm_models`、`MODEL_SOURCE` 默认 `db`，优先级 DB 字典 → env → 内置）。若目标库的字典里登记的是**短名**，p34 改完之后 deploy / general / web-system-dev 这 3 个 agent 会**从「匹配得上」变成「全部匹配不上」**，静默回落 hy3（更慢更贵），比迁移前更糟。
   - 缓解：新增的 `assertModelRegistered()` 会对每条未注册 model 打 error —— 但那是**观测**手段，不是回滚手段。

---

### 2.4 重点 4：`AgentDefSyncService` 新增构造参数 `ClientRegistry` —— 是否对外契约变化？

**结论：✅ 不构成对外契约变化；spec 已同步。**

证据：

| 检查 | 命令 / 位置 | 结果 |
|---|---|---|
| 是否被跨模块 export | `grep -rn "AgentDefSyncService" --exclude-dir=dist .` | 仅 3 处引用：`agent.module.ts:31`（provider）、`agent-def-sync.service.spec.ts`（测试）、自身定义 |
| 是否在模块 exports 里 | `sed -n '204p' servers/ai-agent/src/agent/agent.module.ts` | `exports: [AgentRunner, AgentEngine, ToolRegistry, AgentRegistry, ClientRegistry, DbConversationMemory, Compaction]` —— **不含 `AgentDefSyncService`** |
| DI 能否解析 | `agent.module.ts:82` `provide: ClientRegistry` + `:186` `AgentDefSyncService` 同模块 | ✅ 同模块内可解析 |
| spec 是否同步 | `agent-def-sync.service.spec.ts:55-61` | ✅ 已改 5 参构造；新增 2 条回归用例（短名告警 / 带前缀不告警） |
| 类型/接口面 | 无 HTTP 接口、无 SSE、无权限码变化 | 不涉 C1/C2/C4/C5 |

判据：无 `contracts.md` 条目适用 —— 该类只有**单一消费方**（本模块 + 其 spec），按 §1 判据「单一消费方的内部约定不算契约」→ **非契约面**。构造签名变更的所有调用点已穷举并同步 ✅。

---

### 2.5 重点 5：`intent.service.ts` 改默认值对「未配置该 env 的环境」的影响

**结论：⚠️ 有条件通过（重要 I5）。** 假设生产 `.env` 里没有 `INTENT_MODEL`（全仓 grep `INTENT_MODEL` 仅命中 `.env.example:39` 与若干**已过期文档**，未见任何环境 .env 配置 → 按「未配置」评估成立）。

| 项 | 旧默认 | 新默认 | 未配置 env 时的实际效果 |
|---|---|---|---|
| `INTENT_MODEL` | `deepseek-v4-flash`（短名，**不在注册键里**） | `deepseek/deepseek-v4-flash` | 若注册表含该键 → 分类走 DeepSeek flash（本次修复生效）；不含 → `getOrFallback` 打 warn 并回落 hy3（**与改前同样的静默回落**） |
| `INTENT_TIMEOUT_MS` | 1200 | 3000 | 超时翻倍；分类是主对话的前置同步调用，最坏情况每轮多等 1.8s（仅在未命中规则、走 LLM 时发生） |

- 默认值**取值本身正确**：`BUILTIN_TOKENHUB_MODELS`（`model-catalog.service.ts:13-21`）确实含 `deepseek/deepseek-v4-flash` ✅
- 但**生效前提**是目标环境的注册键与之一致；而注册键真相源是 DB 字典 `llm_models`（`MODEL_SOURCE` 默认 `db`）→ **未验证**，放行前必须核验（见 §4）
- `.env.example` 已同步（含注释说明前缀要求）✅ —— 这一点做得对
- 超时 1200→3000 属行为参数变更，未构成契约变化；但会改变主对话 P95 延迟，建议交 `release-reviewer` 一并看

---

### 2.6 机器门禁影响（实测 `scripts/redline/scan-rules.sh`）

- `R13_LINE_THRESHOLD=5`；`is_contract_file` 含 `archive/migrations/*` → **p34（190 行）触发 R13**
- `is_release_file` 含 `servers/*/.env.*` → **`servers/ai-agent/.env.example` 触发 R14**
- 两者级别均为 warning（`quality-gate.yml` 不带 `--strict`），但按 `contracts.md` §7 第 3 条应主动带 trailer
- 建议 commit trailer：`Contract: docs/reviews/contract-review-2026-10-08-intent-routing.md` + `Release: pass`（或指向发布评审报告）

---

### 2.7 附带发现（不在 5 个重点内，但属契约面）

`servers/ai-agent/src/contract/tools/contract-cleaner.tool.ts:60` 与 `agent.module.ts:65`、`servers/ai-service/src/agent-def/agent-def.service.ts`（3 处）把 `getOrFallback('deepseek-v4-flash')` / `model:'deepseek-v4-flash'` 统一改为带前缀键 —— 方向正确，与 p34 一致 ✅；但同样**依赖目标环境注册键**（同 I5 风险）。另注意：这是**代码侧**改动，按 §7 第 4 条，应在 p34（DB 侧）**之前**完成同步。

---

## 3. 消费方清单（`contracts.md` §7 第 5 条要求）

**A. 类型面消费方（受新增导出/字段影响）—— 0 个**

- `ThinkingOption`：全仓仅 agent-core 内部 4 处，无外部声明、无重名、无包再导出（`export * from '@kedouai/agent-core'` = 0 处）
- 包导出的 `ChatOptions`：**无任何外部文件引用**（ai-service / content-hub 各自维护副本）

**B. 运行时面消费方（向 agent-core 客户端传 options）—— 5 个，全部已核对**

| # | 位置 | 场景 | 传入 | 结论 |
|---|---|---|---|---|
| 1 | `servers/ai-agent/src/ocr/ocr.service.ts:142` | OCR | `{temperature, maxTokens}` | payload 不变 |
| 2 | `servers/ai-agent/src/agent/user-memory-update.hook.ts:77` | 用户记忆更新 | `{temperature, maxTokens}` | payload 不变 |
| 3 | `servers/ai-agent/src/contract/tools/contract-cleaner.tool.ts:80` | 合同清洗 | `{temperature, maxTokens}` | payload 不变（另改了模型键） |
| 4 | `packages/agent-core/src/memory/compaction.ts:53` | 记忆压缩 | `{temperature, maxTokens}` | payload 不变 |
| 5 | `packages/agent-core/src/core/intent-classifier.ts:212` | 意图分类 | `{temperature, maxTokens, thinking}` | **唯一改变项（修复目标）** |

主对话链路（`AgentEngine`）：grep 无 options 字面量，不传 → payload 不变。

**C. 包级 import 消费方全景**（`grep -rl "from '@kedouai/agent-core'" --exclude-dir=dist --exclude="*.md"`）

- 源码文件 **36 个**（另有 31 个 `dist/` 产物，非源码）；分布：`servers/ai-agent/src` 19、`servers/ai-service/src` 8、`packages/kedou-agent/src` 6、`servers/ai-agent/e2e` 1、`apps/admin/src` 1、另有 `packages/agent-core/README.md` 与 `docs/api/reviews/sse-stream-contract-20260924.md` 为文档引用
- 抽查关键两端：`apps/admin/src/views/Agents/AgentPlayground.vue:232` 只 `import type { StreamEvent }`；`packages/kedou-agent/src/**` 无 `.chat(`/`chatWithTools(` 直调 → 均不受本次类型变更影响

---

## 4. 阻塞项与放行条件

### B1 · `p34` 的 `translate.keywords` 是整数组覆盖写，且无备份/回滚 → 运营自定义词不可逆丢失

- **反例**：运营在 admin 给 `translate` 加过「西班牙语怎么说」，但未加全 p34 要求的 6 个新词 → p34 判定「缺词」→ `keywords` 被整数组替换为硬编码 14 词 → 运营自定义词**永久消失**，无 dump、无回滚 SQL。
- **判据**：`contracts.md` §7 第 5 条（破坏性变更须写清「怎么迁移、保留多久」）；本仓 UPDATE 改写类脚本惯例（p13/p14/p15/p22 改写前 dump；p32 明文「运营在 admin 改过的值不会被覆盖」并给回滚 SQL）。
- **严重级**：高（不可逆数据丢失，作用于共享库）
- **放行条件（二选一）**：
  1. 改为**合并语义**：只把缺失的词补进现有数组（如 `JSON_MERGE`/`JSON_ARRAY_APPEND`，或先 SELECT 再写回），已有词一个不动；或
  2. 保留覆盖语义，但**改写前把 `translate` 行的 `keywords` 原值 dump 到 `/tmp/p34-backup-<ts>.json`**（照 p13/p14/p15/p22 写法），并在脚本头部补 `回滚：` 段（照 p32 写法）。

### 重要项（不阻塞，但建议同批整改 / 上线前核验）

| # | 项 | 放行前动作 |
|---|---|---|
| I1 | p34 无目标库声明、无注册键前置校验（存在「改完 3 个 agent 全部静默回落 hy3」的反例） | 运行时打印 `目标库 db@host:port`（照 p31）；执行前先 `SELECT` 校验 `deepseek/deepseek-v4-flash` 在 `llm_models` 字典/注册表中，不在则中止 |
| I2 | p34 无备份/回滚路径（整体） | 同 B1 放行条件 2 |
| I3 | hy3 兜底路径首次下发 `thinking` 字段，网关兼容性未验证 | 实测一次「未注册模型 → 回落 hy3 → 带 `thinking:{type:'disabled'}`」的请求，确认不 4xx；或在 hy3 client 里对非 TokenHub 端点跳过该字段 |
| I4 | agent-core 以 `dist/` 被消费（`package.json` `main: dist/index.js`，`dist/` 已 gitignore） | 发布时必须 `cd packages/agent-core && npm run build`，否则本次修复（maxTokens 256 / thinking / 新 d.ts）**静默不生效**；建议交 `release-reviewer` 纳入发布清单 |
| I5 | `INTENT_MODEL` 新默认值依赖目标环境注册键，注册键真相源是 DB 字典 `llm_models`（未验证） | 上线前在目标环境跑 `assertModelRegistered` 的 error 日志核对，或直接查字典 `llm_models` 的启用项 |

---

## 5. 未覆盖项 / 未验证

- **未验证**生产/测试库 `llm_models` 字典内容与 `TOKENHUB_MODELS` 实际值（本次只读代码，未连库、未上服务器）
- **未验证** hy3 / TokenHub 网关对 `thinking` 字段的实际接受行为，以及 `HY3_BASE_URL` 在各环境的实际取值
- **未验证** p34 在真实库上的执行结果（未执行；仅静态分析 SQL）
- **未运行** ai-service / apps/admin 的构建（改动未触及它们的类型面，且 ai-service 用自有 `ChatOptions` 副本，但**未做全量 `tsc`**）
- **未验证** p34「不回写 `agent_definition_versions`」对 admin「恢复旧版本」的实际影响（只按作者注释标注为已知取舍）
- **未评审** `agent.module.ts` 之外是否还有其它模块直接 `new AgentDefSyncService(...)`（已 grep 穷举为 0，但未跑运行时 DI 校验）

### 建议（无判据条目，属个人偏好，可驳回）

1. **文档漂移**（与 `contracts.md` §8 同类，建议顺手修）：`apps/kedou-ai-minigram/docs/意图识别-实现方案.md:388` 与 `specs/kedou-ai-minigram/tasks.md:194` 仍写 `INTENT_MODEL=deepseek-v4-flash` / `INTENT_TIMEOUT_MS=1200`；`意图识别-实现方案.md:47` 仍写「`ChatOptions` 只有 `temperature / maxTokens / topP`」。这三条现在都与代码相反，是下次事故的种子。
2. **补 payload 快照单测**：`packages/agent-core/src/clients/` 下**没有任何 spec**，本次「不传 thinking 时与改造前逐字段一致」只靠人工对照，没有机械保障。建议加两条：`chatWithTools` 不传 thinking 时 payload 快照、传 thinking 时覆盖 env。
3. **报告落盘路径**：`contract-reviewer` 技能的默认约定是 `docs/api/reviews/<topic>-<YYYYMMDD>.md`（本仓已有 `docs/api/reviews/sse-stream-contract-20260924.md`）；本次按指定落在 `docs/reviews/`。R13 只解析报告头部的 `阻塞: N`，不校验目录，故不影响门禁 —— 仅为后续检索方便，建议统一。

---

## 6. 评审局限（诚实标注）

- **独立性弱**：本次评审者与改动出自**同一会话**，虽按 `contract-reviewer` 工作流做了「先读判据源形成应然、再看改动」的盲审顺序，但独立性明显弱于跨人评审 —— 尤其「作者注释里的实测结论」（如 3/3 空返回、1.3s 实测）本次**全部采信未复验**。
- 所有「✅」结论均基于**本工作区的静态证据**（grep / tsc / jest），不代表线上行为已验证。
- 建议：p34 属不可逆数据操作，放行前再过一次 `release-reviewer`（发布与环境评审），与本报告的契约面结论交叉验证。

---

## 7. 复审记录（2026-10-08 整改后）

> 复审角色：`contract-reviewer`（同一角色、第二轮；**不采信整改方说法，全部自行取证**）
> 复审对象：B1 整改后的 `archive/migrations/p34-agent-routing-fix.mjs` + 两条重要项 I3 / I5
> 复审时间：2026-10-08
> 编号说明：§6 已被「评审局限」占用，本节顺延为 §7，避免同号章节；内容即用户指定的「复审记录」。
> 取证边界：只跑 `DRY_RUN=1` / 守卫分支，**未连库改写任何数据**；对 dev 库 `web_system` 仅执行只读 SELECT。

### 7.0 结论

| 原项 | 级别 | 复审结论 |
|---|---|---|
| **B1** p34 `translate.keywords` 整数组覆盖写 + 无备份/回滚 | 阻塞 | ✅ **关闭** —— 合并语义实测保留自定义词；dump + 备份表 + 回滚 SQL + 直连守卫四项均到位 |
| **I1** p34 无目标库声明、无注册键前置校验 | 重要 | ⚠️ **降级保留（→ R1）** —— 目标库声明已补；注册键真相源已实证；但**列存在性前置校验仍缺**，且非事务分步执行（新发现，见 7.1 R1） |
| **I2** p34 无备份/回滚路径 | 重要 | ⚠️ **降级保留（→ R2）** —— 备份三件套已到位，但 EMIT_SQL 模式下备份表建在 model UPDATE **之后** |
| **I3** hy3 兜底首次下发 `thinking`，网关兼容性未验证 | 重要 | ✅ **关闭** —— 实测 HTTP 200 / `finish_reason=stop` / `content='OK'` / `reasoning_tokens=0` |
| **I4** agent-core 以 `dist/` 被消费 | 重要 | ⚠️ **保留（→ R3）** —— 属发布面，本次未整改，交 `release-reviewer` |
| **I5** `INTENT_MODEL` 新默认值依赖 DB 字典 `llm_models` 注册键 | 重要 | ✅ **关闭** —— 注册键真相源重新定位为**字典 `dict_items(type_code='llm_models')`**，dev 实测 `deepseek/deepseek-v4-flash` **enabled=1** |

**头部已更新为 `阻塞: 0` / `重要: 3`。**

---

### 7.1 B1 整改验证（4 个用例，全部自跑）

整改内容（`archive/migrations/p34-agent-routing-fix.mjs`）：
`mergeKeywords()`（:122，保留原顺序、只 append 缺失词）→ `buildKeywordStep()`（:158，已知当前值时写精确合并值）→ `dumpBackup()`（:193，写 `/tmp/p34-agent-defs-backup-<ts>.json`）→ 库内备份表 `agent_definitions_bak_p34_20261008`（:239）→ 头部回滚 SQL（:34-42）→ 直连守卫（:205-212）。

#### 用例① 离线模式、未传 `CURRENT_KEYWORDS`（退化路径）

```
DRY_RUN=1 node archive/migrations/p34-agent-routing-fix.mjs
```

stdout 尾部：

```
CREATE TABLE IF NOT EXISTS `agent_definitions_bak_p34_20261008` AS SELECT * FROM `agent_definitions`; -- 幂等：仅在首次执行时建表
UPDATE `agent_definitions` SET `keywords` = '["翻译","译成",…,"translation"]' WHERE `id` = 'translate' AND (`keywords` IS NULL OR JSON_VALID(`keywords`) = 0 OR JSON_SEARCH(`keywords`, 'one', '英语怎么说') IS NULL);
```

stderr：

```
-- 步骤：translate.keywords（整列覆盖·未知当前值）
⚠️ 未提供 CURRENT_KEYWORDS，keywords 走整列覆盖——已前置建备份表，但运营自定义词仍可能丢失。
```

**判定**：退化路径仍在，但**前置备份表 + stderr 红色警告 + 头部回滚 SQL** 齐备 → 满足原放行条件 2 的等价强度（备份表替代 /tmp dump，且可 SQL 回写）。不再不可逆。

#### 用例② 传含**运营自定义词**的 `CURRENT_KEYWORDS`（核心反例）

```
DRY_RUN=1 CURRENT_KEYWORDS='["翻译","英文怎么说","西班牙语怎么说"]' \
  node archive/migrations/p34-agent-routing-fix.mjs
```

stdout（keywords 语句）：

```
UPDATE `agent_definitions` SET `keywords` = '["翻译","英文怎么说","西班牙语怎么说","译成","翻成","英语怎么说","英文怎么讲","英语怎么讲","中文怎么说","日语怎么说","韩语怎么说","用英语","用英文","润色","translation"]'
```

stderr：

```
-- 步骤：translate.keywords（合并：新增 12 词，保留原 3 词）
```

**判定：✅ B1 关闭。** 原反例中的运营自定义词 `西班牙语怎么说` **完整保留且仍在原位置（第 3 位）**，原顺序未变，12 个缺失词追加到末尾；WHERE 条件也只由 12 个**真正缺失**的词构成（不再包含已有的「翻译」「英文怎么说」），幂等性同步成立。

#### 用例③ 幂等（no-op）

```
# ③a 14 词齐备 + 自定义词「西班牙语怎么说」
DRY_RUN=1 CURRENT_KEYWORDS='["翻译",…,"translation","西班牙语怎么说"]' node … | grep 已齐备
# ③b 恰好 14 词
DRY_RUN=1 CURRENT_KEYWORDS='["翻译",…,"translation"]' node … | grep 已齐备
# ③c 空数组
DRY_RUN=1 CURRENT_KEYWORDS='[]' node … | grep 步骤
```

输出：

```
-- translate.keywords 已齐备，无需改动        ← ③a
-- translate.keywords 已齐备，无需改动        ← ③b
-- 步骤：translate.keywords（合并：新增 14 词，保留原 0 词）  ← ③c
```

**判定：✅** 齐备时零写入（`noop`，连备份表都不建）；空数组正确走「补 14 词」而非覆盖丢失。

#### 用例④ 直连守卫（缺 `DB_HOST` / `DB_NAME` 必须拒绝）

```
env -u DB_HOST -u DB_NAME node p34…   ; echo EXIT=$?   → EXIT=2
env -u DB_NAME  DB_HOST=127.0.0.1 node p34… ; echo EXIT=$? → EXIT=2
env -u DB_HOST  DB_NAME=web_system node p34… ; echo EXIT=$? → EXIT=2
```

stderr 三条一致：

```
✗ 拒绝执行：直连模式必须显式传入 DB_HOST 与 DB_NAME
  示例：DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... node p34...
  本机无法直连内网库时改用 EMIT_SQL=1 导出 SQL。
```

反向对照（证明守卫不会误杀，且未真正改写数据）：

```
DB_HOST=127.0.0.1 DB_NAME=web_system DB_PORT=1 DB_USER=root DB_PASSWORD=x node p34…
→ p34 失败: connect ECONNREFUSED 127.0.0.1:1
```

**判定：✅** 守卫在 `require('mysql2')` 与 `createConnection` **之前**生效（:205 早于 :215/:225），两个变量缺任一即 exit 2，不会误连本机库。

---

### 7.2 I3 核验（hy3 兜底路径首次下发 `thinking`）→ ✅ 关闭

复跑命令（凭证取自 `~/env_config/llm.env`，`set -a; . ~/env_config/llm.env; set +a`）：

```
curl -s -w '\nHTTP_CODE=%{http_code}\n' -X POST "$TOKENHUB_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TOKENHUB_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"hy3","messages":[{"role":"user","content":"只回复 OK 两个字"}],
       "temperature":0,"max_tokens":256,"thinking":{"type":"disabled"},"stream":false}'
```

实测输出：

```
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"OK","role":"assistant"}}],
 "created":1791471061,"id":"49134a7f-…","model":"hy3","object":"chat.completion",
 "usage":{"prompt_tokens":20,"completion_tokens":2,"total_tokens":22,
 "prompt_tokens_details":{"cached_tokens":0},
 "completion_tokens_details":{"reasoning_tokens":0}}}
HTTP_CODE=200
```

**复核要点**（不只采信结果，另验「打的是不是真凶那个端点」）：

| 检查 | 命令 / 位置 | 结果 |
|---|---|---|
| 实测端点就是 hy3 的默认端点 | `packages/agent-core/src/clients/hy3.client.ts:81` `return process.env.HY3_BASE_URL \|\| DEFAULT_BASE_URL;` + `:9` `DEFAULT_BASE_URL='https://tokenhub.tencentmaas.com/v1'` | 实测 `$TOKENHUB_BASE_URL` = `https://tokenhub.tencentmaas.com/v1` → **与未设 `HY3_BASE_URL` 时的 hy3 端点完全一致** |
| 是否有环境把 hy3 改走别的端点 | `grep -rn "HY3_BASE_URL" --exclude-dir=node_modules --exclude-dir=dist .` | 命中**全部是文档/CLI**：`docs/`、`packages/kedou-agent/README.md:66`、`packages/kedou-agent/src/cli/config-store.ts:40`；**服务端 `.env*` 无一处设置** → 服务端 hy3 必落 tokenhub 网关 |
| 字段确实被接受而非被忽略 | `reasoning_tokens=0` + `finish_reason=stop` + `content='OK'` | 无 4xx、无截断、无异常推理消耗 |

**判定：✅ I3 关闭。** 网关接受 `thinking:{type:'disabled'}`，分类请求不会因该字段 4xx 而 100% 走 L4 兜底。
残留提示（不计级）：若将来某环境显式配置 `HY3_BASE_URL` 指向非 tokenhub 端点（如文档里出现过的 `wcode.net`），需重新实测一次 —— 当前无任何环境如此配置。

---

### 7.3 I5 核验（注册键真相源重新定位）→ ✅ 关闭

**先纠正一个分类错误**：原报告 §2.3 / §4 写的「注册键真相源是 DB 字典 `llm_models`」方向对，但**把 `llm_models` 当成了一张表**。它不是表 —— 它是**字典编码**：

| 事实 | 证据 |
|---|---|
| `llm_models` 是 `dict_types.code` 的一行，明细在 `dict_items.type_code` | `migrations/0006_dict_tables.sql:62` `SELECT UUID(), 'llm_models', '大模型清单', … FROM dict_types`；`specs/dict-module/api-design.md:104` |
| 承载表有三张 | dev 库只读查询 `SHOW TABLES LIKE 'dict%'` → `dict_fields` / `dict_items` / `dict_types` |
| 所以「`SHOW TABLES LIKE "%model%"` 只返回 `model_pricing`」**不能**证明字典不存在 | 字典明细表叫 `dict_items`，不含 "model" 字样 |

**注册链路（三级，逐级取证）**：

1. **启动初值**（`servers/ai-agent/src/agent/agent.module.ts:82-103`）：
   `configService.get('TOKENHUB_MODELS', BUILTIN_TOKENHUB_MODELS)` → 逐项 `registry.register(new TokenHubClient(m))` → `ClientRegistry` 以 `modelId` 为 key。
2. **`MODEL_SOURCE` 默认 `db`**（`model-catalog.service.ts:71`），`sync()` 顺序见 `:113-135`：**DB 字典 → `TOKENHUB_MODELS` → `BUILTIN_TOKENHUB_MODELS`**，任一上级有启用项即 `apply()`（:156 起 `clear()` + 回填）。
3. **内置兜底**含该键：`model-catalog.service.ts:13-21` `BUILTIN_TOKENHUB_MODELS` 第 2 项即 `deepseek/deepseek-v4-flash`。

**dev 库实测（只读，账号 `web_system_ro`）**：

```sql
SELECT value,label,enabled FROM dict_items WHERE type_code='llm_models' ORDER BY sort;
```

| value | label | enabled |
|---|---|---|
| `hy4-preview` | Hy4 Preview | 1 |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | 1 |
| **`deepseek/deepseek-v4-flash`** | **DeepSeek V4 Flash** | **1** |
| `glm-5.3` | GLM 5.3 | 1 |
| `kimi-k3` | Kimi K3 | 0（停用） |
| `qwen3.5-plus` | Qwen 3.5 Plus | 1 |
| `minimax-m3` | MiniMax M3 | 1 |
| `deepseek-v4-pro-0813` | DeepSeek V4 Pro (0813) | 1 |

**判定：✅ I5 关闭。**

- 注册键是**带前缀**的 `deepseek/deepseek-v4-flash`（与 `intent.service.ts:50` 新默认值 `deepseek/deepseek-v4-flash` **字面一致**）→ 修复生效，不再静默回落 hy3。
- 原 I1 里最坏的反例「字典里登记的是短名 → 改完 3 个 agent 全部匹配不上」被**实证排除**：字典里 8 条全部是带前缀/网关 id，无一条短名。
- 观测兜底也在：`assertModelRegistered()` 位于 `servers/ai-agent/src/agent/agent-def-sync.service.ts:130-138`（`registered.has(model)` 否则打「运行期会静默回退 hy3」日志），回归用例见 `agent-def-sync.service.spec.ts:172`。
- 另附：dev 库 `agent_definitions` 现状 `deploy=deepseek-v4-flash`、`general=hy3`、`web-system-dev=deepseek-v4-flash`、`translate=deepseek/deepseek-v4-flash` → p34 的 model 修复对 `deploy` / `web-system-dev` 确实有活干。
- 残留提示（不计级）：**prod 字典未核**（本次只读 dev）。若 prod 字典非空但不含该键，`apply()` 会用字典覆盖注册表 → 回落 hy3（与改前行为一致，不会更差）。建议 `release-reviewer` 在 prod 上重跑同一条 SELECT。

---

### 7.4 复审后的重要项（3 条）

| # | 项 | 证据 | 建议动作 |
|---|---|---|---|
| **R1**（原 I1 残留 + 新发现） | p34 **无列存在性前置校验**，且 model 与 keywords 分步执行、**无事务包裹** | dev 库只读 `DESCRIBE agent_definitions` → 列清单为 `id,name,system_prompt,model,tools,max_steps,temperature,memory,version,status,enabled,published_at,updated_by,capabilities,skills,streaming`，**没有 `keywords`**；`information_schema.COLUMNS … COLUMN_NAME LIKE '%keyword%'` → `[]`。而 `keywords` 列由 **p32**（`archive/migrations/p32-agent-def-routing-hints.mjs:106` `ADD COLUMN keywords json`）创建 —— **目标库若没跑过 p32，p34 会在 keywords 步骤报 1054 中断，而 3 条 model 已先行改写** | 执行前先 `information_schema` 探列，缺列即中止；或把 model+keywords 包进一个事务 |
| **R2**（原 I2 残留） | EMIT_SQL/离线模式下，**备份表建在 3 条 model UPDATE 之后** | `runOffline()`（:277-299）stdout 顺序：3 条 `UPDATE … model` → `CREATE TABLE IF NOT EXISTS …_bak_p34_20261008 AS SELECT *` → `UPDATE … keywords`。备份表里 model 已是改后值 → **备份表无法回滚 model**，只能靠头部硬编码的 `SET model='deepseek-v4-flash'` | 把 `CREATE TABLE … AS SELECT` 提到所有 UPDATE 之前（直连模式 :239 顺序是对的，只有离线路径错了） |
| **R3**（原 I4，未整改） | agent-core 以 `dist/` 被消费（`main: dist/index.js`，`dist/` 已 gitignore） | 见原报告 §4 I4 | 发布时必须 `cd packages/agent-core && npm run build`；交 `release-reviewer` 纳入发布清单 |

---

### 7.5 复审局限

- **独立性仍弱**：复审者与整改出自同一工作区，本轮已做到「每条结论都附自跑命令与原始输出」，但无人交叉复核。
- **未核验 prod**：字典内容、agent_definitions 现状均只在 dev 库只读取证；prod 需 `release-reviewer` 复跑 7.3 的 SELECT 与 7.4 R1 的探列。
- **未做真库写入演练**：p34 全程 `DRY_RUN=1` / 守卫分支，合并语义在**生成的 SQL 文本**层面验证，未在真实 MySQL 上跑通（因 dev 库缺 `keywords` 列，见 R1，本就不具备执行条件）。
- **未复跑单测**：`agent-def-sync.service.spec.ts` 等本轮未重跑 jest，I3/I5 结论走的是「网关实测 + 库内只读取证」路径。
