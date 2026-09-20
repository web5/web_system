# 合同翻译官 · 对话历史化 · 任务清单

> 执行原则：TDD（红→绿→重构）；不主动 git commit；改动同类文件先扫全量。
> 依赖方向：T1 → T2 → T3 → T4；前端 T5 依赖 T4；T6~T8 依赖 T5。
> 每个任务完成后跑所在包 `pnpm lint` / `pnpm test`（如已配）确认绿灯。

---

## T1 对话表 schema 扩展 + 通用 title（后端 · 表）

- [ ] `servers/ai-agent/src/agent/memory/agent-conversation.entity.ts`：
      `AgentConversation` 增加 `title: string|null`、`report: unknown|null`、`meta: unknown|null`
      （均 nullable，见 design §2，report/meta 首版宽松存 object，注释标明结构与用途）。
- [ ] `servers/ai-agent/src/agent/memory/db-conversation-memory.ts`：
      `persist` 在**新建**（`existing == null`）时写入 `title`（首条 user content 前 20 字 || '新对话'）；
      更新路径改为**读回既有行 → 改字段 → save**（或 `UpdateQueryBuilder` 按列更新），
      严禁 `repo.create` 整行覆盖把 title/report/meta 写丢。
- [ ] 非 production 启动验证 `synchronize` 自动补列；文档记录 production 需手工
      `ALTER TABLE agent_conversations ADD COLUMN title VARCHAR(255) NULL, ADD COLUMN report JSON NULL, ADD COLUMN meta JSON NULL;`
- 验收：requirements §3.1 "新建会话 title" + §3.1 "压缩保留快照列"（数据层：压缩前后 report 列不被触碰）。

## T2 合同报告快照解析与落库（后端 · 快照）

- [ ] 新增 `servers/ai-agent/src/contract/contract-report.parser.ts`：
      `parseContractReport(content): ContractReportSnapshot | null`（鲁棒 JSON 提取，纯函数，单测覆盖）。
- [ ] 新增 `servers/ai-agent/src/contract/contract-conversation.service.ts`：
      `snapshotReport(userId, conversationId, finalContent)`——parse null 则 no-op（追问不覆盖）；
      有值则 `UPDATE agent_conversations SET report=?, meta={scene,danger,warn,ok},
      title='合同体检 · <scene>' WHERE id=? AND userId=?`；`Logger` 记录；异常 catch 不外抛。
- [ ] `servers/ai-agent/src/agent/agent.controller.ts` `handleRun`：`res.end()` 后的异步段，
      仅 `dto.agentId === 'contract-risk'` 且拿到 `conversationIdFromEngine` 时调用
      `snapshotReport`（注入 service，.catch(()=>{})）。
- [ ] `agent.module.ts` 注册 `ContractConversationService` provider（依赖
      `TypeOrmModule.forFeature([AgentConversation])`，已具备）。
- 验收：requirements §3.1 首次分析落 report/meta；追问文本后 report/meta 不变。

## T3 对话读取接口（后端 · list/detail）

- [ ] `servers/ai-agent/src/agent/agent.controller.ts` 新增：
      `GET /agent/conversations`（AuthGuard 类级已生效）——
      Query DTO（page/pageSize 校验），`findAndCount({ where:{userId}, order:{updatedAt:'DESC'},
      select:['id','title','meta','createdAt','updatedAt'], skip, take })`，
      响应 `{ list, total }`。
      `GET /agent/conversations/:id`——`ParseUUIDPipe`，`findOne({ where:{ id, userId } })`，
      未命中 `NotFoundException`，响应含 `messages: messages ?? []`。
- [ ] DTO 文件（可放 `dto/conversation-query.dto.ts`，class-validator）；Swagger 注解补齐。
- 验收：requirements §3.2（401 / 仅本人 / 详情 404 / list 不含 messages 全量）。单测覆盖越权 404。

## T4 消息模型可选字段（P2，首版可跳过）

- [ ] （可选）`packages/agent-core/src/memory/stored-message.ts` 加 `type?/meta?`；
      `db-conversation-memory.parseMessages` 与 ai-service `conversation-memory.ts` 回读 map 透传。
- 首版若跳过：result/chat 完全依赖 `report` 快照列渲染，**不依赖 type 打标**
      （见 design §5 结论）。是否执行由 rd-execute 依 T6~T8 需要决定。

## T5 前端 API 层（mini-app）

- [ ] `apps/mini-app/services/contract-api.ts`：
      `ConversationSummary` / `ConversationDetail` 类型 +
      `listContractConversations(page?, pageSize?)` / `getContractConversation(id)`
      （走 `utils/request.ts` 的 `get`，路径 `/api/ai-agent/agent/conversations[/:id]`）。
- 验收：developer tool console 可调通两个 GET（带 token）。

## T6 history 页多记录（前端 · tab）

- [ ] `apps/mini-app/pages/contract/history/history.ts/.wxml`：`onShow` 拉列表替换本地 latest；
      行卡片用 `item.meta`（scene/danger/warn）与 `updatedAt`；点击行
      `navigateTo /pages/contract/result/result?conversationId=<id>`；补 loading。
- 验收：requirements §3.3 history 展示多次分析并可跳转。

## T7 result 页历史回放

- [ ] `apps/mini-app/pages/contract/result/result.ts`：`onLoad` 支持 `conversationId` query →
      `getContractConversation` → `report` 存在则 `processReport`，为空则友好占位；
      无参保持 storage 链路；`askFollowUp`/`goChat` 携带当前 `conversationId`。
- 验收：requirements §3.3 result 回放旧报告 + 追问按钮带 conversationId。

## T8 chat 页历史渲染与续问

- [ ] `apps/mini-app/pages/contract/chat/chat.ts`：`onLoad` 支持 `conversationId` query →
      拉详情构造历史 `chatMessages`（user 直出；assistant 报告消息用 `report.conclusion`
      / content 嗅探兜底前 200 字）；`sendWith` 续问写入同一 id。
- 验收：requirements §3.3 chat 打开旧对话见全量历史 + 可继续追问；无参旧链路行为不变。

---

## T9 全链路验收（手动）

- [ ] 真机/开发者工具：分析一份合同 → 追问 ≥3 轮 → 退出重进小程序 →
      history 见该次记录 → 点开回放报告（signals/rights 完整）→ 进 chat 见全量历史 → 继续追问成功；
- [ ] 清本地 storage 后重进：history 仍可见全部记录（不依赖本地缓存）；
- [ ] 换账号登录：history 为空 / 看不到他人记录（越权 404）。
