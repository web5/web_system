# 合同翻译官 · 对话历史化 Spec

> 版本：v1.0 · 2026-09-07
> 关联：`specs/contract-risk/`（阶段一地基：IRR + 标准库）、`servers/ai-agent`（agent_conversations）
> 决策来源：tech-review（R1 采纳方案 b——对话表加 `report` JSON 快照列）

## 1. 背景与目标

合同翻译官目前"合同分析（产出结构化报告）"与"追问对话"在数据层虽共享同一
`conversationId`（同一行 `agent_conversations`），但前端把报告只存在本地
`wx.getStorageSync('contract_report')`（仅 1 份、清缓存即丢），历史页只显示本地最新一条，
无法"回看任意一次合同分析及其追问对话"。

**统一建模原则（用户拍板）**：合同分析与追问属于**同一个 AI 对话**；所有数据以对话
（`agent_conversations` 行）为唯一真相源；前端 result/chat/history 只是同一份对话数据的
不同渲染视图，不新增业务表。

**核心矛盾（tech-review R1）**：agent 记忆的摘要压缩（threshold 20 / keepRecent 6）会把
早期消息（含报告 JSON）压进 summary，导致报告无法永久回放。采纳方案 b：**对话行新增
`report` JSON 快照列**（一次分析一份，独立于压缩机制），展示走快照列，messages 中的报告
消息照常参与压缩。

## 2. 用户故事

1. 作为用户，完成一次合同分析后，我想在"历史记录"看到它的卡片（合同类型 / 风险等级 / 时间）。
2. 作为用户，我想从历史列表点开任意一次分析，看到当时的完整风险报告（信号展开 / 追问可用）。
3. 作为用户，我想在对话页看到该次分析的完整追问历史（不只当轮），并能继续追问同一对话。
4. 作为用户，我想在多次分析后仍能回看最早的报告（不受对话摘要压缩影响）。

## 3. 验收标准（EARS）

### 3.1 数据持久化

- When 用户完成一次合同分析（`contract-risk` agent 返回结构化报告 final），系统应落库一条
  `agent_conversations` 记录，其中 `report` 列保存解析后的报告对象
  （scene/conclusion/signals/rights/loanPlan/optimize/keyNumbers/disclaimer），
  `meta` 列保存 `{ scene, danger, warn, ok }`。
- When 同一对话继续追问且回复为普通文本，系统应追加 messages 但**不得覆盖**该对话已有的
  `report` / `meta` 快照。
- When 对话累积超过压缩阈值触发摘要压缩，系统应保证 `report` 快照列完整保留（可回放该次
  分析全文），不受 messages 压缩影响。
- When 新建对话持久化时无显式标题，系统应以首条 user 消息前 20 字为 `title`；合同分析完成
  写快照后，系统应以 `合同体检 · <scene>` 覆盖 title。

### 3.2 读取接口与安全

- While 未登录，when 请求任意 conversation 接口，系统应返回 401。
- When 登录用户请求对话列表，系统应仅返回该用户（JWT userId）的对话，按 `updatedAt` 倒序、
  分页返回列表项（id / title / meta / createdAt / updatedAt，**不含 messages 全量**）。
- When 登录用户请求对话详情（`/:id`），系统应仅在该对话属于当前用户时返回
  （title / report / meta / messages / createdAt / updatedAt）；否则返回 404，不得泄露存在性。

### 3.3 前端视图（同一对话的三种投影）

- When 用户进入历史记录页，系统应展示 API 返回的多次分析卡片（合同类型 + 风险徽标 + 时间），
  点击某卡片应跳转 result 页并携带该对话 `conversationId`。
- When result 页带 `conversationId` 打开，系统应从详情接口读取 `report` 快照并完整渲染
  （结论 / 信号展开 / 权益 / 方案解读 / 追问按钮可用）；`report` 为空时应给出友好占位。
- When chat 页带 `conversationId` 打开既有对话，系统应渲染该对话**全部历史轮次**
  （报告结论轮 + 既往追问轮），并允许继续发送追问写入同一 `conversationId`。
- When 用户沿用"即时分析 → result → 追问"旧链路（无历史打开），系统应保持现有行为不变
  （本地 storage 兜底渲染 + 追问自动发送）。

## 4. 不做（范围外）

- 不做对话删除/重命名/清空。
- 不做跨设备主动同步推送（数据已随对话落库，换设备登录后历史页即可见）。
- 不把合同场景并入 ai-service 的 `conversations` 表（维持 ai-agent 库自持对话，见 design §1）。
- 不改变 agent-core 的摘要压缩策略本身（仅新增快照豁免途径）。
