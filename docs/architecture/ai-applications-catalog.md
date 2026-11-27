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

## 2. 应用清单：三个环境口径不同（2026-11-27 分环境直查 `agent_definitions`）

> 🔴 **不要再写「线上共 14 个」。** 14 是**本机库**的行数；线上 `kedou-dev` / `kedou-prod` 各只有 **8** 行。
> 本节按四个口径分别给出 —— 任何单一数字都不足以回答「线上到底有几个应用」。

| 口径 | kedou-dev（线上） | kedou-prod（线上） | 本机 |
| --- | --- | --- | --- |
| `agent_definitions` 表内行数 | **8** | **8** | **14** |
| 已发布可用（`status='published'` 且 `published_at` 非空） | **8** | **7** | 本次未统计 |

prod 比 dev 少的那一条是 `general`：`status='draft'` 且 `published_at=NULL`。

**三环境差集**（逐条核对过；下面那张 14 行表全部是**本机行**）

- **本机独有 7 条**：`acc-agent`、`baike`、`emotion`、`general-assistant`、`horoscope`、`tool`、`widget-demo`
- **线上独有 1 条**：`music`（音乐推荐官；dev / prod 均 `status='published'` + `enabled=1`，`system_prompt` 488 字）—— **线上有、本机无**，故不在这张表里，详见 §3.2
- **共有 7 条**：`bianbian`、`contract-risk`、`deploy`、`general`、`study-assistant`、`translate`、`web-system-dev`

即：本机 14 = 7 独有 + 7 共有；线上 8 = 1 独有 + 7 共有；三环境并集 15 个 id。

| id | 名称 | 模型 | 能力 | 定位 | 环境归属 |
| --- | --- | --- | --- | --- | --- |
| `acc-agent` | 验收Agent | `hy3` | 1 个 skill（`web-system-paper`；不产生工具） | 验收场景助手，加载论文学习技能出动态 | 本机独有 |
| `baike` | 百科科普 | `hy3` | 无工具（纯模型） | 百科科普问答，先结论后原理 | 本机独有 |
| `bianbian` | 变变创作助手 | `hy3` | 1 个 tool（`image-gen`） | 面向小朋友的形象/场景 AI 生图 | 三环境共有 |
| `contract-risk` | 合同翻译官 | `deepseek-v4-flash` | 4 个 tool | 合同条款风险体检，算真实利率与维权金额 | 三环境共有 |
| `deploy` | 发布助手 | `deepseek-v4-flash` | 9 个 mcp | 微前端发布、灰度与回滚的流水线助手 | 三环境共有 |
| `emotion` | 情感陪聊 | `hy3` | 3 个 tool | 情绪陪伴为主，兼做音乐推荐出卡片 | 本机独有 |
| `general` | 通用助手 | `hy3` | 3 个 tool | 日常问答与闲聊兜底，能力上只剩音乐推荐 | 三环境共有（prod 为 `draft`） |
| `general-assistant` | 通用问答 | `deepseek-v4-flash` | 3 个 tool（`tools` 里的 `web-search` 被忽略） | 全能问答主入口，联网搜索未生效 | 本机独有 |
| `horoscope` | 星座时运 | `hy3` | 无工具（纯模型） | 星座时运娱乐解读，强制带免责声明 | 本机独有 |
| `study-assistant` | 科豆学习助手 | `hy3` | 1 个 tool（`image-gen`） | 少儿学习辅导，可调用生图辅助讲解 | 三环境共有 |
| `tool` | 工具服务 | `hy3` | 无工具（纯模型；虽名为工具服务） | 汇率/天气/计算入口，当前未挂任何工具 | 本机独有 |
| `translate` | 语言翻译官 | `deepseek-v4-flash` | 无工具（纯模型） | 四段式翻译与润色，纯模型无工具 | 三环境共有 |
| `web-system-dev` | web_system 研发助手 | `deepseek-v4-flash` | 4 个 mcp（2 个 ref / 4 条授权） | 检索本仓库工程知识答研发问题 | 三环境共有 |
| `widget-demo` | Widget 演示助手 | `hy3` | 1 个 tool（`present-widget`） | 对话内生成投票/图表/表单组件演示 | 本机独有 |

