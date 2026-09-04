# Agent Playground 对话界面 · 技术方案 Review

> 写于 2026-09-04。过去 4 小时内对 Playground 做了多轮小修（加来源标签、过程卡片、loading dots 等），暴露了底层架构问题。本文档**整体重审**对话流方案，并**融合 ACP（Agent Client Protocol）风格**的协议设计，给出稳的新架构，避免再反复修改。

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

**每个 commit 都是"局部 patch"，没有动底层数据模型**。这种"补丁式演进"会越改越脆——下次再出问题（并发、删除、断网重连）还是修不干净。

---

## 二、推荐新架构（消息驱动 + 状态机 + ACP 风格协议）

### 2.1 核心改动：单真相源 + 显式状态机

```ts
type MsgStatus = 'pending' | 'streaming' | 'done' | 'error' | 'aborted';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** 显式状态机，替代 streaming + type:error 两个字段 */
  status: MsgStatus;
  /** 客户端消息 id（ACP 风格路由，见 2.6） */
  clientMsgId?: string;
  /** 回答来源（仅 status='done' 时有效） */
  source?: 'tool' | 'direct';
  /** 错误信息（仅 status='error' 时） */
  error?: string;
  /** 中断原因（仅 status='aborted' 时） */
  abortReason?: string;
  /** 过程卡片（仅 assistant 消息） */
  processes?: ProcessItem[];
}

// 删除：usedTool / currentAssistant / processItems 三个全局状态
// 删除：Msg.streaming / Msg.type
```

### 2.2 删掉全局状态，用"找最新流式消息"代替

```ts
// 替代 currentAssistant 全局变量
function findStreamingAssistant(): Msg | undefined {
  return [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'streaming');
}

// handleEvent 不再持有 currentAssistant
function handleEvent(ev: AgentEvent) {
  const cur = findStreamingAssistant();
  switch (ev.type) {
    case 'content_delta':
      if (cur) cur.content += ev.content;
      break;
    case 'tool_call':
      cur?.processes?.push({ procType: 'tool_call', ... });
      break;
    case 'final':
      if (cur) {
        cur.content = ev.content ?? cur.content;
        cur.status = 'done';
        cur.source = (cur.processes?.some(p => p.procType === 'tool_call')) ? 'tool' : 'direct';
      }
      break;
    // ...
  }
}
```

### 2.3 reactive 化整个数组

把 ref 数组改成 reactive 数组，**根除** push-后-重指的心智负担：

```ts
// 改前
const messages = ref<Msg[]>([]);
messages.value.push(x);  // 普通对象

// 改后
const messages = reactive<Msg[]>([]);
messages.push(x);  // 直接 push，字段改动自然响应
```

**代价**：所有 `messages.value` → `messages`，`processItems.value` → `processItems`。

### 2.4 过程卡片归属消息

```ts
const msg = messages.find(m => m.id === ev.assistantMsgId);
msg.processes.push({ procType: 'tool_call', ... });
```

**好处**：
- 删除消息时 cascade 删 processes
- 多轮对话视觉自然分层（可加"折叠本轮"按钮）
- 后续支持"导出对话为 Markdown"时一条龙带上过程信息

### 2.5 typing-dots 用 status 判定

```html
<template v-if="m.status === 'pending'">
  <div class="typing-dots">...</div>
</template>
<template v-else-if="m.status === 'streaming'">
  <div class="bubble-text">{{ m.content }}<span class="cursor">▍</span></div>
</template>
<template v-else-if="m.status === 'done'">
  <div class="bubble-text">{{ m.content }}</div>
</template>
<template v-else-if="m.status === 'error'">
  <div class="err-inline">⚠ {{ m.error }}</div>
</template>
<template v-else-if="m.status === 'aborted'">
  <div class="aborted-inline">⏸ {{ m.abortReason || '已中断' }}</div>
</template>
```

### 2.6 协议层设计（ACP 风格）

不直接引入 ACP 依赖（它仍处 `0.x`、以 stdio 为主），但吸收它三个核心思想，把 SSE 事件协议一次定到位。

#### 2.6.1 事件三分类

ACP 把消息分 `request / response / notification` 三类，映射到我们：

| ACP 分类 | 语义 | 映射到我们的实现 |
|---------|------|------------------|
| `request` | 客户端→Agent（带 id，期望响应） | `POST /agent/admin-run` 的 body（`userInput` + `clientMsgId`） |
| `response` | Agent→客户端（关联 request id） | `content_delta` / `tool_call` / `tool_result` / `skill_load` / `final` / `error` |
| `notification` | Agent→客户端（单向，无 id） | `progress` / `status` / `reasoning`（预留） |

#### 2.6.2 显式消息 id 路由（治 1.4「事件路由脆弱」）

