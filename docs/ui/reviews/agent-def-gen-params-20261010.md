阻塞: 5
重要: 12

# 设计评审报告（D2 · 原型评审）

> 关口：D2 ｜ 对象：`docs/ui/prototypes/admin-agents.html` 屏 ②（编辑弹窗「生成参数」区） + `docs/ui/page-specs/agent-def-generation-params-v1.md`
> 目标端：admin 系（桌面 Web） ｜ 判据源：`docs/ui/design-system.md` + `docs/ui/design.md` + `packages/ui/src/tokens.ts`
> 评审方式：盲审（未读生产者设计决策记录的自辩段；未修改任何原型 / 规格文件）
> 契约旁证：`docs/api/contracts.md` §7.2（C7-b/C7-c/C7-e）、§7.4（档位约定）

---

## 阻塞（必须解决，未清零不得交人确认）

### [B1] 采样策略分段选中态「白字压 #F97316」对比度 2.8:1，不过 AA；且与同屏 thinking 段用了两套选中态
- 位置：原型 L244 `.seg button.on{background:var(--ws-brand-500);color:var(--ws-on-brand)}`，DOM L496 `Temperature` 选中态
- 反例：12.5px 白字压 `#F97316` → 对比度约 **2.80:1**，既不满足正文 4.5:1，连大字 3:1 都不到；而同屏 L530 的 thinking 三段走的是另一套 `.on.plain`（`--ws-bg-active` 底 + `--ws-text-primary`，约 15:1）。同一个弹窗里两段同类分段控件，选中态一深一浅、一可读一不可读。
- 判据：[G3]（design-system §2.4，正文 ≥4.5:1）+ [P2]（§1 一致性优先于个性化）｜严重级：阻塞｜是否阻塞：是
- 建议修法：选中态统一走 "浅底 + 深字 + 品牌描边"——`background:var(--ws-brand-soft)` / `color:var(--ws-brand-700)`（tokens 有 brand[700] `#C2410C`，压 `#FFF7ED` 约 5.4:1）/ `border-color:var(--ws-brand-500)`；或直接把 sampler 段改用 `.on.plain` 口径与 thinking 段对齐。**不要**用实心 `#F97316` + 白字。

### [B2] 屏 ② 新增样式块存在裸 hex / rgba，且遮罩未引 `--ws-overlay`
- 位置（均为屏 ② 样式块 L205–265）：
  - L206 `.mask{background:rgba(23,23,23,.45)}` —— 裸 rgba；tokens 已有 `roles.overlay`（light `rgba(0,0,0,0.5)` / dark `rgba(0,0,0,0.6)`）
  - L220 `.btn.primary:hover{…color:#fff}` —— 裸 hex，应为 `var(--ws-on-brand)`
  - L262 `.toast{background:var(--ws-text-primary);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)}` —— 裸 hex + 裸 rgba 阴影
- 反例：切 dark 主题时 `#fff` 与 `rgba(23,23,23,.45)` 不会跟着翻转，遮罩与 toast 直接错位；裸阴影也绕过了 `tokens.shadow.popover`。
- 判据：[G1]（§2.4 禁裸 hex/rgba）+ [X4]（§7 反模式）+ [G8]（§2.5 阴影取既定档）｜严重级：阻塞｜是否阻塞：是
- 建议修法：遮罩改 `var(--ws-overlay)`；`#fff` 统一改 `var(--ws-on-brand)`；toast 阴影改 `var(--ws-shadow-popover)`（若 CSS 层暂无该变量，先在 `:root` 补 `--ws-shadow-popover` 并同步 `tokens.ts` / `tokens.css`，**不**在业务样式里散写）。
- 说明：壳与屏 ① 的存量裸值（L90 `.ad-desktop` 阴影 `rgba(20,30,50,.14)`、L102 `.ad-item.active` 的 `rgba(255,140,66,.04)`、L136 `.bubble.ai` 阴影）**不在本次计数**，但屏 ② 原样复制了同一套壳，建议随壳统一清理（见「建议」区）。

