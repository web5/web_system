# agent-kit 同步补齐 · 影响清单

> **定位**：批量整改前的影响清单（文件 / 改动 / 风险 / 优先级 / 判据）。
> **边界**：本清单只做「把现状对齐」——不改能力源内容、不改方法论、不碰分发机制。`karpathy-llm-wiki` 纳管是另一件事，见 ai-agent-kit `docs/design/llm-wiki-capability.md`。
> **关联**：`.codebuddy/CODEBUDDY.md` §3、`scripts/sync-agent-kit.sh`、`scripts/redline/check-kit-structure.sh`、`.github/workflows/kit-gate.yml`

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-11 | v0.1 | 初稿：两个缺口 + 三步动作 + V1…V6 |
| 2026-09-11 | v0.2 | 三个 `karpathy-*` symlink 确认同批处置；A1 机制定为 `git merge origin/sync/agent-kit`；补分发模型关系（本项目走 vendor 模式 + 保护清单） |

---

## 一、现状（2026-09-11 实测）

跑项目自己的结构门禁：`bash scripts/redline/check-kit-structure.sh` → **11 error / 0 warning**，全部为 S7「运行源与能力源不一致」。

| # | 缺口 | 证据 |
|---|---|---|
| A1 | **能力源落后上游 kit master** | `diff -rq` kit master vs `.codebuddy/agent-kit/` → **13 文件差异**（7 个 skills + 5 个 references + `README.md`）。而 `origin/sync/agent-kit`（`804f4d7`）的改动集**正好就是这 13 个文件**，即 CI 同步 PR 已生成、只是未合并 |
| A2 | **运行源落后能力源** | S7 报 11 文件不一致，涉及 `rd-plan` / `rd-execute` / `rd-review` / `tech-review` / `rd-digital-agent` / `ux-prototype-designer` |
| A3 | **三个 `karpathy-*` 运行源目录是本机 symlink** | `karpathy-coding-guidelines` / `karpathy-coding-rules-dami` / `karpathy-llm-wiki` 均指向 `/Users/geekwen/.codebuddy/skills/...`，且**被 git 跟踪** → 换机器或 CI 克隆即断链 |

### A1 明细（13 文件）

```
README.md
references/agent-definition-methodology.md
references/agent-definition-template.md
references/digital-agent-profile.md
references/eval-framework.md
references/methodology-design.md
skills/incremental-refactoring/SKILL.md
skills/rd-digital-agent/RATIONALE.md
skills/rd-digital-agent/SKILL.md
skills/rd-review/SKILL.md
skills/systematic-debugging/SKILL.md
skills/tech-review/SKILL.md
skills/user-memory/SKILL.md
```

### A2 方向证明（能力源更新，不是运行源更新）

| 文件 | 能力源 | 运行源 |
|---|---|---|
| `rd-plan/SKILL.md` | 1.2.1 | 1.2.0 |
| `rd-execute/SKILL.md` | 1.4.0 | 1.3.0 |
| `rd-review/SKILL.md` | 1.1.0 | 1.0.0 |
| `tech-review/SKILL.md` | 1.0.1 | 1.0.0 |
| `rd-digital-agent/SKILL.md` | 4.6.0 | 4.4.0 |

> 结论：能力源全面领先后者，补齐方向**单向向前**，不会覆盖掉更新内容。另 6 个漂移文件无 `version` 字段（`RATIONALE.md` ×4 / `thinking-checklist.md` / `spec-workflow.md`）。

---

## 二、做成 / 不算做成

**做成**：① `check-kit-structure.sh` 归零（S7 无 error）；② 能力源与 kit master 逐字节一致；③ 三个 symlink 各有明确归属处置且无残留。

**不算做成**：① 用 `rm -rf` 重建能力源；② 直接手改运行源让 S7「巧合通过」；③ `karpathy-*` symlink 原样保留。

---

## 三、影响清单（按优先级）

| 优先级 | 动作 | 文件 / 命令 | 风险 |
|---|---|---|---|
| P0 | A1 能力源补齐 | `git merge origin/sync/agent-kit` | 低：改动集与缺口完全对应，可逐字节比对 |
| P0 | A2 运行源补齐 | `bash scripts/sync-agent-kit.sh --apply` | 低：能力源全面领先，方向单向；先跑不带 `--apply` 的 dry-run 预览 |
| P1 | A3 karpathy 三个 symlink 处置 | 见下表 | 中：两个 `coding-*` 待 kit 侧补完「适用边界」后退役；`llm-wiki` 待 kit 侧落入后退役（同一批次） |

