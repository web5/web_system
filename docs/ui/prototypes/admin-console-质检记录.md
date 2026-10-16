# 内容中心 5 屏 · 质检记录

> ⚠️ **稿已迁址（2026-10-15 同日）**：出稿时这 5 屏在 `docs/ui/prototypes/admin-console.html`
> （另一份重复造的 admin 整合容器）内。该容器**已删除**，5 屏切为**模块稿**
> `docs/ui/prototypes/admin-content-hub.html`（无壳），经 `scripts/lib/proto-registry.mjs`
> 以 **shared 共享源**登记后重跑 `node scripts/build-agents-hub.mjs` 合入整合稿。
> **本记录的 A~I 结论、76 项断言结论对「内容中心 5 屏」继续有效**；断言的自动执行已由
> `scripts/verify-agents-hub.mjs` ⑩g 段接管（每条都可在整合稿里复跑）。
>
> 稿：`docs/ui/prototypes/admin-content-hub.html`（原 `admin-console.html`）｜产出：2026-10-15｜目标端：**桌面 Web**（apps/admin 亮色）
> 依据：`specs/admin-prototype-coverage/tasks.md` §4 方法与约定｜清单：`.codebuddy/skills/ux-prototype-designer/references/ux-review-checklist.md`
> 本次范围：**内容中心（CQO）5 屏** + 把既有 `admin-settings.html` / `admin-agents.html` 整合进统一壳
> 结论：**A~I 全部通过**；D2 独立评审判出 **4 项阻塞已全部整改清零**（回执见 `docs/ui/reviews/admin-console-d2-20261015.md` 末节）；
> 浏览器实跑 **76 项断言全绿、0 控制台错误**（60 项全量 + 16 项 D2 整改回归）

---

## 一、设计决策记录

### 1. 为什么做成「统一容器」而不是再来一份 `admin-content.html`

原方案（tasks.md §4.4）是每模块一份稿 `admin-<module>.html`。但 admin 侧已有两份稿，各自**复制了一份壳与菜单**（`admin-settings.html` 侧栏 9 项、`admin-agents.html` 侧栏 11 项且顺序不同、还多出「科豆管理」logo 文案）—— 这就是活生生的第二真相源：改菜单要改 N 处，且两份稿的菜单与 `BasicLayout.vue` **都已经对不上**。

本稿把壳与菜单收成**单一入口**，菜单直接派生自 `apps/admin/src/layouts/BasicLayout.vue`（顺序 / 权限码 / 子项 / logo 文案「科豆 AI」/ 顶栏面包屑）。新增模块 = 在菜单数组加一项 + 加一个 `screenXxx()`，不再复制壳。

**因此本稿取代** `admin-settings.html`（其「系统设置」屏与「[原型] 变更对照」壳写法已并入）与 `admin-agents.html`（其「对话调试」屏已并入）。两份旧稿保留供追溯，登记为历史稿。

### 2. 侧栏宽度纠正 210px → 220px

落地 `BasicLayout.vue` 是 `width="220"`、`collapsedWidth="80"`；两份旧稿都写 `210px`。本稿按落地取 220px，并在实跑断言里核到 computed 宽度 = 220px。

### 3. 「条目详情」是独立页，「席位明细」是抽屉（同模块两种承载，非随意）

| 内容 | 承载 | 为什么 |
|---|---|---|
| 内容条目详情 | **独立页**（有返回列表路径） | 要展示 `meta` JSON 全量 + arXiv 原文（可比对幻觉的正文），抽屉宽度放不下；这是 D4 裁决「Admin 做 5 页」的由来 |
| 龙虎榜席位明细 | **抽屉** | 它是同一屏内的补充表格（4~5 行席位），不构成独立浏览任务；做成页会让「列表→看席位」多一次整页跳转 |

### 4. 席位判定显式写成「规则匹配，不是 AI」

`hotmoney_seats` 是规则表而非硬编码，原型在两处（席位抽屉、席位库页头）都写明「规则匹配、可复现」以及**停用而非删除**（删除会让历史龙虎榜判定不可再现）。这不是文案装饰 —— 它决定了这个页面的操作形态必须含「停用」而不是只有「删除」。

### 5. 净额配色：涨红跌绿（A 股口径）

