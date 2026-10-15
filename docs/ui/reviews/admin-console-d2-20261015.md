阻塞: 4
重要: 11

# 设计评审报告（D2 · 原型评审）

> 关口：D2 ｜ 对象：`docs/ui/prototypes/admin-console.html`（1227 行）
> ⚠️ **稿已迁址（2026-10-15 同日）**：该整合容器已删除，其中**内容中心 5 屏**切为模块稿
> `docs/ui/prototypes/admin-content-hub.html` 并合入 `admin-agents-hub.html`。
> 本报告的 4 项阻塞 / 11 项重要均针对这 5 屏，结论与整改回执继续有效。
> 目标端：**admin 系**（桌面 Web · 亮色）｜判据源：`docs/ui/design-system.md` + `packages/ui/src/tokens.ts` + `docs/ui/color-reference.md` + `docs/ui/css-override-rules.md` + `specs/admin-prototype-coverage/tasks.md` + `apps/admin/src/layouts/BasicLayout.vue`
> 评审方式：**盲审** —— 未读 `admin-console-质检记录.md` 的「一、设计决策记录」与「四、遗留项与待拍板」（出稿者自辩段）。本报告**全部条目均为独立发现**，与出稿者自陈的对照由 team-lead 另行比对。
> 日期：2026-10-15 ｜ 评审角色：`design-reviewer`

---

## 阻塞（必须解决，未清零不得交人确认）

### B1 [X6 / G2] 枚举按值配色：席位资金性质、席位买卖方向、触发方式各配一色

- 反例：
  - `tagBadge()`（L521-525）给 `SEAT_TAG` 三值 `hotmoney / institution / retail` 分别配 `warn` 橙 / `info` 蓝 / `neutral` 灰；
  - `renderDrawer()`（L953-954）给 `SEAT_TRADE_TYPE` 三值 `buy / sell / both` 分别配 `err` 红 / `ok` 绿 / `neutral` 灰；
  - 触发方式（L681）`manual` 配 `info` 蓝、`schedule` 配 `neutral` 灰。
  - 期望：颜色只编码语义（success/warning/error/info + brand），类型/枚举靠**文字**区分。
- 判据：[G2]（design-system §2.4「颜色只编码语义；类型、枚举不配色」，反例即「给环境=dev/test/prod 各配一种色」）+ [X6]（§7 反模式清单，看到即记阻塞）；`dir` 一处另触 [G6]（语义色不得挪作他用）
- 加重情节：**同色异义**。同一屏内 `.badge.err` 在 L922 表示「涨停」、在 L954 表示「买入」；`.badge.ok` 在 L1020 表示「启用」、在 L954 表示「卖出」。「买入」不是错误、「卖出」不是成功，红/绿在此处不承载任何语义，只承载枚举值。
- 严重级：阻塞 ｜ 是否阻塞：**是**
- 建议改法：
  1. 资金性质、买卖方向、触发方式一律降为 `neutral`（`--ws-bg-subtle` + `--ws-text-secondary`），差异交给文字；
  2. 确需提示的只用**一档**语义色（如「游资」用 `warn`，语义 = 需关注），不三值三色；
  3. 「买入 / 卖出」若要保留方向感，用箭头符号（↑ ↓）或中性深浅，不要动用 `err` / `ok`。

### B2 [K / X7] 原型出现落码不存在的字段，且未标注（与稿内自述「字段名是真的」冲突）

- 反例（逐条比对 M1 落码后独立核验）：
  - `quality_version`（L840）、`quality_scored_at`（L841）—— `servers/content-hub/src/content/entities/content-item.entity.ts` 的 `quality_*` 列只有 `quality_status`(L84) / `quality_stage`(L88) / `quality_issue`(L96) 三列；`archive/migrations/p35-content-quality.mjs` 同样只有这三列（另加 `collect_duration_ms` / `raw_hash`）。**两列均不存在**。
  - `HEALTH.totalItems` → 「近 7 天入库条数」卡（L641）—— `collect-log.service.ts` `health()` 返回 `{ windowDays, totalRuns, failedRuns, successRate, todayFailed, staleSources }`，**无入库条数字段**。
  - 期望：原型抬头 L295 自述「数据是模拟的，**字段名是真的**」，字段要么真实、要么显式标「[原型领先] 待落地补」。
