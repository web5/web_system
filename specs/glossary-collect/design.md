> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

# 生词本 / 收藏（一期）技术方案

## 1 背景与现状

「收藏 / 生词本」当前是**纯占位**，两端都只弹 toast，无任何持久化：

| 位置 | 现状 |
|---|---|
| 小程序聊天页卡片 `onCardFav`（`apps/kedou-ai-minigram/pages/chat/index/index.ts:652`） | `wx.showToast('已收进生词本')`，无接口调用 |
| 小程序翻译结果页 `fav`（`packageTranslate/pages/translate/result/result.ts:178`） | 同上 |
| 小程序设置页 `goGlossary`（`packageTranslate/pages/translate/settings/settings.ts:34`） | `wx.showToast('术语库开发中')` |
| PC 端 `collectWord`（`apps/portal/src/views/AiChat.vue:368`） | `message.success('已收进生词本')` |

后端搜 `生词 / favorite / 收藏 / wordbook / glossary` 在 `servers/**` **零命中**。

**目标**：把「收藏译文」做成真实的、按用户跨会话持久化的能力，小程序与 PC 端共用同一份数据（前提：账号已绑定）。

## 2 关键决策与理由（已与用户确认，2026-09-22）

| 决策 | 理由 |
|---|---|
| **数据落 user-service（跟用户走，不跟 AI 走）** | 收藏是用户主动行为产生的数据，生命周期跟账号走；放 `web_system` 库，与 `users` 同库。用户明确拍板 |
| **收藏对象 = 译文快照，而非消息引用** | 生词本是用户知识资产，独立生命周期；存引用（messageId）会导致会话删除后收藏悬空。收藏那一刻的 `enMain + sourceText + note + meta` 冗余落库 |
| **去重按 `(user_id, content_hash)` 唯一，幂等** | 同一句译文重复收藏无意义；`content_hash` = `enMain` 归一化（trim + 小写 + 压缩空白）后 `sha256` 截 64。重复收藏返回「已存在」，不报错不重复插入 |
| **存语气/风格 meta** | 生词本回显「正式 · 中文→英语」这类信息。用户确认要存 |
| **跨端同步前提 = 账号绑定** | 默认小程序（`mpOpenid`）与 PC（账号密码）是两条 `users` 记录；`POST /auth/bind-miniprogram` 绑定后同一 `user.id` 才互通。未绑定时两端各看各的 |
| **一期只覆盖「翻译」类** | 聊天页翻译卡片 + 翻译结果页两个入口；合翻（contract）产物是报告不是「生词」，**后面另做**（用户提：可能需要一个「AI 产物站点」承载，见 §10 后续） |

## 3 数据模型

### 3.1 `glossary_entries`（新建，落 user-service 库 `web_system`，与 `users` 同库）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| user_id | varchar(64) | 索引，越权防护按此过滤 |
| content_hash | varchar(64) | `enMain` 归一化后 sha256 截 64；唯一索引 `(user_id, content_hash)` |
| source_type | varchar(16) | `chat`（聊天页翻译卡片）/ `translate`（翻译结果页） |
| source_text | text nullable | 中文原文（chat 卡片可能无原文，可空） |
| en_main | text | 英文译文主文 |
| note | text nullable | 注解 / 直译对照 / 委婉版（翻译卡片的折叠注解区） |
| meta | json nullable | `{ tone?, style?, direction:'zh2en' }` |
| conversation_id | varchar(64) nullable | 关联会话，用于「回看上下文」；会话删除后此列保留但跳转降级 |
| created_at / updated_at | datetime(6) | |

### 3.2 建表（DDL）结论

- 项目有正式迁移机制：`scripts/migrations/*.sql` + `scripts/apply-migrations.sh <local|dev|prod>`（`schema_migrations` 幂等记账）。本表已由 `scripts/migrations/p26-glossary-user-memory-tables.sql` 建表（幂等 CREATE TABLE IF NOT EXISTS）。
- **本地/开发**：也可由 synchronize 自动建表（`NODE_ENV !== 'production'`）。
- **生产**：`synchronize` 关闭，靠迁移脚本建表（p26）。
- 实体必须**显式注册**进 `servers/user-service/src/app.module.ts` 的 `entities` 数组（该服务不是 glob 扫描，与 ai-agent 不同）。

## 4 接口 / 契约

`@Controller('glossary')` + `@UseGuards(AuthGuard)`（复用 `servers/user-service/src/auth/auth.guard.ts`），身份取 `req.user.id`。

