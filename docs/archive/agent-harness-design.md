# AI Service · Agent Harness 详细设计方案

> 状态：设计方案（待评审确认）
> 作者：CodeBuddy
> 日期：2026-08-25
> 关联：现有 `ai-service`（`BaseAiClient` / `AiService` / `ConversationService` / `ImageGenClient`）

---

## 0. 背景与目标

当前 `ai-service` 已有基础底座，但**还不是 Agent 框架**：

- ✅ `BaseAiClient` 抽象层统一了 Hy3 / Deepseek / ImageGen 的模型调用
- ❌ `AiService` 只做「单轮 messages → content」，无工具调用、无多步推理、无 Agent 循环
- ❌ prompt 散落在 `ai.service.ts` 的 `SYSTEM_PROMPT` 常量
- ❌ `ConversationService` 全量消息覆盖存储，无分层、无摘要、无 token 控制

**目标**：在现有底座上补一个可复用的 **Agent harness**，使后续每个 AI 应用 =
「写一个 `AgentDefinition` + 注册若干 `Tool`」，无需改动引擎。

**本次决策（已与用户确认）**：

1. 工具调用协议：**OpenAI 标准 `tools` / `tool_calls`**（Hy3、Deepseek 均原生支持）
2. 先输出设计方案 + 目录骨架，**暂不写实现代码**
3. 记忆采用 **摘要压缩（summary compaction）**，需重构 `ConversationService`
4. 落地前已提交无关改动 `d4b5b07`（content-hub wechat token）

---

## 1. 整体架构（分层）

```
ai-service/src/agent/
├── agent.module.ts            # 统一注册入口（providers + 自动注册内置 tools/agents）
├── core/
│   ├── agent-engine.ts        # Agent 运行引擎（ReAct 循环，harness 灵魂）
│   ├── agent-runner.ts        # 单次 run / 流式 run 封装（对接 SSE）
│   └── run-state.ts           # 一次运行的会话状态（messages / tool_calls / step 计数）
├── registry/
│   ├── tool.registry.ts       # 工具注册中心（全局单例，自动发现）
│   └── agent.registry.ts      # Agent 定义注册中心
├── interfaces/
│   ├── tool.interface.ts      # ToolDefinition / ToolExecutor / ToolContext
│   ├── agent.interface.ts     # AgentDefinition / AgentConfig
│   └── runtime.interface.ts   # RunInput / RunResult / StreamEvent
├── tools/                     # 内置工具实现（每个文件一个 Tool）
│   ├── image-gen.tool.ts      # 包装现有 ImageGenClient
│   ├── calculator.tool.ts     # 纯函数工具示例
│   └── web-search.tool.ts     # 占位（接 search 服务，后续补）
├── agents/                    # 具体 Agent 定义（基于 harness 搭应用）
│   ├── study-assistant.agent.ts   # 迁移现有「科豆学习助手」
│   └── bianbian.agent.ts          # 变变专属 Agent
└── memory/
    ├── conversation-memory.ts  # 基于重构后的 ConversationService 做持久记忆 + 摘要压缩
    └── compaction.ts           # 摘要压缩策略（阈值触发 + 调模型生成摘要）
```

**对外接口**：新增 `AgentController`（`POST /ai/agent/run` 流式 SSE）。
**Gateway**：按项目铁律，`/api/ai/agent/*` 代理需传 `PROXY_TIMEOUT.AI_TASK`。

---

## 2. 核心接口定义（先定契约，不绑实现）

### 2.1 工具接口 `interfaces/tool.interface.ts`

```ts
export type ToolParamType = 'string' | 'number' | 'boolean' | 'object';

export interface ToolParameter {
  type: ToolParamType;
  description: string;
  required?: boolean;
}

export interface ToolContext {
  userId: string;
  runId: string;
  /** 工具可访问的注入依赖（client 等），由 harness 在 execute 时填充 */
  deps: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  /** 回写给模型的内容（已序列化的文本） */
  content: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  /** 供模型使用的 JSON Schema（与 OpenAI tools 格式一致） */
  toSchema(): ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
```

### 2.2 Agent 定义 `interfaces/agent.interface.ts`

