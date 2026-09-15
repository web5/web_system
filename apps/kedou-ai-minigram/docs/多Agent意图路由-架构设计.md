# 多 Agent 意图路由架构设计

> 日期：2026-09-15 ｜ 范围：`servers/ai-service` / `packages/agent-core` / 小程序
> 配套：`意图识别-实现方案.md`（代码级：改哪些文件、怎么写、怎么测）

## 0. 结论

**后端的 95% 已经建好，只差「意图识别」这一层。**

需求是「后台维护多个 agent，每个有精调 systemPrompt + skills + MCP」——这套能力在 `agent_definitions` 表与 agent-core 里已经完整存在，无需新建。唯一缺失的是：**怎么决定这一句该交给哪个 agent**。

| 要的能力 | 现状 | 落点 |
|---|---|---|
| 后台维护 agent | ✅ 已有 | `agent_definitions` 表 + `admin/agent-defs`（publish / versions / rollback / enabled / capabilities） |
| 精调 systemPrompt | ✅ 已有 | `systemPrompt mediumtext`，publish 即热生效（`AgentDefSyncService` 定时轮询 DB） |
| 挂 skills | ✅ 已有 | `capabilities[{type:'skill'}]` + `skill-loader.ts` + `admin/skills` |
| 挂 MCP | ✅ 已有 | `capabilities[{type:'mcp',ref:'mcp:module/tool'}]` + `mcp-tool.adapter.ts` + 独立 `servers/mcp-gateway` |
| 多轮 + 流式 | ✅ 已有 | `POST /ai/agent/run` SSE；`conversationId` 持久化；记忆摘要压缩 |
| agentId 动态路由 | ✅ 已有 | `AgentRunDto.agentId` 本来就是入参 |
| 版本 / 回滚 / 埋点 | ✅ 已有 | 版本表 + rollback + `agent_log`（含 steps / usage / duration） |
| **意图识别 → 路由** | ❌ **缺失** | 全仓搜不到 intent / classify / dispatch / router ← **唯一要新建的** |

### ⚠️ 先纠正一个定位

**后端不在小程序仓库 `~/workspace1/web_system` 里。** 真后端在 **`~/web_system_release/`**（`servers/ai-service`、`packages/agent-core`、`servers/mcp-gateway`）。
链路：小程序 → gateway(`/api/ai-agent/agent/run`) → ai-agent → agent-core。在错误的仓库里找「agent 跑不起来」的原因会白费很多时间。

**另注：该目录会被反复 `reset --hard origin/master` 同步。** 往里放的未提交/未跟踪文件会被清掉，文档需 commit + push 才能存活。

## 1. 意图识别放哪一层

| 方案 | 做法 | 首字延迟 | 判断 |
|---|---|---|---|
| A · 前端分类 | 小程序先调分类接口，拿 agentId 再发起对话 | 两趟往返（卡两下） | ❌ 多一次鉴权与网络往返，弱网体验差 |
| B · 独立路由服务 | 新起 router 服务夹在 gateway 与 ai-service 之间 | 多一跳 | ❌ 为 5 选 1 的分类引入一个服务，运维成本不成比例 |
| **C · 后端内联** | `agentId` 可选，`'auto'` 时 controller 先分类再路由，SSE 先推 `intent` | **一次连接一次鉴权** | ✅ **选它**，复用现有鉴权 / 日志 / 会话体系，改动面最小 |

流程：

1. 小程序发一句（不传 agentId）
2. ai-service 解析意图（三级快通道）
3. **SSE 先推 `{type:'intent', agentId, confidence, via}`** —— 前端可据此渲染 agent 徽标、也便于排查误判
4. 再推正常 token 流（与现状一致）

## 2. 分类器怎么实现

意图识别一定会失败，关键不是「分得准」，而是「分错时别把用户扔进错误的专家」。

| 级别 | 触发 | 延迟 | 成本 | 说明 |
|---|---|---|---|---|
| L1 显式 | `@星座 …`、发现页进入、会话已锁定 | 0 | 0 | 最高优先级 |
| L2 规则 | 关键词 / 正则表 | ~0ms | 0 | 覆盖约 70–80% 日常输入 |
| L3 LLM | 规则未命中时才调 | 150–400ms | 低 | **必须用小模型** |
| L4 兜底 | 超时 / 解析失败 / 未知 | 0 | 0 | 一律 `general` |

> ⚠️ **分类器不能用主对话同档模型。** 分类是 5 选 1 的简单活，用同档模型会让每次对话的 token 成本直接翻倍，收益几乎为零。当前 `agent.module.ts` 已注册 `TokenHubClient('deepseek-v4-flash')` —— 直接复用，不用新增模型或 key。

## 3. 路由粒度：会话锁定 vs 每轮重分类