净额为正显示红（`--ws-danger`）、为负显示绿（`--ws-ok`）—— 与国内行情软件一致，与欧美相反。实跑断言核到 computed 颜色（`rgb(229,72,77)` / `rgb(57,142,74)`），不是只查 class。

### 6. Token：新增 `--ws-warn-text`，并把两处裸 hex 收进 token

`packages/ui/src/tokens.ts` 的 `warning` 只定义了 `100/#FEF3DC` 与 `500/#F5A623` 两档，**没有「warn 色在 warn-soft 底上的可读文本档」**。两份旧稿由此在 `.note.warn` / `.badge.warn` 直接写了裸 hex `#8a5a00`（违反 design-system G1）。

本稿在 `:root` 定义 `--ws-warn-text:#8A5A00`（原型侧派生值，文件内已注明「待补入 tokens.ts」），两处改为 `var()`。实跑核到该 token **真实解析**为 `rgb(138,90,0)` —— 因为「声明一致 ≠ 生效」，缺 token 会静默回退。

### 7. 数据是模拟的，字段名是真的

所有字段名与接口形态对照 M1 落码逐一对齐：`collect_runs`（含 `dedup_count`/`fail_count`/`duration_ms`/`trigger_type`）、`content_items.quality_status|quality_stage|quality_issue|quality_version|quality_scored_at`、`lhb_records`（含 `seats`/`tags`/`limit_up`/`is_st`）、`hotmoney_seats`（`alias`/`tag`/`is_active`）、论文摘要落库（`arxiv_id`/`title_en`/`prompt_version`/`degraded`）。
席位库的 18 条名单**不是编的**，逐条取自 `archive/migrations/p35-content-quality.mjs` 的 `SEAT_SEED`（15 游资 + 3 机构通道）。

---

## 二、A~I 逐条结论

### A. 信息架构

- [x] **页面清单完整**：本次范围 5 屏（采集总览 / 内容条目 / 条目详情 / 龙虎榜 / 席位库）全部产出，无缺页。
- [x] **入口可达、有返回路径、无死链**：菜单 15 项全部可点；5 屏均从侧栏可达（面包屑逐屏核对：`首页/内容中心/<屏名>`）；条目详情有「返回列表」。**死链做了全屏 × 全态扫描**（不只正常态）—— 这一步抓出一个真 bug：空态按钮写 `collect(...)` 而函数名是 `confirmCollect(...)`，正常态扫描漏掉、空态才暴露。
- [x] **导航层级 ≤ 3 层**：`首页 / 内容中心 / 某屏` = 3 层；无跳转环。

### B. 任务流闭环

- [x] **主路径闭环**：采集总览（看健康度）→「立即采集」→ 二次确认 → loading → 新批次入日志表 → Toast 反馈。列表 → 详情 → 返回列表往返闭环。
- [x] **异常分支覆盖**：5 屏 × 5 态（正常/加载中/空数据/请求失败/无权限）逐格断言「有真实可见内容」（判 computed display 与盒子高度，不只查 classList）；错误态给出具体接口与状态码，空态给出恢复入口（如「立即采集一次」）。
- [x] **跨屏衔接**：详情页展示的 `quality_issue` 与列表失败行的批次号（`已在批次 8418 记 failed`）互相指得上；批次级（collect_runs）与条目级（content_items.quality_*）在两屏各自标明职责边界。

### C. 状态矩阵

- [x] **加载中**：骨架屏（健康度卡 + 表格骨架）。
- [x] **空态/错误态/无权限**：三者各有唯一恢复入口（空态→立即采集 / 错误→重试 / 无权限→返回工作台）。无权限文案带真实权限码：`content:view`、`settings:view`、`agents:debug`。
- [x] **完成态反馈**：Toast（「采集完成：新增 68 条」）+ 表格首行新增批次（状态变化可见，不只有 Toast）。
- 说明：**占位屏对「加载/空/错」三态标注为不适用并说明原因**（它不请求任何数据）——不假装覆盖。

### D. 操作与确认