### [B3] 阶外字号多处且未按 E12 登记「字阶例外」
- 位置（屏 ② 新增）：`.extra` 11.5px、`.chip` 11.5px、`.tbl .id` 11.5px、`.ctrl .clear` 11.5px、`.seg button` 12.5px、`.toast` 12.5px、`.lnk` 12.5px、`.modal .mh .t` 15px
- 反例：字阶只有 h1 32 / h2 24 / h3 18 / h4 16 / base 14 / sm 13 / caption 12（`tokens.font.size`）。11.5 / 12.5 / 15 全部阶外；全文件仅 L159 的 code 块 12.5px 做了字阶例外登记，屏 ② 这批**一个都没登记**。落码时前端无从判断该取 12 还是 13。
- 判据：[E4]（§2.1 字号取字阶）+ [E12]（§2.1 阶外字号须显式登记，未登记即打回）｜严重级：阻塞｜是否阻塞：是
- 建议修法：就近归拢——11.5 → `caption 12`（`.extra`/`.chip`/`.id`/`.clear`）；12.5 → `sm 13`（`.seg button`/`.lnk`/`.toast`）；`.modal .mh .t` 15px → `h4 16`。若坚持 11.5/12.5，须在 page-spec §2 显式加一行「字阶例外登记：…（理由 + 适用元素）」。

### [B4] 预设套用不重置采样模式，会往禁用控件里写值（UI 与数据状态不一致）
- 位置：原型 JS L606–614 `preset.change` → 直接 `inTemp.value = p.temp`，未 touch sampler；而 L566–576 的 sampler 才决定 `ctrlTemp` / `ctrlTopP` 谁禁用
- 反例：用户先点「Top P」（`ctrlTemp` 变 `.off` 灰底、input disabled）→ 再选预设「分类 / 意图路由」→ `inTemp` 被写入 `0`，但界面上 Temperature 仍是**禁用灰底**、Top P 是激活态且为空。用户看到的是「选了预设没反应」，实际数据里 temperature=0 已被填上，保存即静默生效。
- 判据：[P3]（§1 状态必须可见）+ [B]（清单 B：跨状态衔接正确、状态可预期）｜严重级：阻塞｜是否阻塞：是
- 建议修法：`preset.change` 里先把 sampler 复位到 temperature（触发 `sampler.querySelector('[data-mode="temperature"]').click()`）再回填；或预设只回填「当前已激活的采样模式」对应字段，另一字段一律清空且不写值。

### [B5] 预设的 `maxTokens` / `thinking` 取值属自行脑补，契约 §7.4 未定义且未标注
- 位置：原型 JS L598–605 `PRESET`（max: 256/1500/3000/2000/2500/2000；think: off/off/inherit/inherit/inherit/inherit）与 L549 的 `.note` 档位参考
- 反例： contracts.md §7.4 只给了
  - 分类 maxTokens **256**、thinking **disabled（强制）**
  - 抽取「按字段量」、代码「≥3000」、对话「800~2000」、创意「放宽」、工具调用「按工具返回量」
  - thinking：抽取 disabled、代码「视复杂度」、对话「可开小预算」、创意「可开」、工具调用「视链路长短」

  原型给抽取填了 **1500**、创意 **2500**、工具调用 **2000**，thinking 全部填 inherit —— 这些确定值在 §7.4 **无出处**，且 `note` 只列了 temperature 六个数字让读者以为整档都有据可依。属「需求/契约未定义自行脑补且不标注」。
- 判据：[P6]（§1 未定义不脑补）+ [X7]（§7 反模式）｜严重级：阻塞｜是否阻塞：是
- 建议修法：二选一 ——（a）预设只回填 temperature（这是 §7.4 唯一有确定值的列），maxTokens / thinking 留空并提示「按场景自行设定」；（b）若确要回填，请在 contracts.md §7.4 补齐 maxTokens / thinking 的确定档位后再回填，并在原型 `note` 与规格 §1 第 5 条标注取值来源行号。**另外**：分类场景 thinking 是 C7-d 强制 disabled，预设值 off 正确但应在 UI 上标注「强制」，否则用户可改回。

---

## 重要（建议解决，不阻塞交人）

### [I1] 阶外间距遍地，未落在 `tokens.space` 阶梯
- 位置：`.row{margin-bottom:14px}`、`.grp{margin:20px 0 12px}`、`.lb{margin-bottom:6px}`、`.extra{margin-top:5px}`、`.note{padding:9px 12px}`、`.modal .mb{padding:18px 20px 4px}`、`.modal .mh{padding:14px 20px}`、`.mask{padding:34px 0 40px}`、`.ans p{margin:0 0 16px}`(16 ✓)
- 反例：space 阶梯 = 4/8/12/16/24/32/48；14 / 20 / 6 / 5 / 9 / 18 / 34 全部无法归阶梯。
- 判据：[F1]（§2.3）｜严重级：重要｜是否阻塞：否
- 建议修法：归拢表 —— 14→16（或 12）、20→24、6→8、5→4、9→8、18→16、34→32。同组统一取值。