- 判据：K 维度（与规格/需求一致性：字段与 page-spec/落码一致，无漏项）+ [X7]（需求未定义的项自行脑补且不标注）+ `specs/admin-prototype-coverage/tasks.md` §4.3（字段对照落地写，不用占位）
- 后果：内容中心 5 屏是本轮**新增范围**且被定位为后续落码的对照源，按此稿落码会造出不存在的列。
- 严重级：阻塞 ｜ 是否阻塞：**是**
- 建议改法：删掉这两行 + 该指标卡；或保留但加 `[原型领先]` 角标并在 `tasks.md` / 契约门登记为落地待补字段。

### B3 [E12 / E4] 阶外字号 15 处，全文 0 处「字阶例外」登记

- 反例：字阶（`tokens.font.size`）= 32 / 24 / 18 / 16 / 14 / 13 / 12。实测阶外值：

  | 阶外值 | 出现处 |
  |---|---|
  | 22px | L185 `.stat .v` |
  | 15px | L230 `.modal .mh` |
  | 14.5px | L272 `.ans p.lead` |
  | 13.5px | L273 `.ans h4` |
  | 12.5px | L101 `.ad-sub` |
  | 11.5px | L77、L144、L145、L187、L240（5 处）|
  | 11px | L282、L778 等（3 处）|
  | 10px | L105 `.ad-new` |
  | 9px | L100 `.ad-item .caret` |

  全文检索「字阶例外 / 阶外 / 例外登记」命中 **0**。
- 判据：[E4]（字号取字阶，禁自定义数值；确需阶外走 E12）+ [E12]（阶外字号须在原型/规格**显式登记**，**未登记即打回**）—— E12 的示例数值正是 12.5px 代码块，与本稿形态吻合
- 严重级：阻塞 ｜ 是否阻塞：**是**
- 建议改法（二选一）：
  1. **就近归拢**：11.5→12、12.5→13、13.5→13、14.5→14、15→16、22→24、9/10→8 或 12、11→12；
  2. **保留则登记**：在原型头部注释或质检记录里加一张「字阶例外登记表」（值 / 用途 / 理由），E12 即满足。

### B4 [X4 / G1] `:root` 之外出现裸 rgba 共 12 处

- 反例（G1 的豁免只覆盖「原型 `:root` 与端 token 定义层」，本稿 `:root` 止于 L61）：

  | 行 | 内容 |
  |---|---|
  | 81 | 桌面壳阴影 `rgba(20,30,50,.14)` |
  | 97 | 侧栏选中渐变尾 `rgba(255,140,66,.04)` |
  | 140–143 | `.note` 四种语义描边 `rgba(249,115,22,.25)` / `rgba(245,166,35,.3)` / `rgba(229,72,77,.25)` / `rgba(57,142,74,.25)` |
  | 153 | `.btn.danger` 描边 `rgba(229,72,77,.4)` |
  | 194 | `.src.cycle` 描边 `rgba(245,166,35,.45)` |
  | 209 / 226 | 抽屉与弹窗遮罩 `rgba(23,23,23,.35)` |
  | 229 | 弹窗阴影 `rgba(20,30,50,.2)` |
  | 269 | `.bubble.ai` 阴影 `rgba(0,0,0,.04)` |

- 判据：[G1]（色值只引 token，禁裸 hex/rgba）+ [X4]（§7 反模式，看到即记阻塞）；另触 [G8]（阴影取 `tokens.shadow.card` / `popover`，不自定义）
- 加重情节：遮罩本可直接引 tokens 既有 `roles.light.overlay`；弹窗阴影本应引 `tokens.shadow.popover`——而原型 `:root` **根本没定义 `--ws-shadow-popover`**，说明是漏引而非刻意例外。
- 严重级：阻塞 ｜ 是否阻塞：**是**
- 建议改法：
  1. 8 个语义描边/遮罩色收进 `:root`，命名 `--ws-{ok|warn|danger|info}-border` / `--ws-overlay`（引用 role + alpha）；
  2. 弹窗阴影改引 `--ws-shadow-popover`（补进 `:root`），气泡阴影改引 `--ws-shadow-card`；
  3. 桌面壳 / 气泡若判定为「原型框架、非 admin UI」，需在 `:root` 注释里**显式写豁免理由**（例外 = 有注释 + 有唯一去处，见 `color-reference.md` §4）。