```ts
// 客户端 send() 生成稳定 id，随请求下发
const clientMsgId = crypto.randomUUID();
fetch('/api/ai-agent/agent/admin-run', {
  body: JSON.stringify({ userInput, clientMsgId, conversationId, ... })
});

// 后端 SSE 每个事件透传 clientMsgId
interface AgentEvent {
  kind: 'response' | 'notification';
  type: 'content_delta' | 'tool_call' | 'tool_result' | 'skill_load' | 'final' | 'error' | 'progress' | 'status';
  clientMsgId: string;   // 关键：路由到具体 assistant 消息
  conversationId?: string;
  step?: number;
  content?: string;
  name?: string;
  args?: unknown;
}

// 前端路由：从 findStreamingAssistant() 升级为精确命中
function handleEvent(ev: AgentEvent) {
  const msg = messages.find(m => m.clientMsgId === ev.clientMsgId);
  // ...
}
```

**好处**：并发 SSE 流（未来）天然支持；断线重连、多轮对话不串。

#### 2.6.3 权限协商（预留 schema，本期不实现）

ACP 的 `permission_request`：Agent 执行高危动作前，请求客户端批准。

```ts
// 预留事件位（schema 先定，本期不接）
interface PermissionEvent {
  kind: 'notification';
  type: 'permission_request';
  clientMsgId: string;
  toolName: string;      // 如 'mcp_gateway.exec_sql'
  reason: string;
  // 客户端可回：approve / reject
}
```

对应 RBAC 演进：现在 RBAC 管「谁能用 admin」，未来加「Agent 运行时调哪些高危工具需人审」。

#### 2.6.4 与后端的关系（本次范围边界）

- **本期必做**（前端）：状态机 + 消息驱动 + reactive 数组，**不改后端也能完成**，用 `findStreamingAssistant()` 兜底路由。
- **本期可选**（后端，小改）：`agent/admin-run` 接收可选 `clientMsgId` 并透传到 SSE 事件，前端切换为精确 id 路由。
- **预留**：`permission_request` / `reasoning` / `progress` 事件位（schema 留好，不实现）。

---

## 三、迁移路径

### 阶段一：紧急止血（已完成）
修 reactive proxy 引用坑，AI 回答能正常显示。commit `c9e1c58`。

### 阶段二：状态字段统一（半天，~150 行 diff）
- `Msg.streaming: boolean` + `Msg.type: 'error'` → `Msg.status: MsgStatus` + `Msg.error?` + `Msg.abortReason?`
- 改 handleEvent 写 status
- 改 template 判定（2.5）
- 改 retry / copy / 重发逻辑

### 阶段三：消息驱动重构（1 天，~300 行 diff）
- 删 `currentAssistant` / `usedTool` / 全局 `processItems` 三个变量
- 改 `Msg.processes: ProcessItem[]`
- handleEvent 用 findStreamingAssistant() 找当前消息
- 改 `messages: reactive<Msg[]>([])` 去掉 ref/.value
- 同步 `processItems` 改成 `Msg.processes`

### 阶段三.5：协议字段对齐（可选，改后端，小改）
- 后端 `agent/admin-run` 接收可选 `clientMsgId`，SSE 事件透传
- 前端 `handleEvent` 从 `findStreamingAssistant()` 升级为 `clientMsgId` 精确路由（2.6.2）
- 为未来并发流铺路，非本期阻塞项

### 阶段四：增强（可选，2-3 天）
- 多轮并发支持（`clientMsgId` 显式路由）
- 消息删除（cascade 删 processes）
- 对话导出为 Markdown
- reasoning 事件支持（o1 / deepseek-r1）
- `permission_request` 权限协商（2.6.3）

---

## 四、决策点

| # | 问题 | 状态 |
|---|------|------|
| 1 | 是否**全量**迁移到新架构（阶段二 + 阶段三）？ | ✅ **已拍板（2026-09-04 用户确认按推荐执行）**，采用 ACP 风格协议 |
| 2 | 是否要支持**消息删除**？ | 阶段四做，不阻塞 |
| 3 | 现状保留 `Debugger` 面板？ | **保留**，作为深度调试入口（结构化事件流） |
| 4 | 是否需要 `reasoning`（思考）事件？ | 阶段四做 |
| 5 | 历史 commit 合并策略？ | 不 squash（每个 commit 自洽），最终发版 tag 即可 |
| 6 | 后端是否透传 `clientMsgId`？ | 阶段三.5，小改，非阻塞（可先 findStreamingAssistant 兜底） |

---

## 五、不在本次范围

- 直接引入 ACP 依赖（stdio 传输 / JSON-RPC 全套 / 多并发 session）——过度设计，等 spec 稳定后再评估
- 后端 ai-agent SSE 事件格式大改（本期最多透传 `clientMsgId`，见 2.6.4）
- 多用户并发对话（不在本系统范围）
- 移动端适配（admin 是桌面端）
