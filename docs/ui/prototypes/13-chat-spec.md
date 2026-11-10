# 13-气泡对话施工图 · 大橙子个人助理小程序

> 版本 v1.0 · 2026-11-09 · 负责人 issue1-product-v2（产品设计）
> 配套原型：`12-气泡对话原型稿.html`（Proto 交付，Design: pass）
> 面向对象：rd-engineer（issue3-engineer-v2）按本图实施，**只写小程序代码，不写原型**。

---

## 0. 需求三件齐（已拍板，仅归档）

- **问题陈述**：英语对话要从「卡片列表 + 输入框」改成「AI 消息气泡的直接对话形式」（参考科豆 AI）；同时首页支持新建通用 AI 对话。
- **目标用户**：小程序「大橙子个人助理」的登录用户，场景 = ① 首页发起通用 AI 聊天；② 翻译完后继续追问。
- **成功判据（宏观）**：一个统一「主对话页」承载通用对话（`auto`）与翻译追问（`translate`）两类气泡流，SSE 流式、固定 agentId、历史可恢复、返回不丢上下文。

**已拍板方案（A2）**：并入主对话页，不搞多套对话页；翻译追问固定 `translate`，通用对话固定 `auto`。本图不再重提备选方案。

---

## 1. 架构与数据流（2.1）

```
首页「新对话」 ──navigateTo──► pages/chat/index（agentId=auto，空态）
                              │  send()
                              ▼
              createAgentApi('auto').stream(userInput, {source:'chat'}, handlers)
                              │  wx.request enableChunked (SSE)
                              ▼
        gateway /api/ai-agent/agent/run → ai-agent /agent/run → agent-core
                              │  onDelta / onReply / intent / onEvent(conversationId)
                              ▼
              气泡流逐字渲染 + 锁定 conversationId（首事件捕获）

翻译结果页「继续追问」 ──navigateTo──► pages/chat/index（agentId=translate，
                                       conversationId + kd_chat_seed{原文,译文}）
                                      后续追问 createAgentApi('translate').stream(...,{source:'tool',conversationId})

对话记录列表 ──navigateTo──► pages/chat/index（conversationId）
                              getConversation(conversationId) → mergeConsecutiveAi → 渲染气泡
```

**关键结论**：后端 SSE 链路、对话列表/详情接口**全部已存在**，本次零后端改动、零新表，纯前端小程序页面 + 入口改造。

---

## 2. 改动文件清单（B · 施工图，相对 `apps/dachengzi-minigram/`）

| # | 文件 | 动作 | 说明 |
|---|---|---|---|
| 1 | `pages/chat/index/index.ts` | 新建 | 主对话页逻辑：agentId 锁定、SSE 收流、气泡流、历史恢复、种子渲染 |
| 2 | `pages/chat/index/index.wxml` | 新建 | 气泡消息流 + 空态 + 输入栏 + 自绘导航（标题/历史/新对话） |
| 3 | `pages/chat/index/index.wxss` | 新建 | 气泡样式（用户右实心蓝 / AI 左白）、流式光标、空态、输入栏 |
| 4 | `pages/chat/index/index.json` | 新建 | `navigationStyle:"custom"`（自绘导航，右侧留原生胶囊位） |
| 5 | `pages/chat/history/history.{ts,wxml,wxss,json}` | **建议新建（P1，可裁剪）** | 对话记录列表页，调用 `listConversations()`；MVP 可先不建，「历史」入口暂隐藏 |
| 6 | `app.json` | 修改 | `pages` 数组追加 `pages/chat/index/index`（主包，非分包；高频入口）；若做列表页再追加 `pages/chat/history/history` |
| 7 | `pages/home/index/index.wxml` | 修改 | hero 区加「新对话」快捷入口（独立于两条能力入口，见 §3） |
| 8 | `pages/home/index/index.ts` | 修改 | 加 `goChat()`，复用 `openEntry('/pages/chat/index/index')`（缺省 auto） |
| 9 | `pages/home/index/index.wxss` | 修改 | 加 `.newchat` 样式（品牌蓝渐变实心卡） |
| 10 | `packageTranslate/pages/translate/result/result.wxml` | 修改 | 「继续追问」区由内联气泡列表改为「在对话里继续问 →」入口 |
| 11 | `packageTranslate/pages/translate/result/result.ts` | 修改 | 加 `goFollowUpChat()`：写 `kd_chat_seed` + `navigateTo`（带 agentId/conversationId）；**保留**结构化结果页与翻译历史 |
| 12 | `packageTranslate/pages/translate/result/result.wxss` | 修改 | 追问入口样式（可小改，非必需） |