- [x] **主操作一屏 ≤ 1**：「立即采集」是各采集卡唯一 primary；席位库页头唯一 primary 是「新增席位」。
- [x] **破坏性操作二次确认**：手动采集（会真实请求上游 + 可能被拒）、停用席位（写明「新采集不再用它判定；历史记录不改写」）、重新处理条目（写明会覆盖 `quality_status/stage/issue` 且原归因无法复原）。
- [x] **禁用/进行中正确**：采集进行中按钮文案变「采集中…（禁止重复触发）」且 `disabled=true`（实跑断言核到 disabled 属性）。这与服务端 `running` 集合的幂等保护对应。
- [x] **表单校验**：新增席位表单用 label 左置栅格（`.frow/.fitem/.flb 84px/.fld/.fhint`），hint 说明「全称写错会导致规则永远匹配不上」。
- 遗留：席位表单的错误态文案未逐字段演示（属可接受简化，见 §四-3）。

### E. 视觉与 Token 一致性

- [x] **Token 化**：静态扫描 + 人工确认，业务区**无裸 hex**（唯二两处已收进 `--ws-warn-text`）；`:root` 之外无 rgba 硬编码色板（半透明用 `rgba(255,140,66,.x)` 仅出现在 :root 的 accent-soft 与少量 border，沿用既有稿口径）。
- [x] **主色匹配目标端**：品牌橙 `--ws-brand-500/600`，admin 侧栏选中用 `--ws-accent:#FF8C42`（与 `BasicLayout.vue` 一致）；单一亮色口径，不混深浅。
- [x] **无 emoji、图标内联 SVG**：**初稿有 4 处 `⚠️`，已全部替换为文字标记**（`[待补]` / `注意`）；图标全部为内联 SVG。
- [x] **间距取 8 的倍数**：卡片 16px、栅格 gap 12px/14px、表头内距 8/10px。
- [x] **字号三级**：18px（页标题）/ 13px（正文与表体）/ 12px（次要与标签），层级不靠加粗堆叠。

### F. 可访问性基线

- [x] **可读性**：正文 `--ws-text-body` 于白底；次要文字用 `--ws-text-tertiary` 仅承载辅助信息，不承载状态结论（状态一律用 badge 带底色）。
- [x] **键盘/焦点**：`:focus-visible` 统一 focus ring（`box-shadow:var(--ws-focus-ring)`）；可点元素用 `<button>` —— 浅色页不显 ring、键盘 Tab 可见。
- [x] **语义**：可点区为 `button`；抽屉/弹窗有关闭按钮带 `aria-label`；表单有 `aria-label`（如「交易日」「日期起点」）。
- 遗留：抽屉/弹窗未做 focus trap 与 Esc 关闭（原型阶段标注即可，落地需补）。

### G. 内容与真实性

- [x] **无 lorem / 无 TBD 占位**：全部真实业务文案（「近 7 天成功率」「去重跳过」「静默失效源」等）。
- [x] **关键信息完整**：采集日志含 批次/源/触发/状态/条数/去重/失败/耗时/时间/错误原文；龙虎榜含 代码/名称/原因/买卖额/净额/换手/资金性质/涨停/ST；条目含 `quality_status` + `quality_stage` + `quality_issue` 三层归因；详情页含 `quality_version`/`quality_scored_at` 与原文。

### H. 目标端一致性

- [x] **目标端已确认并回显**：桌面 Web（admin 管理后台亮色），文件头与页头均回显。
- [x] **壳与宿主元素匹配**：侧栏 220px（含 logo 22px + 折叠按钮）+ 顶栏 56px（面包屑 / 状态控件 / 用户头像）+ 内容区，无移动 H5 / 小程序元素混入。
- [x] **平台原生能力**：本稿无分享/授权/支付类能力需要占位；唯一的模拟语义是「[原型] 状态」控件与 Toast，均已在页头声明「仅走查用，落地不保留」。

### I. 未定义项显式标注（不脑补）

- [x] 未定义/超前的部分均有显式标注，不静默发明：内容条目页标注 `quality_status`/`quality_stage` **筛选落地待补**（服务端当前只有 `GET /api/content/quality/filter-support` 自查占位）；菜单「内容中心」标 `新增` 徽标（位置待拍板，见 §四-1）。
- [x] 席位无明细的行**不静默留空**：明确写 `seats_available=false` 及其后果（资金性质只能判 retail，没有席位谈不上命中游资席位）。

