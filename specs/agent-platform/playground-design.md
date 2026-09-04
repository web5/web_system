# Agent Playground 对话界面 · 技术方案 Review

> 写于 2026-09-04。过去 4 小时内对 Playground 做了多轮小修（加来源标签、过程卡片、loading dots 等），暴露了底层架构问题。本文档**整体重审**对话流方案，融合 **ACP（Agent Client Protocol）风格**协议设计，并补充**协议收敛**与**页面权限确认**方案，避免再反复修改。

---

## 一、当前架构的问题清单（按严重度）

### 1.1 【严重】Reactive Proxy 引用坑（最近一次 bug 根因）
**症状**：用户截图显示 — AI 答完了，Debugger 收到 `final` + 完整内容，主面板气泡还停在 "AI 正在思考…"。

**根因**：
```ts
// send() 里
currentAssistant = { id: msgSeq++, kind: 'msg', role: 'assistant', content: '', ... };
messages.value.push(currentAssistant);  // ← push 的是原对象引用
// 后续 handleEvent
currentAssistant.content += ev.content;  // ← 改的是原对象，不触发响应
```

Vue 3 `ref<Msg[]>` 内部用 reactive 包装，但 `array[i]` **第一次访问才**返回 reactive(obj) proxy。原对象引用 `currentAssistant` 不会自动 reactive 化，修改它**永远不会**触发响应。

**修法**：push 后**必须**用 `messages.value[i]` 重新指向 reactive proxy。（已完成止血，最终方案见 2.3）

### 1.2 【中】状态机分散
当前用了 5+ 个独立的状态字段：

| 字段 | 用途 | 位置 |
|------|------|------|
| `Msg.streaming: boolean` | 模板判定流式/完成 | Msg |
| `Msg.type: 'error'` | 错误标记 | Msg |
| `Msg.source: 'tool'\|'direct'` | 来源标签 | Msg |
| `usedTool: boolean`（全局） | final 时计算 source | 模块级 let |
| `currentAssistant: Msg \| null` | 指向"当前正在流"的消息 | 模块级 let |
| `processItems: ProcessItem[]` | 过程事件流 | 模块级 ref |
| `procExpanded: Record<number, boolean>` | 卡片展开状态 | 模块级 reactive |

**问题**：
- 切 agent / 中断恢复 / 多轮对话时状态容易错乱
- `streaming: true` + `content: ''` 表示"思考中"，但**没法表达"已中断"** / "已失败"等状态
- 错误用 `type: 'error'` 单独字段，状态机不正交

### 1.3 【中】过程卡片不绑定消息
`processItems` 是**全局数组**，意味着：
- 多轮对话时，上一轮的过程卡片会持续显示（虽然这版我们想保留——但要明确是设计选择）
- 想删除某条 AI 消息时，过程卡片孤儿化
- 无法做"折叠整个一轮过程"

### 1.4 【低】事件路由脆弱
依赖全局 `currentAssistant` 变量做"事件 → 消息"路由，**没有任何显式 ID 关联**。
同一次 fetch 内事件串行没问题；一旦支持并发（多个 SSE 流）会乱。

### 1.5 【低】typing-dots 判定过于简单
用 `streaming && !content` 判定"思考中"：
- 如果 SSE **只发 final 不发 content_delta**（有的模型/后端实现）→ 永远看不到 typing-dots
- 应该用显式 `status: 'pending'` 标记

### 1.6 【低】反复修改的工作流问题
最近 4 小时改的 4 个 commit：
- `3717a17` 加来源标签（tool / direct）
- `64f4c4a` 过程卡片化（tool_call/result 不再当消息）
- `2b36cdd` typing-dots loading
- `c9e1c58` reactive proxy 修复
- `3c3e809` 消息驱动 + 状态机重构

**每个 commit 都是"局部 patch"，没有动底层数据模型**。这种"补丁式演进"会越改越脆——下次再出问题（并发、删除、断网重连）还是修不干净。

---

## 二、推荐新架构（消息驱动 + 状态机 + ACP 风格协议）

> 状态：**已完成并部署**（`3c3e809`）。本节省略已完成细节，保留核心结论作为上下文。

### 2.1 核心改动：单真相源 + 显式状态机

```ts
type MsgStatus = 'pending' | 'streaming' | 'done' | 'error' | 'aborted';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  status: MsgStatus;                 // 替代 streaming + type:error
  source?: 'tool' | 'direct';        // 来源标签（final 时按 processes 判定）
  error?: string;                    // status='error'
  abortReason?: string;              // status='aborted'
  processes?: ProcessItem[];         // 过程卡片归属消息
}

// 已删除：usedTool / currentAssistant / processItems 三个全局状态
// 已删除：Msg.streaming / Msg.type
```

### 2.2 删掉全局状态，用"找最新流式消息"代替

```ts
function findStreamingAssistant(): Msg | undefined {
  return [...messages].reverse().find(m => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'));
}
```

### 2.3 reactive 化整个数组（根除引用坑）

```ts
const messages = reactive<Msg[]>([]);   // 直接 push 对象即可响应
const events = reactive<Evt[]>([]);
```

