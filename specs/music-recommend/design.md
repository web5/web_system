> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

# 歌曲推荐卡片（一期）技术方案

## 1 架构总览

```
小程序聊天页
  ├─ SSE (wx.request enableChunked)  ← ai-agent /agent/run
  │    事件: token/content_delta | tool_call | tool_result | intent | final | 【新增 card】
  └─ 点击「去 QQ音乐听」 → wx.navigateToMiniProgram(appId from 卡片, path)

ai-agent (ReAct loop)
  ├─ 工具 present_music_card（本地）  → 产出 SSE card 事件 + 落库
  ├─ 工具 save_music_taste（本地）    → 写 user_taste_profiles
  └─ MCP 工具 music/list_music_providers（mcp-gateway，DB 驱动）

注入点：agent-engine 组装 messages 时插入 [用户口味档案] system 消息
```

## 2 关键决策与理由

| 决策 | 理由 |
|---|---|
| **一期不站内播放** | 版权（QQ音乐无官方开放 API，灰色直链合规风险）+ 小程序音频域名白名单不可控。见 requirements §2 反例 |
| **跳转目标 DB 可配置** | 硬编码 appId 每次变更都要提审；照 `content_sources` 风格（code/name/config/enabled） |
| **歌曲元数据由 LLM 生成，不接曲库 API** | 一期零外部依赖、零版权风险；provider 的 `search_template` 负责把歌名拼成跳转定位参数 |
| **卡片走独立 SSE `card` 事件，不塞进 final 文本** | schema 固定、前端易渲染、历史可还原；塞 JSON 字符串进 content 会让文本解析脆弱 |
| **口味存独立表而非扩 `users`** | `users` 在 auth 域，跨服务写不便；agent 侧需低延迟读写。表名带 namespace 便于后续扩展到其它偏好域 |
| **一期只上 QQ音乐一个 provider** | 用户拍板。表与工具仍按多 provider 设计（code/name/sort/enabled），配第二条只是插一行数据 |
| **口味同时给 UI（我的 → 音乐口味）** | 用户要求「一起做」：Agent 隐式积累 + 用户可查看/增删/清空，避免「AI 记了我改不了」的黑盒感 |

## 3 数据模型

### 3.1 `music_providers`（新建，放 mcp-gateway 库，与 `mcp_modules` 同库）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| code | varchar(64) unique | `qqmusic` / `netease` |
| name | varchar(128) | 按钮文案「去 QQ音乐听」中的平台名 |
| app_id | varchar(64) | 目标小程序 appid |
| entry_type | varchar(32) | `mini_program`（预留 `h5`） |
| search_template | varchar(512) | 定位参数模板，含 `{keyword}` 占位，例 `pages/search/search?keyword={keyword}` |
| icon | varchar(255) nullable | |
| sort | int default 100 | 多 provider 时的优先序 |
| enabled | bool default true | 关闭则不下发给 agent |
| created_at / updated_at / deleted_at | datetime(6) | 软删除 |

风格对齐 `servers/content-hub/src/content/entities/content-source.entity.ts:11-42`（bigint + snake_case + 每列 comment + json 私有配置 + enabled + 软删除）。

### 3.2 `user_taste_profiles`（新建，放 ai-agent 库，与 `agent_conversations` 同库）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| user_id | varchar(64) | 唯一索引 `(user_id, namespace)` |
| namespace | varchar(32) default 'music' | 预留其它偏好域 |
| data | json | `{ likes:{genres[],artists[],moods[]}, dislikes:{genres[],artists[]}, note:string }` |
| updated_at | datetime(6) | |

> 假设（需确认）：ai-agent 的 DB 连接可建新表（TypeORM `synchronize` 在 production 关闭 → 需写 migrations/ 或手工 DDL）。若不可行，退路：改由 ai-service 提供 `/internal/user-taste` 读写接口（ai-agent 已有调 ai-service internal 接口的先例：`agent-def-sync.service.ts`）。

## 4 接口 / 契约

### 4.1 mcp-gateway 工具（DB 驱动，无需改代码，只需插 `mcp_modules` + `mcp_tools`）

- `music/list_music_providers` → `[{code,name,appId,entryType,searchTemplate,icon}]`（仅 enabled，按 sort）
- 备选（如 mcp-gateway 声明式 HTTP 不好表达查表）：改为 ai-agent 本地工具，直连 `music_providers` 表。**实现阶段按 mcp-gateway module_type 能力二选一，默认走本地工具更省事**（mcp-gateway 声明式 HTTP 需自有 HTTP 端点）。

### 4.2 ai-agent 本地工具

