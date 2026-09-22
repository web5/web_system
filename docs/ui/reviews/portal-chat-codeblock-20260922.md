# 设计评审报告 · 对话工作台 markdown 代码块（D2 原型/规格评审）

> 评审对象：`apps/portal/prototype/index.html`（code 块增量）+ `specs/portal-redesign/page-spec.md` §2.1（blocks 表 `code` 行与 markdown 口径）
> 判据源：`docs/ui/design-system.md` 品牌端分区（E3/E4/E7/F1/F4/G1/G4/G7/H5/H6）、`specs/portal-redesign/page-spec.md` §2.1/§2.2
> 评审方式：独立 sub-agent 盲审（先读判据源、再看被审物），2026-09-22

阻塞: 0
重要: 0

## 评审时发现问题（均已回流修正）

### P1（重要 → 已修正）

- 反例：折叠触发 `plainLen` 只累计 `t==='p'`，代码类长回答（lead 段 + 两段各 ~20 行代码，段落约 68 字 < 160）永不折叠；而 `foldCut` 却把 `code` 计入 90 字累计——触发与截断两处数字源不一致。且 `p(30字)+code(3000字)` 场景下 foldCut「先 push 再判 90」，折叠预览 = 完整 3000 字代码块，正是规格口径要防的「折叠态整块吞屏」。
- 判据：page-spec §2.2「按块边界截断（累计约 90 字止）」+ §2.1 markdown 口径 ②；清单 K「与 page-spec 一致，无漏项」。
- 处置：① 触发口径扩为 p + code（与截断同源）；② 超长代码块（> 90 字）不进折叠预览，展开后完整可见。规格 §2.1 口径 ②③ 同步收口。

### 建议区

- S1｜复制 toast 文案「代码已复制」与全局「已复制」不一致 → **已统一为「已复制」**（H5）。
- S2｜复制按钮样式与 copybox 头行分叉（紧凑头行系有意收窄）→ 保留，个人偏好可驳回。
- S3｜头行内边距 `6px 12px` 出 8 倍数阶梯 → **已改 `8px 12px`**（F1）。
- S4｜正文 `12.5px` 为阶外字号 → 规格已登记「端内字阶例外：代码块专用」（E4）。
- S5｜demo 未覆盖「长代码 + 折叠」组合场景 → 由规格口径 ③ 收口，不另加演示例。

## 通过项

- 视觉同语言、无裸 hex：`--page-bg`/`--line`/`--r-md`/`--t1..t3`/hover `--brand-strong`（G1/G7/G4）
- 等宽栈 + `white-space:pre; overflow-x:auto`，长行横滚不换行（F4）
- `esc()` 转义代码体与语言标签；lang 缺省兜底 `'code'`
- demo 数据为真实可运行的快排实现，无占位堆砌（H6）
- 规格 markdown 配套口径（行内反引号 / 复制 / 朗读跳过 / 流式降级）闭合

## 结论

✅ 通过（评审发现问题已全部回流修正，无阻塞、无未决重要项）。待用户确认原型后落码。

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