### [I2] 组间距 = 组内间距（均 14px），层级不可辨
- 位置：`.grp{margin:20px 0 12px}` 之后，「采样策略」组（label + seg + 两个数值 row）与「输出上限 / 思考预算」组之间靠 `.row{margin-bottom:14px}` 分隔，组内 row 间距同为 14px
- 反例：三个语义分组（采样策略 / 输出上限+思考 / 预算）在视觉上是一条等距流水，看不出「哪些字段是一组」。
- 判据：[F2]（§2.3 分组间距 > 组内间距）｜严重级：重要｜是否阻塞：否
- 建议修法：组内 12px、组间 24px（或给每组套一个带 `border-top` hairline 的 `.grp-body`，用分隔线而非纯留白表达分组）。

### [I3] `.preset` 控件高 26px 不在 control 阶梯，同屏出现 26 / 32 两档控件高
- 位置：L251 `.grp .side select,.grp .side .preset{height:26px}`，同屏 `.ctrl` / `.seg button` 均 32px
- 反例：control 阶梯 sm24 / md32 / lg40，26 阶外；且它和 32px 的输入控件在同一条分组标题行附近出现。
- 判据：[E13]（§2.1 控件高度取 control 阶梯）｜严重级：重要｜是否阻塞：否
- 建议修法：取 `--ws-control-sm`(24)（它是次级控件，比主输入矮一档合理），或直接 32 与相邻控件齐平。二者择一并全文一致。

### [I4] 用 Unicode 符号当图标：✕ / ▾ / ●
- 位置：L454 `<span class="x">✕</span>`（关闭）、L461 `<span class="clear">▾</span>`（下拉）、L471 `<span class="clear">●</span>`（开关状态）
- 反例：● 被当作「流式输出已开启」的状态指示，✕ 是弹窗主关闭入口 —— 都是图标位，却用字符而非 SVG；字符的字重/基线随系统字体漂移，且 dark 下不随 token 翻转。
- 判据：[I5]（§6 admin 系图标为 SVG、尺寸 16/20/24 + stroke 1.5）｜严重级：重要｜是否阻塞：否
- 建议修法：换 tabler `x`（16）、`chevron-down`（16）；开关态改用 antd `a-switch` 或 `check` SVG，不要用圆点字符。

### [I5] Top P 禁用控件内嵌可点击的「清空」按钮，禁用语义自相矛盾
- 位置：L510–513 `.ctrl.off`（`cursor:not-allowed`）内部仍放 `<span class="clear" data-clear="inTopP">清空</span>`，且 L234 `.ctrl .clear:hover{color:var(--ws-brand-600)}` 给了可点击反馈；JS L593 的 clear 绑定不区分禁用态
- 反例：控件整体是 not-allowed、input 是 disabled，里面却有一个会变色、点了真会清空的按钮 —— 用户点之前无法预判后果。且「清空」清空一个本来就空且禁用的字段，无任何意义。
- 判据：[P4]（§1 操作必须可预期）+ [S7]（§4 禁用态须说明原因，design.md §3「禁用态」行）｜严重级：重要｜是否阻塞：否
- 建议修法：禁用态下隐藏 `.clear`（或整体 `pointer-events:none`）；禁用原因除常驻 `extra` 外，补 `a-tooltip` 挂在控件上（S7 要求 tooltip）。

### [I6] thinking 的 null 语义措辞三处漂移，其中一处是**错义**
- 位置：规格 §1 第 4 条写「沿用模型默认」；原型按钮 L531 写「沿用默认」；原型 extra L535 写「`null` = 沿用**客户端**默认」
- 反例：C7-c 的优先级是「RunInput > Agent 定义 > env `TOKENHUB_THINKING` > 客户端按模型名推断」，null 落到的是**服务端 env 或客户端推断**，不是「客户端默认」。写「客户端默认」会让实现方误以为有前端默认值兜底，直接违背 C7-e（全 null 须与旧版一致）。
- 判据：[H5]（§5 术语一致）+ [K]（与 page-spec 一致）｜严重级：重要｜是否阻塞：否
- 建议修法：三处统一为「沿用模型默认」；extra 改为「`type` 由后端按 C7-c 优先级解析；留空则不覆盖」。