```
present_music_card({ songs: [{title, artist, reason}], providerCode, keyword? })
  → 校验 providerCode 已启用（不存在则取 sort 最小 enabled）
  → 产出 SSE: { type:'card', card:{ kind:'music', provider:{code,name,appId,entryType,path}, songs:[...] } }
  → 落库为一条 assistant 消息（type='card'）

save_music_taste({ likes?: {genres?,artists?,moods?}, dislikes?: {...}, note? })
  → merge 写 user_taste_profiles（同 key 去重，数组上限 20）
```

### 4.3 SSE 事件扩展

- `packages/agent-core/src/interfaces/runtime.interface.ts:5` 事件联合类型加 `'card'`；`:19-50` `StreamEvent` 加 `card?: CardPayload`（`{kind:string; [k:string]:unknown}`）。
- ⚠️ **前端字段冲突**：聊天页 `ChatMsg.card` 已被「推荐译文」卡片占用（`pages/chat/index/index.wxml:57`）。音乐卡片**不得复用该布尔字段**，改用 `type: 'text' | 'music-card' | ...` + `musicCard?` 载荷；渲染分支加在 `wx:if="{{item.card}}"` 之前。
- `servers/ai-agent/src/agent/agent.controller.ts:248` 泛型透传无需改；`:252` 落库判断需把 `card` 纳入。
- 前端 `apps/kedou-ai-minigram/services/agent-stream.ts:80` 类型 + `:262` 解析新增 `onCard`；`:136` `StoredChatMessage.type` 加 `'card'`。

### 4.4 口味注入

- `packages/agent-core/src/memory/memory-port.ts:8` `load()` 返回加 `profile?: string`（可选字段，不破坏内存实现）。
- `servers/ai-agent/src/agent/memory/db-conversation-memory.ts:24` 实现里查 `user_taste_profiles`，拼 `[用户口味档案]\n...`。
- `packages/agent-core/src/core/agent-engine.ts:128` 组装 messages 时插入该 system 消息（在历史摘要之后、用户消息之前）。

## 5 前端改动

1. 新建 `apps/kedou-ai-minigram/components/music-card/`（项目当前**无 components 目录**，只有 `custom-tab-bar/`）；在 `pages/chat/index/index.json` 的 `usingComponents` 注册（先例：`pages/welcome/index/index.json:3-5`）。
2. `pages/chat/index/index.ts:22` `ChatMsg` 加 `type?: 'text'|'card'` + `card?: MusicCard`；`:334` `onEvent` 加 card 分支；`:164-172` 历史载入读 `m.type`。
3. `pages/chat/index/index.wxml:39` 循环内加 `wx:elif="{{item.type === 'card'}}"`（当前**无任何 type 分支**，只有文本）。
4. 跳转：`wx.navigateToMiniProgram({ appId, path })`；`entry_type='h5'` 走 `wx.setClipboardData` 或 webview（一期不支持）。
   - 官方《全局配置》文档**当前已无 `navigateToMiniProgramAppIdList` 字段**（仅 `embeddedAppIdList` 用于半屏打开），网上教程多为过时内容 → **不写 app.json 白名单**，改为真机验证：若调用报「不在白名单」再补。
   - 硬性约束（官方 API 文档）：基础库 2.3.0 起**必须由用户点击触发**，禁止自动跳转 → 卡片主按钮天然满足；微信客户端会弹「即将跳转」确认弹窗，不能绕过。
5. 口味页：新建 `pages/mine/taste/`（wxml/ts/wxss/json）+ 在 `app.json` `pages` 注册；我的页 `pages/mine/index/index.wxml:35`「我的数据」分组前新增「AI 记忆」分组与入口行。
   - 读写接口：新增 `GET/PUT /api/ai-agent/user-taste/music`（或挂 system 服务），小程序直连；Agent 侧的 `user_taste_profiles` 与此同源。

## 6 失败与降级

- provider 全禁用 / 工具报错 → 退化为纯文本推荐，不抛错。
- 口味表不可用 → 跳过注入，日志 warn，不影响主流程。
- 跳转失败（未配置白名单/用户取消）→ toast「跳转失败，可手动搜索：<歌名>」。

## 7 不做（一期明确范围外）

站内音频播放、曲库 API 对接、歌单收藏、admin 配置页、口味的 UI 编辑。

## 8 待确认（阻塞项）

- [ ] `user_taste_profiles` 落哪个库 / 谁负责 DDL（见 §3.2 假设）
- [ ] provider 的 `search_template` 真实值（QQ音乐小程序搜索页 path 需真机确认）
- [ ] `navigateToMiniProgramAppIdList` 由谁维护、是否需微信后台报备
