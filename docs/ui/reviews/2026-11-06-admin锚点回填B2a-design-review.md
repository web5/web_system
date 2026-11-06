阻塞: 0
重要: 2

# 设计评审报告 · admin 锚点回填 B2a（第二批）

> 关口：D3 实现一致性评审（原型 ↔ 实现）｜ 对象：`docs/ui/prototypes/admin-agent-def-detail.html`（31 锚点）+ `admin-agents.html`（独有 1）＝ 去重 **32**
> 生产落地：`apps/admin/src/views/Agents/{AgentDefDetail,AgentTuningPanel,AgentStrategyPreview,TuningAuditList,AgentDefList}.vue`、`views/Forbidden.vue`、`layouts/BasicLayout.vue`
> 判据源：`docs/ui/design-system.md` §3.2 A1–A4 + S3/S4/S5 ｜ `docs/ui/page-specs/agent-def-detail-v2.md` v2 ｜ `docs/ui/reviews/2026-10-28-b3-tuning-ui-design-review.md`（五控件口径）
> 方案：`docs/development/reports/2026-11-06-admin锚点回填B2a-方案待确认.md`（八项待拍板已按默认获确认）
> 评审日期：2026-11-06 ｜ 方式：机检（`verify-agent-def-detail.mjs` 159 项 / `scan-design-drift.py anchors`）+ 逐锚点人工对照

---

## 0. 结论

| 断言 | 结果 | 证据 |
|---|---|---|
| 原型侧锚点集合稳定 | **32**（detail 31 + `agent-def-list`） | `python3 -c` 统计，三份原型残留 0 |
| 无「实现里没有却留着」的锚点 | **0** | §2 三处撤除均有定稿判据 |
| 无「实现有却把锚点撤了」的锚点 | **0** | §3 撤回 1 处（`forbidden-cta`，本轮自我纠正） |
| 走查 | **159 / 159** | `verify-agent-def-detail.mjs`（含新增 22l-1/2/3） |
| hub 走查 | **243 / 246** | 剩 3 项为存量菜单漂移（台账 #8609），非本批引入 |

→ **阻塞: 0**，可带 `Design: pass` 进 UI 门。

## 1. 三组定性（与方案 §2.2 一致，机检可复核）

| 组 | 数量 | 判定依据 |
|---|---|---|
| ✅ 回填 | 17 | 实现中已有同语义同位置结构（A1 同位置 / A3 同名同语义），只缺 `data-dr` |
| 🔧 补实现后回填 | 2 | 规格强制要求而实现缺失：`role-fallback`（§5.1 + S5 禁静默隐藏）、`error-cta`（S4 失败须有可重试路径） |
| ⏸ 阻塞 | 13 | 属独立功能批次（调试台 7 / 面板级 diff 2 / 字段级 badge 4），不属本批 |

## 2. 撤除判据（3 个锚点，均「规格 + 实现」双查）

| 锚点 | 判据 | 复核点 |
|---|---|---|
| `gen-params-preset`（前批） | B3 五控件口径不含预设下拉 | `2026-10-28-b3-tuning-ui-design-review.md`「五控件」；`agent-def-detail-page-2026-10-28.md:42` |
| `gen-params-sampler`（前批） | 被 C7-b 同填报错取代 | `form-controls-and-toggles-v1.md:277` |
| `empty-cta`（本批） | B3 定稿为「逐控件留空 + 占位说明」，无整块空态框；S3 空态适用列表页 | `contracts.md` C7-c / C7-e |
| `mutex-conflict-hint`（本批） | 提示落双字段红字，不设汇总行 | `form-controls-and-toggles-v1.md:277`；已回写 `agent-def-detail-v2.md` §3 |

> **纪律**：撤锚点必须两条都查——「规格怎么说」+「实现里有没有」。本轮曾只查后者就撤了 `forbidden-cta`，查 `Forbidden.vue:8` 发现实现有唯一出路按钮（`useSafeReturn` 的 `label`/`go`），已撤回并恢复锚点（见 §3）。

## 3. 恢复与改挂（2 处，本轮自我纠正）

| 锚点 | 原处置 | 现处置 | 理由 |
|---|---|---|---|
| `forbidden-cta` | 撤（误判） | **恢复锚点 + 回填 `Forbidden.vue`** | 实现结构真实存在，S5 要求有出路 |
| `error-cta` | 撤（判为演示态） | **改挂 `load-fail` 演示态** | 原 `only-error` 演示的是「保存被拒（互斥）」，与实现侧「加载失败 → 重试」语义不同。新增 `data-demo-state="load-fail"` 承载，原分支改挂 `id="cta-error"` 保留演示 |

## 4. 走查证据（新增 3 条，防「锚点常显 = 假结构」）

| 断言 | 内容 | 结果 |
|---|---|---|
| 22l-1 | `load-fail` 态下重试按钮可见 | ok |
| 22l-2 | `normal` 态下重试按钮**不可见**（不是常显装饰） | ok |
| 22l-3 | 点重试 → 回 `normal` 态（非死按钮） | ok |

## 5. 重要项（不阻塞，记跟进）

| # | 事项 | 跟进 |
|---|---|---|
| I1 | 13 个阻塞锚点使 admin 无法到 0 → `DESIGN_ANCHOR_MODE` 仍只能 `off` | 台账 #8608 排 B2c（diff/badge 6 个）+ 调试台分期（7 个） |
| I2 | `BasicLayout.vue` 属壳层共享面，命中 SOP §7.3，但 R23 的 `test_surface` glob 未覆盖 `apps/*/src/layouts/*` | 建议后续把该路径并入 `test_surface`（否则机器永远不拦） |