### [I7] 原型未表达「保存中」状态，与规格 §3 承诺不符
- 位置：L616–622 `saveBtn` 点击后直接 `toast(...)`，无 loading、无重复提交锁
- 反例：规格 §3「保存中：按钮 loading，防重复提交」；原型作为交人确认的唯一视觉依据，看不到这个状态，用户无法确认「点了到底有没有在存」。连点会连出多条 toast。
- 判据：[S8]（§4 进行中锁重复提交 + 按钮 loading）+ [K]（与 page-spec §3 一致）｜严重级：重要｜是否阻塞：否
- 建议修法：原型补一个「保存中」态（按钮 loading + 禁用）；规格侧同步标注落码时的 saving 锁位置。

### [I8] placeholder「沿用模型默认」只加在禁用控件上，三个活跃数值控件清空后是纯空框
- 位置：L511 `inTopP` 有 `placeholder="沿用模型默认"`；L503 `inTemp` / L523 `inMax` / L542 `inBudget` 均无 placeholder
- 反例：规格 §1 第 6 条要求「保留 `null`，placeholder 显示「沿用模型默认」」。用户点「清空」后，Temperature / maxTokens / 预算三个框变成完全空白，屏幕上唯一提示只剩灰色 extra；与 Top P 的口径不一致。
- 判据：[K]（与 page-spec §1 第 6 条一致）+ [P3]（状态可见）｜严重级：重要｜是否阻塞：否
- 建议修法：四个数值控件统一 `placeholder="沿用模型默认"`。

### [I9] 原型在前端重造了值域/互斥判据并自写报错文案，与规格 §4 冲突
- 位置：L617–620 `if(t && p) toast('Temperature 与 Top P 只能填其一')`、`if(max<1||max>32768) toast('输出上限须为 1–32768 的整数')`
- 反例：规格 §4 明确「互斥与值域的**真相源在后端**…前端只做预防性禁填，**报错文案一律用后端返回的中文**」。原型把两条中文报错写死在前端，落码时极易被照抄成前端硬编码，届时后端改文案前端不同步。
- 判据：[K]（与 page-spec §4 一致）｜严重级：重要｜是否阻塞：否
- 建议修法：原型 toast 文案加注「（示意，实际取后端返回中文原文）」；落码只保留预防性 disabled，值域交给后端 `assertTuningParams()`。

### [I10] 只画 light，未标注 dark 变量回退
- 位置：全文件 `:root` 只有 light 值，无 `[data-theme='dark']` 镜像；规格 §2「涉及 Token」也未提 dark
- 反例：`design.md` §4 要求「同一 `--ws-*` 名下 light/dark 双值由 `[data-theme]` 切换；写新样式时两种主题都过目一遍」，§5 自检第 4 条要求「切 dark 无错位、无遗漏变量」。本次新增的 `--ws-brand-soft`（橙色提示底）、`--ws-bg-subtle`（禁用控件底）、`.toast`（`--ws-text-primary` 底 + 白字）在 dark 下都需镜像，原型未提供任何依据。
- 判据：[design.md §4 第 5 条 / §5 自检第 4 条]（端规范，admin 系判据源之一）｜严重级：重要｜是否阻塞：否
- 建议修法：原型补一段 `[data-theme='dark']` 变量镜像（值取 `packages/ui/src/tokens.ts` 的 `roles.dark`，**不**硬编码、不新造色），或在 page-spec §2 显式登记「dark 走 tokens 镜像，本次不新增变量」。

### [I11] 小字品牌橙对比度不足：`.note` 3.4:1、`.extra.warn` 3.6:1
- 位置：L255–256 `.note`（12px `#EA580C` on `#FFF7ED`）、L236 `.extra.warn`（11.5px `#EA580C` on `#FFFFFF`）
- 反例：12px / 11.5px 且字重 400，达不到「≥14px 且 500/600」的大字豁免，须按正文 4.5:1 判定 → 实测约 3.4:1 / 3.6:1，不达标。橙色块又是弹窗里视觉权重最高的元素之一，读不清的风险被放大。
- 判据：[G3]（§2.4）+ [G4]（§2.4 品牌橙作文本须用深档 —— 已用 brand-600 深档，但深档在小字上仍不过 AA）｜严重级：重要｜是否阻塞：否
- 建议修法：`.note` 正文改 `--ws-text-secondary`（压 brand-soft 约 7.9:1），用左侧 3px brand 竖条或 16px `info` SVG 承载「这是提示」的语义；`.extra.warn` 正文改 `--ws-text-secondary`，仅保留 warn 图标/前缀标为 brand-600。