```
POST   /api/glossary
  body: { sourceType:'chat'|'translate', sourceText?, enMain, note?, meta?, conversationId? }
  → 幂等：已存在返回 { id, created:false, existed:true }；新插返回 { id, created:true }
  → 校验：enMain 必填非空；sourceType 枚举

GET    /api/glossary?page=1&pageSize=20&keyword=?
  → { list:[{ id, sourceType, sourceText, enMain, note, meta, createdAt }], total }
  → 仅当前用户（where userId），createdAt 倒序，keyword 可选（模糊 enMain/sourceText）

DELETE /api/glossary/:id
  → 仅本人可删；他人/不存在统一 404（按「不存在」处理，不泄露存在性）
```

响应统一 `{ code, data, message }`（user-service 现有全局 TransformInterceptor/异常过滤器已保证）。

### 4.1 gateway 路由（必须新增）

`servers/gateway/src/proxy/proxy.controller.ts` 新增一对硬编码路由（对齐 `/api/keys` 的写法，第 62-71 行）：

```ts
// 生词本（/api/glossary → user-service）
@All('glossary')              proxyGlossaryExact(...)     { return this.proxyService.getUserProxy()(req, res); }
@All('glossary/:path(*)')     proxyGlossaryWildcard(...)   { return this.proxyService.getUserProxy()(req, res); }
```

## 5 鉴权与可见性

- 全部走 `AuthGuard` → auth-service `/auth/verify` → `req.user.id`。
- 列表/删除强制带 `userId` 条件，他人数据按「不存在」处理。
- 跨端可见性：同一 `user.id` 下数据互通；未绑定前两端 `user.id` 不同，天然隔离，无泄漏。

## 6 消费约定（前端封装）

- 小程序新增 `apps/kedou-ai-minigram/services/glossary.ts`：`BASE = '/api/glossary'`，导出 `collect / list / remove`（对齐 `services/user-taste.ts` 写法）。
- PC 新增 `apps/portal/src/api/glossary.ts`：同上，走 axios `request`（baseURL `/api`）。
- 两端 `collect` 入参字段一致，后端一份 DTO。

## 7 前端改动

> ⚠️ 涉及小程序新页面与 PC 新 Vue 页面，**走 UI 动作门**：先原型 → 质检 → 用户确认 → 单独 commit 记 sha → 落码带 `Proto: <sha>`。

1. **小程序·接入收藏**：`pages/chat/index/index.ts:652` `onCardFav` 与 `packageTranslate/.../result.ts:178` `fav()` 改为调 `collect()`；成功 toast「已收进生词本」，已存在 toast「已在生词本」。聊天页 `onCardFav` 现无入参，需补 `data-idx` 取当前卡的 `enMain`；结果页用 `this.data.natural`（英文主文）+ 原文。
2. **小程序·生词本页**：`packageTranslate/.../settings.ts:34` `goGlossary()` 由占位改为 `navigateTo` 生词本列表页（新页面，wxml/ts/wxss/json + app.json 注册）；列表项支持删除，点击「回看」按 `conversationId` 跳对话（无 conversationId 时隐藏）。
3. **PC·接入收藏**：`apps/portal/src/views/AiChat.vue:368` `collectWord()` 改为调 `collect()`；需拿到当前卡片的 `enMain + 原文`（现函数无参，需补入参）。
4. **PC·生词本查看页**：新增 `apps/portal/src/views/Glossary.vue` + 路由，**入口挂「个人中心」**（用户拍板）；列表 + 删除，对齐 portal 现有 antd 风格。

## 8 失败与降级

- 未登录 / 401 → 复用两端现有 401 处理，不额外处理。
- 重复收藏 → 幂等返回，toast「已在生词本」，不报错。
- 列表接口失败 → 空态 + 重试按钮，不阻塞其它页面。
- `conversationId` 对应会话已被删 → 回看入口隐藏或 toast「原会话已删除」。

## 9 实施顺序（已确认，无阻塞项）

1. 后端：`glossary-entry.entity.ts` + `glossary.controller` + `glossary.service` + DTO，注册进 `app.module.ts` entities 与 module → gateway 加 `/api/glossary` 路由 → 接口自测。
2. 小程序：`services/glossary.ts` + 接入两个收藏点 → 生词本页（走 UI 门）。
3. PC：`api/glossary.ts` + 接入 `collectWord` → 生词本查看页（走 UI 门，入口个人中心）。
4. 端到端：绑定账号后验证跨端同步；未绑定验证隔离。

## 10 后续（不在本期）

- **合翻（contract）收藏 / AI 产物站点**：用户提「合同后面另外做，可能需要一个 AI 产物站点来支持」。合同产物（报告等）的收藏/沉淀，后续按「AI 产物站点」单独立项设计，不与生词本混表。
