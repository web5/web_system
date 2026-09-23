# 接口设计 · 对话列表按 source / agentId 过滤（B 待办）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 状态：设计（已确认粒度：按能力分开，2026-09-23）
> 相关：`specs/portal-redesign/page-spec.md` §1 3b、§3.2、§3.3

## 1 背景与目标

工具页（翻译工作台 `/translate`、合翻工作台 `/contract`）的会话以 `source='tool'` 落库（不进主对话流），
但读取侧 `GET /api/ai-agent/agent/conversations` **写死 `source='chat'`**，导致：

- 主对话列表拿不到 `tool` 会话（符合预期，不要动）；
- **工具页拿不到自己的历史** —— PC 左栏上半区「翻译记录 / 体检记录」因此一直是空的，
  本次收口后用户实测成「记录没了」。

目标：让列表接口能按 **来源 + 能力** 取记录，前端左栏上半区各自拉自己的记录（与原型一致）。

## 2 现状

| 层 | 现状 |
|---|---|
| 实体 `agent_conversations` | `source`（varchar，默认 `'chat'`）；`agentId`（varchar(64)，nullable，**已建索引**） |
| `AgentConversationQueryService.listConversations` | `where: { userId, source: 'chat' }`（**硬编码**） |
| `ListConversationsDto` | 只声明 `page` / `pageSize`（`forbidNonWhitelisted`） |
| 前端 `apps/portal/src/api/agent.ts` | `listConversations(page, pageSize)` |

## 3 接口契约

`GET /api/ai-agent/agent/conversations`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `page` | int | 否 | 1 | 不变 |
| `pageSize` | int | 否 | 20 | 不变（≤50） |
| `source` | `'chat' \| 'tool'` | 否 | `chat` | **新增**；非白名单值 → 400 |
| `agentId` | string(≤64) | 否 | — | **新增**；按能力过滤（`translate` / `contract-risk`）；空串当未传 |

- 返回结构**不变**：`{ list: [{id, title, meta, createdAt, updatedAt}], total }`
- 越权防护**不变**：强制 `userId`（JWT），他人会话按不存在处理
- 组合语义：`source` 与 `agentId` 独立生效（不强制 `agentId` 只在 `tool` 下生效），
  前端只用 `(tool, translate)` / `(tool, contract-risk)` / `(chat)` 三种组合

### 兼容

- 不传参 = 现有行为（`source=chat`），**前端老调用与小程序历史页零改动**
- 无数据迁移、无字段新增

## 4 实现点

| 文件 | 改动 |
|---|---|
| `agent/dto/conversation-query.dto.ts` | 新增 `source`（`@IsIn(['chat','tool'])`）、`agentId`（`@MaxLength(64)`），均 `@IsOptional` |
| `agent/agent-conversation-query.service.ts` | `listConversations(userId, page, pageSize, source='chat', agentId?)`；按参数拼 `where`（空串/空值不拼接） |
| `agent/agent.controller.ts` | 把 `query.source` / `query.agentId` 透传给 service |
| 单测 `agent-conversation-query.service.spec.ts` | 补：默认 `chat`；`source=tool`；`source=tool + agentId` 三种 where 断言 |

> 不加索引：`agentId` 已有 `@Index`，`source` 取值仅两个、区分度低，且列表本身按 `userId` 收敛；
> 数据量到百万级再评估 `(userId, source, agentId)` 复合索引。

## 5 前端消费（PC）

| 视图 | 左栏上半区参数 | 标题 |
|---|---|---|
| 开始 / 对话 | `source=chat` | 最近对话 / 会话 |
| 翻译工作台 | `source=tool&agentId=translate` | 翻译记录 |
| 合翻工作台 | `source=tool&agentId=contract-risk` | 体检记录 |

- 列表仍复用 `useConversationStore`，新增按视图传参的加载口径（切换视图时按参数重载）
- 空态沿用「还没有记录」+「新建」出口（工具页新建 = 进该能力工作台，不跳 `/chat`）
- 小程序历史页本轮**不动**（保持 `source=chat` 默认行为）

## 6 验证

```bash
# 登录拿 token 后（本地走 vite 代理 5173 或 gateway 6000）
curl -s "http://localhost:5173/api/ai-agent/agent/conversations?source=tool&agentId=contract-risk" | head
curl -s "http://localhost:5173/api/ai-agent/agent/conversations" | head          # 默认 chat，行为不变
curl -s "http://localhost:5173/api/ai-agent/agent/conversations?source=bad"      # 期望 400
```

## 7 回滚

纯查询参数，无写路径、无迁移 → 回滚 = 回退这三个文件并重新编译重启；前端把参数去掉即回到现状。

## 8 待确认

无（粒度已拍板：按能力分开）。