**复用（不改）**：`services/agent-stream.ts`（`createAgentApi`）、`utils/history-cards.ts`（`decorateHistoryCards`）、`utils/translate-parse.ts`（`buildTranslateCardView`/`parseSections`）、`services/auth.ts`（`isLoggedIn`）、`utils/tabbar.ts`。

---

## 3. Agent ID 固定策略（关键决策）

- **进入即锁定**：`onLoad(query)` 解析 `query.agentId`，`'translate'` → translate，其余/缺省 → `auto`；存实例字段 `this._agentId`，**整页生命周期不变**（会话级锁定，不随 intent 事件切换）。
- **source 派生**：`auto` → 不传 source（后端默认 `chat`，进入「对话记录」列表）；`translate` → `source:'tool'`（不进「对话记录」，翻译历史走自己的本地历史页）。
- **三条入口**：
  | 入口 | agentId | conversationId | 种子 |
  |---|---|---|---|
  | 首页「新对话」 | 缺省 auto | 无（新会话） | 无 |
  | 翻译结果页「继续追问」 | translate | 复用本次 translation 的 conversationId | `kd_chat_seed`（原文+译文） |
  | 对话记录列表 → 某条 | 缺省 auto；进入后取 `detail.agentId` 兜底 | 传 conversationId | 无（fetch 详情） |
- **首事件捕获 conversationId**：`onEvent` 里 `if (!this._conversationId && ev.conversationId) this._conversationId = ev.conversationId;`（与 result 页同手法）。

---

## 4. 页面清单（2.2）

| 页面 | 路由 | 职责 | 权限门控 |
|---|---|---|---|
| 主对话页 | `/pages/chat/index/index` | 通用对话 + 翻译追问气泡流 | `isLoggedIn()`（未登录 toast + 引导登录） |
| 对话记录列表（P1） | `/pages/chat/history/history` | chat 会话列表、点击恢复 | 同登录门控 |
| 首页（改） | `/pages/home/index/index` | 加「新对话」入口 | 现有 `openEntry` |
| 翻译结果页（改） | `/packageTranslate/pages/translate/result/result` | 结构化结果 + 「继续追问」入口 | 现有（已登录链路） |

---

## 5. 接口清单（2.3 · 全部沿用，零新增）

| 方法 | 路径 | 入参要点 | 出参要点 | 鉴权 |
|---|---|---|---|---|
| POST | `/api/ai-agent/agent/run` | `agentId`(auto/translate)、`userInput`、`conversationId?`、`source?` | SSE：`content_delta`/`reasoning_delta`/`final`/`intent`/`error` + `conversationId` | 用户 JWT（`Authorization: Bearer`） |
| GET | `/api/ai-agent/agent/conversations` | `page`、`pageSize`（⚠️ 不加未声明参数，后端 `forbidNonWhitelisted` → 400） | `{list: ConversationSummary[], total}` | 用户 JWT |
| GET | `/api/ai-agent/agent/conversations/:id` | `conversationId` | `ConversationDetail`（`messages`/`agentId`/`intentHistory`） | 用户 JWT |

---

## 6. 数据结构（2.4 · 无 DDL）

- 前端新增本地消息类型（建议抽到 `pages/chat/index/index.ts` 内或 `utils/chat-msg.ts`）：

```ts
interface ChatMsg {
  id: string;                 // wx:key（自增序列）
  role: 'user' | 'ai';
  text: string;               // 气泡正文（流式累加）
  loading?: boolean;          // AI 流式中
  error?: boolean;            // 失败态（渲染「重试」）
  // 翻译会话专用（可选字段）：
  isTranslateCard?: boolean;  // 译文卡气泡
  trMain?: string;            // 推荐译文主文
  trNote?: string;            // 中文注解
  trMeta?: string;            // 方向 meta（如「中文 → 英语」）
}
```