### 2.4 过程卡片归属消息

`Msg.processes` 取代全局 `processItems`。删除消息时 cascade 删 processes，多轮视觉自然分层。

### 2.5 typing-dots 用 status 判定

`status: 'pending'` → typing dots；`'streaming'` → 流式文字 + 光标；`'done'/'error'/'aborted'` → 终态渲染。

### 2.6 协议层设计（ACP 风格）

不直接引入 ACP 依赖（仍处 `0.x`、以 stdio 为主），但吸收三个核心思想：

| ACP 思想 | 落地 |
|---------|------|
| 事件三分类（request/response/notification） | SSE 事件标注语义，未引入 JSON-RPC 框架 |
| 显式消息 id 路由 | `clientMsgId` 字段（阶段三.5） |
| permission 协商 | `permission_request` 事件（见 3.3） |

**协议本体是自定义的 `StreamEvent`（`agent-core` 单一来源），不是实现 ACP 标准**。详见第三章。

---

## 三、协议收敛与权限确认

> 本章基于代码现状盘点，明确协议归属、CLI 复用方式、页面权限确认落地路径。

### 3.1 协议单一来源与收敛

**现状**：协议已经单一来源 —— `packages/agent-core/src/interfaces/runtime.interface.ts`：

```ts
type StreamEventType = 'token' | 'content_delta' | 'tool_call' | 'tool_result'
  | 'skill_load' | 'summary' | 'final' | 'error';

interface StreamEvent {
  type: StreamEventType;
  content?: string;
  name?: string;
  args?: unknown;
  step?: number;
  conversationId?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

interface RunInput { agentId: string; userInput: string; conversationId?: string; model?: string; }
```

引擎（`AgentEngine`）、CLI（`kedou-agent`）、Web 服务端（`ai-agent`）都 import 这个类型。

**缺口**：前端 `AgentPlayground.vue` 的 `handleEvent` 是手写的：
- 只认 6 种事件，**漏了 `token` / `summary`**（`summary` 是多步工具链的中间总结，应有渲染位）
- `Msg` / `ProcessItem` 是自定义类型，与 `StreamEvent` 无类型关联

**方案（阶段五）**：前端复用协议类型，handleEvent 按 `ev.type` 收窄：

```ts
// 前端直接 import 协议类型（或抽到 packages/shared 统一导出）
import type { StreamEvent } from '@kedouai/agent-core';

function handleEvent(ev: StreamEvent) {
  switch (ev.type) {
    case 'content_delta': /* ... */
    case 'tool_call':     /* ... */
    case 'tool_result':   /* ... */
    case 'skill_load':    /* ... */
    case 'summary':       /* 补：中间总结 → 独立过程卡片 */
    case 'final':         /* ... */
    case 'error':         /* ... */
    case 'token':         /* 补：token 计数（可进 Debugger） */
  }
}
```

### 3.2 CLI 复用协议

**现状（已正确）**：CLI（`kedou-agent`）**本地实例化 agent-core 引擎**，直接消费 `StreamEvent`，复用的是「引擎协议」而非「HTTP 传输」：

```ts
// packages/kedou-agent/src/cli/harness.ts
const engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);
// 直接 engine.run(...) 产出 StreamEvent，终端渲染
```

**分层图**：

```
agent-core StreamEvent（协议单一来源，稳定）
        │
        ├─ CLI（kedou-agent）      本地直消费 StreamEvent（现状）
        ├─ Web 服务端（ai-agent）  HTTP+SSE 序列化 StreamEvent（现状）
        ├─ Web 前端（admin）       import 类型 + handleEvent 收窄（阶段五）
        └─ 未来 ACP adapter        stdio JSON-RPC 翻译（有第三方接入时再加）
```

**原则**：协议只有一份，客户端差异只在**传输层**（本地直调 / HTTP+SSE / 未来 stdio）和**渲染层**（终端 / 浏览器）。CLI 未来若连远程服务，加 HTTP+SSE 传输适配器即可，**不是重写协议**；对外对接 ACP，加 stdio JSON-RPC adapter 做翻译，**不推倒内部协议**。

### 3.3 页面权限确认

**现状**：
- 引擎层已有 `ToolContext.confirm?`（`packages/agent-core/src/interfaces/tool.interface.ts`），工具在危险操作（删除/覆盖写等）前调用
- **CLI 已用**：`buildHarness((m) => replConfirm(m))` 弹 `[y/N]`；非交互直接拒绝
- **Web 服务端断了**：`agent.controller.ts` 的 `handleRun` 调 `agentRunner.stream(input, userId)` —— **没传 confirmHandler**

**挑战**：CLI 的 confirm 是同步的（工具内部 `await confirm(message)`），但 Web 是 SSE 单向流 + 工具执行 `await` 结果——需要「流中途暂停，等前端用户批准后恢复」。

**方案**：

① 协议扩展（`StreamEvent` 加一个事件）：

```ts
type StreamEventType = /* 现有 */ ... | 'permission_request';
// StreamEvent 增字段：requestId?: string（确认请求 id）
```