### [I12] 弹窗内橙色块过多，与 primary「保存」争焦点
- 位置：`.grp::before` 品牌竖条、`.note` 整块 `--ws-brand-soft` 底、`.extra.warn` 橙字、`.seg button.on` 实心橙、`.chip.brand` 橙 chip —— 弹窗可视区内 5 处品牌橙
- 反例：主操作「保存」是唯一的实心橙按钮，但它被同屏另外 4 处橙元素稀释，尤其 L548 的档位参考 note 是全宽橙底块，视觉权重接近甚至超过主操作区。
- 判据：[E2]（§2.2 一屏只有一个主视觉焦点）+ [P1]（§1 信息优先于装饰）｜严重级：重要｜是否阻塞：否
- 建议修法：档位参考 note 降级为灰底（`.note.grey`，样式已存在）+ 12px 次要文本；`.chip.brand` 见下条；同屏品牌橙控制在「主操作 1 处 + 选中态 1 处」。

### [I13] 列表摘要 chip 用颜色区分参数类型（temp 橙 / max 灰 / 思考 灰）
- 位置：L429 `chip brand` 给 `temp 0.7`，`max 2048` 与 `思考 沿用` 用普通 chip；L429 vs L437 两行都在给 temperature 上橙色
- 反例：三个 chip 是同一组「生成参数摘要」，颜色编码的是**参数类型**（temperature vs 其他），而非语义状态（success/warning/error/info）。这正是 G2 禁止的类型配色。
- 判据：[G2]（§2.4 颜色只编码语义）+ [X6]（§7 类型/枚举配色）｜严重级：重要｜是否阻塞：否
- 建议修法：三个 chip 同款（统一 `--ws-bg-subtle` + `--ws-text-secondary`）；如需突出「已配置 vs 全部沿用默认」，用「有值 = 实底 chip / 未配置 = 虚线 chip」这种**状态**差异表达，而非按参数类型上色。

---

## 建议（无判据或判据较弱的个人偏好，可驳回）

- **F4｜数值输入与列表 chip 未开 `tabular-nums`** —— `.ctrl input` 与 `.chip` 已用 mono 字体（等效等宽），但显式加 `font-variant-numeric:tabular-nums` 更稳。标注：判据 [F4] 适用度弱（mono 已覆盖），属个人偏好。
- **A1/A2｜列表「生成参数」列未打锚点** —— 屏 ② 只有 `data-dr="agent-def-list"` 打在整表上，本次新增的列没有独立锚点，D3 比对时会漏。建议补 `data-dr="agent-def-list-genparams"`。标注：判据 [A1] 只要求「关键结构」，此列是否算关键结构由人裁决，属个人偏好。
- **H4｜错误文案缺具体动作** —— 「Temperature 与 Top P 只能填其一」说了问题，但没说怎么办；建议补「请清空其中一个后重试」。标注：[H4] 判据成立但满足度临界，可驳回。
- **S3｜列表行内「全部沿用默认（未配置）」无出路** —— 建议加「· 编辑配置」，把这句变成可点链接。标注：表格单元格级空态，[S3] 针对页面空态，适用度弱，属个人偏好。
- **「采样策略」这层抽象是否必要** —— 现在流程是「先选 Temperature/Top P 模式 → 再填值」，多一层间接。直接在两个输入框上做「填了一个就禁用另一个」可能更短。标注：**无判据编号，属个人偏好**，且当前做法符合 M2 豁免（见下方「通过项」）。
- **壳的存量裸值建议随壳一起清** —— `.ad-desktop` 阴影 `rgba(20,30,50,.14)` + `border-radius:14px`（14 也不在圆角档 4/6/8/9999，[G7]）、`.ad-item.active` 的 `rgba(255,140,66,.04)`、`.bubble.ai` 阴影。屏 ② 复制了同一套壳，但这些属屏 ① 存量，本轮不计数。标注：非本次新增，是否并入本轮整改由人裁决。
- **「新建 Agent」入口在屏 ② 缺失** —— 列表页只有「编辑」，无新建主操作。若列表页不在本次范围，建议在原型注明「新建入口不在本屏范围」。标注：无判据，属个人偏好。

