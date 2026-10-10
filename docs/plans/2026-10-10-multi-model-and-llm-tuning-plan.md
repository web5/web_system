# 执行计划与方案 · 多模型接入 / 大模型调参 / 文档校准

> 状态：**待确认** ｜ 日期：2026-10-10 ｜ 范围：`packages/agent-core` + `servers/ai-agent` + `servers/ai-service` + `apps/admin`
> 关联：`docs/development/agent-capability-playbook.md`、`specs/llm-models-unify/design.md`、`docs/api/contracts.md`

---

## 0. 一句话结论

三条独立的债，按优先级串行推进：**A 文档校准（0.5d，零风险，先做）→ C 调参能力补齐（3d，跨契约/UI 门）→ B 多模型统一（2d）**。A 不依赖任何代码改动，可以立刻落地；C 与 B 互不阻塞，但 C 会改 `agent-core` 接口，必须先过契约门。

---

## 1. 问题盘点

### 1.1 文档漂移清单（实测，README 停在 0.1 时代，包已 0.2.3）

| # | 位置 | 现状（错误） | 应为 |
|---|---|---|---|
| A1 | `packages/agent-core/README.md` 特性段 | 「`Hy3Client`、`DeepseekClient`」 | DeepseekClient **已删除**，改为 `TokenHubClient(modelId)` |
| A2 | README · API 概览表 | 只列 12 项 | 缺 9 项实际导出：`TokenHubClient`、`SkillLoader`、`McpToolAdapter`、`withLongRunning`、`IntentClassifier`、`resolveAgentCapabilities`、`WsaSearchProvider`、`agent-errors` 三件套、`interfaces/*` |
| A3 | README · 搜索 | 「默认内置 `BingSearchProvider`」 | 实际 **WSA（腾讯云联网）优先，Bing 兜底** |
| A4 | README · 快速开始 | 未体现能力 | 需补 SkillLoader / MCP 适配器 / 遥测的**可选注入**示例 |
| A5 | README 头部 | 无版本号 | 标注 `0.2.3` + Node ≥18 |
| A6 | `docs/development/agent-capability-playbook.md:141` | 📌 提示「README 里 DeepseekClient 已下线」 | README 修好后，该提示改为交叉引用或直接删除 |
| A7 | `servers/ai-service/src/common/client.registry.ts:30` | 日志文案 `DEPSEEK_API_KEY`（拼写错） | `DEEPSEEK_API_KEY` |

> 注：`agent-capability-playbook.md` 本身是准确的（已记录 DeepseekClient 下线），漂移集中在 `agent-core/README.md`——它是**包的门面**，对外发布（`private: false`）会带出去，优先级最高。

### 1.2 多模型装配不一致

| 侧 | 机制 | 加模型成本 |
|---|---|---|
| `ai-agent` | `ModelCatalogService`：DB 字典 `llm_models` → `TOKENHUB_MODELS` → 代码内置，60s 轮询注册 `TokenHubClient` | **零代码**，改字典 |
| `ai-service`（Agent harness） | `agent.module.ts:26-34` 硬编码 `Hy3Client` + `TokenHubClient('deepseek-v4-flash')` | 改代码 + 发版 |
| `ai-service`（普通 chat 链路） | 自研 `common/http/deepseek.client.ts`，官方直连 `api.deepseek.com` + `DEEPSEEK_API_KEY` | 改代码 + **另一套 key** |

⚠️ 同一服务内**并存两套模型客户端实现**（自研 `http/` 与 `agent-core` 的），且是两把 key，运维心智负担与故障面都翻倍。

### 1.3 调参缺口

- 已打通：`model` / `temperature` / `maxSteps` / `streaming` / `memory`（DB `agent_definitions`）。
- 缺口：`maxTokens` / `topP` / `thinking` —— `ChatOptions` 支持，但 `agent-engine.ts:164-166` **只传了 `temperature`**，等于不可调。
- 隐患：`temperature` 与 `topP` 能同时填，而 DeepSeek 官方明确要求**二选一**；参数档位无任何约定，谁能填、填多少没有约束。

---

## 2. 目标与非目标

**目标**
1. `agent-core` 的门面文档与代码一致，且建立「改代码顺手改 README」的约束。
2. 新增模型在 **ai-agent / ai-service 两侧都只需改字典**，不再发版。
3. 调参旋钮（`maxTokens` / `topP` / `thinking`）可配、可校验、有档位约定。