---

## 重要（建议解决，不阻塞交人）

- [ ] **[G3] 净额与状态徽标对比度未过 AA**
  - 反例：`.badge.err` `#E5484D` on `#FCEBEC` = **3.40:1**；`.badge.ok` `#398E4A` on `#EAF6EC` = **3.67:1**；龙虎榜净额 12px/600 红绿 on 白 = **3.92 / 4.08:1**。三者均 < 4.5:1，且 12–13px 不享 G3 的「大字」豁免（豁免门槛是 ≥18px，或 ≥14px 且 500/600）。
  - 位置：L160-162（`.badge.ok/warn/err`）、L527-529（`netCell`）、L178（`td.num` 12px）
  - 判据：[G3]（正文 ≥4.5:1）｜严重级：重要｜是否阻塞：否
  - 建议改法：① 净额列提到 14px + 600 字重 → 享 3:1 门槛（3.92/4.08 通过）；② 比照 `--ws-warn-text` 的同一把尺子，补 `--ws-ok-text` / `--ws-danger-text` 深档进 tokens.ts（warn-text 已达 5.38:1，同口径应对 ok/err 生效）。
  - ⚠️ 这是**用出稿者自己的论证**量出来的：出稿者为 warn 补了可读文本档，却漏了 ok/err。

- [ ] **[G1 + css-override-rules §3] `--ws-warn-text` 与 `--ws-info` 是原型侧自造的 `--ws-*`，落地无对应 token**
  - 反例：`css-override-rules.md` §3「`--ws-*` 变量只允许出现在 `packages/ui/src/tokens.css`；任何 app / 组件不得再定义同名变量」。本稿在自身 `:root` 定义了 `--ws-warn-text:#8A5A00`（L46）与 `--ws-info:#2563EB`（L48），二者在 `tokens.ts` 中均不存在；且 `tokens.ts` 注释明确「蓝仅预留第三方链接」。
  - **独立核验 `--ws-warn-text` 的理由是否成立** → **成立，应补 token 而非改用既有 token**：
    - `warning.light.500 #F5A623` 压 `warning.light.100 #FEF3DC` = **1.84:1**，确实不可读 → 出稿者的问题诊断正确；
    - `#8A5A00` 压 `#FEF3DC` = **5.38:1**，过 AA → 取值正确；
    - 改用既有 token 不可行：`textBody #3F3F46`（9.48:1）/ `textStrong #18181B`（16.09:1）虽过 AA，但丢失 warn 色相，语义提示文本不应是近黑。
  - 判据：[G1]（原型 `:root` 受豁免，**形式不违规**，故不阻塞）+ `css-override-rules.md` §2-3 / §3 ｜严重级：重要｜是否阻塞：否
  - 建议改法：`warn-text` 正式补进 `tokens.ts`（light `#8A5A00` + dark 镜像）+ `tokens.css` 双侧同步；`--ws-info` 蓝色与「蓝仅预留第三方链接」冲突，去或留需用户拍板（见「待用户裁决」）。

- [ ] **[A1] 原型侧 `data-dr` 锚点数 = 0**
  - 反例：全文件检索 `data-dr` 命中 **0**。`specs/admin-prototype-coverage/tasks.md` §0 写「锚点回填**可复用原型侧 `data-dr`**」，§4.6 排除的是**实现侧**回填，不是原型侧打点。本稿作为 admin 唯一容器，不打锚点则 `anchor-backlog` B1b 批（admin 26 个 `.vue`）拿不到原型侧对照，D3 无法机检。
  - 判据：[A1] / [A2]（关键结构打点，不逐元素打）｜严重级：重要｜是否阻塞：否
  - 建议改法：按 A2 粒度，每屏打 4~6 个：页头（`data-dr="pg-head"`）、主操作、状态区、列表容器、主表单。

- [ ] **[E6] 一屏 3 个 primary 主操作（采集总览 · 采集源卡）**
  - 反例：L663 三张采集源卡各渲染一个 `.btn.sm.primary`「立即采集」，正常态同屏并存 3 个 primary。E6 要求一屏 primary ≤ 1。
  - 判据：[E6]（§2.2，反例即「两个 primary 按钮并排」）｜严重级：重要｜是否阻塞：否
  - 建议改法：卡内按钮默认次级 `.btn`；卡片组页头保留唯一 primary（如「一键采集全部」），或仅对当前失败源升 primary。

