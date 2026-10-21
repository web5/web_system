# AI 应用清单（agent_definitions）

> **这份文档是干什么的**
> 回答一个问题：**线上到底有哪些 AI 应用**。
> 架构讨论、方案设计、写代码举例时，请以本文列出的应用为准。
>
> ⚠️ 常见错误：拿「论文抓取」「日报生成」当 AI 应用举例 —— 它们**不是**本工程的 AI 应用，
> 只是外部自动化任务。本工程的 AI 应用一律是 `agent_definitions` 表里的一行。
>
> 事实来源：`servers/ai-service/src/agent-def/agent-def.service.ts` 的 `builtinSeeds()`
> 与 `scripts/seed-music-agent.sql`。本文不含推测内容，未实现的见 §6。

---

## 1. 建模方式：一个 AI 应用 = 表里的一行

**工程里没有 `ai_app` / `ai_application` / `ai_capability` / `ai_scene` 这样的表。**

```
AI 应用        → agent_definitions 表的一行（id 即应用标识）
AI 能力        → 该行的 capabilities / tools 字段（CapabilityRef 引用）
提示词模板     → 该行的 system_prompt 字段（没有独立的 prompt 模板表）
模型绑定       → 该行的 model 字段（单值字符串，无外键、无中间表）
历史版本       → agent_definition_versions 表
运行记录       → agent_runs / run_metrics 表
```

两个服务要分清：

| 服务 | 路径 | 角色 |
| --- | --- | --- |
| **ai-service** | `servers/ai-service` | **管理面 + 定义持有方**。CRUD / 发布 / 回滚 / seed，对外提供 internal 拉取接口 |
| **ai-agent** | `servers/ai-agent` | **执行面**。跑 AgentEngine：意图路由、ToolRegistry、MCP 调用、SSE 推送 |

同步链路：两个服务各自 `agent-def-sync.service.ts` 启动时拉取 + **30s 轮询** upsert 到本地 `AgentRegistry`。改完定义不用重启，30 秒内生效。

---

## 2. 应用清单：线上共 8 个

| id | 名称 | 模型 | 能力 | 定位 |
| --- | --- | --- | --- | --- |
| `translate` | 翻译官 | `hy3` | 无工具（纯模型） | 多语种互译与润色 |
| `music` | 音乐推荐官 | `deepseek/deepseek-v4-flash` | 3 个 tool | 按场景/心情/口味推歌并出卡片 |
| `general` | 通用助手 | `deepseek/deepseek-v4-flash` | `web-search` | 日常问答兜底 + 联网搜索 |
| `contract-risk` | 合同翻译官 | `hy3` | 3 个 tool | 合同条款风险体检（带真实数字） |
| `bianbian` | 变变创作助手 | `hy3` | `image-gen` | AI 绘画 / 生图 |
| `study-assistant` | 科豆学习助手 | `hy3` | `image-gen` | 少儿知识答疑与辅导 |
| `deploy` | 发布助手 | `deepseek/deepseek-v4-flash` | 9 个 mcp | 微前端模块/后端服务发布、灰度、回滚 |
| `web-system-dev` | web_system 研发助手 | `deepseek/deepseek-v4-flash` | 4 个 mcp（知识检索） | 检索本仓库工程知识答疑 |

其中 `translate` / `music` / `general` 是用户最常提到的三个，也是**外部自动化任务之外**的代表性应用。

---

## 3. 逐个应用详情

### 3.1 `translate` 翻译官

- **能力**：无工具（纯模型能力），`maxSteps: 4`，`temperature: 0.4`
- **输出契约（硬性，顺序固定）**：【推荐译文】【直译对照】【委婉版】【语气要点】四段
- **路由关键词**：`翻译` `译成` `翻成` `英文怎么说` `英语怎么说` `英文怎么讲` `英语怎么讲` `中文怎么说` `日语怎么说` `韩语怎么说` `用英语` `用英文` `润色` `translation`
- **红线**：不删减、不臆造；专有名词/人名照原样保留
- **注意**：关键词是**字面量子串**匹配（拼成 `|` 正则），所以「英文怎么说」覆盖不了「英语怎么说」——同类说法必须逐个列全。2026-10-08 事故就是这个原因。
- 另有一份历史种子 `specs/kedou-ai-minigram/agent-translate.sql`（名为「语言翻译官」、模型不同），与代码种子 id 相同、name/model 不同，属历史双份。

### 3.2 `music` 音乐推荐官