**非目标**
- 不做模型训练 / fine-tune（工程无此链路）。
- 不做按 provider 的多维账单聚合（见 `specs/llm-models-unify` 非目标）。
- 不动 `agent_runs.cost` 存储语义。

---

## 3. 工作线 A · 文档校准（P0）

| 步骤 | 动作 | 文件 |
|---|---|---|
| A-1 | 删除 `DeepseekClient`，替换为 `TokenHubClient` 说明 | `agent-core/README.md` |
| A-2 | 重写 API 概览表（按 `src/index.ts` 全量导出分组：接口/客户端/注册表/引擎/记忆/搜索/工具/插件） | 同上 |
| A-3 | 补「可选注入」一节：SkillLoader、TelemetryPort、MCP 适配器、withLongRunning 的最小示例 | 同上 |
| A-4 | 搜索段落改为「WSA 优先、Bing 兜底」；头部加版本号 | 同上 |
| A-5 | 同步修正 playbook 的 📌 提示、修复 `DEPSEEK_API_KEY` 拼写 | `playbook.md:141`、`client.registry.ts:30` |

**验收**：`README.md` 中出现的每个导出名都能在 `src/index.ts` grep 到；反向也成立（用脚本对拍，见 §7）。

---

## 4. 工作线 B · 多模型接入统一（P1 → P2）

### 方案对比

| 方案 | 做法 | 成本 | 风险 | 结论 |
|---|---|---|---|---|
| **B1（推荐）** | `ai-service` 内新增同款 `ModelCatalogService`（复制实现），复用 `/internal/dict/llm_models` | 1d | 低：三级回落保底，字典挂了也不影响启动 | ✅ 先做 |
| B2 | 下沉为 `packages/llm-catalog`，两服务共用 | +1d | 中：跨服务共享包版本需同步发版 | P2，B1 稳定后再抽 |
| B3 | 维持现状，需要时手动改代码 | 0 | 高：每次加模型都走发布链路 | ❌ 不采纳 |

### B1 步骤

1. 新增 `servers/ai-service/src/agent/model-catalog.service.ts`（对齐 `ai-agent` 实现：启动即同步 + `MODEL_POLL_MS` 轮询 + 三级回落 + `clear()` 后回填）；
2. `AgentModule.onModuleInit` 中启动，替换 `clientRegistryProvider` 的硬编码注册；
3. ⚠️ 保留 `hy3` 由专用 `Hy3Client` 承载的规则（清单中混入 `hy3` 必须跳过，否则覆盖注册）；
4. env：`MODEL_DICT_CODE=llm_models`、`MODEL_SOURCE`、`MODEL_POLL_MS`（默认 60000）；
5. 普通 chat 链路的自研 `deepseek.client.ts` 标记 **deprecated**，后续切 `TokenHubClient`，统一到一把 key。

**验收**：字典里加一个新模型 id，≤60s 后 ai-service 日志出现「模型清单已更新」，Playground 下拉可见，无需重启发布。

---

## 5. 工作线 C · 调参能力补齐（P1）

### 5.1 字段设计（方案对比）

| 方案 | 做法 | 结论 |
|---|---|---|
| **C-A（推荐）** | 独立列：`max_tokens` / `top_p` / `thinking_mode` / `thinking_budget` | ✅ 类型清晰、可加索引/注释、与已有 `temperature` 列风格一致 |
| C-B | 单个 `generation_params` JSON | ❌ 与已有 `temperature` 列形成双份事实，且失去列级约束 |

| 新增列 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `max_tokens` | `int` | `null` | null = 沿用客户端默认（2000），不传 |
| `top_p` | `float` | `null` | 与 `temperature` **互斥** |
| `thinking_mode` | `varchar(16)` | `null` | `disabled` / `enabled`；null = 按模型名推断 |
| `thinking_budget` | `int` | `null` | 仅 `enabled` 时生效，建议 1024 |

### 5.2 引擎透传（唯一改动点）

`packages/agent-core/src/core/agent-engine.ts:164-166`，由

```ts
client.chatWithToolsStream(messages, toolSchemas, { temperature: agent.temperature })
```

扩为按 agent 定义透传 `maxTokens` / `topP` / `thinking`。`thinking` 解析规则：`disabled → {type:'disabled'}`、`enabled → {type:'enabled', budget_tokens}`、`null → 不传`（沿用客户端按模型推断，保证既有行为零变化）。

### 5.3 互斥校验（必须做）

