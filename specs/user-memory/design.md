> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

# 用户记忆（User Memory）技术方案

## 1 背景与目标

个人中心新增「用户记忆」板块：AI 在**每一轮对话结束后**（不管 `source`，只要进了 AI），异步从本轮对话里提炼可沉淀的用户偏好 / 事实 / 习惯，合并写入用户级记忆表；用户可在个人中心查看、删除。记忆更新做成 **AI 流程的插件能力**（后置钩子），不阻塞对话响应。

本批次同时把**音乐口味并入记忆体系**：`user_taste_profiles` 从 ai-agent 迁到 user-service，作为记忆的 `music` 域，与自由画像记忆统一由「用户记忆」体系读写。

## 2 关键决策与理由（已与用户确认，2026-09-22）

| 决策 | 理由 |
|---|---|
| **数据落 user-service（跟用户走）** | 用户拍板方案 B：记忆与收藏同源，个人中心的「收藏 + 记忆」统一从 user-service 读；AI 通过 internal 接口写 |
| **更新范围 = 所有进入 AI 的对话** | 用户拍板：不区分 `source`，`chat` / 翻译 / 合同工具页的对话**都**做记忆提取 |
| **挂点：对话结束之后，fire-and-forget 异步** | 不阻塞 SSE；复用 `runPusher.push` / `snapshotReport` 的「fire-and-forget + `.catch(() => {})`」模式，一期不引入队列 |
| **做成「后置钩子插件」而非硬编码** | 用户要求「插件能力」。定义 `PostRunHook` 接口，记忆更新是第一个实现，未来后置逻辑都往列表加 |
| **音乐口味本期并入** | 用户拍板：`user_taste_profiles` 迁到 user-service，`save-music-taste` 工具与口味读接口改指向，作为记忆的 `music` 域 |
| **音乐口味与自由记忆分表（同库）** | 音乐口味是结构化 json（likes/dislikes 数组 + 专门 UI），自由记忆是条目文本，结构不同不硬并一张表；同落 user-service 即可实现「统一管理」 |

## 3 数据模型（均落 user-service 库 `web_system`）

### 3.1 `user_memories`（新建，条目化自由记忆）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| user_id | varchar(64) | 索引，越权防护按此过滤 |
| category | varchar(32) | `preference`（偏好）/ `fact`（事实）/ `habit`（习惯） |
| content | text | 记忆内容（自然语言，如「用户在备考雅思」「用户偏好正式语气」） |
| content_hash | varchar(64) | content 归一化（trim + 小写 + 压缩空白）后 sha256 截 64；唯一索引 `(user_id, category, content_hash)` |
| confidence | decimal(3,2) default 1.00 | LLM 输出置信度，低于阈值不落库 |
| source_conversation_id | varchar(64) nullable | 来源会话 |
| created_at / updated_at | datetime(6) | |

### 3.2 `user_taste_profiles`（读写方从 ai-agent 切到 user-service，**无需跨库迁移**）

- 原实体 `servers/ai-agent/src/music/user-taste-profile.entity.ts` → 迁到 `servers/user-service/src/`（`UserTasteProfileEntity`）。
- 列不变：`id / user_id / namespace('music') / data(json) / created_at / updated_at / deleted_at`，唯一索引 `(user_id, namespace)`。
- **实测结论（2026-09-22）**：本地及 dev/prod 的 ai-agent 与 user-service 都配置 `DB_DATABASE=web_system`，共用同一个库，`user_taste_profiles` 表**早已在 web_system 库**（含 deleted_at 列，本地 1 行数据）。因此**无需跨库搬数据**——表与数据天然就在目标库，本次只切换读写方（ai-agent 的 `MusicService` 改 HTTP 代理、删除本地实体，user-service 新增 `user-taste` 模块直连同名表）。

### 3.3 建表（DDL）

