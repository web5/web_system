# 交接说明 · kit-sop-enforcement（给新会话接手）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 交接时间：2026-09-20
> 方案本体：**同目录 `design.md`**（根因 4 断点 / 五层设计 / T1–T6 / V1–V9 判据 / 待确认 Q1–Q5）
> 本文用途：让接手的新会话**不回看原对话**即可开工；本文只讲「现状 + 怎么开工 + 别踩什么」

---

## 1. 一句话任务

把 agent-kit 的 SOP 从「提示」降层为「拦截」：

- **L2** 品牌端规则（补 DR-5 的规则真空）
- **L3** CodeBuddy Hook 硬阻断（`PreToolUse` deny）
- **L4** CI 红线 R9（防绕过兜底）
- **L1** 常驻动作门（文本第一道，**已部分开工**，见 §3）
- **L5** 上游 `ai-agent-kit`（触发词 + eval 陷阱用例，另仓另 PR）

细节一律看 `design.md`，本文不复制其内容。

---

## 2. 开工话术（复制到新对话即可）

```
读 specs/kit-sop-enforcement/HANDOFF.md，再读同目录 design.md。

注意：CODEBUDDY.md 已被改过（只加了指向 §2.5 的引用，§2.5 正文还不存在，
属悬空引用），请先核实这个现状再动手。

先跟我确认 design.md §7 的 Q1–Q5，确认后按 §4 做 T1–T6，
每项按 §5 对应 V# 实跑取证。工作区里有小程序开发线的未提交改动，别动它们。
```

> 若只想先做最小闭环（真强制），把上面第三段换成：
> `先只做 T3（Hook 硬阻断），跑一周看摩擦再决定 T4。`

---

## 3. 当前状态（截至 2026-09-20，务必自行复核）

| 项 | 状态 |
|---|---|
| `specs/kit-sop-enforcement/design.md` | ✅ 已完成（**未提交 git**） |
| `.codebuddy/CODEBUDDY.md` | ⚠️ **已被修改**（非编写 design.md 的会话所为）。改动内容：标题行加入 `§2.5`、新增一行「⚠️ 动手前先看 §2.5 动作门…」；但**第 2 节之后直接跳到第 3 节，§2.5 章节本体不存在** → 当前是**悬空引用**。T1 需要补齐正文（或回退该引用） |
| `.codebuddy/rules/brand-interface/RULE.mdc` | ❌ 未创建（T2） |
| `.codebuddy/settings.json` + 两个 hook 脚本 | ❌ 未创建（T3） |
| `scripts/redline/scan-rules.sh` 的 R9 | ❌ 未加（T4） |
| 上游 `ai-agent-kit`（description 触发词 / eval 用例） | ❌ 未做（T6，**另仓**） |

**动工前必做**：

1. 跑一次 `git status` 与本文 §6 快照核对
2. 确认 `design.md` §7 的 Q1–Q5（尤其 Q4 落地范围、Q2 豁免方式）
3. 处理 §3 表格第 2 行的悬空引用

---

## 4. 硬约束（踩了会破坏现有机制）

| 约束 | 原因 / 判定 |
|---|---|
| **不得修改 `.codebuddy/skills/` 下的通用技能**（含 `ux-prototype-designer`） | `kit-gate` 的 **S7 检查运行源与能力源零漂移**；L5 一律走上游 `ai-agent-kit` |
| `scripts/redline/scan-rules.sh` 只加判定函数，**不动调用方契约** | 脚本头部已声明「白名单/阈值调整：改下方 R* 判定函数，勿改调用方」 |
| `.codebuddy/.state/` 必须写进 `.gitignore` | 运行时产物，不入库 |
| hook 脚本不得引入第三方依赖 | 用 `python3` 标准库解析 stdin JSON / 用 bash |
| 脚本内**不得硬编码单一 `tool_name` 风格** | IDE 为 `write_to_file`/`replace_in_file`，CLI 为 `Write`/`Edit`；`tool_input` 字段名也可能是 `filePath` 或 `file_path` |
| 交付必须按 V1–V9 逐条**实跑**给证据 | `design.md` §5；「应该没问题」不算证据 |

---

## 5. 别动的东西（同一工作区的另一条线）

本工作区正在并行做**科豆 AI 小程序开发**（分支 `feature/kedou-ai-minigram`）。其未提交改动**不属于本任务**：

- `apps/kedou-ai-minigram/**`（批次 1 前端骨架、批次 2 的 `services/agent-stream.ts`）
- `specs/kedou-ai-minigram/tasks.md`
- 另有本地静态服务跑在 `127.0.0.1:8899`（伺服原型，勿 kill）