- [ ] **[S3 / X2] 空态块缺「唯一出路」按钮**
  - 反例：L759、L770（内容条目空态）、L1011（席位库空态）调用 `emptyHtml(title, sub, '')`，第三参 action 传空串 → 空态块只有「图标 + 标题 + 说明」，无出路按钮。S3 规定空态 = 图标 + 一句话标题 + 说明 + **唯一出路**。
  - 缓解：上方筛选条的「重置 / 清空」仍在屏上，但出路不在空态块内，与 S3 的视觉规格不符。
  - 判据：[S3]（§4）｜严重级：重要｜是否阻塞：否
  - 建议改法：空态块内补一个「清空筛选条件」按钮。

- [ ] **[F1] 间距系统性偏离 4 倍数阶梯（约 60 处）**
  - 反例：`tokens.space` = 4/8/12/16/24/32/48（antd 惯例 4 的倍数）。实测阶外值：2 / 5 / 6 / 7 / 9 / 10 / 14 / 18 / 20 / 22 / 34 / 56 / 94 / 120。典型：`.ad-content{padding:18px 22px}`(L116)、`.ad-item{padding:9px 12px}`(L93)、`.card{margin-bottom:14px}`(L133)、`.btn{padding:6px 14px}`(L148)、`.ad-sub{padding-left:34px}`(L101)。
  - 判据：[F1]（§2.3，反例「出现 13px / 7rpx 这类无法归阶梯的值」）｜严重级：重要｜是否阻塞：否
  - 建议改法：就近归拢 6/10/14/18/22 → 8/12/16/16/24；2/5/7/9 → 4/4/8/8；34→32；56→48 或 64；94→96；120→96 或 128。

- [ ] **[E3] 字重 700 越界（且是照抄落地的漂移）**
  - 反例：L88 `.ad-logo-t{font-weight:700}`。E3 只许 400 / 500 / 600。
  - 加重情节：`apps/admin/src/layouts/BasicLayout.vue:272` 落地同样是 700 —— 原型照抄了实现而非判据，会把落地漂移固化进对照源。
  - 判据：[E3]（§2.1）｜严重级：重要｜是否阻塞：否
  - 建议改法：原型改 600；同时在质检记录登记「落地 `.logo-text` 700 待改（E3）」回流 `rd-execute`。

- [ ] **[G7 / E13] 控件圆角两档混用 + 控件高阶外**
  - 反例：`.btn` 用 `--ws-radius-md`(6 = control，L147) 而 `.btn.sm` 用 `--ws-radius-sm`(4 = chip，L155) —— 同为控件层却两档；`.ad-collapse{26px}`(L89)、`.icon-btn{28px}`(L220)，而 `tokens.control` 阶梯是 24 / 32 / 40。
  - 判据：[G7]（同层级元素圆角一致）+ [E13]（控件高取 control 阶梯）｜严重级：重要｜是否阻塞：否
  - 建议改法：`.btn.sm` 圆角改 `--ws-radius-md`；26 / 28 → 24 或 32。

- [ ] **[P4 / A] 「条目详情」作为侧栏一级菜单项，无 id 参数**
  - 反例：从侧栏点「条目详情」→ 落到写死的默认 `S.detailId = 12043`（L408）。用户点之前**无法预判**会看到哪一条，返回路径只有「返回列表」。详情页作为独立页是合理的（meta JSON 与原文塞不进抽屉，M4 判断正确），但**不该是菜单项**。
  - 判据：[P4]（操作必须可预期）+ A 维度（入口可达且语义有效）｜严重级：重要｜是否阻塞：否
  - 建议改法：详情页不进侧栏菜单，改由列表行内进入；若保留，菜单项须显式标注「原型态：默认展示 #12043」。

- [ ] **[P2] Agents 子菜单顺序与落地不一致**
  - 反例：`BasicLayout.vue` 子项序 = Agent 观测 / 运行记录 / 能力资产 / 知识集合 / 检索调试 / 定义管理 / 技能库 / **对话调试（末位）**；本稿 L355 把「对话调试」提到**首位**。
  - 判据：[P2]（一致性优先于个性化）+ `tasks.md` §4.2（菜单必须从 `BasicLayout.vue` 派生）｜严重级：重要（低危）｜是否阻塞：否
  - 建议改法：改回落地的末位顺序，或在该项旁标注「已整合稿，位置提前，落地为末位」—— 否则「单点派生」承诺被自己打破，又会长出第二真相源。