### A3 细目

| 目录 | 判定 | 处置（已确认） |
|---|---|---|
| `karpathy-coding-guidelines` | 内容已等于 `AGENT.md` §产出纪律 + `references/code-discipline.md` | **退役**（消掉重复真相源） |
| `karpathy-coding-rules-dami` | 同上；独有增量仅「适用边界」一条 | 该条**并入 kit 的 `code-discipline.md`**，**同批**退役 |
| `karpathy-llm-wiki` | kit 确认纳入（见 ai-agent-kit `docs/design/llm-wiki-capability.md`） | 待 kit 侧落入并同步到本项目后，**退役 symlink**，改为真实目录镜像 |

> 前两项的退役动作分两处：内容增量在 **kit 侧**（`code-discipline.md` 补「适用边界」），删 symlink 在**本项目**。
> 三个 `karpathy-*` 一并处置（同批），不留半退役状态。
> 另注：`check-kit-structure.sh` 的 `RUN_SKILLS` 白名单**已包含** `karpathy-llm-wiki`，S7 反向豁免已覆盖 `karpathy-*`，故 A3 在门禁层无需额外改造，只需按退役结果同步白名单。

---

## 四、验收判据 V1…V6

| 编号 | 判据（做成 = 一句话可验证） | 验证手段 | PASS 条件 | 不通过怎么办 |
|---|---|---|---|---|
| V1 | 能力源与 kit master 一致 | `diff -rq ~/workspace/ai-agent-kit/{skills,references,rules} .codebuddy/agent-kit/` + `diff -q` 两顶层文件 | 无 `differ` / `Only in` 输出 | 核对合并是否漏文件 |
| V2 | 运行源与能力源零漂移 | `bash scripts/redline/check-kit-structure.sh` | S7 无 error | 按报出的文件补跑 `sync-agent-kit.sh --apply` |
| V3 | 结构门禁全绿 | 同上 | 输出「通过」，`11 error` 归零 | 按 error 逐条修 |
| V4 | 无 symlink 残留（A3 完成后） | `find .codebuddy/skills -maxdepth 1 -type l` | 输出为空（或仅剩明确保留项） | 补处置 |
| V5 | 运行源版本已前进 | `grep -m1 '^version:' .codebuddy/skills/rd-execute/SKILL.md` | ≥ `1.4.0` | 重跑 `sync-agent-kit.sh --apply` |
| V6 | 加载面未被破坏 | 新开会话问「主链唯一指什么」 | 答出 `rd-*` 为唯一编排入口 | 检查运行源文件完整性 |

---

## 五、风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 运行源存在本地手改 | 若有人直接改过运行源，镜像会覆盖 | 版本比对已证明能力源全面领先；执行前仍跑 dry-run 逐个确认 |
| 分发机制重构 | ai-agent-kit `docs/design/kit-contract-design.md` **已纳入本次范围**：决策一把分发主定位改为拉取式（fork + merge），vendor 模式降级保留但**必须加保护清单** | 本项目走 **vendor 模式**（kit 内容在 `.codebuddy/agent-kit/` 子目录、非仓库根，`git merge upstream/master` 无法工作）；故 A1 选 `git merge origin/sync/agent-kit` 做内容对齐，且 kit 侧 `sync-to-target.sh` 的 `rm -rf` 需先改为「逐文件比对 + 保护清单」 |

---

## 六、待确认项

| # | 事项 | 影响 | 结论 / 建议 |
|---|---|---|---|
| Q1 | 三个 `karpathy-*` symlink 是否确认退役 | A3 执行范围 | **已定：确认退役，三个同批处置**（不留半退役状态） |
| Q2 | A1 用 `merge origin/sync/agent-kit` 还是重跑 vendor 同步 | 决定 P0 第一条的具体命令 | **已定：用 `git merge origin/sync/agent-kit`**（改动集逐项对齐，且方向与拉取式一致；重跑推送脚本会走带 `rm -rf` 的旧链路） |
| Q3 | `origin/sync/agent-kit` 是否有未合并的 open PR 需一并处理 | 避免产生重复 PR | 合并后确认远端 PR 状态 |
| Q4 | 退役后 `RUN_SKILLS` 白名单是否同步清理 | 白名单残留只会触发 S2 告警（不报错），风险低但应清理 | 建议同批：`karpathy-coding-guidelines` / `-rules-dami` 从 `RUN_SKILLS` 移除；`karpathy-llm-wiki` 保留至 kit 侧落入后一并处理 |