如需提交本任务产物，**只 add 本任务相关文件**，不要 `git add -A`。

---

## 6. 工作区快照（2026-09-20）

分支：`feature/kedou-ai-minigram`（不要求提交，按用户指令）

```
 M .codebuddy/CODEBUDDY.md                 ← 本任务相关（悬空引用，见 §3）
 M apps/kedou-ai-minigram/app.json          ← 小程序线
 M apps/kedou-ai-minigram/app.wxss          ← 小程序线
 M apps/kedou-ai-minigram/pages/mine/**     ← 小程序线
 M apps/kedou-ai-minigram/pages/welcome/**  ← 小程序线
 M apps/kedou-ai-minigram/prototype/index.html ← 小程序线
 M apps/kedou-ai-minigram/services/contract-api.ts ← 小程序线
?? apps/kedou-ai-minigram/pages/chat/       ← 小程序线
?? apps/kedou-ai-minigram/pages/discover/   ← 小程序线
?? apps/kedou-ai-minigram/services/agent-stream.ts ← 小程序线
?? apps/kedou-ai-minigram/utils/daily.ts    ← 小程序线
?? specs/kedou-ai-minigram/                 ← 小程序线
?? specs/kit-sop-enforcement/               ← 本任务（design.md + 本文）
```

---

## 7. 相关文件索引（读这些就够）

| 用途 | 文件 |
|---|---|
| 方案本体 | `specs/kit-sop-enforcement/design.md` |
| 开工前置不变量 | `.codebuddy/agent-kit/AGENT.md` §43–52 |
| V1…Vn 判据格式与同构规则 | `.codebuddy/skills/rd-plan/SKILL.md` §验证判据表 |
| 规则文件写法范例 | `.codebuddy/rules/ui-interface/RULE.mdc`（注意：它明确排除品牌端 → 这正是断点 #2） |
| 现有红线实现 | `scripts/redline/scan-rules.sh`（R1–R8）、`scripts/redline/check-kit-structure.sh`（S1–S7） |
| CI 接入点 | `.github/workflows/quality-gate.yml` 的 `redline-scan` job（2026-09-24 恢复；此前 9-18 下线后未随机制回归，导致 R9–R14 一度只有本地 hook） |
| Hook 机制（官方） | <https://www.codebuddy.ai/docs/zh/ide/Features/Hooks> |

---

## 8. 交付要求

1. 每完成一项 T#，按 `design.md` §5 对应 V# **实跑**并留输出证据
2. 报告按四项：假设 / 改动 / 证据 / 剩余风险
3. 若 Q1–Q5 有未拍板项，**列出来问用户**，不要自行脑补（本轮任务本身就是因"脑补流程"而起）

---

## 9. 实战修复记录（2026-09-20，由小程序会话发现并修复，纳入本任务回归）

L3 Hook 部署后**首次真实拦截**即暴露放行通道失效：

- **现象**：PreToolUse 拦截正确（提示语、路径识别都对）；但「先改原型 → 再改 UI 文件」仍被拦，`.codebuddy/.state/` 目录存在却**始终为空**。
- **根因**：`scripts/redline/hook-mark-proto-touched.py` 缺少 `to_rel()` 路径归一化 —— IDE 经 stdin 传来的是**绝对路径**，直接与 `PASSPORT_GLOBS`（`apps/*/prototype/*`）做 fnmatch 永远不匹配 → 标记永不写入。gate 脚本有 `to_rel()`，mark 脚本没有，**两脚本不对称**。
- **修复**：mark 脚本补 `to_rel()`（与 gate 同一套逻辑），已验证三项：
  ① 模拟 PostToolUse stdin → 标记写入（target 为正确相对路径）；
  ② 有标记时 PreToolUse 放行；③ 删标记后仍正确 deny。
  并通过真实链路：「改原型 → 改 wxml → 放行」。
- **留给本任务的动作**：
  1. 把上述三步纳入 `design.md` §5 的 V1/V2 回归（避免以后改脚本再退化）；
  2. 两个 hook 脚本今后**必须保持对称**（归一化、路径集合、豁免逻辑改一处就核对另一处）；
  3. 已知取舍待 review：gate 的 `UI_EXTS` 只含 `.wxml/.wxss/.vue`，**不含 `.ts`**（design.md §3.1 建议含 ts）—— 当前实现摩擦更小，是否收紧由用户拍板。