- [ ] **[K] 两处字段口径与落码不一致，原型未标注**
  - 反例 1（**落地 bug，本角色独立发现**）：`collect-log.service.ts:144` 的 `staleSources: rows.map(...)` 返回的是**窗口内有采集记录的源**（`rows` 来自 `started_at >= since` 的分组），而函数注释与原型都说是「近 N 天**零采集**的源」。语义相反。原型 L642-651 按注释画成「静默失效源」，D3 照原型比对会判漂移。
  - 反例 2：`content-source.entity.ts` 无 `cron` 列（cron 在 `content-pipelines.cron`，见 `scheduler.service.ts`）。原型 L661 把「调度：收盘后 15:10 / 每 30 分钟」挂在**采集源**卡上，未标注为派生。
  - 判据：K 维度 + `tasks.md` §5（不一致处须显式标注「原型简化」或「落地待改」）｜严重级：重要｜是否阻塞：否
  - 建议改法：静默失效源卡加 `[落地待修]` 角标并回流 `rd-execute` 修 `health()`；调度字段标注「取自 pipeline.cron」。

---

## 建议（无判据的个人偏好，可驳回）

- `.stat .v`（22px 统计数值）未开 `tabular-nums`、未用 mono，与 `td.num` 不一致 —— 判据 [F4] 原文针对「数字列」，统计卡属边缘情形，故降级为建议。
- 空态/表格里的占位符 `—` 用 `--ws-text-disabled #D4D4D4`，压白底仅 **1.48:1** —— [G3] 的边界（占位符非正文内容），建议提到 `--ws-text-tertiary`。
- 侧栏菜单项、`.ad-new` 用 `<div onclick>` 而非 `<button>`，键盘不可达 —— [J] 维度在原型阶段「标注即可」，本稿未标注，建议补一行说明。
- 「立即采集」成功后 `RUNS.unshift` 新增批次，但 `SOURCES` 的 `count` / `last` 未同步更新，采集源卡与批次日志数据不自洽 —— **无判据编号，属个人偏好，可驳回**。
- `.ad-logo-dot` 用 `accent → warn` 渐变，与 favicon / logo 的品牌豆色 `#F97316` 不一致 —— 品牌图标例外已登记在 `color-reference.md` §4，是否需统一**无判据**，属个人偏好。

---

## 通过项

| 维度 | 结论 |
|---|---|
| **I5 图标与 !important** | 全 SVG 内联，emoji 命中 **0**；`!important` 命中 **0**（X4 一半通过）✅ |
| **A 信息架构** | 8 个一级项 + 2 个子菜单，与 `BasicLayout.vue` 的顺序 / 权限码 / 子项**逐一对齐**；侧栏 **220px**、`collapsedWidth=80`、logo「科豆 AI」与落地一致（旧稿 210px 已纠正）✅ |
| **P6 未定义不脑补** | 14 个未补模块走占位屏，显式写「本屏是占位，**不是设计稿**」+ 路由 / 落地文件 / 批次（L1159-1175）✅ 反 X7 |
| **S1/S2/S4** | 骨架屏覆盖全部 5 屏；无假 loading；失败态含「出了什么问题 + 落点 + 重试」按钮（H4 同过）✅ |
| **S5 无权限** | 锁图标 + 明确写出缺少哪个权限码 + 唯一出路按钮 + 申请指引，非空白非静默隐藏 ✅ 反 X2 |
| **S6 破坏性操作** | 停用席位 / 重新处理 / 立即采集 **全部二次确认**，文案写明影响面与可恢复性（「历史记录不会被改写」「原失败归因无法复原」「运行期间被服务端拒绝」）✅ |
| **S8 进行中** | `S.busy` + `disabled` + 「采集中…（禁止重复触发）」锁重复提交 ✅ |
| **M4 / S9** | 席位明细用 Drawer 保留列表上下文；弹窗不嵌套 ✅ |
| **K 字段真实性（主体）** | `collect_runs` 全字段、`QUALITY_STATUS` 4 值、`QUALITY_STAGE` 5 值（含 v2.0 新增 `fallback`）、`SEAT_TAG` 3 值、`SEAT_TRADE_TYPE` 3 值、`lhb_records`、`hotmoney_seats` 全部与落码一致 ✅ |
| **K 接口真实性** | `collect/runs`、`collect/health`、`collect/:sourceCode`、`arxiv-digest`、`lhb`、`lhb/:id`、`lhb/stats`、`quality/filter-support` 全部存在于 `content-quality.controller.ts` ✅ |
| **G10 代码块** | 统一深色方案，`--ws-code-*` 与 `tokens.ts` 同值，未用语义色当代码底 ✅ |
| **G11 焦点态** | `:focus-visible` 全局焦点环已定义（L70）✅ |
| **G12 动效** | 过渡统一 150/200ms + `--ws-ease-out`，无装饰动效 ✅ |
| **I2 / I4 未串端** | 无品牌端 token（`--page-bg` / `--brand-txt` / `--card` 均未出现），单位 px，桌面壳 ✅ |
| **H1 / H2 / H6** | 按钮动词开头（新增 / 停用 / 立即采集 / 重新处理 / 导出）；无冗余敬语；无 lorem / TBD 堆砌 ✅ |