**如果每轮都重分类，会出三个问题：**

1. **人格割裂**：同一话题前后两句由不同 agent 回答（问百科被当情感陪聊共情）
2. **追问被切走**：用户问「那第二种呢」，分类器看到孤立一句无从判断
3. **成本翻倍**：每轮多一次 LLM 调用

**采用：会话锁定 + 切换检测**

- **锁定**：`conversation.agentId` 记录本会话当前 agent，后续轮次直接沿用（`via='locked'`，零成本）
- **切换**：仅当 ①用户显式指定（`@xxx`）②高置信规则命中（≥0.88）③LLM 高置信且与当前不同（≥0.75）时才切
- **兜底不切**：分类失败时保持现状，比乱切安全

> ⚠️ **硬前提：`conversations` 表没有 agentId 字段。** `servers/ai-service/src/conversation/entities/conversation.entity.ts` 当前只有 `userId / title / messages / summary / summarizedCount / recentMessages`。要做会话锁定必须加列 + 出 migration。

## 4. Agent 清单建议

用户列了 5 个，建议补第 6 个。

| agentId | 定位 | 要点 |
|---|---|---|
| `emotion` | 情感陪聊 | 语气优先，不主动输出长篇知识 |
| `baike` | 百科科普 | 需要联网检索能力（MCP） |
| `horoscope` | 性格星座时运 | ⚠️ 合规敏感，命理/占卜类 |
| `translate` | 语言翻译 | 顺手补上小程序侧断链的翻译入口 |
| `tool` | 工具服务 | 汇率 / 天气 / 快递 / 计算等实时能力，靠 MCP |
| **`general`** | **通用兜底** | **P0 必须补**。用户没列，但意图识别必然有失败——"在吗""嗯""？？？"。没有兜底时误判会把用户直接扔进错误的专家 agent，**比不路由还糟**。这是安全阀 |

> ✅ 这 6 个不是「开发任务」，是**后台配置**：在 `admin/agent-defs` 里建记录、填 systemPrompt、勾 capabilities（skill / mcp），**publish 即生效，不用发版**。

## 5. 前后端契约变更

| 项 | 变化 | 说明 |
|---|---|---|
| `AgentRunDto.agentId` | 可选 | 不传或 `'auto'` → 服务端分类；显式传值 → 老行为完全不变（向后兼容） |
| `StreamEventType` | 加一项 | 新增 `'intent'`，且必须是本轮第一个事件 |
| `conversations` 表 | 加两列 | `agent_id`（锁定的 agent）+ `intent_history`（判定流水，可回溯） |
| 小程序会话 | **必须配合** | **每轮回传 `conversationId`**，否则每轮都当新会话重分类 |

## 6. 成本与延迟

| 场景 | 额外延迟 | 额外成本 |
|---|---|---|
| 显式指定 / 已锁定（多数轮次） | 0ms | 0 |
| 规则命中 | ~0ms | 0 |
| 走 LLM 分类 | 150–400ms | 约 100–200 token / 次（flash 档，可忽略） |

规则命中率越高，这套架构越「免费」。目标：把 LLM 分类的触发比例压到 20% 以下。

## 7. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| **星座时运合规** | 🔴 高 | 命理/占卜类在生成式 AI 备案与内容安全口径上敏感。建议 systemPrompt 内置免责声明（"仅供参考，不构成任何建议"），**先确认口径再开发** |
| 误判把用户扔进错误专家 | 🟡 中 | 强制 `general` 兜底 + 阈值保守（宁可不切）+ 前端 agent 徽标可手动切换 |
| 分类延迟拉高首字延迟 | 🟡 中 | 1.2s 超时 + 超时即兜底；规则层挡掉大多数请求 |
| 每轮重分类导致人格割裂 | 🟡 中 | 会话锁定 + migration |
| 烧钱 | 🟢 低 | 分类器限用 flash 档 + `maxTokens:60` + `temperature:0` |

## 8. 建议的落地顺序

1. **先在 admin 后台配 6 个 agent**（含 `general`）—— 内容工作，不依赖任何代码改动，是所有后续步骤的前置
2. **发现页显式传 agentId** —— **可独立上线，不依赖意图识别**；显式指定天然绕过分类，这一版就已经是多 agent 架构了
3. **对话 tab 接线 + 灰度开关** —— 先把 `agentId` 传成 `'general'` 跑通链路，确认 SSE / 会话 / 埋点都正常
4. **上意图识别** —— 加 classifier + IntentService + migration，开关默认关，配好 agent 后打开
5. **补体验层** —— agent 徽标、手动切换、误判率观测（`intent_history`）

> ✅ **好消息：第 2 步和第 4 步可以并行，不互相阻塞。** 发现页的显式入口先上线就能用；意图路由是给「对话 tab」增强的，后上不影响前面。