**读这张表前必须知道的四件事**

1. **「能力」列是实际生效的集合，不是数据库原始字段。** 判据见 §5.2：`capabilities` 非 NULL 时 `tools` 整列被忽略（空数组 `[]` 也算非 NULL）。
2. **`model` 列以本环境字典为准**，判据与自查 SQL 见 §5.1。本表模型只有 `hy3` 与 `deepseek-v4-flash` 两个值，**没有任何 `deepseek/` 前缀**。
3. **本表是 2026-11-27 直查本机库的结果**；各环境的字典与定义可能不同，跨环境引用前请自行核对。
4. 表只列 id / 名称 / 模型 / 能力 / 定位五项，**`maxSteps`、`temperature`、`systemPrompt` 等运行参数不在表内**，见 §3。

> ⚠️ 三处最容易误读，先说明：
> - `acc-agent` 的能力是 **`skill` 不是 `tool`**。skill 是行为守则，不进工具列表，所以它「有技能、无工具」（不是「1 个工具」）。
> - `general-assistant` 是**唯一**一条 `tools` 被 `capabilities` 吃掉的：`tools` 写着 `web-search`，但 `capabilities` 是 3 个音乐工具，实际拿不到联网。其余 `capabilities`/`tools` 双非空的条目属同集冗余或 mcp 口径差异，不是缺陷。
> - 🔴 **全表 14 条没有任何一条实际生效 `web-search`**，且本机 / dev / prod 三环境 `.env` 都没有搜索服务凭据（`BING_SEARCH_API_KEY` 等），所以**联网搜索当前整体不可用**，不是单个 agent 的配置问题。

其中 `translate` / `contract-risk` / `general` 是用户最常提到的三个，也是**外部自动化任务之外**的代表性应用。


---

## 3. 逐个应用详情

> 本节覆盖 8 条，其中 `music` **在本机库中不存在**（线上有，见 3.2）。库里另有 7 条（`acc-agent` / `baike` / `emotion` / `general-assistant` / `horoscope` / `tool` / `widget-demo`）只有 §2 表格的一行，尚未展开详情。
>
> 🔴 **本节数字以库为准，与代码种子 `builtinSeeds()`（`servers/ai-service/src/agent-def/agent-def.service.ts`）不一致时以库为准。** 本节历史上是照代码种子写的，2026-11-27 逐条比对后发现 4 节共 9 处实质不符（`translate` / `music` / `general` / `contract-risk`），已修正。
>
> ⚠️ 另有一条通病：**14 条 agent 的 `keywords` 列全为 NULL**。本节各处列出的「路由关键词」都只存在于代码种子，**没有一条落库**，因此关键词规则路由在当前库状态下不会命中任何一条。

### 3.1 `translate` 语言翻译官

- **模型**：`deepseek-v4-flash`（库实际值；代码种子写的是 `hy3`）
- **能力**：无工具（纯模型能力），`maxSteps: 4`，`temperature: 0.3`
- **输出契约（硬性，顺序固定）**：【推荐译文】【直译对照】【委婉版】【语气要点】四段
- **路由关键词**（仅存在于代码种子，库 `keywords` 为 NULL）：`翻译` `译成` `翻成` `英文怎么说` `英语怎么说` `英文怎么讲` `英语怎么讲` `中文怎么说` `日语怎么说` `韩语怎么说` `用英语` `用英文` `润色` `translation`
- **红线**：不删减、不臆造；专有名词/人名照原样保留
- **注意**：关键词是**字面量子串**匹配（拼成 `|` 正则），所以「英文怎么说」覆盖不了「英语怎么说」——同类说法必须逐个列全。2026-10-08 事故就是这个原因。
- 另有一份历史种子 `specs/kedou-ai-minigram/agent-translate.sql`，与代码种子 id 相同、name/model 不同，属历史双份；库里的 `name` 是「语言翻译官」。

### 3.2 `music` 音乐推荐官 —— **线上在跑，本机没有**

2026-11-27 分环境直查（同一轮查询同时取了定义表与渠道表）：