```ts
export interface AgentDefinition {
  id: string;                 // 'study-assistant' | 'bianbian'
  name: string;
  systemPrompt: string;
  model: string;              // 走 clientRegistry：'hy3' | 'deepseek-v4-flash'
  tools: string[];            // 启用的工具名
  maxSteps: number;           // 防失控熔断，默认 10
  temperature?: number;
  /** 记忆配置 */
  memory: AgentMemoryConfig;
}

export interface AgentMemoryConfig {
  /** 触发摘要压缩的消息条数阈值 */
  compactionThreshold: number;  // 默认 20
  /** 每次保留的最近原始消息条数（压缩后不丢近期上下文） */
  keepRecent: number;           // 默认 6
  /** 是否启用摘要 */
  enabled: boolean;             // 默认 true
}
```

### 2.3 运行时接口 `interfaces/runtime.interface.ts`

```ts
export type StreamEventType = 'token' | 'tool_call' | 'tool_result' | 'summary' | 'final' | 'error';

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  name?: string;        // tool_call / tool_result 时的工具名
  args?: unknown;       // tool_call 时的参数
  step?: number;
}

export interface RunInput {
  agentId: string;
  userInput: string;
  conversationId?: string;   // 有则续聊，无则新建
}
```

---

## 3. Agent 引擎（ReAct 循环）—— harness 灵魂

`core/agent-engine.ts` 伪代码（契约级，本次不实现）：

```
async *run(agent, input, ctx):
  messages = [system(agent.systemPrompt), ...memory.load(), user(input)]
  client  = clientRegistry.get(agent.model)
  tools   = agent.tools.map(toolRegistry.get)

  for step in 0..agent.maxSteps:
    resp = await client.chatWithTools(messages, tools.toSchemas(), agent)
    messages.push(resp.assistantMessage)

    if resp.toolCalls is empty:
      yield { type: 'final', content: resp.content }
      memory.save(messages)          // 含摘要压缩判断
      return

    for call in resp.toolCalls:
      yield { type: 'tool_call', name: call.name, args: call.args }
      result = await toolRegistry.execute(call, ctx)
      messages.push({ role: 'tool', content: result.content, toolCallId: call.id })
      yield { type: 'tool_result', name: call.name, result: result.content }

  yield { type: 'error', content: '达到最大步数限制' }
```

**关键依赖**：`BaseAiClient` 需新增 `chatWithTools(messages, toolSchemas, options)` 抽象方法
（OpenAI 兼容 `tools` / `tool_calls`）。Hy3、Deepseek 都支持，改动集中在两个 client 文件，
不删现有 `chat()`（轻量通道保留）。

---

## 4. 工具注册中心 `registry/tool.registry.ts`

全局单例 `@Injectable()`，提供：

- `register(tool: ToolDefinition)` —— 重复注册抛错（防 Monorepo 散落，符合"同类修改扫全量"铁律）
- `get(name)` / `toSchemas(names[])` —— 给引擎生成模型 schema
- `execute(call, ctx)` —— 分发执行

新增工具只需 `toolRegistry.register(new XxxTool())`，统一收口，不散落各处。

---

## 5. 内置工具清单（v1）

| 工具 | 实现方式 | 说明 |
|------|---------|------|
| `image-gen` | 包装现有 `ImageGenClient.submit/query` | Agent 可主动生图（变变核心） |
| `calculator` | 纯函数（安全 eval / 表达式解析） | 少儿学习场景示例工具 |
| `web-search` | 占位，接 search 服务（后续补） | 标注 TODO，不在 v1 强制实现 |

---

## 6. 具体 Agent（后续应用 = 写 Definition）

```ts
// agents/study-assistant.agent.ts
export const studyAssistantAgent: AgentDefinition = {
  id: 'study-assistant',
  name: '科豆学习助手',
  systemPrompt: `你是科豆 AI 学习助手...（把现有 SYSTEM_PROMPT 搬过来）`,
  model: 'hy3',
  tools: ['image-gen', 'calculator'],
  maxSteps: 8,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
```

> 后续每加一个 AI 应用，就是新增一个 `*.agent.ts` + 按需注册工具，**不动引擎**。

---

## 7. 记忆子系统设计（重点：摘要压缩）

### 7.1 现状问题（现有 `ConversationService`）

- `saveConversation` 直接 `conversation.messages = messages` **全量覆盖**
- 无 token 控制：长对话 token 爆炸，超出模型上下文
- 无分层：system / user / assistant / tool 混在一起
- Agent 多步推理会产生大量 `tool` / `tool_result` 消息，全量保存会迅速撑爆

### 7.2 改造方案（供确认）

#### A. 数据模型调整 —— `Conversation` entity 增加字段

