---
name: process-gate
description: 需求实现流程门禁（赛道一软 L1）。当要在 web_system 写 UI/接口/页面/服务端代码、或改动 *.controller.ts / *.service.ts / apps/*/src/views/* / packages/types / migrations/*.sql 时，先按本 skill 自查流程凭证（原型确认 / 设计评审 / 方案文档 / 契约评审），再动手写码。触发词：写接口、写页面、写组件、改控制器、改服务、做需求、实现功能、写 UI。
---

# 流程门禁 · 写码前自查（软 L1）

> **定位**：WorkBuddy 没有 CodeBuddy 的 PreToolUse hook，本 skill 是**软 L1**——靠 AI 自律执行。
> 真正的硬门是 L2（git hooks）和 L3（CI）。本 skill 的价值是**把拦截提前到写码之前**，
> 避免写完 200 行才被 commit 拦下重来。

## 一句话纪律

**没确认原型不写 UI 码；没过设计/方案不写业务逻辑；没定契约不改接口。**

## 写码前必须过的 4 道自查

按你要写的文件类型，对照下表。**每道门都有"先做后写"的顺序要求**：

| # | 你要写什么 | 先要有什么 | 没有怎么办 | 对应门禁 |
|---|---|---|---|---|
| **1** | UI 页面 / 组件（`apps/*/src/views/*`、`packages/ui`） | **已确认的原型**（图片/HTML/mock，且用户点头） | 停下，先出原型给用户确认 | B1/B2/B3 · C1 `Proto` |
| **2** | 业务逻辑 / 服务（`*.service.ts`、`*.controller.ts`） | **设计方案**（架构/数据流/接口边界） | 停下，先写方案要点让用户过目 | C2 `Design` · C7 `Plan` |
| **3** | 对外接口 / 数据结构（`packages/types`、`migrations/*.sql`、API 入口） | **契约草案**（入参/出参/错误码/兼容策略） | 停下，先列契约表 | C3 `Contract` |
| **4** | 改已有代码（重构/修 bug） | 说明**改的是哪一层**（表现/逻辑/数据） | 至少写清改动边界 | C4 `Code` |

## 执行流程

```
用户提需求
  │
  ▼
① 判断触发面（对照上表 4 类）
  │
  ▼
② 对每道命中的门，先产出「凭证」
     · 原型 → 截图/HTML mock → 用户确认「可以按这个做」
     · 设计 → 架构要点/数据流 → 用户点头
     · 契约 → 接口表（字段/类型/错误码）→ 用户过目
     · 方案 → 九子项方案文档（走《研发方案与发布规范》）
  │
  ▼
③ 凭证到手 → 写代码
  │
  ▼
④ commit 时按触发面补 trailer
     git commit -m "feat(xxx): ..." -m "Proto: pass"
     或
     git commit -m "feat(xxx): ..." -m "Plan: docs/development/reports/xxx.md"
     或
     git commit -m "feat(xxx): ..." -m "Micro-exempt: <理由>"
  │
  ▼
⑤ push → PR → L3 CI 全量重扫（唯一硬契约）
```

## Trailer 怎么写

C 类凭证门共用同一个机制 `_trailer_check_one`（实现在 `scripts/redline/scan-rules.sh`）。
命中触发面的 commit **必须**带以下三者之一：

| 写法 | 含义 | 什么时候用 |
|---|---|---|
| `Proto: pass` | 声明「原型已确认」 | 改 UI 面时 |
| `Design: pass` | 声明「设计已过」 | 改业务逻辑时 |
| `Contract: pass` | 声明「契约已定」 | 改接口/数据结构时 |
| `Code: pass` | 声明「改动边界已说明」 | 重构/修 bug 时 |
| `Test: pass` | 声明「测试已写」 | 改有测试覆盖的模块时 |
| `Plan: pass` | 声明「方案已过」 | 改 controller/service/views 时 |
| `Plan: docs/development/reports/xxx.md` | 指向报告路径 | 有完整方案文档时，报告头部「阻塞: N」须为 0 |
| `Micro-exempt: <一句话理由>` | 豁免 | 真的不该拦时（写清为什么） |

**注意**：trailer 是行首格式 `Key: value`，要放在 commit message 的**独立行**（正文与 trailer 之间空一行）。

## 豁免纪律

- 豁免必须写进 commit trailer（`Micro-exempt: 理由`），**可审计**
- 不许口头说"这个不用走流程"、不许只在注释里写
- 豁免是**例外**不是常规——连着出现就要反思触发面是不是画错了

## 与硬门的关系

| 层 | 谁执行 | 强度 | 本 skill 的位置 |
|---|---|---|---|
| **L1** | 本 skill（软）| AI 自律 | ← **在这里** |
| **L2** | `.githooks/pre-commit` + `commit-msg` | `--no-verify` 可绕 | 兜住漏网 |
| **L3** | `.github/workflows/quality-gate.yml` | **唯一契约** | 最终裁决 |

**本 skill 失效（忘了用）也不会让烂代码合进 master**——L3 会重扫。
但用了它能省掉"写完 200 行被 commit 拦下"的返工。

## 参考

- 日常速查（编号含义/级别/豁免）：`docs/development/gates/01-日常使用.md`
- 流程门机制（C/B 类、触发面）：`docs/development/gates/02a-需求流程机制.md`
- 编号索引与判据源：`docs/development/gates/03-治理与索引.md`
- 方案文档规范（九子项）：`~/AiWorkspace/20-私域资产/研发方案与发布规范-v2.md`
