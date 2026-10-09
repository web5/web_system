# AI 写作编辑 · 最小可运行原型（Demo）

> 在 web_system 仓库里的位置：`ai-writing-demo/`（仓库根目录）。
> **自包含**：内部用 npm workspaces（`apps/web` + `servers/collab`）+ 自己的 `package-lock.json`，**不参与根 pnpm workspace**，因此不会影响根 lockfile 与 CI 依赖解析。

> 把《协作编辑与CRDT调研.md》+《AI写作编辑-核心代码实现指南.md》落地的可演示闭环。
> 交互形态：**左侧普通对话 + 右侧文档**；AI 通过对话**直接写入文档**，可一键撤销，与人工修改**交叉**时检测并提示。
> 技术栈对齐 web_system：Vue3 + Vite + Tiptap + Yjs（前端）/ NestJS + ws（后端），npm workspaces 单仓。

## 交互与闭环

```
[左] 对话                          [右] 文档
发指令 ──► POST /ai/stream (SSE 流式)  ──► AI 返回【修改后的完整文档全文】
                                          │
                                          ▼
                                   段落级 diff 合并落地
                                   （以当前文档为底，保留未交叉的人工改动）
                                          │
       气泡上出现 ◄───────────────────────┘
   「已写入文档 · 改动 N 段」
   「⚠️ 与你的修改交叉」+「撤销本次改动」
```

- **生成文档**：文档为空时发指令 → AI 直接生成全篇。
- **修改文档**：文档有内容时发指令 → AI 返回改后全文 → 只落地真正改动的段落。
- **保存**：右上角「保存」走 `POST /doc/save` 落盘（`servers/collab/data/docs.json`），刷新后自动读回。
- **撤销**：对话气泡上的「撤销本次改动」回滚到该次 AI 改动前的快照；工具栏撤销/重做走 Tiptap 自带 yUndoManager。

## 架构

- 前端 `apps/web`：Vue3 + Vite + Tiptap(ProseMirror) + Yjs + y-websocket
  - `lib/diff.ts` —— 段落级 LCS diff（文档改动天然是段落维度，区间可解释成"第 N 段被改"）
  - `lib/useAiDocument.ts` —— AI 全文 → 段落 hunk → 锚定合并进当前文档
  - `lib/useChat.ts` —— 对话状态机 + 流式 + 落地 + 变更快照
  - `components/ChatPanel.vue` / `DocPanel.vue` / `Editor.vue`
- 后端 `servers/collab`：NestJS
  - HTTP `:7100` —— `/ai/stream` SSE 流式（真实 LLM：DeepSeek/混元，OpenAI 兼容；无 key 自动降级 mock）
  - HTTP `:7100` —— `POST /doc/save`、`GET /doc/:docId` 文档落盘
  - WS   `:7101/yjs` —— Yjs 中继
  - `/healthz` 探活

## 快速启动

```bash
npm install     # 根目录，workspaces 一次装齐
npm run dev     # 前端 http://localhost:5173  后端 http://localhost:7100  ws://localhost:7101
```

> LLM key：启动时会读 `~/env_config/llm.env`（仅补齐未设置的变量）。没 key 自动走内置 mock。
> 强制 mock：`FORCE_MOCK=1 npm run dev:server`。

## 演示脚本

1. 文档为空 → 发「帮我写一篇项目周报」→ 右侧直接生成全篇（可编辑、可保存）
2. 手动改其中一段 → 发「把第一段改得更正式」→ AI 只改该段，**你改的那段原样保留**
3. 在 AI 流式返回**过程中**去改同一段 → 落地产出「⚠️ 与你的修改交叉」，仍按 AI 版本写入，可点「撤销本次改动」回滚
4. 开两个标签 → Yjs 实时协同，远端光标可见；Ctrl+Z 只撤本地，不误伤另一端

## 交叉判定（核心）

```
requestDoc = 发起请求那一刻的文档快照
aiText     = AI 返回的改后全文
currentDoc = 落地那一刻的当前文档（可能已被人改）

aiHunks    = diff(requestDoc → aiText)     合 hunk
humanHunks = diff(requestDoc → currentDoc) 合 hunk
overlapped = 两个区间集合求交
```

- **不交叉**：按锚定段落精确替换，人工在别处的改动完全不受影响。
- **交叉**：按「前后未改动的上下文段落」夹逼出区间，用 AI 版本覆盖（用户选定的"直接写入"），同时给出醒目提示 + 一键撤销。
- 纯插入点落在区间边界上**不算**交叉（在 C 段前插入新段落 ≠ 修改 C 段）。

## 踩坑记录（面试可讲）

1. **CORS 预检被拦**：前端 `:5173` fetch 后端 `:7100` 的 SSE，浏览器先发 `OPTIONS` 预检，后端没开 CORS → `No 'Access-Control-Allow-Origin'`。
   修复：`NestFactory.create(AppModule, { cors: { origin: [...], methods: [...] } })`，由 cors 中间件统一处理预检（手写 SSE 时容易只加响应头、忘了预检）。WS（`:7101`）握手不走这套 CORS。

2. **主干真源错位（最典型）**：Tiptap 的 `Collaboration` 绑定在 **Y.XmlFragment(`'default'`)**，AI 管线最初却读写孤立的 **`Y.Text('content')`** → 恒为空，AI 回「文档内容为空」。
   结论：**Yjs 上只要有两个并行表示（XmlFragment vs Y.Text），先确认谁是真源**，否则读写静默错位。现在统一以编辑器为唯一真源，`applyingProgrammatic` 标志防止程序化写入被误判成人改。

3. **del/ins 必须合成 hunk 处理**：一次"改写段落"在 diff 里是 del+ins 成对。若当成两个独立段各自锚定，删除锚点找不到时新内容会被插到文末（实测 `['A','C','X']` 而非 `['A','X','C']`）。合成 hunk 后一次整体替换才正确。

4. **Y.Doc 必须 `markRaw`**：Vue 深响应代理会代理 Y.Doc 内部结构，字符级更新触发巨量依赖追踪直接卡死（见 `useYDoc.ts`）。

## 诚实边界

本 demo 为面试搭建的最小原型，验证方案可行性。
> 简化点：撤销是「回滚到该次改动前的整篇快照」而非 CRDT 相对位置级反向补丁；若之后又有人改，撤销会二次确认后再覆盖。多人同时改同一段仍由 Yjs 保证最终一致。