② 服务端注入 confirmHandler（暂停-恢复）：

```ts
// agent.controller.ts handleRun 里
const pending = new Map<string, (ok: boolean) => void>();

const confirmHandler = async (message: string): Promise<boolean> => {
  const requestId = randomUUID();
  res.write(`data: ${JSON.stringify({ type: 'permission_request', requestId, content: message })}\n\n`);
  return new Promise<boolean>((resolve) => {
    pending.set(requestId, resolve);
    setTimeout(() => { if (pending.delete(requestId)) resolve(false); }, 60_000); // 超时自动拒绝
  });
};

const stream = this.agentRunner.stream(input, userId, confirmHandler);
```

③ 新增确认端点（`pending` 提升为独立 `PermissionBroker` service）：

```ts
@Post('permission/:requestId')
async resolvePermission(@Param('requestId') id: string, @Body() body: { approve: boolean }) {
  const resolve = this.broker.take(id);
  if (resolve) resolve(body.approve);
  return { ok: true };
}
```

④ 前端 handleEvent + 确认弹窗：

```ts
case 'permission_request': {
  const approve = await showConfirmModal(ev.content, ev.name, ev.args); // antd Modal.confirm
  await fetch(`/api/ai-agent/agent/permission/${ev.requestId}`, {
    method: 'POST', body: JSON.stringify({ approve }),
    headers: { Authorization: `Bearer ${token}` },
  });
  break;
}
```

**确认粒度（分期）**：

| 期 | 粒度 | 机制 | 适用 |
|----|------|------|------|
| 短期 | 会话级开关 | 发送前声明「允许危险操作」，confirmHandler 直接读开关 | Playground 调试（管理员信任自己的 Agent） |
| 中期 | 逐次确认 | 上述 permission_request 暂停-恢复 | C 端业务（高危写操作让终端用户逐次批） |

对应 RBAC 演进：现在 RBAC 管「谁能用 admin」，未来加「Agent 运行时调哪些高危工具需人审」。

---

## 四、迁移路径

### 阶段一：紧急止血（已完成）
修 reactive proxy 引用坑。commit `c9e1c58`。

### 阶段二：状态字段统一（已完成）
`Msg.status` 状态机替代 `streaming` + `type:error`。

### 阶段三：消息驱动重构（已完成）
删全局状态 + `Msg.processes` 归属 + `messages` 改 reactive。commit `3c3e809`。

### 阶段三.5：协议字段对齐（可选，改后端，小改）
- 后端 `agent/admin-run` 接收可选 `clientMsgId`，SSE 事件透传
- 前端 `handleEvent` 从 `findStreamingAssistant()` 升级为 `clientMsgId` 精确路由
- 为未来并发流铺路

### 阶段四：协议收敛（半天）
- 前端 import `agent-core` 的 `StreamEvent` 类型，handleEvent 按 `ev.type` 收窄
- 补 `summary`（中间总结过程卡片）+ `token`（Debugger token 计数）
- 统一 `Msg`/`ProcessItem` 与 `StreamEvent` 的类型映射

### 阶段五：页面权限确认（短期半天 + 中期 1 天）
- 短期：会话级「允许危险操作」开关
- 中期：`permission_request` 事件 + 暂停恢复 + 确认接口 + 前端弹窗（3.3）

### 阶段六：增强（可选，2-3 天）
- 多轮并发支持（`clientMsgId` 显式路由）
- 消息删除（cascade 删 processes）
- 对话导出为 Markdown
- reasoning 事件支持（o1 / deepseek-r1）
- ACP adapter（stdio JSON-RPC，有第三方客户端接入时）

---

## 五、决策点

| # | 问题 | 状态 |
|---|------|------|
| 1 | 是否**全量**迁移到新架构（阶段二 + 阶段三）？ | ✅ **已完成**（`3c3e809`） |
| 2 | 是否要支持**消息删除**？ | 阶段六做，不阻塞 |
| 3 | 现状保留 `Debugger` 面板？ | **保留**，深度调试入口 |
| 4 | 是否需要 `reasoning`（思考）事件？ | 阶段六做 |
| 5 | 历史 commit 合并策略？ | 不 squash，最终发版 tag |
| 6 | 后端是否透传 `clientMsgId`？ | 阶段三.5，小改，非阻塞 |
| 7 | **权限确认粒度**（会话级 vs 逐次）？ | 待定：先短期开关，中期逐次 |
| 8 | **哪些工具算高危**（需确认清单）？ | 待定：建议 shell_exec / write_file / MCP 写操作 |
| 9 | 协议收敛是否抽到 `shared` 统一导出？ | 待定：前端可直接依赖 agent-core，或抽 shared |

---

## 六、不在本次范围

- 直接引入 ACP 依赖（stdio 传输 / JSON-RPC 全套 / 多并发 session）——过度设计，等 spec 稳定后再评估，届时用 adapter 翻译而非重写
- 后端 ai-agent SSE 事件格式大改（本期最多透传 `clientMsgId` + `permission_request`）
- 多用户并发对话（不在本系统范围）
- 移动端适配（admin 是桌面端）