- **能力**：`present-music-card` / `save-music-taste` / `list-music-providers`，`maxSteps: 4`，`temperature: 0.8`
- **流程（硬性）**：先 `list-music-providers` 取渠道 → `present-music-card` 出 1–3 首（title/artist/reason）→ 用户表达偏好时 `save-music-taste` 记住（**跨会话生效**）
- **路由关键词**：17 个（来首音乐 / 来首歌 / 放首歌 / 推荐音乐 / 听歌 / 歌单 / 背景音乐 / BGM / 配乐 …）
- **红线**：歌名歌手必须真实存在，不确定就换一首确定的，绝不编造
- **配套表**：`music_providers`（渠道配置，种子 `qqmusic_h5`）、`user_taste_profiles`（用户口味档案，跨会话记忆）
- **注意**：`capabilities` 字段必须是 **NULL 而不是 `[]`**（见 §5.2）

### 3.3 `general` 通用助手

- **能力**：`web-search`，`maxSteps: 8`，`temperature: 0.7`
- **关键词**：**空数组** —— 它是兜底，不靠关键词命中，路由失败时落到它
- **职责**：日常提问、闲聊、通用知识问答；需要实时信息（新闻/天气/行情）时调 `web-search`
- **边界**：需求明显属于专业场景时，提示用户去对应入口

### 3.4 `contract-risk` 合同翻译官

- **能力**：`contract-cleaner`（OCR 清洗）/ `contract-rule`（法定标准库扫描）/ `contract-irr`（真实利率 IRR/APR 计算），`maxSteps: 12`，`temperature: 0.3`
- **输出**：只输出一个 JSON 对象，字段 `scene` / `conclusion` / `keyNumbers` / `signals` / `rights` / `disclaimer`
- **合规红线**：只解读不推荐；必须附免责声明；测算必须基于工具真实数值，不得臆造
- **配套字典**：`contract_scene`（消费贷/车贷/医疗险/车险/租赁/其他）、`contract_risk_level`（danger/warn/ok）

### 3.5 `bianbian` 变变创作助手

- **能力**：`image-gen`，`maxSteps: 6`，`temperature: 0.8`
- **关键词**：画画 / 画一张 / 生图 / 生成图片 / 插画 / 变变 / 变身 / 皮克斯 …
- **定位**：把脑海里的角色、场景、变身效果画成图片，面向小朋友

### 3.6 `study-assistant` 科豆学习助手

- **能力**：`image-gen`，`maxSteps: 8`，`temperature: 0.7`
- **关键词**：学习 / 作业 / 辅导 / 小朋友 / 为什么 / 怎么算
- **定位**：面向少儿的知识答疑与学习辅导，可用画图辅助讲解

### 3.7 `deploy` 发布助手

- **能力**：9 个 **mcp** 能力 —— `deploy/list_modules` `get_current_versions` `list_releases` `publish_pipeline`（`longRunning`, `maxWaitMs 600s`, `requiresConfirm`）/ `get_job_status` `cancel_job` `publish_version` `rollback` `promote_release`（后三个均 `requiresConfirm`）
- `maxSteps: 12`，`temperature: 0.2`
- **流水线阶段**：check → pull → build → upload/restart → version → pointer → verify → cleanup
- **安全红线（硬性）**：发布 prod 前必须二次确认；prod 必须带 `confirm=true`；非 master 分支禁止发 prod；绝不自行决定回滚生产
- **易错点**：`publish_version` 必须同时传 `component`，否则历史版本切换失败
- **易错点**：提交流水线后**必须轮询到终态**才能告诉用户"已发布"

### 3.8 `web-system-dev` web_system 研发助手

- **能力**：4 个 **mcp** 知识检索 —— `knowledge/knowledge_list` + `knowledge/knowledge_search` × 3（collectionId 分别为 `ws-arch` / `ws-agent-platform` / `ws-dev-guide`）
- `maxSteps: 8`，`temperature: 0.2`
- **边界**：知识库没覆盖就如实说"知识库没有"并建议查源码路径，不用通用猜测填充；不做发布动作（引导到发布助手）
- **语料更新**：`scripts/self-knowledge/corpgen.mjs` 重新生成后入库

---

## 4. 能力的三级模型

`capabilities` / `tools` 里的引用统一是 `CapabilityRef`：

```ts
interface CapabilityRef {
  type: 'tool' | 'mcp' | 'skill';
  ref: string;        // tool:'contract-irr' ｜ mcp:'deploy/publish_pipeline' ｜ skill:'web-system-finnews'
  enabled: boolean;
  config?: Record<string, unknown>;  // longRunning / maxWaitMs / requiresConfirm / collectionId
}
```

| 类型 | 指向 | 例子 |
| --- | --- | --- |
| `tool` | 本地代码注册的具名工具 | `contract-irr`、`image-gen`、`web-search` |
| `mcp` | `mcp_tools`（经 `mcp_modules`） | `deploy/publish_pipeline`、`knowledge/knowledge_search` |
| `skill` | `agent_skills.code`（SKILL.md 行为守则） | 见 `agents/skills/*/SKILL.md` |