| 环境 | `agent_definitions` 里的 `music` | `music_providers`（渠道配置） |
| --- | --- | --- |
| kedou-dev | **有**：`status='published'` + `enabled=1`，`system_prompt` 488 字 | 只有 `qqmusic_h5`（`h5`）一条 |
| kedou-prod | **有**：`status='published'` + `enabled=1`，`system_prompt` 488 字 | `qqmusic`（`mini_program`）+ `qqmusic_h5`（`h5`）两条 |
| 本机 | **无**：`agent_definitions` 0 行，`agent_definition_versions` 也无任何 `music` 版本 | 已有 legacy `qqmusic`（`mini_program`）一条，不是零配置 |

所以 `scripts/seed-music-agent.sql`（第 38 行 `INSERT INTO agent_definitions`）**不是孤儿种子 —— 它在线上已生效，只是本机未执行**。谁在本机跑它，谁就会补出本节描述的这条 `music`。

⚠️ 三环境的 `music_providers` 并不一致（见上表）：本机是 legacy `mini_program` 渠道、dev 只有 `h5`、prod 两者都有。所以任何「音乐卡片在各环境表现一致」的假设都不成立，比对前先确认渠道。

本机因为没有这条定义，本节描述的三个能力（`list-music-providers` / `present-music-card` / `save-music-taste`）挂在本机的 `general`、`emotion`、`general-assistant` 三条定义上（见 §3.3）。线上 `music` 自身的能力集合本次未逐条核对，引用其字段前请自行直查。

本节原有的两条纪律与环境无关，继续适用于现在承载这三个工具的各条 agent：

- **红线**：歌名歌手必须真实存在，不确定就换一首确定的，绝不编造
- **注意**：`capabilities` 字段必须是 **NULL 而不是 `[]`**（见 §5.2）——`translate` 恰好是 `[]` 的反例

配套表 `music_providers`（渠道配置，三环境取值见上表，**不可只按 `qqmusic_h5` 一种口径理解**）与 `user_taste_profiles`（用户口味档案，跨会话记忆）仍然存在。

### 3.3 `general` 通用助手

- **模型**：`hy3`（库实际值；代码种子写的是 `deepseek-v4-flash`）
- **能力**：3 个 tool —— `list-music-providers` / `present-music-card` / `save-music-taste`；`tools` 为空，`maxSteps: 5`，`temperature: 0.7`
- **关键词**：库 `keywords` 为 **NULL** —— 它是兜底，不靠关键词命中，路由失败时落到它
- **职责**：日常提问、闲聊、通用知识问答
- 🔴 **它没有联网搜索**：`web-search` 不在它的能力里（`tools` 为空，`capabilities` 是音乐三件套）。2026-11-27 实测它明确回答「我目前没有可用的 web-search 工具……我现有的能力主要是音乐推荐」。
- **边界**：需求明显属于专业场景时，提示用户去对应入口

### 3.4 `contract-risk` 合同翻译官

- **模型**：`deepseek-v4-flash`
- **能力**：4 个 tool —— `contract-cleaner`（OCR 清洗）/ `contract-rule`（法定标准库扫描）/ `contract-irr`（真实利率 IRR/APR 计算）/ `contract-benchmark`，`maxSteps: 20`，`temperature: 0.3`
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

### 5.1 `model` 必须逐字等于**本环境字典**里某个启用的 `value`

`model` 写的是 ai-agent 侧 ClientRegistry 的注册键。注册来源是**当前环境字典** `dict_items`（`type_code='llm_models'`）里**启用项的 `value` 逐字**：

- `model-catalog.service.ts` 的 `fetchFromDict()` 只取 `row.value`，`attrs` 不参与模型注册（`attrs` 只被 `dict-pricing.provider.ts` 用来读单价）；
- 注册是 `registry.register(new TokenHubClient(m))`，ClientRegistry 内部是 **Map 精确匹配，没有前缀归一化**。

所以 `agent_definitions.model` 必须与字典 `value` 一字不差。对不上时 **ai-agent 不报错，只静默回退到 hy3**（更慢更贵），表现为「徽标对、模型悄悄换了」，只在 `web-ai-agent-error.log` 留一条 `ClientRegistry 模型 xxx 未注册`。