---

## 结论

❌ **阻塞**（4 项未清零，退回 `ux-prototype-designer`）

补充判断：4 项均为**低成本可改**，不涉及结构重构——

- B1 = 去枚举配色（改 3 个 badge 映射函数）
- B2 = 删 3 个不存在的字段，或加 `[原型领先]` 角标
- B3 = 归拢字号，或补一张「字阶例外登记表」
- B4 = 把 8 个裸 rgba 收进 `:root`，阴影改引 token

补齐后可在当日复评转 ✅。但**不得**以「产品已确认方向 / 主体质量不错」为由带阻塞交人确认（反模式第 1 条）。

---

## 质疑回流

- → **ux-prototype-designer**：Blocker B1–B4 的反例与改法（本角色不代改）；另请补 A 维度两处：菜单 Agents 子项顺序回落地的末位、条目详情是否移出侧栏菜单。
- → **rd-execute**（D3 前置，非本次改动）：
  1. `collect-log.service.ts` `health().staleSources` 返回的是「有采集的源」与注释语义相反，属落地 bug；
  2. `apps/admin/src/layouts/BasicLayout.vue:272` `.logo-text{font-weight:700}` 违反 E3，待改 600。
- → **requirement-translation**：内容中心 5 屏的口径（静默失效源定义、条目筛选 `quality_status`/`quality_stage` 真实筛选能力）在需求侧未定稿，原型只能在 `quality/filter-support` 占位之上表达（原型已自行标注，✅ 合规），但需求侧需给出定稿口径。

---

## 待用户裁决（本角色无权拍板）

1. **`--ws-warn-text` 是否正式进 `packages/ui/src/tokens.ts`**（+ dark 镜像 + `tokens.css` 双侧同步）。本角色独立判断：**应补**——出稿者的理由成立（1.84:1 → 5.38:1），且既有 `textBody` / `textStrong` 虽过 AA 但丢语义色相，不能替代。
2. **`--ws-info:#2563EB` 蓝去留**：`tokens.ts` 明确「蓝仅预留第三方链接」，info 语义已由品牌橙承载。留 = 需进 tokens 并修订 DR；去 = 徽标降为 neutral。
3. **龙虎榜净额「涨红跌绿」（A 股口径）是否保留**。判据上**不违规**：[G2] 允许颜色编码语义，涨跌是**数值方向**而非类型/枚举，且稿内 L927 有显式图例说明。但存在同色异义风险（红既=error 又=涨）。保留需同时解决 [G3] 的 3.92/4.08:1 对比度；替代方案是新增 `--ws-fin-up` / `--ws-fin-down` 语义档进 tokens。
4. **内容中心菜单落点**：现插在「数据浏览」与「Agents」之间（`tasks.md` §3.1 标「待拍板」）。
5. **`content:view` / `content:manage` 权限码登记进 `packages/types/src/index.ts`**（契约门 C4，原型注释已提示）。
6. **条目详情是否保留为侧栏一级菜单项**（见「重要 · P4」）。

---

## 独立性声明