---

## 通过项

- **A1/A2 锚点覆盖**：屏 ② 打了 11 个 `data-dr`（`agent-def-edit-modal` / `gen-params-group` / `gen-params-sampler` / `gen-params-temperature` / `gen-params-topP` / `gen-params-maxTokens` / `gen-params-thinking` / `gen-params-thinking-budget` / `gen-params-preset` / `agent-def-save` / `agent-def-list`），覆盖关键结构、未逐元素滥打 ✓ [A1/A2]
- **E6 一屏 primary ≤1**：弹窗 footer 仅「保存」为 primary；列表页无 primary ✓ [E6 / design.md §2-1]
- **M2 组件选型合规**（团队重点问项）：`a-radio-group` 表达「二选一 / 三态」**符合规则** —— design-system M2 与 design.md §2 第 10 条的强制范围是「**页面主导筛选维度**」，而「表单内选择字段 / 复合查询表单」明列豁免（R6 澄清）；采样策略与思考预算都在 a-modal 表单内，故用 radio-group 不需改 tabs。横向空间核算：thinking 三段（沿用默认 / 关闭 / 开启并限预算）在 353px 列宽内约 240px，不溢出 ✓ [M2 / design.md §2-10]
- **S9 无弹窗嵌套**：屏 ② 只有一层 modal ✓ [S9]
- **G7 圆角语义档一致**：chip→`--ws-radius-sm`(4)、control/seg/btn→`--ws-radius-md`(6)、modal/table→`--ws-radius-lg`(8)，同层级一致 ✓ [G7]
- **G8 分隔与阴影**：modal 头/脚用 `1px solid var(--ws-border)` hairline；modal 阴影取 `--ws-shadow-card`，未自造 ✓ [G8/G9]
- **G11 焦点态**：全局 `:focus-visible{box-shadow:var(--ws-focus-ring)}`，seg button / input / select 均可键盘到达 ✓ [G11]
- **E10 正文与强调分离**：弹窗内无长文正文；label 用 `--ws-text-primary`、extra 用 `--ws-text-tertiary`、表头用 `--ws-text-secondary`，分档正确，未出现整段 textPrimary 压浅底 ✓ [E10]
- **H1 按钮动词开头**：「保存 / 取消 / 清空 / 按场景套用」均为动词 ✓ [H1]
- **G2（局部）**：模型 chip、标识 ID 用中性灰，未给「模型类型」配色 ✓ [G2]（仅列表摘要 chip 例外，见 I13）
- **B 主路径闭环**：弹窗回填 → 编辑 → 保存 → toast 反馈 → 关闭（✕ / 取消）路径完整 ✓ [B]（仅预设分支有状态错乱，见 B4）
- **与既有表单口径一致**：屏 ② 沿用 `AgentDefList.vue` 现况结构（模型 / 最大步数 / 流式输出 三列 `.row`，label + control + extra 三段式），新增分组插在 System Prompt 之上，未自创骨架 ✓ [A / design.md §1]
- **预设档位与契约的一致性（temperature 列）**：PRESET 的 temp（0 / 0.2 / 0.2 / 0.7 / 0.9 / 0.3）与 contracts.md §7.4 的区间（0~0.1 / 0~0.2 / 0~0.2 / 0.6~0.7 / 0.8~1.0 / 0.2~0.4）全部落在区间内；分类 maxTokens 256、代码 ≥3000 也与 §7.4 一致 ✓ [K]

---

## 结论

❌ **阻塞**（5 项阻塞未清零，退回 `ux-prototype-designer` 重出）

阻塞集中在三处硬伤：**可读性**（B1 选中态 2.8:1）、**可落地性**（B2 裸色 / B3 阶外字号未登记，落码时无依据）、**正确性**（B4 预设写入禁用控件、B5 预设档位源自脑补且违反 C7-d 的强制项）。其中 B4 / B5 不是视觉问题而是**数据与交互语义错误**，优先级最高——原型是交人确认的依据，照此稿确认会把错误档位写进契约认知。