在 `agent-def.service.ts` 保存路径显式报错：**`temperature` 与 `top_p` 不得同时为非默认值**（DeepSeek 官方铁律）。理由是不做校验的话，两者打架时现象是「输出时好时坏」，排查成本极高。

### 5.4 档位约定（写入 playbook）

| 场景 | temperature | top_p | max_tokens | thinking |
|---|---|---|---|---|
| 分类 / 意图路由 | 0 ~ 0.1 | 不填 | 256 | **disabled** |
| 结构化抽取 / JSON | 0 ~ 0.2 | 不填 | 按字段量 | disabled |
| 代码生成 | 0 ~ 0.2 | 不填 | ≥3000 | 视复杂度 |
| 通用对话 | 0.6 ~ 0.7 | 不填 | 800~2000 | 小预算 |
| 创意文案 | 0.8 ~ 1.0 | 或不填温度改 top_p 0.95 | 放宽 | 开 |
| Agent 工具调用 | 0.2 ~ 0.4 | 不填 | 按工具返回量 | 视链路长短 |

⚠️ 推理模型（思考模式）官方推荐 `temperature 0.6~0.7`；压到 0.1 不会更准，只会复读。**思考预算与正文共用 `max_tokens`**，预算给小会把正文挤成空串（本工程 `CLASSIFY_MAX_TOKENS=256` 就是为此）。

### 5.5 消费方清单（契约门要求，逐处确认）

- `servers/ai-service/src/agent-def/entities/agent-definition.entity.ts` + `agent-definition-version.entity.ts`
- `servers/ai-service/src/agent-def/dto/agent-def.dto.ts`、`agent-def.service.ts`（含快照逻辑）
- `servers/ai-agent/src/agent/agent-def-sync.service.ts`、`servers/ai-service/src/agent/agent-def-sync.service.ts`（DB → `AgentDefinition` 映射）
- `apps/admin/src/views/Agents/*`（表单项，走 UI 门）
- `packages/kedou-agent`（CLI 构造定义处，可选字段，编译不受影响）

---

## 6. 排期与依赖

| # | 工作线 | 优先级 | 工作量 | 依赖 | 命中动作门 |
|---|---|---|---|---|---|
| A | 文档校准 A1–A5 | **P0** | 0.5d | 无 | 无（纯文档） |
| C-1 | `agent-core` 字段 + 引擎透传 | P1 | 1.5d | 无 | **契约门**（`Contract: pass`） |
| C-2 | 实体/DTO/两处同步 + 互斥校验 | P1 | 1d | C-1 | 契约门 |
| C-3 | admin 表单三个输入项 | P1 | 1d | C-2 | **UI 门**（`Proto: <sha>` + `Design: pass`） |
| B-1 | ai-service 字典化 | P1 | 1d | 无 | **发布门**（改 env，`Release: pass`） |
| C-4 | 档位约定写入 playbook | P1 | 0.25d | C-1 | 无 |
| B-2 | 抽 `packages/llm-catalog` | P2 | 1d | B-1 稳定 | 契约门 |
| C-5 | 评测集 ≥20 条 + Playground 对比 | P2 | 1d | C-3 | 无 |

串行建议：A →（C-1 ∥ B-1）→ C-2 → C-3 → C-4 → B-2 / C-5。

---

## 7. 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| 透传 `maxTokens` 后长回答被截断 | 默认 `null` 则不传，行为与现状一致 | 列值清空即恢复 |
| `thinking:disabled` 被误配到推理类 agent | 默认 `null`（沿用推断），不会全局生效 | 列值置 null |
| ai-service 字典化后字典不可用 | 三级回落：DB → env → 代码内置 8 个 | `MODEL_SOURCE=builtin` 强制内置 |
| 新增字段影响存量定义 | 全部 nullable，且同步层缺省不传 | 无需回退 |

---

## 8. 验收标准

1. `agent-core/README.md` 与 `src/index.ts` 导出**双向对拍无误**（脚本 grep，可进 CI）。
2. 字典新增一个模型 id，≤60s 内 **ai-agent 与 ai-service 两侧同时**可见，无需发版。
3. Admin 上给某个 agent 设 `max_tokens=500`，该 agent 的回答被稳定截断在 500 以内。
4. 同时填 `temperature` 与 `top_p` 时，保存**被明确拒绝**并给出可读错误。
5. 存量 agent（新字段全 null）行为与改动前**完全一致**（回归对照）。
6. playbook 新增「参数档位」小节，与本文档 §5.4 一致。
