# 合同翻译官 · 对话历史化 · 设计

## 1. 架构定位与数据归属

- 对话主载体仍是 ai-agent（6010）库的 `agent_conversations` 行：分析轮 + 追问轮按序增长
  于同一行 `messages`，`id` = 下发给前端的 `conversationId`（现状已成立）。
- 不跨服务复制：**不**把合同对话快照推到 ai-service `conversations` 表（遵守"每服务独享库"）。
- 展示增强只落在该行新增列上：`title` / `report` / `meta`。
- gateway 无需改动：`proxy.controller.ts` `@All('ai-agent/:path(*)')` 通配已覆盖新增 GET，
  `proxy.service.ts` 对 `/api/ai-agent` 前缀 pathRewrite 到 ai-agent `/agent/...`。

```
mini-app ── /api/ai-agent/agent/run               (POST SSE：分析 + 追问，现状)
        └─ /api/ai-agent/agent/conversations      (GET list，新增)
        └─ /api/ai-agent/agent/conversations/:id  (GET detail，新增)
gateway ── aiAgentProxy ──> ai-agent(6010) AgentController
```

## 2. 数据模型变更（ai-agent 库）

`servers/ai-agent/src/agent/memory/agent-conversation.entity.ts` 新增 3 列（均 nullable，向后兼容）：

```ts
@Entity('agent_conversations')
export class AgentConversation extends AbstractEntity {
  // 现有：id(userId, summary, summarizedCount, messages)
  /** 对话标题：新建时取首条 user 前 20 字；合同分析快照成功后覆盖为 "合同体检 · <scene>" */
  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  /** 合同分析报告快照（解析后的对象；独立于摘要压缩，保证历史可完整回放；追问不覆盖） */
  @Column({ type: 'json', nullable: true })
  report: ContractReportSnapshot | null;

  /** 列表卡片元信息（从 report 冗余，避免列表拉全量 JSON 解析） */
  @Column({ type: 'json', nullable: true })
  meta: { scene?: string; danger: number; warn: number; ok: number } | null;
}
```

- 建表：非 production 依赖 `app.module.ts` 现有 `synchronize: true` 自动补列；
  **production 需手工执行一次 `ALTER TABLE agent_conversations ADD COLUMN ...`**（写进 tasks，
  由部署侧跟进）。
- 快照类型 `ContractReportSnapshot`：为避免与前端/LLM 输出耦合过深，仅约定"report 列存
  `final` 内容鲁棒解析出的顶层对象"，结构对齐 mini-app `contract-api.ts` 的 `ContractReport`
  （scene/conclusion/signals/rights/loanPlan/optimize/keyNumbers/disclaimer）。

## 3. 写入链路

### 3.1 通用 title（DbConversationMemory，agent-core 端口实现）

`servers/ai-agent/src/agent/memory/db-conversation-memory.ts` 的 `persist`：
- 新建（`existing == null`）写 `title = firstUserText.substring(0,20) || '新对话'`
  （对齐 ai-service `conversation.service.ts:158` saveAgentMemory 先例）。
- 更新不触碰 title/report/meta（这些由快照服务专门更新），避免整行 create 覆盖丢列。

> ⚠️ 现状 persist 用 `repo.save(repo.create({...}))` 整行覆盖 messages；新增 title 后，更新路径
> 必须显式保留既有 title（先 `findOne` 读回或 `UPDATE ... SET messages/summary/... WHERE id`），
> 不得 create 覆盖丢 title/report/meta。实现时用「读回 → 改字段 → save」或 typeorm `UpdateQueryBuilder`
> 按列更新，防止旧代码路径把新增列写 null。

### 3.2 报告快照（contract 场景专有）

新增 `servers/ai-agent/src/contract/contract-report.parser.ts` + `contract-conversation.service.ts`：