```ts
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() title: string;

  // —— 新增 ——
  /** 已压缩的摘要文本（长期记忆） */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** 摘要覆盖到的消息条数（避免重复压缩同批） */
  @Column({ default: 0 })
  summarizedCount: number;

  /** 未压缩的近期原始消息（短列表，受 keepRecent 控制） */
  @Column({ type: 'json' })
  recentMessages: StoredMessage[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
```

> 旧 `messages` 字段保留一个迁移窗口，或一次性 `synchronize` 重建（开发环境可直接 `synchronize: true`）。

#### B. 分层记忆模型

```
┌─────────────┐   每次 run 拼接顺序
│ system      │   AgentDefinition.systemPrompt
├─────────────┤
│ summary     │ ← 历史压缩摘要（长期记忆，省 token）
├─────────────┤
│ recentMessages │ ← 最近 N 条原始消息（不丢近期细节）
├─────────────┤
│ [tool/tool_result] │ ← 本轮 run 产生的工具消息（run 结束决定是否入 recent）
└─────────────┘
```

#### C. 摘要压缩策略 `memory/compaction.ts`

触发条件（满足其一即压缩）：

1. `recentMessages.length >= agent.memory.compactionThreshold`（默认 20）
2. 估算 token 数 > 模型上下文 60%（可选，v1 先只做条数阈值）

压缩流程：

```
1. 取 recentMessages 中「超出 keepRecent 的早期部分」(oldPart)
2. prompt = SUMMARY_PROMPT + oldPart + 现有 summary（增量压缩，不是丢弃重写）
3. 调 client.chat() 生成新 summary（用便宜模型或同模型均可配）
4. summary = newSummary; summarizedCount += oldPart.length
5. recentMessages = recentMessages.slice(-keepRecent)
```

> **增量压缩**而非「摘要覆盖摘要再丢失」，保证长程信息不丢。

#### D. `ConversationMemory` 接口（替代直接调 service）

```ts
@Injectable()
export class ConversationMemory {
  constructor(private readonly conv: ConversationService) {}

  /** 加载：返回 [summary, ...recentMessages] 用于拼 messages */
  async load(userId, conversationId): Promise<{ summary: string|null; messages: StoredMessage[] }>;

  /** 落库：run 结束后写入，内部判断是否触发 compaction */
  async persist(userId, conversationId, fullRunMessages: StoredMessage[], config: AgentMemoryConfig): Promise<string>;
}
```

#### E. 与现有 `AiService` 的关系

- 现有 `AiService.chat/chatStream`（轻量单轮）**保留**，仍用 `ConversationService.saveConversation`
- `AgentService`（新）走 `ConversationMemory` + `AgentEngine`
- 两套并存，互不破坏；后续可平滑迁移轻量通道到 harness

### 7.3 需要你确认的点（ConversationService 改造）

1. **数据迁移策略**：开发环境直接 `synchronize` 重建 `conversations` 表（丢旧数据），还是写迁移 SQL 保留？
2. **摘要压缩模型**：用主模型（hy3）还是更便宜的模型做摘要？（推荐独立可配，默认主模型）
3. **`messages` 旧字段**：是否彻底移除旧字段（简化），还是保留做兼容期双写？
4. **keepRecent / compactionThreshold 默认值**：20 / 6 是否合适，还是你有其他预期？

---

## 8. 落地顺序（确认后进入 plan/execute）

1. 扩展 `BaseAiClient` + Hy3/Deepseek client 支持 `chatWithTools()`
2. 写 `interfaces` + `ToolRegistry` + `AgentRegistry`（骨架，可单测）
3. 写 `AgentEngine`（ReAct 循环）
4. 内置工具 `image-gen`（包装）/ `calculator`
5. 重构 `ConversationService` entity + 写 `ConversationMemory` + `compaction`
6. 迁移 `study-assistant` / `bianbian` 为 `AgentDefinition`，接 `AgentController`
7. 补单测：引擎循环、工具注册、maxSteps 熔断、compaction 触发

---

## 9. 风险与约定

- 工具调用需防「无限循环」→ `maxSteps` 熔断（默认 10）
- 工具执行失败不能让整个 Agent 崩 → 工具返回 `ToolResult.success=false`，模型自行决定重试/放弃
- 所有工具 `execute` 必须 try/catch 包裹，失败返回结构化 `ToolResult`，不抛裸异常（符合项目异常铁律）
- 新增 `/ai/agent/*` 路由，Gateway 必须加 `PROXY_TIMEOUT.AI_TASK`（三层超时铁律）
- 工具注册集中到 `ToolRegistry`，禁止各 service 自行 `new` 工具散落（Monorepo 扫全量铁律）