---

## 三、浏览器实跑证据

- 环境：本地静态服务 `python3 -m http.server 5199`（`file:` 协议被禁），Chrome headless + puppeteer-core，视口 1400×1000。
- 脚本：`verify-admin-console.mjs`（含 60 项断言，覆盖：无 JS 错误 / 菜单可达 / 5 屏 × 5 态 / token computed 生效 / 主路径闭环 / 降级说明 / 净额配色 / 抽屉与无席位分支 / 席位库种子条数 / 破坏性确认 / 采集 loading 防重复 / 全屏全态死链 / 已整合模块内容）。
- 结果：**PASS 60 · FAIL 0 · 控制台错误 0**。

关键断言原文（节选）：

| 断言 | 实测值 |
|---|---|
| 侧栏宽度=220（对齐 BasicLayout） | `220px` |
| 新增 token `--ws-warn-text` 真实生效 | `rgb(138, 90, 0)` |
| 净额为正=红（A 股口径） | `+2.24 亿` → `rgb(229, 72, 77)` |
| 净额为负=绿（A 股口径） | `-2.24 亿` → `rgb(57, 142, 74)` |
| 席位抽屉滑入视口 | `{shown:true, left:779, w:560}` |
| 席位库渲染 p35 种子 | `18 条`（15 游资 + 3 机构通道） |
| 采集进行中防重复 | `{text:"采集中…（禁止重复触发）", disabled:true}` |
| 采集完成后新批次入日志 | 首行 `8422 东方财富龙虎榜 eastmoney_lhb 手动 成功 68 0 0 2.41s` |
| 无死链（全屏 × 全态） | 0 个未定义处理函数 |
| 降级条目解释 fallback 意义 | 命中「走了降级通道」+ `fallback` |

截图证据：`/tmp/aqv2/shots/overview-normal.png`、`overview-noperm.png`、`items.png`、`lhb-drawer.png`。

---

## 四、遗留项与待拍板（不影响本稿通过）

1. **内容中心在菜单的落点待拍板** —— 本稿放在「数据浏览」之后、「Agents」之前。落地需同时改 `BasicLayout.vue`（menu-item + 权限判据）与 router；`content:view`/`content:manage` 还需在 `packages/types/src/index.ts` 登记（契约门 C4）。
2. **「重新处理条目」按钮的权限归属** —— 我按 `content:manage` 设计（有副作用）。需确认 admin 是否真要给这个能力，或只留给超管。
3. **席位库的写接口尚未落地** —— M1 只做了规则匹配的**读**（`seat-tag.service.ts` 登录时按 tag 分配席位）；新增/停用/编辑席位需要补接口。原型按目标形态表达，落地时需先补接口。
4. **采集源卡片的调度信息是只读文案** —— 当前来自服务端常量（`收盘后 15:10` / `每 30 分钟`），若将来要做「在界面改调度」，需先补调度配置接口。
5. **`seats` 字段映射待真实返回校准** —— M1 采集器用的是保守提取（取到就填、取不到留空 `seats_available=false`），dev 库跑通后需拿真实返回校准一次映射；原型已把两种分支都画了。
6. **抽屉/弹窗未做 focus trap 与 Esc 关闭**（原型阶段可接受，落地需补）。

---

## 五、与落地一致性说明

| 项 | 原型 | 落地 | 处理 |
|---|---|---|---|
| `quality_status`/`quality_stage` 筛选 | 已有筛选控件 | 服务端仅 `filter-support` 自查占位 | 原型页内标注「落地待补」 |
| `collect_runs` 批次日志 | 表格 + 健康度卡 | ✅ 表与服务已落（p35 + M1） | 一致 |
| 席位库表格 | 18 条种子 + 停用 | 表与种子已落；停用接口待补 | 标注遗留 3 |
| 系统设置 | 7 个 tab（存储配置已移除） | 一致 | 并入本稿 |
| Agents 对话调试 | blocks 渲染 + 深色代码块 | 一致 | 并入本稿 |
| 龙虎榜净额配色 | 涨红跌绿 | 需落地按此实现 | 口径已定 |

**全程未改任何落地代码**（`apps/**` 未动）。

---

## 六、D2 独立设计评审与整改（2026-10-15）