12 项重要里，I6（「沿用客户端默认」错义）和 I9（前端重造判据）同样有语义风险，建议与阻塞项一并处理后再交人；其余为一致性 / 密度 / dark 回退类，可在落码前消化。

## 质疑回流

- → `ux-prototype-designer`：**退回重出**。必改 B1–B5；建议同批消化 I1 / I2 / I3 / I5 / I8（改量小、与阻塞项在同一片样式区）。重出时请勿改动屏 ①。
- → `requirement-translation` / 契约侧：B5 需要澄清——**contracts.md §7.4 是否要为 `maxTokens` / `thinking` 补确定档位**？若要补，请先改 §7.4 再回填预设；若不补，预设应只回填 temperature。另需澄清：**分类场景的 thinking 是否应在 UI 上锁死为 disabled**（C7-d 强制，当前原型允许改回 inherit）。
- → `rd-execute`（D3 预警）：B2 的 `--ws-overlay` / `--ws-shadow-popover` 若 CSS 层尚无变量，落码时须先在 `tokens.ts` ↔ `tokens.css` 双写并同步，不得在业务样式里散写 rgba。

## 待用户裁决

1. **阻塞计数是否接受**：B3（阶外字号）与 B2（裸色）严格按 E12 / X4 属「打回」级；若本仓库对原型稿的容错更宽松，可整批降为重要，B1 / B4 / B5 不建议降。
2. **I13 列表 chip 配色**：temperature 上橙是否是有意的「重点参数」表达？若是，请给一个非「类型配色」的替代口径（如实底/虚线区分已配置与否）。
3. **B5 的处置方向**：预设只回填 temperature（保守） vs 补 §7.4 后全量回填（完整）—— 需要产品 + 契约侧共同决定。
4. **I10 dark 回退**：本轮是否要求原型出 dark 稿，还是「登记变量镜像 + 落码时验证」即可。

## 复检（第二轮）

复检阻塞: 2
复检重要: 1

> 复检范围仅限首轮两份报告的 8 个阻塞项，并对指定主路径做浏览器实操；不重新全审。`部分` 按未清零计入复检阻塞。

| 阻塞项 | 结论 | 证据 |
|---|---|---|
| 设计 B1 · 采样策略选中态对比度与同窗两套口径 | 已清零 | 屏②两组控件共用 `.seg button.on`，统一为 `--ws-bg-active` + `--ws-text-primary`，不再使用品牌橙底白字（`admin-agents.html:243-250`）；采样与 thinking DOM 均使用同一 `.seg`（`:509-512`、`:545-549`）。 |
| 设计 B2 · 屏②业务样式裸 hex / rgba | 已清零 | `.mask`、primary hover、toast 字色/阴影已分别改用 `--ws-overlay`、`--ws-on-brand`、`--ws-bg-surface`、`--ws-shadow-float`（`:209-223`、`:266-270`）。原型根变量中暂存的 token 定义位于 `:root` 且标注待入包（`:59-61`），未再散落于屏②业务规则。 |
| 设计 B3 · 11.5 / 12.5 / 15px 阶外字号 | 已清零 | 屏②新增列表、弹窗、分段、提示与 toast 仅使用 12 / 13 / 16px（`:189-269`），原阻塞所列 `.extra/.chip/.id/.clear/.seg/.toast/.lnk/.modal .t` 均已归阶。 |
| 设计 B4 · 预设写入禁用的 Temperature | 已清零 | 预设变更先解锁采样器并点击 temperature，再回填数值（`:663-675`）；payload 又按当前 mode 裁剪（`:689-702`）。浏览器从 Top P 态套预设后，采样模式回到 temperature，禁用框不再被静默写穿。 |
| 设计 B5 · 预设取值无出处；分类 thinking 应强制 disabled | 部分 | 取值表已收敛为有据项：分类 256、代码 3000，其余无据 max 留空（`:655-662`），此半已清零；但分类分支先给 `thinkSeg` 加 `locked`，再程序点击 `off`（`:677-681`），而 thinking 点击处理器遇 `locked` 直接返回（`:630-632`）。浏览器实操结果：选项仍为 `inherit`、三个 button 的原生 `disabled` 均为 false、payload 为 `{"temperature":0,"maxTokens":256}`，没有 `thinking:{type:"disabled"}`；仅说明文字声称已锁为关闭，数据与文案相反。 |
| 交互 B1 · 互斥残留值不可见及静默提交 | 已清零 | 切换模式会清空另一项并在 extra 回显（`:598-613`），payload 仅取当前模式（`:690-702`）。浏览器默认态切到 Top P 后直接保存：Temperature 值为空且 disabled，预览及保存时均为 `{"maxTokens":2048}`，未带出 `temperature=0.7`。 |
| 交互 B2 · 保存中态缺失、重复提交未锁 | 已清零 | 保存入口先检查 `saveBtn.disabled`，随后立即置 disabled +「保存中…」，900ms 后恢复（`:708-723`）。浏览器连续触发两次 click，仅产生 1 次成功 toast；期间按钮为 disabled，重复提交被锁。 |
| 交互 B3 · 校验失败违反规格、无字段态、toast 仅靠颜色 | 部分 | 字段红边和行内错误已补（`:724-732`），但仍由前端正则/范围条件决定并写死两套中文文案（`:712-716`、`:727`）；toast DOM 无 `role="alert"` / `aria-live`（`:458`），成功与失败的结构差异仍只有圆点颜色（`:735-740`），且字段错误 2.6s 后自动消失而非持续到用户修改。浏览器输入 `maxTokens=0` 可复现：红边/行内错误存在，但 `role`、`aria-live` 均为 null。 |