🔴 **`deepseek/` 前缀既不是必需的，也不能当规范**：带前缀的写法只有在字典里恰好存在同名 `value` 时才可解析。2026-11-27 实测 dev 与 prod 的字典均为 3 项**全裸名**（`deepseek-v4-flash` / `deepseek-v4-pro` / `hy4-preview`），因此 `deepseek/deepseek-v4-flash` 在这两个环境**必然**回落 hy3。本机当时就有 3 条 agent 这么写着（合同翻译官 / 语言翻译官 / 通用问答），已改为裸名。

> 历史注记：2026-10-08 那次路由事故（deploy / web-system-dev / general 三个回落 hy3）确实存在，当时的成因是「网关短名 ≠ 注册键」，本节曾据此写成「必须带前缀」。2026-11-27 复核发现该结论会随字典内容变化而失效 —— **真正的判据是「与本环境字典 value 是否逐字相等」，不是「有没有前缀」**。

兜底层级：字典 → `TOKENHUB_MODELS` 环境变量 → 代码内置 `BUILTIN_TOKENHUB_MODELS`（60s 轮询）。**兜底清单不是可用键的权威列表**，只有字典是。

自查（返回 0 行才算干净）：

```sql
SELECT name, model FROM agent_definitions
 WHERE model NOT IN (SELECT value FROM dict_items WHERE type_code='llm_models' AND enabled=1)
   AND model <> 'hy3';   -- hy3 是常驻模型，不在字典内属设计如此
```

### 5.2 `capabilities` 要 NULL 不要 `[]`

解析规则是「`capabilities` 非空（**含空数组**）则只认它，忽略 `tools` 字段」。填 `[]` 会让 `tools` 被解析成空，模型收不到任何工具，只能把 `<tool_calls>` 当文本吐出来（2026-10-09 dev 实录）。

需要两种能力并存时，把工具写成 `capabilities` 数组。

### 5.3 关键词是字面量子串

规则路由把关键词转义后拼成 `|` 正则。所以「英文怎么说」覆盖不了「英语怎么说」，同类说法必须逐个列全。

### 5.4 路由的来源优先级

`IntentVia`：`explicit`（显式指定）→ `locked`（会话锁定）→ `rule`（关键词规则）→ `llm`（模型判断）→ `fallback`（兜底到 general）。

### 5.5 单价与模型清单走字典

模型清单和单价都在字典 `dict_items`（`type_code='llm_models'`）的 `attrs` 里（`input_price_per1k` / `output_price_per1k`），`model_pricing` 表**已退役**。三级回落：DB 字典 → `TOKENHUB_MODELS` 环境变量 → 代码内置，60s 轮询。

⚠️ **但当前没有任何一条配了单价**：2026-11-27 实测三环境，本机多数条目连价格 key 都没有、`hy4-preview` 是 `0/0`、dev/prod 的 `attrs` 直接是 NULL。⇒ **所有模型 run 的成本现在全按 0 记**。要让成本统计有意义，必须先补真实单价；补之前任何「成本」口径的结论都不成立。

⚠️ 另注：`attrs` **不参与模型注册**，注册只取 `value`（见 §5.1）。所以填 `attrs` 只影响单价与 UI 展示，填错了不会导致模型注册失败。

---

## 6. 容易误认的东西

> 本节第一行已于 2026-11-27 被证伪，保留原文并标注，因为「以为它不存在」这件事本身还会再发生。

| 看起来像 | 实际情况 |
| --- | --- |
| ~~`horoscope`（星座）/ `tool` / `baike` / `emotion`~~ **← 此行已证伪** | 🔴 **2026-11-27 直查：这四个 id 全部在库，且都是 `status='published'` + `enabled=1`**（见 §2 表格）。它们确实**也**出现在 `LEGACY_RULE_TABLE` 废弃兼容表里，但那是意图分类在「未传 routingHints」时的降级兜底表，**不代表线上不存在**。<br>`intent-classifier.ts` 现位于 `packages/agent-core/src/core/`（不在 `servers/ai-agent/src`），其注释原文是「未传 routingHints 时才退回 LEGACY_RULE_TABLE（仅供旧单测 / 降级兼容，不要在新代码依赖）」——「不要依赖」针对的是这张旧规则表，**不是**说这些 agent 不存在 |
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