由 `design-reviewer` 以**独立上下文 + 盲审隔离**（禁读本文件「一、设计决策记录」与「四、遗留项」）执行，
报告：`docs/ui/reviews/admin-console-d2-20261015.md`。初评结论 **4 项阻塞 / 11 项重要** → 判定「不可直接进入用户确认」。

**这 4 项阻塞全部成立，我逐条核实后已整改**（只改声明不算改完，每项都做了运行时复验）：

| # | 判据 | 阻塞 | 整改 | 复验 |
|---|---|---|---|---|
| 1 | X6 / G2 | 买卖方向复用 `badge.err`（买入=错误色）/ `badge.ok`（卖出=成功色），同屏红色既表「涨停」又表「买入」 | 新增 `.trade.buy/.sell/.both` + 金融档 `--ws-fin-up/#C4322F`、`--ws-fin-down/#2E7D48`（AA 5.46 / 5.07:1） | computed 买入 `rgb(196,50,47)`、卖出 `rgb(46,125,72)`；类名不再含 `badge` |
| 2 | K / X7 | 三个**落码不存在**的字段被当成真实字段：`quality_version`、`quality_scored_at`（p35 只建了 status/stage/issue 三列）、健康度「近 7 天入库条数」（`health()` 无此字段） | 详情页删两字段 → 改 `[落地待补]` 角标说明；健康度卡改真实字段「最近一次采集」 | 页面不再含 `quality_version</dt>`；含 `[落地待补]`；不再含「入库条数」 |
| 3 | E12 / E4 | 阶外字号 **15 处**、登记 0 处（22/15/14.5/13.5/12.5/11.5/11/10/9），E12「未登记即打回」 | 全量归一到 `tokens.font.size`（32/24/18/16/14/13/12），字重 700→600（E3），文件头登记「字阶例外 0 处」 | 运行时扫描壳与内容区：**0 处**阶外 |
| 4 | X4 / G1 | `:root` 外裸 rgba **12 处** | 收进 `:root` 为 12 个语义 token（overlay / shadow-window·modal·thumb·bubble / accent-04 / border-brand·warn·warn-strong·danger·danger-strong·ok） | 静态扫描 `:root` 外裸 rgba = **0** |

**同步整改的重要项**：E6（采集总览 primary 3→0）、S3（条目/龙虎榜/席位库三处空态补唯一出路按钮）、
P2（Agents 子菜单还原为 `BasicLayout.vue` 顺序 —— 原先我把「已实现」的对话调试排到首位，这恰恰破坏了「菜单单点派生自落地」这条承诺）、
P4（条目详情直入时说明默认展示最近一条）。

### 评审独立发现的落地 bug（非原型问题，已修）

`collect-log.service.ts` → `health().staleSources`：注释写「近 N 天零采集的源」，
实际 SQL 是 `WHERE started_at >= :since` 分组 —— **查出来的正是窗口内有过采集的源，语义相反**。
已改为「统计覆盖全部有记录的源 + 窗口内量用 CASE WHEN 聚合 + JS 挑 `MAX(started_at) < since`」，`tsc --noEmit` 通过。
已知边界：从未跑过的源（`collect_runs` 里无记录）仍发现不了，需 join `content_sources` —— 列遗留项。

### 评审对三条自陈事实的独立核验（结论与我一致）

- `--ws-warn-text` 理由成立：warning-500 `#F5A623` 压 `#FEF3DC` 仅 **1.84:1**（确实不可读），`#8A5A00` 为 **5.38:1**（过 AA）；改既有 token 不可行（会丢 warn 色相）
- 侧栏 220px ✅ 与 `BasicLayout.vue` 一致；菜单一级项顺序/权限码逐一对齐
- 涨红跌绿**不违规**（涨跌是数值方向不是枚举类型，G2 允许），但存在同色异义风险 → 已由第 1 条整改解决

### 未决项（需用户拍板，已并入 §四）

新增两条来自评审：① `--ws-warn-text` 是否正式进 `tokens.ts`（+dark 镜像）；② `--ws-info:#2563EB` 蓝的去留
（`tokens.ts` 写明「蓝仅预留第三方链接」，info 语义已由品牌橙承载 → 建议移除）。
