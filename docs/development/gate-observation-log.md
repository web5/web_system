# 评审门禁 · 观察期数据日志（rd-process A2）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：R13/R14/R15/R16 四个评审门当前**全是 warning（只报不拦）**，升 error 之前必须有真实数据。本文是 A2 的**唯一数据落点**，是 A3（升 error）的前置。
> 周期：2026-09-25 起，1–2 周（建议每天或每批 PR 采一次）。
> 采集：`bash scripts/redline/collect-gate-observations.sh master~20..master --append`

---

## 1 采什么（指标定义）

| # | 指标 | 为什么采 | 用途 |
|---|---|---|---|
| 1 | 各门 warning 条数（R13/R14/R15/R16） | 看命中是否集中在真实改动 | 判断能否升 error |
| 2 | 出现但**未命中**的改动面 | 契约面/发布面收得准不准 | 补 `is_contract_file` / `is_release_file` |
| 3 | 评审报告结论能否追到判据编号 | 验证 V3（判据源先于角色） | 防主观评审 |
| 4 | `Micro-exempt` / `UI_GATE=off` 使用频次 | **门禁被关掉的前兆指标（头号失败模式）** | 频次走高 = 摩擦过大，先降摩擦再谈升级 |

> **指标 2 / 3 需人工记录**（脚本采不到）：采完在「人工观察」区补一句结论即可，别追求格式。

---

## 2 采集记录

| 采集时间 | 范围 | commits | R13 | R14 | R15 | R16 | Micro-exempt | UI_GATE=off |
|---|---|---|---|---|---|---|---|---|
| 2026-09-25 23:2x | `master~6..master` | 6 | 0 | 0 | 0 | 0 | 0 | 0 |

> 基线说明：近 6 个 commit 全部为文档/脚本类改动，**零命中属预期**（V6 零摩擦边界）。这说明当前样本不足以支撑升 error —— 需覆盖到含「接口/迁移/发布脚本」改动的 commit 才有判断价值。

---

## 3 人工观察（指标 2 / 3）

| 日期 | 观察 | 结论 |
|---|---|---|
| 2026-09-25 | 首个采集点，样本全为文档类改动 | 后续应定向采集含 `packages/types`、`migrations/*.sql`、`ecosystem.config.*` 改动的范围 |

---

## 4 出口判据（够了才能进 A3）

- [ ] 至少覆盖 20 个 commit，且**命中样本 ≥ 5 条**（否则无法判断误报率）
- [ ] 误报占比可算出（误报 / 总命中）
- [ ] `Micro-exempt` 使用频次未随门禁上线而走高
- [ ] 至少抽查 3 条评审结论能追到判据编号（V3）

---

## 5 关联

- 机制设计：`specs/rd-process-model/design.md` §5（判据表）、§7.1 Q3（先保持 warning）
- 待办：`specs/rd-process-model/TODO.md` A2（本项）/ A3（升 error，依赖本文）
