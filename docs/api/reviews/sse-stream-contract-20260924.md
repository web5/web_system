# 契约评审报告 · SSE 事件契约漂移修复（C2）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 评审对象：`packages/agent-core` 的 `StreamEventType` 修正 + 两端手写联合对齐 + R16 机检新增 + admin 死分支清理
> 判据源：`docs/api/contracts.md`（§1 C2 · §3 · §7 契约变更纪律 · §8 漂移清单）
> 评审方式：**独立 sub-agent 盲审**（先读判据源形成应然、再看被审物；不采信作者自辩；只读不改），2026-09-24

阻塞: 0
重要: 0

> **首轮结论为 ❌ 阻塞**（1 项阻塞 + 5 项重要）。本文件为**处置后定稿**：每条均已修复并复核，故头部归零。
> 这也是本仓首个由「生产者 ≠ 评审者」分离产出的评审报告——本轮改动由作者实施，评审由独立上下文执行。

---

## 首轮发现与处置

### 阻塞（1 项 · 已修）

| # | 判据 | 问题 | 处置与复核 |
|---|---|---|---|
| **B1** | §8 D6 · §7 第 5 条 | 从真相源删除 `'token'` 会**破坏 import 型消费方**：`apps/admin/src/views/Agents/AgentPlayground.vue:232` `import type { StreamEvent } from '@kedouai/agent-core'`，其 `switch` 上仍有 `case 'token'` → 类型删掉后该 case 不可比，`vue-tsc` 报 **TS2678**。而该破坏在所有门禁下**静默通过**（R16 未覆盖 admin；`changed-packages` 只构建自身有改动的包，agent-core 改动不连带构建 admin；`redline-scan` 不以 `--strict` 运行） | 删除该 `case`（同 `switch` 的 `default` 会兜底，事件不丢）；并把该文件纳入 **R16 的 case 检查**。复核：临时注入 `case 'token'` → R16 报 `EXTRA admin 有 1 个未登记 case` |

**教训（已写入 §8 D6）**：删契约类型前必须查 **import 型**消费方（`case 'xxx'` / `=== 'xxx'`），不能只 grep 手写联合的那几处。

### 重要（5 项 · 已修）

| # | 判据 | 问题 | 处置与复核 |
|---|---|---|---|
| M1 | §3 · §7 第 3 条 | R16 只覆盖手写联合的两处，漏掉 import 型消费方 admin → 该端无任何机检 | 新增 `CASE_CONSUMERS`：检查 `case 'xxx':` 是否 ⊆ 真相源集合（`EXTRA` 级别）。负例复测通过 |
| M2 | §7 第 3 条 | `LOOSE` 消息内含裸 `\|`，与 `scan-rules.sh` 的 `add_warn` 用 `\|` 拼段再拆段冲突 → 四段错位 | 消息改用中文冒号，去掉竖线。负例复测：输出为正确的 4 列 TSV，`scan-rules` 解析正常 |
| M3 | §3 | §3 的索引块仍是旧集合（含已删 `token`、缺新增 `card`），与同文 §8 自相矛盾 | 已更正为当前 11 项 |
| M4 | §3 · §7 第 3 条 | "机检守 / 机检会拦"表述与级别不符：`quality-gate.yml` 调用 `scan-rules.sh diff` **不带 `--strict`**，warning **不阻断**合并 | 改为「机检会报」，并显式写出级别现状与升级条件 |
| M5 | §3 `MISSING` 判据 | 提取正则要求成员前置 `\|` 且字类无数字 → 内联首行成员（`type: 'x' \| 'y'`）会漏取造成**误报 MISSING**；`'xxx_v2'` 会被截断 | 正则改为支持内联首行 + `[a-z0-9_]+`。负例复测：内联首行不误报 |

### 建议（未采纳，记录在案）

- **fail-open 静默**：R16 对"消费方文件缺失 / 真相源 marker 缺失 / 成员集为空"一律静默跳过 —— 属设计取舍（fail-open 优先于阻断正常提交），保留。
- **消费方 `card.kind` 仍为 `string`**：未随真相源收敛到「`'music'` + 扩展位」，对消费方无提示但无害，未处理。
- **未清理的死消费点**：`apps/kedou-ai-minigram/packageContract/pages/contract/{chat,assistant}.ts` 与 admin `evtTag` 里的 `'start'` —— 它们**没有兜底**，删除后若真有生产者会导致文案静默消失，故**保留**并记入 §8 D6 待确认。

---

## 通过项

- **`'card'` 确有生产者**：`servers/ai-agent/src/agent/agent.controller.ts:285` 推送 `{ type: 'card', card, step }`（§8 D1）——补登记的方向正确。
- **两端手写联合与真相源逐项一致**：真相源 11 项；`portal/src/api/agent.ts` 与 `kedou-ai-minigram/services/agent-stream.ts` 各 11 项命名成员，集合相等（含 `skill_load` / `permission_request` / `card`，无 `token` / `start`），另加 `(string & {})` 扩展位负责向前兼容。
- **`(string & {})` 未被误判为 LOOSE**：修正后的判定不匹配「已知联合 + 扩展位」写法。
- **`is_contract_file` 新增 `packages/agent-core/src/interfaces/*` 粒度合理**：符合 §8 D3「明确路径」原则，未回退为整个 SDK；`selfcheck` 的 V25 防回退正则 `packages/agent-core/\*\)` 不会误伤该窄路径（已负例验证）。
- **`'token'` / `'start'` 确无生产者**：在 `packages/agent-core` 与 `servers/**` 全量 grep 无 `type: 'token'` / `type: 'start'`。

## 未决项

- 未实际执行 `cd apps/admin && npx vue-tsc --noEmit` 复现 TS2678（评审者只读环境）。风险已从两头消除：① 删掉死分支；② 新增 case 机检防同类复发。
- `'start'` 的历史生产者无法从当前代码定论（可能曾由前端本地合成后删除），故其消费点保留待确认。

## 复跑入口

```bash
python3 scripts/redline/check-sse-contract.py     # R16 等价手动入口（无输出=一致）
bash scripts/redline/selfcheck-ui-gate.sh          # V27 覆盖 R16 接线
```