- **种子传递**：新增本地 storage key `kd_chat_seed`（写入 `{ user, reply }`，chat 页读取后 `removeStorageSync` 清除，避免残留）。结构放 `utils/translate-keys.ts` 单点真源（与现有 `kd_tr_*` 同源，方便未来清空/治理）。

---

## 7. 配置清单（2.5）

| 配置项 | 类型 | 改动 | 环境差异 | 发布关联 |
|---|---|---|---|---|
| `app.json` pages 注册 | 小程序配置 | 新增 `pages/chat/index/index`（+可选 history） | 无 | 随前端模块发布（阶段3） |
| 主对话页 `navigationStyle` | 页面 json | `custom`（自绘导航） | 无 | 随前端 |
| 网关路由 / 后端服务 | 网关/服务 | **沿用，零改动** | 无 | 无需后端发布 |

---

## 8. 依赖系统或接口（2.6）

| 依赖对象 | 类型 | 强/弱 | 缺失后果 | 发布关联 |
|---|---|---|---|---|
| 后端 ai-agent 服务（`agent/run`、`conversations`） | 内部 | 强 | 气泡流不可用 | 已就绪，无需发 |
| `createAgentApi(agentId)` 参数化 | 内部代码 | 强 | 无法区分 auto/translate | 已就绪（现支持） |
| `services/agent-stream.ts` SSE 管线 | 内部代码 | 强 | 流式失效 | 复用，不改 |
| 用户登录态（JWT） | 内部 | 强 | 发消息 401 | 已就绪 |

---

## 9. 初始化数据（2.7）

**无 DB 种子、无表结构、无预置业务数据。** 空态引导语、建议提问为前端代码常量，不算初始化数据。

---

## 10. 权限模型（2.8）

**无新权限项。** 沿用现有用户 JWT 登录：页面 `onLoad` 判 `isLoggedIn()`（`services/auth.ts`），未登录 → `wx.showToast('请先登录')` + 引导到「我的」登录入口（复用首页 `openEntry` 的拦截口径）。SSE 层本身已有登录墙兜底（`requestAgentStream` 内 `getToken()/isLoggedOut()` 校验）。

---

## 11. 接口设计约束（2.9）

1. **listConversations 不加多余 query**：后端 `ListConversationsDto` 只声明 page/pageSize 且开 `forbidNonWhitelisted`，加 `&agentId=` 会 400。对话记录列表按 `listConversations()` 原样调用即可（后端已按 source 排除 tool 会话）。
2. **历史消息合并连续 assistant**：ReAct 一轮可能落「过渡语 + 正文」两条 assistant，历史恢复渲染前须合并连续 assistant（`mergeConsecutiveAi`，当前无共享实现 → 在 chat 页写本地 helper）；翻译卡归属用 `decorateHistoryCards(msgs, detail.intentHistory)`。
3. **conversationId 未就绪禁止追问**：翻译种子态若 conversationId 仍为空（异常），发送前拦截 toast（同 result 页「翻译还没完成」口径），避免另开会话。
4. **并发串行锁**：`_busy` 锁保证同一时刻只有一条 SSE 在途，`onDelta` 按索引写回对应气泡，避免多轮串行覆盖。

---

## 12. 测试方案（4 节）

### 12.1 单元测试
- `mergeConsecutiveAi`：连续 assistant 合并、user 断点不合并、空数组。
- agentId/source 解析：`'translate'` → translate+tool；缺省/非法 → auto+chat。
- `kd_chat_seed` 解析：正常/缺失/异常 JSON 的降级。
- 翻译卡渲染复用 `buildTranslateCardView`（已有测试覆盖，回归确认）。

### 12.2 接口集成
- SSE 契约不变，由既有 `check-sse-contract`（CI R16）守护，无需新接口测试。
- `getConversation` 返回 `intentHistory` 为 null 时降级路径（`decorateHistoryCards` 已覆盖，回归确认）。