- `parseContractReport(content: string): ContractReportSnapshot | null`：鲁棒提取顶层 JSON
  （对齐 mini-app `extractJsonObject` 的容错策略：整体 parse → ```json 代码块 → 配对括号扫描 →
  截断容错）。**判定标准**：解析出对象且含 `signals` 数组或非空 `scene`，才视为报告；否则返回
  `null`（普通追问文本）。
- `snapshotReport(userId, conversationId, finalContent): Promise<void>`：
  - `parse` 为 null → no-op（天然保证追问不覆盖快照）；
  - 有值 → 计算 `meta { scene, danger, warn, ok }`，`title = 合同体检 · <scene>`，
    以 `{ id, userId }` 条件 UPDATE `report` / `meta` / `title`（条件带 userId 防越权）。
- 写入时机：`AgentController.handleRun` 在 `res.end()` 后的异步段调用，仅当
  `dto.agentId === 'contract-risk'` 且 `conversationIdFromEngine` 非空；异常 catch 不外抛
  （同 AgentRunPusher 的"辅助链路不拖垮主链路"约定）。

## 4. 读取接口（新增，挂既有 AuthGuard）

路径均在 `servers/ai-agent/src/agent/agent.controller.ts`（类级已 `@UseGuards(AuthGuard)`）：

### GET `/agent/conversations`
- Query：`page`（默认 1）、`pageSize`（默认 20，最大 50），用 class-validator DTO 校验。
- Service（可直接在 controller 或抽 `ConversationQueryService`）：`repo.findAndCount({ where:
  { userId }, order: { updatedAt: 'DESC' }, select: ['id','title','meta','createdAt','updatedAt'],
  skip, take })`。
- 响应：`{ list: [{ id, title, meta, createdAt, updatedAt }], total }`（**不含 messages/report 全量**）。

### GET `/agent/conversations/:id`
- Param：`@Param('id', new ParseUUIDPipe())`。
- 查询：`repo.findOne({ where: { id, userId } })`；未命中抛 `404`（不区分"不存在/他人"）。
- 响应：`{ id, title, report, meta, messages: messages ?? [], createdAt, updatedAt }`；
  messages 透传存储消息（`StoredMessage[]`，含 `type?`——本功能新增可选字段）。

## 5. 消息模型小扩展（agent-core，可选字段向后兼容）

`packages/agent-core/src/memory/stored-message.ts`：

```ts
export interface StoredMessage {
  role: StoredMessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
  /** 消息展示类型：缺省 'text'；'report' = 合同分析报告消息（前端可富渲染/折叠） */
  type?: 'text' | 'report';
  /** 预留：轻量附加元数据 */
  meta?: Record<string, unknown>;
}
```

- 影响面核对：deploy-agent / study-assistant / bianbian 均在 messages 中透传 StoredMessage，
  可选字段不影响写入与解析。
- load 回读需透传 `type`/`meta`：`db-conversation-memory.ts:parseMessages` 与
  ai-service `conversation-memory.ts` 的 map 增加透传（缺省忽略，天然兼容老数据）。
- **report 消息打标点**：引擎 final 的 assistant content 是报告 JSON。本功能不在 agent-core
  引擎判"是否报告"（引擎无场景语义），改由前端按 `report` 快照列渲染——messages 中报告消息
  的 `type:'report'` 打标可作为可选增强；首版可只依赖快照列 + 前端 content 嗅探（`{` 开头
  JSON 且含 signals）即可，避免引擎侧改动。**首版建议：不动 agent-core 打标，前端按快照列渲染**，
  把 agent-core 扩展降级为"后续增强"（若需要跨端通用 type 时再改）。——故 §5 标记为 P2 可选。

## 6. 前端视图设计（mini-app）

入口关系：

```
history(tab) ──行点击──> result?conversationId=<id>   // 历史回放
analyzing ──redirectTo──> result(无参)                 // 即时分析（保持现状）
result ──"追问"──> chat?conversationId=<id>&question=   // chat 复用同一对话
```

### 6.1 `services/contract-api.ts` 新增

```ts
export interface ConversationSummary { id; title?; meta?: { scene?; danger; warn; ok }; createdAt; updatedAt }
export interface ConversationDetail { id; title?; report?: ContractReport | null; meta?; messages: Array<...>; createdAt; updatedAt }
listContractConversations(page?): Promise<{ list: ConversationSummary[]; total: number }>
getContractConversation(id): Promise<ConversationDetail>
```

### 6.2 history 页（tab）

- `onShow` 拉列表（每次进 tab 刷新），清空旧"仅本地 1 条"逻辑。
- 卡片点击改带参：`navigateTo /pages/contract/result/result?conversationId=<id>`。
- 场景/风险计数来自 `item.meta`，时间取 `updatedAt`（格式化 MM-DD HH:mm）。
- 空态文案保留。加载态（loading）补充。

### 6.3 result 页

- `onLoad(options)`：
  - 有 `options.conversationId` → `getContractConversation(id)`：
    - `report` 存在 → `processReport(report)`；
    - `report` 为空 → 提示"该次分析无报告快照（升级前数据）"占位，仍允许进对话。
  - 无参（即时分析流）→ 维持现有 storage 读取逻辑。
- 追问跳转：`askFollowUp` / `goChat` 的 URL 追加已有 `conversationId`（从 report 或当前 options）。

### 6.4 chat 页

- `onLoad(options)`：`conversationId` 取 `options.conversationId`，否则取本地 report（旧链路）。
- 有 `conversationId` 且来源是历史打开 → `getContractConversation` 拉历史消息渲染初始
  `chatMessages`：
  - user 消息 → `{ role:'user', text }`
  - assistant 消息 → 取展示文本：有 `report.conclusion`（若该条为报告）则用之；否则 content；
    content 为 JSON 报告文本时 fallback 到 `report?.conclusion ?? content 前 200 字`，避免刷屏原始 JSON。
- `sendWith` 继续复用 `sendContractFollowUp(question, conversationId)`（写入同一对话，现状不变）。
- 初次分析结论作为 AI 首条消息的现有逻辑保留（无历史场景）。

## 7. 非功能性

- 日志：新增日志走 `new Logger(...)`，禁 console.log。
- 错误信息：接口层对非 HttpException 不外泄内部 message（现有全局过滤器已处理）。
- 性能：list 不读 messages/report 列（select 白名单 + meta 冗余）；detail 一次行读取量级在
  几十 KB（单用户数据），可接受；不做缓存。
- 类型：TS strict，禁止 `any`。

## 8. 测试策略

- 后端：`parseContractReport` 纯函数单测（整体 JSON/代码块/混思考文本/截断/追问文本→null）；
  快照服务单测（mock repo，验证首次写、追问不覆盖、userId 条件）。
- 接口：nest 单测 list 分页 + detail 404（他人 id）。
- 前端：开发者工具手工链路——分析 → 追问多轮 → 回 history → 点开旧分析回放报告 →
  进对话见全量历史 → 继续追问。多设备模拟清缓存验证"历史页不依赖本地 storage"。