知识集合绑定是**约定式**：`type:'mcp' && ref 以 'knowledge/' 开头 && config.collectionId` 即视为授权该集合。

---

## 5. 改应用时必须知道的 5 个坑

### 5.1 `model` 必须带 `deepseek/` 前缀

`model` 写的是 **ai-agent 侧 ClientRegistry 的注册键**（带 `deepseek/` 前缀），不是 TokenHub 网关短名。两者不匹配时 **ai-agent 不报错，只静默回退到 hy3**（更慢更贵），表现为「徽标对、模型悄悄换了」。2026-10-08 一次路由事故就是这个（涉及 deploy / web-system-dev / general 三个）。

可用注册键见 `servers/ai-agent/src/agent/model-catalog.service.ts` 的 `BUILTIN_TOKENHUB_MODELS`。

### 5.2 `capabilities` 要 NULL 不要 `[]`

解析规则是「`capabilities` 非空（**含空数组**）则只认它，忽略 `tools` 字段」。填 `[]` 会让 `tools` 被解析成空，模型收不到任何工具，只能把 `<tool_calls>` 当文本吐出来（2026-10-09 dev 实录）。

需要两种能力并存时，把工具写成 `capabilities` 数组。

### 5.3 关键词是字面量子串

规则路由把关键词转义后拼成 `|` 正则。所以「英文怎么说」覆盖不了「英语怎么说」，同类说法必须逐个列全。

### 5.4 路由的来源优先级

`IntentVia`：`explicit`（显式指定）→ `locked`（会话锁定）→ `rule`（关键词规则）→ `llm`（模型判断）→ `fallback`（兜底到 general）。

### 5.5 单价与模型清单走字典

模型清单和单价都在字典 `dict_items`（`type_code='llm_models'`）的 `attrs` 里（`input_price_per1k` / `output_price_per1k`），`model_pricing` 表**已退役**。三级回落：DB 字典 → `TOKENHUB_MODELS` 环境变量 → 代码内置，60s 轮询。

---

## 6. 容易误认但**不存在**的东西

| 看起来像 | 实际情况 |
| --- | --- |
| `horoscope`（星座）/ `tool` / `baike` / `emotion` | 只出现在 `intent-classifier.ts` 的 `LEGACY_RULE_TABLE` 废弃兼容表里，**线上不存在**。该文件注释明确写了「不要在这里加新的 agent」 |
| `ai_app` / `ai_application` / `ai_capability` 表 | 全仓不存在 |
| 独立的 prompt 模板表 | 不存在，prompt 就是 `system_prompt` 列 |
| 应用-模型绑定关系表 | 不存在，只是 `model` 单值字符串 |
| `agent_definitions.entry` 列（`visible`/`icon`/`category`/`ui`…） | **设计稿里有，未实现**。见 `apps/kedou-ai-minigram/docs/技术架构拆解-双入口.md` |
| `GET /ai/agents` 接口 | **未实现**。小程序发现页目前仍是写死卡片（`pages/discover/index/index.wxml`） |
| `agent_definitions.source` 列 | 设计稿有，实体与 DDL 里都没有 |
| `wiki/index.md` / `wiki/log.md` | 空壳，只有标题行 |

---

## 7. 相关文档索引

**新建应用 / 改应用定义**首选：

| 文档 | 用途 |
| --- | --- |
| `docs/architecture/agent-definition-db-design.md` | Agent 定义从代码迁 DB 的完整方案（表设计、同步、权限、接口清单） |
| `docs/development/agent-capability-playbook.md` | 速查：有哪些能力、各自在哪、怎么亲手验一遍 |
| `docs/architecture/agent-system-design.md` | Agent 系统架构（T11 维度）与缺口清单 |
| `docs/architecture/ai-flow-technical-design.md` | AI 主链路（聊天/生图/知识/RAG）技术方案 |
| `docs/architecture/multi-agent-design.md` | 多 Agent 编排范式取舍（设计稿） |
| `docs/architecture/agent-evolution-roadmap.md` | Agent 子系统改造批次计划 |
| `docs/architecture/agent-message-schedule.md` | SSE/HTTP 消息清单（11 项 StreamEventType） |
| `docs/ui/page-specs/agent-def-detail-v2.md` | Agent 定义详情页规格 + Playground |
| `specs/music-recommend/` | 音乐推荐应用的需求/设计/页面规格四件套 |
| `specs/llm-models-unify/` | 模型信息收编到字典的设计 |

**能力来源**：`servers/mcp-gateway/src/mcp/entities/`（MCP 模块与工具）、`servers/ai-service/src/skill/`（技能库）、`servers/knowledge-service/src/knowledge/`（RAG）。