项目有正式迁移机制：`scripts/migrations/*.sql` + `scripts/apply-migrations.sh <local|dev|prod>`（`schema_migrations` 幂等记账，文件头 `-- @database <db>` 指定目标库）。本次两张新表已由 `scripts/migrations/p26-glossary-user-memory-tables.sql` 建表（幂等 CREATE TABLE IF NOT EXISTS）。三个新实体都要显式注册进 `servers/user-service/src/app.module.ts` 的 entities 数组。

## 4 更新机制（PostRunHook 插件 + internal 写接口）

### 4.1 插件接口

```ts
interface PostRunContext {
  userId: string;
  conversationId: string | null;
  userInput: string;
  finalAnswer: string;
  steps: Step[];
  source: 'chat' | 'tool';
}

interface PostRunHook {
  name: string;
  trigger(ctx: PostRunContext): Promise<void>; // controller fire-and-forget 调用
}
```

### 4.2 挂点

`servers/ai-agent/src/agent/agent.controller.ts` 的 `handleRun`：

- 在 `res.end()`（第 312 行）**之后**，与 `runPusher.push`（第 322-343 行）、`snapshotReport`（第 347-358 行）并列。
- 数据已齐：`userId`（第 165 行）、`conversationIdFromEngine`（第 296 行）、`dto.userInput`、`finalAnswer`（第 295 行）、`steps`、`dto.source`。
- 调用：`for (const hook of this.postRunHooks) hook.trigger(ctx).catch(() => {})`。
- 注入：`AgentController` 注入 `postRunHooks: PostRunHook[]`（`AgentModule` 以 provider 数组提供）。

### 4.3 `UserMemoryUpdateHook` 逻辑（第一个插件）

1. **全量触发**：不按 `source` 过滤（用户拍板），所有对话都提取。
2. 调 LLM：输入 `userInput + finalAnswer`，输出结构化 JSON：`{ items: [{ category, content, confidence, action: 'add'|'remove' }] }`。
3. `confidence < 阈值`（如 0.6）丢弃。
4. `action='add'` → 经 internal 接口 upsert；`action='remove'` → 删除命中条目。
5. 全程 `.catch(() => {})`，失败只 warn，不影响对话主链路。

### 4.4 写路径：ai-agent 直连 user-service internal 接口

- ai-agent 通过 `USER_SERVICE_URL`（环境变量，对齐 `AUTH_SERVICE_URL` 直连模式）调用 user-service 的 internal 接口。
- 服务间鉴权：`x-service-key` 头（密钥 `USER_SERVICE_KEY`，user-service 与 ai-agent 两端配置；对齐 content-hub 的 `x-service-key` 模式）。
- **`save-music-taste` 工具改造**：`servers/ai-agent/src/music/tools/save-music-taste.tool.ts` 不再直写 ai-agent 的 `user_taste_profiles`，改为调 user-service internal 的 `user-taste/merge`。

## 5 接口 / 契约

### 5.1 对外（个人中心，经 gateway，走 user-service）

```
GET    /api/user-memory?page=1&pageSize=50        → 自由记忆列表（按 category 分组前端做）
DELETE /api/user-memory/:id                        → 删单条记忆（仅本人，他人 404）

GET    /api/user-taste/:namespace                  → 音乐口味读（从 /api/ai-agent/user-taste 迁来）
PUT    /api/user-taste/:namespace                  → 音乐口味增量更新（迁来）
DELETE /api/user-taste/:namespace/tag              → 删单个口味标签（迁来）
DELETE /api/user-taste/:namespace                  → 清空口味（迁来）
```

`@UseGuards(AuthGuard)`（复用 `servers/user-service/src/auth/auth.guard.ts`），身份取 `req.user.id`。controller 挂 user-service：`@Controller('user-memory')`、`@Controller('user-taste')`。

### 5.2 对内（ai-agent 直连，不经 gateway，`x-service-key` 鉴权）

```
POST /internal/user-memory/upsert
  header: x-service-key
  body: { userId, items: [{ category, content, confidence }] }

POST /internal/user-taste/merge
  header: x-service-key
  body: { userId, namespace:'music', patch: {...} }
```