### 指定路径实操

| 路径 | 实际结果 |
|---|---|
| 默认态 → Top P → 不填直接保存 | 预览与保存 payload 均为 `{"maxTokens":2048}`；Temperature 已清空，不会带出去。 |
| 选择「分类 / 意图路由」预设 | select 保留 `cls`，Temperature=0、maxTokens=256 可见；thinking 外观被锁但选中值仍是 `inherit`，payload 缺少强制 `disabled`，因此不通过。 |
| 点击 Temperature「沿用默认」 | value 变空，placeholder 显示「沿用默认」，预览同步变为 `{"maxTokens":2048}`；再清空 maxTokens 后预览为 `{}`。 |
| 保存按钮连续点击两次 | 第一次立即进入 disabled +「保存中…」，第二次被拦；900ms 后仅出现 1 次成功反馈。 |

### 新阻塞扫描

- 未发现超出上述残留的新增阻塞：屏②业务规则无裸色值；无 11.5 / 12.5 / 15px 阶外字号；可见图标已改 SVG；无新增 `!important`（`:271` 仅为注释）；屏②仅 1 个 primary 按钮（`:581`）。
- **复检重要 1 项（非新引入，属首轮 I1 残留）**：规格声称间距已归拢到 4/8/12/16/24/32（`agent-def-generation-params-v1.md:45-49`），原型屏②仍有弹窗水平 padding 20px（`admin-agents.html:213-217`）和采样标题 margin-top 2px（`:508`）。该项维持「重要」，不升级为本轮新阻塞。

### 总结

8 个首轮阻塞项中，6 个已清零，2 个仅部分清零。当前仍不满足「阻塞清零」：一是分类预设锁住了错误的 thinking 状态，提交内容没有 C7-d 要求的 `disabled`；二是校验失败链路仍保留前端自撰判据/文案且缺少可访问的错误告警语义。修复前不建议将第二轮结论改为通过。

---

## 复检修复后实测（第三轮 · 2026-10-10）

复检阻塞 2 项已修，并用**无头浏览器真点一遍**确认（非静态阅读代码）。

| 项 | 修法 | 实测结果 |
|---|---|---|
| 分类档 thinking 锁死失效 | 顺序改为「解锁 → 切换 → 上锁」（原为先上锁再 click，被 locked 拦截） | ✅ thinkSeg 选中 `off` / payload 含 `thinking:{type:"disabled"}` / 锁死后点击「沿用默认」无效 |
| 前端自造值域判据与文案 | 改 `fakeSave()` 模拟后端响应；字段红边与文案取自后端返回；toast 补 `role="alert"` + 文字前缀 + 关闭按钮 + 错误常驻 | ✅ toast 显示「保存失败：输出上限须为 1–32768 的整数」/ 字段红边 / role=alert / 错误不自动消失 |
| 间距未归阶（重要） | 屏② 20px→24px、2px→4px | ✅ |

回归脚本：`scripts/verify-ui-prototype.mjs`（11 项断言，全部通过）。
结论：**阻塞清零**，交人审确认。