- 本次评审**未读** `docs/ui/prototypes/admin-console-质检记录.md` 的「一、设计决策记录」与「四、遗留项与待拍板」，符合 `design-reviewer` 独立性机制①（盲审隔离）。
- 因此**本报告全部条目均为独立发现**，不存在「照抄出稿者自陈」的条目。出稿者自陈遗留项与本报告的对照，需由 team-lead 另行比对。
- 其中三项为本轮**独立核验后得出的新结论**，提请重点关注：
  1. **B2** 的 `quality_version` / `quality_scored_at` / `totalItems` —— 系比对 entity / migration / service 后独立发现落码不存在；
  2. **重要 · K** 的 `health().staleSources` 语义相反 —— 系读 `collect-log.service.ts` 独立发现的**落地 bug**，原型未标注；
  3. **重要 · G3** 的 ok/err 徽标 3.40 / 3.67:1 —— 系用出稿者论证 `--ws-warn-text` 的同一把对比度尺子量出，出稿者为 warn 补了 token 却漏了 ok/err。

---

## 整改回执（出稿者 · 2026-10-15）

针对上方 **4 项阻塞** 逐条整改，全部完成并做了运行时复验（不只改声明）。

| # | 阻塞 | 整改 | 复验证据 |
|---|---|---|---|
| 1 | [X6/G2] 买卖方向复用 `badge.err`/`badge.ok`，同屏红色既表「涨停」又表「买入」 | 新增专用类 `.trade.buy/.sell/.both` + 金融档 token `--ws-fin-up:#C4322F` / `--ws-fin-down:#2E7D48`（AA：5.46:1 / 5.07:1）；净额同步改用金融档；图例写明「与 err/ok 语义色刻意区分」 | computed：买入 `rgb(196,50,47)`、卖出 `rgb(46,125,72)`、净额 `rgb(196,50,47)`；类名均为 `trade buy/sell/both`（不再含 `badge`） |
| 2 | [K/X7] 3 个落码不存在的字段未标注 | 详情页删除 `quality_version` / `quality_scored_at`，改为 `[落地待补]` 角标说明「p35 只建了 status/stage/issue 三列」；健康度卡删掉虚构的「近 7 天入库条数」，改为真实字段「最近一次采集」 | 页面文本不再含 `quality_version</dt>`；含 `[落地待补]` 与 `quality_scored_at`；不再含「近 7 天入库条数」，含「最近一次采集」 |
| 3 | [E12/E4] 阶外字号 15 处且 0 登记 | 全部归一到 `tokens.font.size`（32/24/18/16/14/13/12）：22→24、15→16、14.5→14、13.5→16、12.5→12、11.5→12、11→12、10→12、9→12；字重 700→600（E3）；文件头登记「字阶例外 0 处」 | 运行时扫描 `#app` 与壳内所有元素：**0 处**落在字阶之外 |
| 4 | [X4/G1] `:root` 外裸 rgba 12 处 | 收进 `:root` 为 12 个语义 token（`--ws-overlay`、`--ws-shadow-window/modal/thumb/bubble`、`--ws-accent-04`、`--ws-border-brand/warn/warn-strong/danger/danger-strong/ok`） | 静态扫描 `:root` 外裸 rgba = **0** |

**同步修掉的重要项**：E6（采集总览 primary 由 3 个降为 0 个）、S3（条目/龙虎榜/席位库三处空态补唯一出路按钮）、
P2（Agents 子菜单顺序还原为 `BasicLayout.vue` 顺序，「对话调试」移到末位并加「已有原型」标记，不再因"已实现"而提前）、
P4（条目详情直入时说明「默认展示最近一条 #12043」）。

### 你独立发现的落地 bug（已修，不在原型侧）

`collect-log.service.ts` 的 `health().staleSources`：注释写「近 N 天零采集的源」，
但 SQL 带 `WHERE started_at >= ?` 后再分组 —— 查出来的恰恰是**窗口内有过采集的源**，语义完全相反。
已改为：统计覆盖全部有记录的源，窗口内量用 `CASE WHEN` 单独聚合，再由 JS 挑出 `MAX(started_at) < since` 的源。
`tsc --noEmit` 通过。已知边界：从未跑过的源（collect_runs 一行都没有）仍无法发现，需 join `content_sources`，列为遗留项。

### 复验

浏览器实跑 **76 项断言全绿、0 控制台错误**（原 60 项全量回归 + D2 整改 16 项）。