`@Controller('internal')`，用 service key 守卫（非 JWT），仅供 ai-agent 服务间调用。

### 5.3 gateway 路由（新增）

`servers/gateway/src/proxy/proxy.controller.ts` 新增（对齐 `/api/keys` 写法，第 62-71 行）：

```ts
@All('user-memory')           proxyUserMemoryExact(...)    → getUserProxy()
@All('user-memory/:path(*)')  proxyUserMemoryWildcard(...) → getUserProxy()
@All('user-taste')            proxyUserTasteExact(...)     → getUserProxy()
@All('user-taste/:path(*)')   proxyUserTasteWildcard(...)  → getUserProxy()
```

> 注：`/api/user-taste` 原走 `/api/ai-agent/user-taste`（ai-agent），迁到 user-service 后旧前缀可保留一个过渡期做 302/兼容，或直接切换前端（见 §9）。

## 6 前端改动（个人中心）

> ⚠️ 个人中心改造（小程序 `pages/mine/**` + PC 个人中心）**走 UI 动作门**：先原型 → 质检 → 用户确认 → 单独 commit 记 sha → 落码带 `Proto: <sha>`。

1. **小程序·个人中心「用户记忆」板块**：`pages/mine/` 新增「记忆」分组，展示画像记忆（category 分组 + 单条删除）+ 音乐口味（沿用口味页交互，读 `/api/user-taste/music` 改为 user-service 路径）。
2. **PC·个人中心「用户记忆」板块**：portal 个人中心新增记忆展示/删除 + 口味，对齐 antd。
3. 音乐口味读接口路径从 `/api/ai-agent/user-taste/...` 切到 `/api/user-taste/...`（小程序 `services/user-taste.ts` 的 `BASE`）。

## 7 失败与降级

- LLM 提取失败 / 超时 → 静默，本轮不更新记忆。
- user-service internal 接口不可用 → hook `.catch` 吞掉，日志 warn，不影响对话。
- 个人中心读失败 → 空态 + 重试，不阻塞个人中心其它板块。
- 音乐口味迁移期：旧 `/api/ai-agent/user-taste` 保留兼容（或直接切换 + 前端同步发版）。

## 8 待确认（剩余）

- [ ] **LLM 提取模型与 prompt**：复用 ai-agent model catalog 的哪个模型；提取 prompt 与 `confidence` 阈值实现阶段定。
- [ ] **记忆是否支持用户手动新增/编辑**：一期按「只读 + 删除」（用户未反对，默认此）。
- [ ] **音乐口味迁移的切换方式**：旧 `/api/ai-agent/user-taste` 是「保留兼容过渡」还是「直接切换 + 前后端同发版」？（推荐直接切，一次性干净）
- [ ] **`save-music-taste` 是否保留**：并入后音乐口味仍由该工具在对话中同步写（只是改写 user-service），还是也改由 `UserMemoryUpdateHook` 统一异步写？（推荐保留工具，因口味是对话中明确表达的、需要即时反馈）

## 9 实施顺序（确认后）

1. user-service：`user_memories` + 迁移版 `user_taste_profiles` 实体/表 + `user-memory` / `user-taste` controller + `internal` controller（service key 守卫）+ DDL + 数据迁移。
2. ai-agent：`PostRunHook` 接口 + `UserMemoryUpdateHook`（调 user-service internal）+ `save-music-taste` 工具改指向 + `agent.controller.ts` 注入 `postRunHooks` 接线 + `USER_SERVICE_URL` / `USER_SERVICE_KEY` 配置。
3. gateway：`/api/user-memory`、`/api/user-taste` 路由。
4. 前端：个人中心记忆板块（小程序 + PC，走 UI 门）+ 口味读接口切路径。
5. 端到端：对话后延迟刷新个人中心验证记忆出现；口味增删/清空；越权、LLM 失败、internal 不可用降级。
