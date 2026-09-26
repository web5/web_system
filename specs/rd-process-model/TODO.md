# RD 流程与门禁 · 待办清单

> **定位**：本文只记「还没做完的事 + 推进顺序 + 验收」，机制设计见同目录 `design.md`（§3 环节×角色矩阵 / §4 落地清单 / §5 判据表）。
> **状态基准**：2026-09-24 —— P0/P1/P2 已全部合并（`master = 9c5a002`），本线 open PR 已清空，自检 `PASS=22 FAIL=0`。
> **维护纪律**：完成一项即在此划掉，并同步 `design.md` §4 的对应行（避免两处不一致）。

---

## A. 本机制线（hook 门禁 × 评审角色）

### A1 · spec 回写同步 ✅ **已完成（2026-09-25）**

> 已回填 `design.md`：§4（W3 `code-reviewer` / W5 保护清单 / W6 PASS=22 / W9 已落 / U1–U6 已落）、§7.2（Q2/Q4/Q5 结案）、§7.3（契约登记文件已建，W2-b 阻塞解除）。下方对照表留痕备查。

`design.md` 的 §4 落地清单与 §7 决议记录曾写着「未落 / 阻塞 / 待拍板」，而实际全部已合并。**陈旧状态会误导接手者**。

| 位置 | 现标记 | 实际状态 |
|---|---|---|
| §4 W2-b 契约判据源 | ⏸ 阻塞 | ✅ 已落 `docs/api/contracts.md`（C1 接口 / C2 SSE / C3 MCP / C4 权限码 / C5 网关路由 + §8 待补 + §9 体检命令） |
| §4 W3 `contract-reviewer` | ⏸ 待契约登记文件 | ✅ 已落 |
| §4 W5 R12 保护清单 | 随后续角色同批 | ✅ 已加（`release-reviewer` / `contract-reviewer` / `code-reviewer`） |
| §4 W9 独立代码评审 | P2 未做 | ✅ 已落（`code-reviewer` + R15） |
| §4 U1–U6 上游 | P1 未做 | ✅ 已落（Hub 环节×角色重构 + 两跳 apply） |
| §7.2 Q2 / Q5 | 待确认 | 事实上已执行完，应结案 |
| §7.3 待办 | 「先建契约登记文件」 | ✅ 已建；契约面已纳入 `packages/agent-core/src/interfaces/*` |

**验收**：§4 每一项状态与实际一致；§7 不再有虚假悬项。

### A2 · 实测观察期（1–2 周，A3/A4 的上游依赖）

四个评审门目前**全是 warning（只报不拦）**，正好用来收数据。要收集：

| # | 指标 | 用途 |
|---|---|---|
| 1 | 各门 warning 条数 / 误报占比 | 判断能否升 error |
| 2 | 出现但**未命中**的改动面 | 补 `is_contract_file` / `is_release_file` |
| 3 | 评审报告结论能否追到判据编号 | 验证 V3（判据源先于角色，防主观评审） |
| 4 | `Micro-exempt` / `UI_GATE=off` 使用频次 | **门禁被关掉的前兆指标**（头号失败模式） |

**验收**：一份可复跑的数据表，支撑 A3 决策。

### A3 · R13/R14/R15 升 error（依赖 A2）

现状 warning（只报不拦）。升 error 须先解决**存量 commit 无凭证**问题（否则历史分支全红）。
候选：以某 commit 为分界线做一次性存量豁免，或按改动面分批 `strict`（参考 R11b 的 `off → warn → strict` 三档）。

### A4 · P3 运营回流（依赖 A2 + 真实故障）

故障模式库 → 回灌各 reviewer 判据源。**现在建等于空表**，必须等真实故障积累。

### A5 · 三项遗留缺口

| # | 项 | 性质 | 依据 |
|---|---|---|---|
| A5-1 | `.mjs` 迁移不在 `apply-migrations.sh` 流程内（该脚本只扫 `*.sql`） | **真缺口**：这类迁移不会被应用，也不会被 R13 覆盖 | `release-review-checklist.md` C3 |
| A5-2 | `feature/kedou-ai-minigram` 的 `'start'` 疑似死分支，生产者待确认 | 待确认（可能是历史遗留判断） | 前轮排查记录 |
| A5-3 | S1–S6 结构守护未随机制回归（S7 由 R12 承接） | 待确认是否要补 | `design.md` §3 |

### A6 · 技术文章对外发布

`docs/posts/ai-agent-gate.md` 需泛化项目名/路径 + 补一段背景介绍（对外稿，非内部文档）。

---

## B. 其他在途线（本机制线之外）

| # | 项 | 状态 |
|---|---|---|
| B1 | 配置中心 / `INTERNAL_API_KEY` 下发（方案 1） | ✅ 已合并（`663aa2e`，PR #182） |
| B2 | 小程序账号能力待办清单 F1–F20 | ✅ 已合并（`0be5c56`，PR #182）；文档 `docs/development/mp-account-follow-ups.md` |
| B3 | `feature/mp-account` 分支收尾 | 待做：本地切回 `master` 并 pull（该分支已两次合并，继续当检出分支会持续累积） |

> B2 是与本文**并列的另一份待办清单**（不同主题域）；推进时两者不互相阻塞，但都需避免长期躺在分支上。

---

## C. 仓库治理（可选，非紧急）

| # | 项 | 说明 |
|---|---|---|
| C1 | 远端约 71 个分支中大部分未合并 | `docs/*`、`feat/*` 占多数，需逐个判断归档/删除，**不宜批量** |
| C2 | 本地 8 个未合并分支 | `backup/kedou-ai-minigram-wip-20260921`、`docs/local-acceptance`、`docs/miniprogram-follow-ups`、`feature/kedou-ai-minigram`、`feature/tab-favicon-per-module`、`feature/test`、`fix/portal-ua-reset`、`fix/tts-continuity` |
| C3 | 长期集成分支的拆分 | `feature/kedou-ai-minigram` 已从 auto-pr 排除（W0），但其内容应按主题拆成短命分支才能进 master |

---

## 推进顺序

```
A1  ← 现在就能做：纯文档、零风险、消除陈旧误导
B1  ← 你手上正在进行的线（PR #182，优先级最高）
A2  ← 并行开始积累数据（不需要写码）
      ↓ 1–2 周后
A3 / A5-1  ← 按数据与影响决定（A5-1 是缺口，可独立修）
A4  ← 等真实故障
A6  ← 有空再发
C   ← 想起来再清
```

**判断依据**：A1 与 B1 互不依赖；A2 是 A3/A4 的前置，越早开始越好（它只需要时间，不需要人力）。