### 12.3 功能用例矩阵（见 §13 验收判据 V1..V12，逐条对应）

### 12.4 回归范围
- 翻译结果页结构化四段展示（推荐译文/直译对照/委婉版/语气要点）不回归，仅追问区改入口。
- 翻译历史页、生词本收藏、朗读（tts）不回归。
- 首页两条能力入口（翻译/新概念英语）与「最近使用」不回归。

---

## 13. 验收判据（V1..V12）

| # | 判据 | 通过标准 |
|---|---|---|
| V1 | 新建通用对话 | 首页「新对话」→ 主对话页；空态显示引导语 + 顶部「大橙子助理」+ 历史/新对话入口；请求体 `agentId=auto` |
| V2 | 发送消息 | 输入文本点发送/键盘 confirm → 用户消息以右侧实心蓝气泡上屏，输入框清空、发送键复位 |
| V3 | 流式气泡 | 发送后 AI 左侧白气泡现「正在输入」；`onDelta` 逐字追加 + 尾部光标；`onReply` 后光标/正在输入消失，气泡定格 |
| V4 | 固定 auto | 同会话多轮追问请求体 `agentId` 恒为 `auto`，页面不显示「翻译会话」标 |
| V5 | 翻译追问进气泡流 | 翻译结果页「继续追问」→ 主对话页顶部标「翻译会话」，原文（用户气泡）+译文（译文卡气泡）为首两条，追问追加同流 |
| V6 | 固定 translate + 同会话 | 翻译会话所有请求 `agentId=translate` 且复用同一 `conversationId`（`source='tool'`），不在「对话记录」列表出现 |
| V7 | 历史会话恢复 | 对话记录列表点某条 → `getConversation` 拉取渲染历史气泡（连续 assistant 已合并），可继续追问续同 conversationId |
| V8 | 空态不残留 | 空态仅引导语，不发请求/不落库/不进消息列表；发首条后空态消失 |
| V9 | 返回不丢上下文 | 对话中返回再进入（或翻译结果页返回再点「继续追问」）→ 同 conversationId 消息恢复，不重复发起首轮翻译请求 |
| V10 | 失败可重试 | `onError` 时对应 AI 气泡转失败态 + 「重试」；重试用同 agentId/conversationId 重发，不产生重复用户气泡 |
| V11 | 登录门控 | 未登录进主对话页被拦截（toast + 引导登录），不发起 SSE |
| V12 | 首页入口不破约定 | 首页能力入口仍为「翻译/新概念英语」两条；「新对话」独立于能力列表，不新增第三条能力 |

---

## 14. 交付物 trailer（给工程师的合规提示）

- 有页面/组件改动 → commit 带 `Spec:`（交互清单 page-spec，按 `page-spec-template.md` Quick/Full）。
- 有代码改动 → commit 带 `Test:`（指向真实存在的测试用例文档路径，禁止 `Test: pass` 空壳）。
- 方案文档 → `Plan:`；本图即为方案主稿，工程师落地时补发布清单（本项目纯前端，无后端阶段）。
- 原型已交付：`Proto: <12-气泡对话原型稿.html>` + `Design: pass`。

---

## 15. 待确认（给 team-lead / 用户）

| # | 待确认点 | 默认建议 |
|---|---|---|
| 1 | 「对话记录列表页」是否纳入本期（`pages/chat/history`） | 建议纳入（支撑 V7 历史恢复），可裁剪为 MVP 隐藏「历史」入口 |
| 2 | 主对话页导航用「自绘导航（custom）」还是「原生导航 + 页内工具行」 | 建议自绘导航（匹配科豆形态 + 标题/历史/新对话三入口） |
| 3 | 用户气泡配色：实心蓝 `#2563EB`（本稿） vs 浅蓝底 `#EFF6FF`（现有 result 页追问风格） | 建议实心蓝 `#2563EB`（AA 对比达标、更贴近「色块气泡」） |
| 4 | 翻译种子传递走 storage `kd_chat_seed` vs query 参数 | 建议 storage（避免长 URL 超限） |
| 5 | 空态引导语 / 建议提问文案 | 本稿「有什么想问的，直接说」+ 2 条建议，可换 |
