# 表单控件与开关规范（v1）

> 版本：**v1.3 生效（2026-10-29，§9 全部拍板「按建议来」）** ｜ 适用端：**admin 系内部工具**（admin / deploy-console / mcp-admin）｜ 不适用：C 端品牌端（`ui-design-spec.html` / brand-interface，Claymorphism 那套）
> 定位：**跨页控件规格**——补齐 `design.md` §2 与 `design-system.md` §3.1（M1–M6）没写透的「控件选型判据」。本文件只回答**选什么控件、什么算合规**，不抄数值（数值一律引 `packages/ui/src/tokens.ts`）。
> 判卷格式：每条结论都写成 **场景 → 用什么 → 判定阈值 → 反例**，评审可直接编号引用（B1/C1/L1…）。
> 决策处理：与 `page-specs/agent-def-detail-v2.md` §3.2 的差异**不改 page-spec**，统一列在 §9；§9 已于 2026-10-29 22:30 由用户拍板「按建议来」，现为**决策记录**（非待办）。
> 触发来源：2026-10-29 调参面板（Agent 定义详情页）暴露的三类「没有规范所以各写各的」——三态布尔无规范、label 对齐散落、同页两种表单布局。
> 修订记录：**v1.0 → v1.1（2026-10-29，lead 抽验后修正）**——① Penzo 链接与数据口径改按原文（`2006-07-12`）；② 事实源改引 **ant-design-vue 4.2.6 源码行号**（本仓不用 React 版 antd）；③ §4.1/§4.2 的 E1↔E2 矛盾消解为「显式例外」；④ §3.4 补「配套三件（缺一即失效）」+ ① 限定 horizontal 上下文；⑤ §3.1「≤575px 自动上置」**确认成立并补全证据链**（`:380` 的 `screenXSMax` token 断点 → `makeVerticalLayout`，对所有 layout 生效；中途曾误判为不存在，教训见 §8 说明 3）；⑥ §3.3 84px 重算（`overflow:hidden + nowrap` 会直接裁字）、§3.5 折行口径收口；⑦ §6.3/§7 新增「3 条 label 超 L3 上限、折行补丁即违规」判定；⑧ README 小节号更正（§1→§2）。
> 修订记录：**v1.1 → v1.2（2026-10-29，§8 全部 18 条来源实测后修正）**——① **第 7 条删掉 v1.0 的段数口径**（把 Apple 对 radio 的 "two to five" 误用到 segmented 上；segmented 实为「≥2 段 + 上限约 5–7 / iPhone 约 5」），§2.2 C3 同步；② **第 8 条删掉 v1.0 编造的那句「开关不该与提交按钮同页」**（SLDS 两页原文都没有），改引「When Not to Use」三句 + 组件参考页「只用于单字段表单」；§1.2 B2 同一处伪造引用一并删除换成原话；③ 第 17 条日期改 **2024-12-12** + SC 原文照抄 + 「可见 / placeholder 不足」标注为推论；④ 第 3/4/6/10/11/14/15 条软化表述或修日期；⑤ URL：第 5 条换 m3 域名（原域名 301 跨域）、第 9 条补 `/guidelines`、第 8 条补 zeroheight 正文深链；⑥ §8 新增说明 4（JS 渲染站点「抓不到≠不存在」）+ 说明 5（核查状态）；⑦ 新增 3 条外部证据：Apple「don't replace a checkbox with a switch」+「use a checkbox instead… hierarchy of settings」（§1.2 B2）、Atlassian「禁用须说明原因」（§5.2 S2）、antd Switch `valuePropName="checked"` 技术旁证（§1.2 B2）；⑧ §4.2 加「证据说明」（NN/g #5/#6 反向力，不改编判据）、§9-2 标注 **C 依据最强**（仍不代选）。
> 修订记录：**v1.2 → v1.3（2026-10-29 22:30，用户拍板「按建议来」后入库）**——① **§9 由「待拍板差异清单」转为「决策记录」**：四条全部落定（label 右对齐已落地 PR #492 → `5e3164a7`；placeholder **取 C**；thinking 文案统一「跟随默认/开启/关闭」；`design.md` §2-10 确认不冲突），另含 README 登记 1 条；② **§3.4 补「已实测的坑」**：`justify-content: flex-end` 若不加 `@media (min-width: 576px)` 守卫，`<576px` 自动上置时 label 会被推到行尾（落地时实测发现，PR #492 已按守卫实现）；③ 文件头「冲突处理」改为「决策处理」，版本状态由**草案**改为**生效**；④ `docs/ui/README.md` §2 加本规范索引行。

---

## 0. 一页速查（评审先看这张表）

| # | 场景 | 用什么 | 一句话判据 |
|---|---|---|---|
| B1 | 二态、随表单保存 | **Checkbox**（"否"有后果 → 是/否 RadioGroup） | 页面上有「保存」且该字段也进保存 → 只能是 Checkbox / Radio，**不能是 Switch** |
| B2 | 二态、立即生效 | **Switch** | 无保存按钮、变化立刻落库并可回滚 → Switch；有保存按钮 → Switch 即违规 |
| B3 | 可空布尔（未配置 / 开 / 关） | **三选 RadioGroup（显式「跟随默认」项）** | 必须有一个显式可见的「跟随默认」选项，不靠留空表达 |
| C1 | 多选一 2–5 项 | **RadioGroup**（竖排优先） | ≤5 项且互斥、要一眼看全 → Radio |
| C2 | 多选一 6–15 项 | **Select** | >5 项，或任一文案 >10 半角字符，或需搜索 |
| C3 | 视图/范围切换 | **Segmented** | 切换后同一区域内容变化 → Segmented；**表单字段 → 永远是 RadioGroup** |
| L1 | label 位置 | 桌面编辑页**左置定宽**；窄屏/超长 label **上置** | 窄屏由 ant-design-vue **自动切上置**（`:380` 的 `@media (max-width: screenXSMax=575px)` → `makeVerticalLayout`，对 horizontal 也生效），**不要手写媒体查询** |
| L2 | 同页混用 | **允许**（跨卡片）**禁止**（同卡片内） | 三个条件同时满足才允许，见 §3.2 |
| L3 | label 宽度 | **84px**（≈5 汉字） | >5 汉字 → 缩短或上置，禁止在 84px 里折两行 |
| L4 | label 对齐 | **右对齐**（2026-10-29 拍板） | 与控件间距 ≥12px；同页禁止 left/right 混用 |
| E1 | 空值表达 | placeholder 只写格式/单位/示例；**空值语义是 hint 的独占领域** | hint 里出现「留空 = …」→ placeholder 不得写「未配置」；语义占位只在 §4.1 的例外条件下允许 |
| E2 | 空 = 期望状态 | **首选** placeholder 写示例或留空、语义全交 hint；**无示例值可写时**才用「跟随默认」，且必须与 hint 成对（§4.1 例外） | 「未配置」读作"没配好"，只在无兜底语义时用 |
| S1 | 错误 | 字段红边 + 字段下红字；全局仅一处汇总 | 文案 = 哪里错 + 怎么改；后端原文优先 |
| S2 | 禁用 vs 只读 | 禁用=不可用（须说明原因）；只读=可读不可改（文本/readonly） | 计算值、预览值用**只读**，禁用灰化会让人以为数值坏了 |

---

## 1. 布尔与「可空布尔」

### 1.1 B1 · 纯二态、随表单提交 → Checkbox

**判定**：页面上存在「保存 / 提交」按钮，且该字段的值随这次提交一起落库 → **单个 Checkbox**（"否"有后果、需要用户明确回答 → 是/否 RadioGroup）。

**依据**（多家一致，是业界共识）：

- Ant Design Switch 文档原文：「和 Checkbox 的区别是，切换 switch 会直接触发状态改变，而 checkbox 一般用于状态标记，需要和提交操作配合」。
- NN/g《Toggle-Switch Guidelines》(2018)：表里明确 radio / checkbox / single checkbox 的 "When does the selection take effect? → **After a user clicks a submit button**"。
- Atlassian Toggle：「For options that require a button press to apply the setting, use a checkbox.」
- Carbon Checkbox：「checkboxes represent one input in a larger flow which usually requires a final confirmation step」。

**反例（本仓真实存在，需整改）**：`apps/admin/src/views/UserList.vue:204-206` ——「状态」在"确认创建 / 保存修改"的弹窗表单里用了 `a-switch`。用户切了开关，视觉已变，但点「取消」后并不会落库——这正是 Switch 在提交型表单里的典型误导。

### 1.2 B2 · 二态、立即生效 → Switch（三个前提缺一不可）

**判定**：① 该字段**不随**页面的保存按钮提交（独立接口、改完即存）；② 变化可立即观察（行内状态、开关文案）；③ 失败有回滚与提示。

**禁用条件**（命中任一 → 禁止 Switch）：页面存在「保存」按钮且该字段也在提交范围内；字段需要 `required` 或错误校验（Switch 没有错误态）；操作不可逆或有重大后果。

**依据**：

- **NN/g (2018)**，两句原话：①「If you're considering including toggles in long forms where other types of form fields are present, and users will need to click a *Submit* button for other changes to take effect, don't.」②「**Separate controls that produce instant results from those that require clicking a command button.**」——② 才是「开关别和提交按钮放同一页」这句话的**真正出处**（v1.0 曾误挂到 SLDS 名下，v1.2 已纠正到本条）。该文还有一张表直接写明四类控件「When does the selection take effect?」：Radio / Checkbox / Single Checkbox = `After a user clicks a submit button`，**Toggle Switches = `Immediately`**——这是本规范 B1/B2 分野最凝练的一条外部依据。
- **SLDS 2 Checkbox Toggle**：「When you switch a toggle on or off, the change for that item should save immediately.」+ 组件参考页原话：**「a toggle is self-contained and is designed to be used in a form with only one field」**——这条最直接：SLDS 把 Switch 限定在**单字段表单**，多字段就是选错控件了。
- **Apple HIG Toggles**：「**In general, don't replace a checkbox with a switch.** If you're already using a checkbox in your interface, it's probably best to keep using it.」——目前找到的最强外部依据，比我们自己的转述硬。
- Shopify Polaris Switch：「For selections that require explicit submission, use checkbox instead.」并明确「Switch doesn't support error or required props」。
- Atlassian Toggle：「Toggles should never require people to press a button to apply the settings.」
- **技术旁证（antd / ant-design-vue Switch FAQ）**：`Form.Item` 默认把值绑到 `value`，而 **Switch 的值属性是 `checked`**，必须写 `valuePropName="checked"` 才进表单 —— Switch 的绑定值模型天生是「开关态」而非「随表单提交的字段值」，从实现层印证「页面上有 Save 就别用 Switch」。

**合规反例对照**：`KnowledgeCollectionsPage.vue:40-45`、`ContentPipelines.vue:204` 的表格行内开关是**合规**的（独立接口即时切换、失败可回滚），不要因为要"统一"而把它们改成 Checkbox。

### 1.3 B3 · 可空布尔（继承 / 跟随默认）→ 唯一推荐：三选 RadioGroup

这是本次最需要的一条。**结论：三态一律用 RadioGroup，三项并列，其中「跟随默认」是一个显式选项，不靠"留空"表达。**

```
thinking
  ○ 跟随默认      ← 显式选项（值 = null）
  ○ 开启          ← 值 = enabled
  ○ 关闭          ← 值 = disabled
  留空即按优先级链决定：带工具强制开启 > 任务级显式 > 本配置 > 环境变量 > 形态默认
```

**为什么必须是显式选项**：radio group 一旦选中就无法回到"未选"（NN/g 对 radio 的既有结论；GOV.UK 同样要求把 "none" 做成显式项）。靠"留空=继承"在 radio 形态下**不可达**——用户点过「开启」就再也回不到「未配置」。

**为什么排除另外四种做法**：

| 做法 | 为什么排除 | 反例 |
|---|---|---|
| Select 带「跟随默认」项 | 3 个选项却藏在一次点击之后，违反 §2 阈值（≤5 应全部可见）；三态语义靠下拉最难扫读。仅当选项 >5 才轮到 Select | 把「跟随默认/开启/关闭」做成下拉，用户要展开才知道有"继承"这回事 |
| Switch + 二级「继承」开关 | 双开关 = 双否定（"关闭继承"？），读屏与心智负担翻倍；无任何主流设计系统采用 | 「使用默认 [开] / 思考 [关]」——用户无法判断思考到底开没开 |
| 三态 Checkbox（indeterminate） | indeterminate 是**"部分选中"的聚合语义**（Apple HIG 用于父子联动、Carbon/antd 同），用户无法直接点达该态，读屏念不出"继承" | 用半选表示"跟随默认"，用户以为是三个都选了 |
| 纯"留空 = 继承"（无显式项） | 见上：radio 不可清空；且空白本身无信息（NN/g：placeholder/空值不能承担语义） | 输入框留空 + hint 写「留空=继承」，用户不知道现在到底是继承还是漏填 |

**三态出现的门槛**（不要为了"灵活性"造三态）：只有当"未配置"与"显式开/关"**行为真的不同**、且用户能理解差异时才允许三态；后端只有二态 → 用 Checkbox（提交型）或 Switch（即时型）。

**三态摆放**：横排一行（3 项 ≤5）；**默认项排第一**；每项文案 ≤6 汉字；控件下方 hint 解释"跟随默认"落到哪；不得用 Switch 拼三态、不得用 Segmented（见 C3）。

**文案**：写**状态**不写实现枚举。✅「跟随默认 / 开启 / 关闭」；❌「未配置 (NULL) / enabled / disabled」（后者把 API 值暴露给业务用户，违反 H5 术语一致与 page-spec §3.2「label 用业务词不用字段名」）。

### 1.4 「三态到底该不该出现在表单里」

允许，但必须同时满足：① 三态语义对业务用户可解释（能用一句 hint 说清"跟随默认"是什么）；② 三态都能被用户直接点到（radio 三个可点项）；③ **运行时会纠正用户选择时必须当场说明**（如"带工具 agent 选关闭不会生效，运行时强制开启"）——不能只在保存后才纠正。第 ③ 条对应我们 thinking 的"误配红字警示"，形态是对的（详见 §6.1）。

---

## 2. 多选一：Radio / Segmented / Select

### 2.1 C1/C2 · 选择阈值（本仓统一口径）

| 条件 | 结论 |
|---|---|
| 2–5 项，互斥，需一眼看全 | **RadioGroup**（默认竖排；≤3 项且每项 ≤4 字可横排） |
| 6–15 项 | **Select**（字段次要/空间紧）；若"必须一览"且空间充足，可 RadioGroup 竖排 |
| >15 项 | **Select + showSearch**（combobox）；熟悉且可输入的值优先考虑直接输入框 |
| 任一选项文案 >10 半角字符（≈5 汉字） | 不用**横排** Segmented，改 RadioGroup 竖排或 Select |
| 选项动态加载 / 来自接口 / 需搜索 | **Select** |
| 选项是"视图/范围"而非表单值 | **Segmented**（见 C3） |

**为什么取 5 而不是 7**：业界阈值有分歧——NN/g《Does Your Form Really Need a Dropdown List?》(2026-07-17) 汇总：**USWDS 建议 <7 项用 radio，Material 3 取 6，Carbon 取 3**；NN/g 自己另一篇《Listboxes vs. Dropdown Lists》(2020) 取 **5**（"5 or more items → 用 listbox/dropdown；5 or fewer → radio/checkbox"）。我们取 **5**，与既有 `design.md` §2 第 10 条（「≤5 且固定 → tabs/radio-group，select 仅用于 >5 / 长文案 / 需搜索」）保持**单一口径**——两套阈值比阈值本身取几更糟。

### 2.2 C3 · Segmented 的适用边界（这条决定 thinking 用什么）

**定义**：Segmented 是**视图切换控件**，不是表单录入控件。判据只有一条——**切换后同一区域的内容/视图是否跟着变**。

- Ant Design Segmented 何时使用原文：「用于展示多个选项并允许用户选择其中单个选项；**当切换选中选项时，关联区域的内容会发生变化**」。
- Material 3：segmented buttons「help people **select options, switch views, or sort elements**」，用于 **2–5 项**的简单选择（M3 Expressive 2025-05 起已标为「no longer recommended」，原文「**Use a connected button group instead**」）。
- Apple HIG：分段控制用于「**closely related choices that affect an object, state, or view**」；数量**至少 2 段**，上限是「宽界面不超过约 5–7 段、iPhone 不超过约 5 段」（原文 "Aim for no more than about five to seven segments in a wide interface and no more than about five segments on iPhone"）。
  ⚠️ **易记错点**：「2–5」是 Apple 对 **radio buttons** 的表述（HIG **Toggles 页 → macOS → Radio buttons 小节**："groups of two to five"），**不是** segmented 的。我们 v1.0 就是在这里把两页内容串了，v1.2 已纠正。

**允许**：列表/看板视图切换、时间范围（日/周/月）、图表维度、排序方式。
**禁止**：提交型表单里的字段（含枚举、含三态）。视觉想要"胶囊分段"时，用 **`a-radio-group option-type="button"`**——它是标准表单控件（参与 form 值、有 name/role、能配校验），长得像分段但不是 Segmented。

**为什么表单字段不能用 Segmented**：它不进入表单值模型（`a-form` 拿不到它的校验/required），**没有"未选中"视觉**（总有选中项，会让人误以为"已经设置过"），也没有错误态。

**反例**：把 thinking 三态做成 `a-segmented` → 出现"跟随默认"时用户看起来仍是"已选一项"，且无法与表单校验联动。

### 2.3 Select 的必须条件

满足任一即用 Select：选项 >5、任一文案 >10 半角字符、需要搜索/动态加载/分组选项。**其余情况不要用 Select**（隐藏选项 = 多一次点击 + 信息味淡）。

---

## 3. label 与对齐

### 3.1 L1 · 位置：左置 vs 上置

| 场景 | 结论 | 依据 |
|---|---|---|
| 桌面 admin 编辑/设置页（字段 ≥4、需纵向扫读、值列要齐） | **左置定宽** | 扫读优先；且值列对齐后便于比对 |
| 窄屏（<576px） | **上置** | ant-design-vue 4.2.6 **会自动切，不要手写媒体查询**。证据链：`es/form/style/index.js:380` 是 `@media (max-width: ${token.screenXSMax}px)` → `makeVerticalLayout(token)`；该函数（`:337-356`）把 `${formItemCls}-label` 与 `-control` 都设成 `flex: 0 0 100%` + `flexWrap: wrap`（= 各占满一行 = 上置）；这段挂在 `genVerticalStyle` 的**顶层返回对象**（`:357` 起），由 `:411` 的 `genComponentStyleHook` **无条件导出** → **对所有 layout 生效，不只 vertical**；`screenXSMax = screenSM - 1 = 575`（`es/theme/util/alias.js:29` `screenSM = 576`、`:125`）。⚠️ **判框架行为别 grep 字面量**：断点是 token 计算式，`es/form/**` 里搜不到 `575` 或 `max-width` 字样 |
| label >5 汉字且无法缩短 | **上置** | 84px 装不下，折行更差（见 L3） |
| 单列表单、追求填写速度（注册/登录类） | 上置 | Penzo (2006) 眼动研究：顶部对齐最快（少一次横向注视） |

### 3.2 L2 · 同页允许混用吗？

**允许跨卡片，禁止同卡片内。** 三个条件必须**同时**满足：

1. 分属**不同卡片/分组**，有明确视觉边界；
2. 两组**职责不同**（如"基础配置"以长文本为主 vs "高级参数"是参数网格）；
3. 两组 label 的**对齐方式一致**（都右对齐，见 L4）。

同一卡片内混用 → 控件左缘参差，扫读断线，判**不合规**。

> 现实依据：`AgentDefDetail.vue:42` 基础配置是 `layout="vertical"`（label 在上），`AgentTuningPanel.vue` 是 `horizontal` + 84px（label 在左）。按本条：跨卡片 + 职责不同 → **允许**；但当前高级卡 `label-align="left"` 不满足第 3 条 → 待整改后合规（§6.3）。

### 3.3 L3 · 定宽 84px 的由来与上限

- **由来**：84px 是 `labelCol` 的**列宽**（不是文字宽）。13px 字号下汉字约 13px/字 → 5 字 = 65px、6 字 ≈ 78px、**7 字 ≈ 91px 已溢出**。按 §3.4 配套三件 ③，12px 间距放在**列外**（`column-gap`），所以列内理论可用 ≈84px；但两个因素要留余量：① `.ant-form-item-label` 是 `overflow: hidden; white-space: nowrap`（`es/form/style/index.js:123-125`，ant-design-vue 4.2.6）→ 超宽**直接裁字、连省略号都没有**；② 若 `::after` 残留没清（见 §3.4 ②）还要再吃 10–13px，实际只剩 ~71px。
- **上限判定**：**≤5 个汉字 / ≤10 个半角字符** 用左置 84px（5 汉字 = 65px，留约 19px 余量）；**6 字是刀尖、7 字必被裁**；**超过 5 字 → 缩短为业务词（首选）或改上置**。
- **禁止**：在 84px 里折两行。反例：「输出上限 maxTokens」（5 汉字 + 空格 + 8 半角）实际折两行；「最大步数 max_steps」同理。改为「输出上限」「最大步数」，字段名进 extra/规格（page-spec §3.2 已有此规则，本规范把它升为跨页硬判据）。另注：antd FormItem 默认 `nowrap`、**不会**自己折行，出现折行就说明用了自定义栅格类（page-spec §3.2 的 `.flb/.fld`）或手动开了 `labelWrap`——两种实现都别越过本判据。
- **label 命名**：业务词，不写字段名/英文枚举/契约代号（如 `C7-b`）。

### 3.4 L4 · 文字对齐：右对齐（2026-10-29 用户拍板）

```
┌──────────────────────────────────────┐
│       Temperature  [ 0.7          ]  │  ← label 右缘贴控件（proximity）
│            输出上限  [            ]  │  ← 控件左缘严格对齐（84px 定宽）
│              Top P  [            ]  │
└──────────────────────────────────────┘
        84px 定宽        ≥12px 间距
        （占位文案本身见 §4.2 与 §9-2，本图只示意对齐）
```

**依据（两条独立证据都指向右对齐）**：

1. **框架默认（源码级，非文档）**：本仓用 **ant-design-vue 4.2.6**，`es/form/Form.js:29` 里 `labelAlign: stringType()` **没有声明 default**；默认右对齐来自 CSS——`es/form/style/index.js:121-129` 的 `${formItemCls}-label` 是 `textAlign: 'end'`，且只有 `'&-left': { textAlign: 'start' }`。也就是说**不传就右对齐，显式传 `left` 才是逆默认加配置**（React 版 antd 文档标"默认 right"是同一事实的行为侧说明，不作为本仓事实源）。
2. **眼动研究（Penzo 2006-07-12 实测数据）**：右对齐 **vs 左对齐** → 注视次数减少近一半，**完成时间也减少近一半**（原文 "the form completion times were cut nearly in half"）；saccade（视跳）时长 **左对齐 500ms / 右对齐 170ms（专家）· 240ms（新手）/ 顶部对齐 50ms**——即右对齐**比顶部对齐慢 3–5 倍，不是"接近"**。原文结论：*"Placing labels above input fields is preferable, but if you choose to place them to the left of input fields, **at least make them right aligned**."* 即**顶部最优、左置时必须右对齐**。我们做 admin 密集配置页选左置，所以右对齐是「在既定布局里取最优」，不是全场最优。

**落地口径**：显式写 `label-align="right"`（即使默认即 right——显式写便于机检断言）；label 文本右缘与控件左缘间距 **≥12px**；**同页禁止 left/right 混用**。

#### 配套三件（缺一即失效）

> 实测踩坑记录：只加 `label-align="right"` **右对齐不会生效**，五个 label 文本右缘仍参差（实测 335/325/319/319/323px）。原因是那一个 prop 只管到「列内摆放」，管不到「列内文字怎么摆」。

| # | 必须配的 | 为什么（源码依据） |
|---|---|---|
| ① | `label` 容器加 **`justify-content: flex-end`**，**但必须限定在 horizontal 上下文**（挂在 `.ant-form-horizontal` 下，或加 `@media (min-width: 576px)` 守卫），不得全局无差别套用 | `es/form/style/index.js:138`：`.ant-form-item-label > label` 是 `display: inline-flex; align-items: center`，该块内**没有 `justify-content`** → 默认 `normal`≈`flex-start`，文字贴内容盒**左**缘。`label-align="right"` 给的是父级 `.ant-form-item-label` 的 `text-align: end`（`:126`），对 flex 子项的文字起始位置无效。<br>**为什么要限定**：≤575px 自动上置时，`makeVerticalLayoutLabel`（`:328-336`）把 label 设成 `textAlign: 'start'`（上置态应当左对齐）；但 `justify-content: flex-end` 是**直接写死在 `<label>` 这个 inline-flex 容器上**的，不受 `text-align` 管 → 上置态文字会被右推到列尾，看起来像 bug |
| ② | **清掉 `:colon="false"` 残留的 `::after`** | `es/form/style/index.js:177-186`：`&::after { content: '":"'; marginInlineStart: token.marginXXS/2 (=2px); marginInlineEnd: token.marginXS (=8px) }`；`-no-colon::after`（`:184`）**只把 `content` 换成 `' '`，margin 原样保留** → 白占 **约 10–13px**（2px + 8px + 一个空格字符），右对齐时正好把文字右缘顶离列右缘。要么 `display: none`，要么显式 `margin: 0` |
| ③ | label 列与控件列之间用 **`column-gap: 12px`**（放在列**外**） | 若改用 `labelCol` 的 `padding-right` 补这 12px，会从 84px 定宽里扣，长 label 反被挤溢出——与 L3「84px 里不许折行」直接打架 |

**已实测的坑（2026-10-29 落地时踩到，务必照做）**：`justify-content: flex-end` 若**不加 `@media (min-width: 576px)` 守卫**，在 `<576px` 框架自动切上置时会把 label 文字**推到行尾**。原因：该属性写死在 `<label>` 这个 inline-flex 容器上，而 `makeVerticalLayoutLabel`（`es/form/style/index.js:328-336`）只把父级 `.ant-form-item-label` 改成 `text-align: start`，**管不到 flex 容器内部的排列**。落地实现见 PR #492（`AgentTuningPanel.vue` 的 `@media (min-width: 576px)` 块）。

**注意权衡**（不是推翻，是记录）：右对齐的代价是 label 左缘参差、长 label 混排时左边界不好看——这正是 L3 要把 label 压到 ≤5 字的原因；两者是配套的。

### 3.5 L5 · 长 label 换行

**左置 84px 下不允许折行**（L3 已定：84px 装不下就缩短或改上置，别靠折行硬塞）。**只有上置布局 / 窄屏**才允许 label ≤2 行：行高用 `leading-snug`，同一区域内所有 label 的换行数必须一致（都一行或都两行），否则视觉参差；**>2 行必须缩短文案**。

---

## 4. 空值与默认值表达

### 4.1 E1 · 三分工（互不越界）

| 位置 | 只负责 | 例 |
|---|---|---|
| placeholder | **输入格式 / 单位 / 示例** | `0–2`、`0.01`、`如 2048` |
| hint / extra | **语义 + 空值兜底行为** | 「留空 = 运行时回落 0.7」「留空 = 模型上限（8192）」 |
| 预填默认值 | 仅当**系统会把这个值真的保存下来** | 保存后回填已存值（不是"看起来有值"） |

**硬禁**：把默认值预填成"看起来已配置"——`?? 0.7` 事故（contracts D10：老前端把 null 静默写成 0.7）。空就是空，默认行为写在 hint 里。

**边界说明（E1 的显式例外，只有这一种）**：

上面表格的三分工里，**「空值语义」是 hint 的独占领域**——placeholder 天生会被输入覆盖（NN/g：输入后消失、无法复核），拿它当语义载体本就次优。所以 placeholder 出现「跟随默认 / 未配置 / 不设置」这类**语义词**，按 E1 直接读都是越界。

**唯一允许的例外条件**：**该字段没有合适的示例值可写**（纯枚举型、纯开关型数值框——写 `如 4096` 反而是误导，因为任何具体数字都暗示"这是推荐值"），此时才允许用语义占位，且**必须与 hint 成对**（placeholder 说"跟随默认"，hint 说"跟随谁、兜底成什么"）。不满足这个条件 → placeholder 回归示例或留空。

> 这条例外是为消解"E1 说语义归 hint / E2 又让 placeholder 写语义"的表面矛盾而写的。**maxTokens 是否满足例外条件已定**（2026-10-29 22:30 拍板取 §9-2 候选 C）：它不是纯枚举、`如 4096` 反而暗示推荐值，因此**判为"无示例值可写"→ 允许语义占位，但最终选择留空、语义全交 hint**。详见 §9 第 2 条。

### 4.2 E2 · 「未配置」何时正确、何时误导

> **本节是 §4.1 的显式例外**：下表里的「正确占位」只在**满足 §4.1 边界说明的例外条件**（无合适示例值可写 + 与 hint 成对）时成立；有示例值可写的字段，placeholder 仍应回归格式/示例，语义全交 hint。

| 空值的含义 | 正确占位 | 反例 |
|---|---|---|
| 空 = 有系统默认兜底，且"我不管"是可接受的选择 | **「跟随默认」** | 写「未配置」→ 用户以为漏填 |
| 空 = **期望状态**（如带工具 agent 的 maxTokens 留空 = 用满模型上限，是推荐值） | **「默认（模型上限）」/「跟随默认」** | 写「未配置」→ 用户以为"没配好"，反而去填个更小的值 |
| 空 = 未设置且没有兜底（纯可选扩展字段） | 「未配置」可以 | — |

**判定阈值（可机检）**：**hint 里出现「留空 = …」且给了具体兜底 → placeholder 不得写「未配置」。**

**依据**：NN/g《Placeholders in Form Fields Are Harmful》(Katie Sherwin, 2014-05-11，2018-09-10 更新) —— placeholder 不能承担语义、输入后消失导致无法复核；上面第 6 条还专门指出「用户会把 placeholder 误认为已填数据」。

**词表收口**（禁止自造第四种说法）：`跟随默认` / `未配置` / `不设置` —— 三选一，按上表判；**这三个词都属语义词，只在 §4.1 例外条件下进 placeholder**，其余情况 placeholder 写格式/单位/示例。

**证据说明（只补依据，不改上表判据）**：NN/g《Placeholders in Form Fields Are Harmful》另有两条对本表的反向作用力——`#5 Fields with stuff in them are less noticeable`（字段里有东西反而更不显眼）、`#6 Users may mistake a placeholder for data that was automatically filled in`（用户会把占位误当已填值）。**语义占位「跟随默认」同样属于「字段里有东西」，同样会被读成已配置**。所以在**有示例值可写**时，优先「placeholder 写示例 + 语义进 hint」，而不是把语义塞进 placeholder。此条**不推翻上表**（上表仍用于「无示例值可写」的例外场景），但它是 §9-2 候选 C 的依据。

### 4.3 E3 · 数值输入的占位与单位

- 单位放**控件后缀**（`addonAfter` / suffix），不写进 placeholder；
- 范围/上限放 **hint 或 tooltip**，不写进 placeholder；
- 需要"留空 = 特殊语义"的数值字段，**placeholder 与 hint 必须成对**（placeholder 说"跟随默认"，hint 说"跟随谁"）——**前提是满足 §4.1 的例外条件**；有示例值可写时不用语义占位。

---

## 5. 状态与校验

### 5.1 S1 · 错误态

- 字段级：红边 + 字段下红字（12px），文案 = **哪里错 + 怎么改**（`validate-status="error"` + `help`）；
- 全局：同屏**最多一处** toast/alert，只做"保存失败"的汇总与后端原文；
- 错误在用户改值后自动消失；**不清空用户已填值**（校验失败保留输入）。

### 5.2 S2 · 禁用 vs 只读（常被混用）

| 态 | 语义 | 表达 | 要点 |
|---|---|---|---|
| 禁用 disabled | 当前**不可用**（权限/前置条件不满足） | 灰化 + tooltip/extra **说明原因** | 无声禁用 = 不合规（S7 同款） |
| 只读 readonly | **可读、可复制、不可改**（计算值、预览值） | 普通文本或 `readonly` 输入 | **不要用 disabled 灰化**——灰化会被理解为"值有问题/加载失败" |

反例：把「思考预算（只读预览）」做成 disabled 输入框 → 用户以为预算值异常；应做成文本行或 `readonly` 输入。

**外部原文依据（禁用须说明原因）**：Atlassian Design System · Toggle —— `If you're using a disabled toggle, include information explaining why the option isn't available.`（原文还建议用 visually-hidden 告知读屏用户"此处有一个不可用选项"）。这是 S2「无声禁用不合规」的外部出处，此前只有 `design-system.md` S7 的内部依据。

### 5.3 S3 · 字段级红字 vs 全局提示的分工

- 能定位到字段 → **字段级**（红边 + 行内红字）；
- 定位不到（网络/500/冲突）→ **全局** toast/alert，附重试入口；
- 互斥类校验（A 与 B 只能填一个）→ **两个字段同时红字** + 全局一条汇总（现状 C7-b 即按此）。

### 5.4 S4 · 前端只做预防性拦截

前端只拦"确定不合法"的值（值域、互斥、必填），**文案与最终判据以后端返回为准**，禁止前端自造判据文案（已有裁决，本规范重申）。保存中：按钮 loading + 锁重复提交（S8）。

---

## 6. 三个现有案例判定（验收这份规范有没有用）

### 6.1 thinking 三态 → **形态合规、文案不合规**

| 项 | 现状 | 判定 |
|---|---|---|
| 控件形态 | `a-radio-group option-type="button"` 三项（`AgentTuningPanel.vue`） | ✅ **合规**（RadioGroup，不是 `a-segmented`；视觉是胶囊分段但语义仍是 radio） |
| 选项是否含显式「未配置」 | 有（'null' 项） | ✅ 合规（B3 显式项要求） |
| 文案 | `未配置 (NULL)` / `enabled` / `disabled` | ❌ **不合规**：暴露实现枚举与类型标记（违反 H5 与 page-spec §3.2 label 命名） |
| 误配警示 | 带工具 + disabled → 红字 alert | ✅ 合规（§1.4 第 ③ 条：当场说明运行时纠正） |
| 锁定态（C7-d 分类档） | `locked` + hint 说明原因 | ✅ 合规（S2 禁用须说明原因） |

**整改建议（已拍板，见 §9 第 3 条）**：三项文案改「跟随默认 / 开启 / 关闭」；`enabled/disabled` 只留在代码与 extra 里；hint 写「跟随默认 = 不在此层锁定，按优先级链决定（带工具时强制开启）」。**注意**：若哪天改成 `a-segmented` 组件 → 立即不合规（C3）。

### 6.2 `maxTokens` 空值 → **hint 合规、placeholder 不合规**

| 项 | 现状 | 判定 |
|---|---|---|
| hint | `留空 = 模型上限（8192），不人为压小`（`MODEL_MAX_TOKENS` 插值，无硬编码） | ✅ **合规**（E1 语义进 hint、E2 给出具体兜底） |
| placeholder | `未配置` | ❌ **不合规**：空 = 期望状态（用满上限），写「未配置」会被读成"没配好"（E2 第 2 行） |
| 单位/范围 | 无冗余单位、无范围噪音 | ✅ 合规 |

**整改建议（已拍板）**：取 §9 第 2 条的**候选 C** —— placeholder 回归示例或留空、空值含义全交 hint。落到本案例：`maxTokens` 的 hint 已足够（`留空 = 模型上限（8192），不人为压小`），**placeholder 留空即可**；Temperature / Top P 同理改为示例（`如 0.7` / `如 0.9`）。`未配置` 在任何候选下都不成立，这条判定不受落地进度影响。

### 6.3 基础卡 vertical + 高级卡 horizontal 同页混用 → **允许混用；但 label 命名/折行现状不合规**

| 条件（§3.2） | 现状 | 判定 |
|---|---|---|
| ① 不同卡片、有边界 | 基础配置卡 / 高级调参卡 | ✅ |
| ② 职责不同 | 长文本为主 vs 参数网格 | ✅ |
| ③ 两组 label 对齐一致 | 基础卡 vertical（无横向对齐问题）；高级卡 `label-align="left"` → **已改 `right` + §3.4 配套三件**（PR #492） | ✅ 已整改（2026-10-29） |
| **（补充）label 长度 ≤5 汉字 / ≤10 半角（L3，不属 §3.2 三条件，但同属本次判定）** | 5 个 label 里 **3 个超限**：`Temperature`（11 半角）、`输出上限 maxTokens`（5 汉字 + 空格 + 9 半角）、`最大步数 max_steps`（5 汉字 + 空格 + 9 半角）。而 `.b3-tuning :deep(.ant-form-item-label > label)` 写了 `height: auto; white-space: normal; line-height: 20px; padding-top: 6px`（`AgentTuningPanel.vue:244-247`，行号已随 PR #492 位移）——**这段就是为让 label 折两行不溢出才写的** | ❌ **现状不合规（待整改）**：靠 `white-space: normal` 折行绕过了 84px 上限，L3（≤5 字/≤10 半角）与 L5（左置 84px 下不许折行）双违规。**不是"可接受"**，须缩短为业务词：`Temperature`→`温度`（**改前须先量**：`label.scrollWidth > label.clientWidth` 才改，量不过就别凭「11 半角 > 10」硬判）、`输出上限 maxTokens`→`输出上限`、`最大步数 max_steps`→`最大步数`。缩短后折行补丁**分两步删**：第一步删 `white-space: normal` + `height: auto`（零风险）；第二步删 `line-height: 20px` + `padding-top: 6px`，删前先实测一次 `labelBox.top - inputBox.top`，确认单行下的垂直对齐没被破坏再动 |

**结论**：**允许混用**（①②成立），但有一处已整改、一处待整改：**③ 已整改**——高级卡 `label-align` 已改 `right` 并补齐 §3.4 配套三件（其中 `justify-content: flex-end` 收在 `@media (min-width: 576px)` 守卫内，PR #492 → `5e3164a7`）；**L3/L5 待整改**——三条超长 label 缩短为业务词（`Temperature` 先量再定），折行补丁分两步删（先 `white-space`/`height`，实测后再删 `line-height`/`padding-top`）。**原始现状判「允许混用但字段命名不合规」，不是全绿；③ 已落地，L3/L5 仍在整改队列**。

---

## 7. 现状扫描（顺带登记，供整改排期）

| 位置 | 用法 | 判定 |
|---|---|---|
| `UserList.vue:204` 「状态」开关（创建/编辑弹窗表单） | a-switch + 保存按钮 | ❌ B1/B2：提交型表单内用 Switch |
| `KnowledgeCollectionsPage.vue:40` 集合启停 | 表格行内 a-switch，即时接口 | ✅ B2 合规 |
| `ContentPipelines.vue:204` 管线启停 | 行内 a-switch 即时 | ✅ B2 合规 |
| `AgentTuningPanel.vue` thinking | 三选 radio-group | ✅ 形态；❌ 文案（§6.1） |
| `AgentDefDetail.vue:42` 基础配置 | `layout="vertical"` | ✅ L1（跨卡片混用，见 §6.3） |
| `AgentTuningPanel.vue:244-247` label 折行补丁 | `height: auto; white-space: normal; line-height: 20px; padding-top: 6px` | ❌ L3/L5（**待整改**）：为超长 label 折两行而写，3 条 label 超限；缩短后分两步删（先 `white-space`+`height`，实测 `labelBox.top - inputBox.top` 后再删 `line-height`+`padding-top`，见 §6.3） |
| `AgentTuningPanel.vue` 高级卡 `label-align="left"` | `<a-form layout="horizontal" label-align="left" :colon="false" label-col 84px>` | ✅ **已整改（2026-10-29，PR #492 → `5e3164a7`）**：已改 `right` + §3.4 配套三件（`justify-content` 收在 `@media (min-width: 576px)` 守卫内，见 §9-1） |

---

## 8. 参考来源（版本 / 年份 / 链接，按权重排序）

> 说明 1：结论标注 **业界共识**（≥4 家一致）/ **有分歧**（各家阈值不同，我们取一）/ **我们自定**（无直接来源，按本仓约束推导）。访问日期均为 2026-10-29。
> 说明 2：**本仓实际依赖是 ant-design-vue 4.2.6**（`apps/admin/package.json` 声明 `^4.2.0`，`node_modules` 实装 4.2.6）。凡标「事实源（源码级）」的都引 `apps/admin/node_modules/ant-design-vue/es/**` 的真实行号；第 2/3 条的 React 版 antd 文档只作**行为侧参考**，不作为本仓事实源。
> 说明 3（**方法论，踩过的坑**）：判「框架有没有某行为」**不能 grep 数字/字符串字面量**。antd 的断点、间距、字号全是 token 计算式——如断点写的是 `@media (max-width: ${token.screenXSMax}px)`（`:380`），而 `screenXSMax = screenSM - 1`（`es/theme/util/alias.js:125`）、`screenSM = 576`（`:29`），所以搜 `575` / `max-width` 一个字都搜不到，但规则**确实存在**。正确做法：读 `@media` / `&:hover` / 函数返回对象这类结构段，再用 `es/theme/util/alias.js` + `es/theme/themes/shared/genSizeMapToken.js` 把 token 解成数值（例：`sizeXXS = sizeUnit*(sizeStep-3) = 4`）。**本次 v1.1 修订中曾因只 grep 字面量而误判「没有 575 断点」，已纠正。**
> 说明 4（**抓取限制，同源坑**）：`m3.material.io`、`material.io`、`lightningdesignsystem.com`（zeroheight）都是 **JS 渲染**站点——**静态抓取拿不到正文，但链接有效、规则真实存在**。人工核对这些条目请用浏览器，或看 SLDS 的 zeroheight 正文深链。**「抓不到」≠「不存在」**，这条与说明 3 是同一个坑的两种形态。
> 说明 5（**本表的核查状态**）：2026-10-29 对全部 18 条做过实测（链接可达性 + 结论逐字对照 + 版本日期）。结果：**2 条硬错**（第 7 条把 radio 的段数口径套到 segmented；第 8 条那句「开关不该与提交按钮同页」原文不存在）、**4 条表述过硬或日期错**（第 3/4/6/17 条）、**3 条 URL 需替换**（第 5/9/8 条）。凡"推论"均在「共识度」列标注；未标注的均为原文可直接引用的句子。

| # | 来源 | 版本/年份 | 关键结论 | 共识度 |
|---|---|---|---|---|
| 1 | **ant-design-vue · Form（源码级）** | **4.2.6** · `es/form/Form.js:29`、`es/form/style/index.js:121-129` | `formProps` 里 `labelAlign: stringType()`——**未声明 default**；默认右对齐来自 CSS：`${formItemCls}-label` 是 `textAlign: 'end'`，只有 `&-left` 才 `textAlign: 'start'`。→ **不传即右对齐；显式传 left 是逆默认加配置**。`layout` 支持 horizontal / inline / vertical | **事实源（源码级，非文档）** |
| 2 | Ant Design Switch | v5 https://ant.design/components/switch | Switch 直接触发状态改变；Checkbox 用于状态标记，需配合提交 | 共识 |
| 3 | Ant Design Segmented | `antd@4.20.0` 起——**页面只标版本号、未标年份**（v1.0 写的「2022 起」是本仓补充，非页面信息） https://ant.design/components/segmented | 何时使用原文：「When displaying multiple options and user can select a single option; **When switching the selected option, the content of the associated area changes.**」 | 共识 |
| 4 | Material Design 3 · Switch | M3（现行，页面无版本号） https://m3.material.io/components/switch/guidelines | ①「**The effects of a switch should start immediately, without needing to save.**」②「Switches control binary options, not opposing ones. … **Use a connected button group instead.**」（M3 现在指 connected button group，**不是** segmented）③「Avoid using a switch to select multiple options that require people to save. Switches should be immediate. **Use checkboxes instead.**」——注意 ③ 只管「**多选项**且需保存」，**不是**「任何表单字段」。→「带 Save 的表单里放 switch 自相矛盾」是**推论**（本条原文没有这句话，但 ①③ 已足够支撑） | 共识（①②③ 原文）；推论已标注 |
| 5 | Material Design 3 · Segmented buttons | M3；M3 Expressive **2025-05** 起「no longer recommended」 https://m3.material.io/components/segmented-buttons （v1.0 写的 material.io 域名会 **301 跨域跳转**到这里） | 「Segmented buttons help people **select options, switch views, or sort elements**」；「Use for simple choices between **two to five items**」；「Note: Segmented buttons are no longer recommended in the Material 3 expressive update… **use the connected button group instead**」 | 共识 |
| 6 | Apple HIG · Toggles | changelog **2024-03-29**（页面 Change log 首行：`March 29, 2024`） https://developer.apple.com/design/human-interface-guidelines/toggles | ①「A toggle lets people choose between **a pair of opposing states**」②「**In general, don't replace a checkbox with a switch.**」③「**Use a checkbox instead of a switch if you need to present a hierarchy of settings.**」+ 混合态用于父子联动（`can contain a dash when the button's state is mixed`）④ radio 常见「groups of **two to five**」；「**more than about five** options, **consider** using a pop-up button」。⚠️ ④ 在 **macOS → Radio buttons 小节**，是 radio 的建议（且原文含 "about" + "consider"，非强制），**不等于** segmented 的段数 | 共识 |
| 7 | Apple HIG · Segmented controls | changelog **2023-06-21**（`June 21, 2023`） https://developer.apple.com/design/human-interface-guidelines/segmented-controls | 「A segmented control is a linear set of **two or more** segments」；数量上限「**Aim for no more than about five to seven segments in a wide interface and no more than about five segments on iPhone**」；用途「**closely related choices that affect an object, state, or view**」 | 共识。**⚠️ v1.0 的段数口径是错的**（把 Apple 对 radio 的 "two to five" 误用到 segmented），v1.2 已改为「≥2 段 + 上限约 5–7 / iPhone 约 5」 |
| 8 | Salesforce Lightning Design System 2 · Checkbox Toggle | SLDS 2（页面无版本号） https://www.lightningdesignsystem.com/components/checkbox-toggle/ （zeroheight 外壳；正文深链 https://www.lightningdesignsystem.com/2e1ef8501/v/64486/p/00c862-checkbox-toggle/b/39205c ）；组件参考 https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-checkbox-toggle.html | ①「**Use toggles for settings that take effect immediately.**」②「When Not to Use」逐字：`For actions involving more than two options, use other methods instead of a toggle switch.` / `Avoid using toggles for actions that require confirmation or have significant consequences.` / `Don't use toggles for irreversible actions (for example, deleting records).` ③ 组件参考页：「a toggle is self-contained and **is designed to be used in a form with only one field**」+「the change for that item should save immediately」。**⚠️ v1.0 那句「开关不该与提交按钮同页」两页原文都没有，v1.2 已删**（该意思的原文依据在 NN/g 第 12 条与 Atlassian 第 10 条） | 共识 |
| 9 | IBM Carbon · Checkbox | Carbon 现行（页面无版本号） http://carbondesignsystem.com/building-blocks/core/components/checkbox/guidelines | 逐字：「Toggle switches are preferred when the resulting action will be **instantaneously applied, without the need for further confirmation**. By comparison, **checkboxes represent one input in a larger flow which usually requires a final confirmation step.**」 | 共识 |
| 10 | Atlassian Design System · Toggle | 页面**无版本号/日期**（访问 2026-10-29） https://atlassian.design/components/toggle/usage/ | 逐字：①「**Toggles should never require people to press a button to apply the settings.**」②「**The toggle component doesn't work within the form component by default.** … For options that require a button press to apply the setting, **use a checkbox**.」③（无障碍）「**If you're using a disabled toggle, include information explaining why the option isn't available.**」 | 共识 |
| 11 | Shopify **Polaris web components**（Customer Account UI Extensions，**不是 admin 版 Polaris**） · Switch | 版本页含 **2026-10（latest）**；URL 会跳 `latest` https://shopify.dev/docs/api/customer-account-ui-extensions/2026-10/web-components/forms/switch | 逐字：①「Use switch for **binary controls that take effect immediately**」②「For selections that require explicit submission, **use checkbox instead**」③「**Switch doesn't support `error` or `required` props.**」④ Best practices：`Reserve switches for settings that take effect immediately without a save or submit action` | 共识（注意：引用范围限于 Customer Account 版，不能代表 Shopify Admin 的 Polaris） |
| 12 | NN/g · Toggle-Switch Guidelines | Alita Kendrick，2018-07-29 https://www.nngroup.com/articles/toggle-switch-guidelines | 开关**立即生效**，不得要求 Save/Submit；长表单里混开关会让用户分不清是否即时生效——禁止 | 共识（最常被引用） |
| 13 | NN/g · Does Your Form Really Need a Dropdown List? | Huei-Hsin Wang，2026-07-17 https://www.nngroup.com/articles/dropdown-list | 三个阈值**全部出自本文**，逐字：「The U.S. Web Design System (USWDS) recommends radio buttons for fewer than 7 items. Google Material Design (M3) sets the threshold at 6 items; IBM's Carbon Design System draws the line at 3 items.」；`For fewer than 5 options, radio buttons are usually better`；`well beyond 15 options → consider a combobox` | **有分歧** → 我们取 5 |
| 14 | NN/g · Listboxes vs. Dropdown Lists | Anna Kaley，2020-04-12 https://www.nngroup.com/articles/listbox-dropdown/ | 逐字：「it's better to use a listbox or dropdown list when there are **5 or more** items」；表格：`5 or fewer → radio buttons / checkboxes`、`5–15 → either`、`more than 15 → listbox`。⚠️ **与第 13 条对 >15 的建议不同**（本条说 listbox，2026 那篇说 combobox）；我们取 **combobox**（新版、且本仓要搜索），此差异已记录 | 取 5 的直接来源 |
| 15 | NN/g · Placeholders in Form Fields Are Harmful | Katie Sherwin，**2014-05-11（2018-09-10 复核）**——页面写的是 `Last reviewed`，不是"更新" https://www.nngroup.com/articles/form-design-placeholders/ | 逐字：①`Placeholder text … typically disappear when the user types`；②`#2 Without labels, users cannot check their work before submitting a form`；③`#6 Users may mistake a placeholder for data that was automatically filled in`；④（v1.1 新增，反向力）`#5 Fields with stuff in them are less noticeable` | 共识 |
| 16 | Penzo, *Label Placement in Forms*（+ Caroline Jarrett 的复核） | Matteo Penzo，**2006-07-12** https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php ；Jarrett 复核 https://www.effortmark.co.uk/label-placement-forms-whats-best | **右对齐 vs 左对齐**：注视次数减少近一半，**完成时间也减少近一半**（原文 "the form completion times were cut nearly in half"）。**saccade 时长：左对齐 500ms / 右对齐 170ms（专家）· 240ms（新手）/ 顶部对齐 50ms** → 右对齐**慢于顶部 3–5 倍**，不是"接近"。原文结论：「顶部对齐更优；**若必须左置，至少要右对齐**」 | 右对齐 vs 左对齐 = 原文实测结论（强）；顶部 vs 左置 = 有分歧（取决于数据熟悉度与现实条件） |
| 17 | WCAG 2.2 · 3.3.2 Labels or Instructions | W3C Recommendation **2024-12-12**（现行版本；2.2 **初版** REC 是 2023 年 10 月 5 日，v1.0 误用了初版日期） https://www.w3.org/TR/WCAG22/#labels-or-instructions ；SC 原文与 Intent 见 https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html | SC 原文逐字：**「Labels or instructions are provided when content requires user input.」**（**没有**"必须可见"字样）。「可见」的依据在术语定义 `label: … presented to a user`（Understanding）+ Sufficient Techniques `G131` / `H44`。**「placeholder 单独用不足以满足」是我们的推论**（业内共识，SC 正文无此句） | 标准（合规底线）；"可见"与"placeholder 不满足"标注为推论 |
| 18 | **ant-design-vue · Form 样式（源码级）** | **4.2.6** · `es/form/style/index.js:138`、`:121-129`、`:177-186`、`:328-336`、`:337-356`、`:380`、`:411`；token 见 `es/theme/util/alias.js:29,125` | ① `.ant-form-item-label` 是 `textAlign: 'end'`（`:126`）；② 其子 `<label>` 是 `display: inline-flex`（`:138`）且该块**无 `justify-content`** → 文字仍贴内容盒左缘，`label-align="right"` 单独加**不足以**真右对齐；③ `&::after` colon 规则 `marginInlineStart: marginXXS/2 (2px) + marginInlineEnd: marginXS (8px)`，`-no-colon::after` 只换 `content` 为空格、**margin 原样保留**（`:177-186`）；④ **`@media (max-width: screenXSMax=575px)` → `makeVerticalLayout`（`:380`）对 horizontal 也生效**，label/control 各 `flex: 0 0 100%`（`:337-356`），且 `makeVerticalLayoutLabel`（`:328-336`）把 label 设 `textAlign: 'start'` + 隐藏 `::after` | **事实源（源码级）**，§3.4 配套三件 + §3.1 窄屏上置的依据 |

---

## 9. 决策记录（2026-10-29 22:30 用户拍板「按建议来」，五条已定）

> 本节原为「待拍板差异清单」。2026-10-29 22:30 用户对下列各项一并拍板**「按建议来」**，现转为**决策记录**，不再是待办；每条标出落地状态。

| # | 议题 | 决策 | 落地状态 |
|---|---|---|---|
| 1 | `page-specs/agent-def-detail-v2.md` §2.1/§3.2 的 `label-align="left"`（2026-10-29 早前裁决，机检 26a/26b 锁定） | **改右对齐**，且必须补齐 §3.4「配套三件」 | ✅ **已落地**：PR #492 → master `5e3164a7`，admin@dev 已验（用户反馈「整齐多了」）。落地形态 = `label-align="right"` + §3.4 **配套三件**，其中 ① `justify-content: flex-end` **收在 `@media (min-width: 576px)` 守卫内**（原因见 §3.4「已实测的坑」），② 清 `::after` 残留 margin，③ `column-gap: 12px` |
| 2 | 同文件 §2.1：「Temperature / maxTokens / Top P 三个数值控件 placeholder 一律『未配置』」 | **取候选 C**：placeholder 回归示例或留空，**空值含义全交 hint** | 待落地（实现 + 原型 + 机检）：Temperature `如 0.7`、Top P `如 0.9`、**输出上限（maxTokens）留空不给示例**。机检 25c 由「等于某词」改为「不含语义词（未配置／跟随默认／不设置）」——验规则不验具体词 |
| 3 | 同文件 §3 第 5 行：thinking 文案「沿用默认 / 关闭（`type=disabled`）/ 开启并限预算」；实现文案「未配置 (NULL) / enabled / disabled」 | **统一「跟随默认 / 开启 / 关闭」** | 待落地（page-spec + 实现 + 原型三处一次改齐）。`enabled` / `disabled` / `(NULL)` 只留在代码与规格，不进界面 |
| 4 | `design.md` §2 第 10 条（≤5 用 tabs/radio-group；select 仅 >5 / 长文案 / 需搜索） | **确认不冲突**：同为「≤5 项用 radio-group」，本规范只补「Segmented 仅用于视图切换」一条边界 | ✅ 无需改动 |
| 5 | `docs/ui/README.md` 登记 | **执行**：在 **§2「任务 × 最小文档集」**加索引行（§1 是「文档分档」，不要挂在那节） | ✅ 本次 PR 一并完成 |

**决策依据留档**（供后人回溯，不必重开讨论）：

- **第 1 条（右对齐）**：两条独立证据——ant-design-vue 4.2.6 **默认即** `text-align: end`（`es/form/style/index.js:121-129`，显式写 left 才是逆默认加配置）；Penzo（2006-07-12）实测右对齐的注视次数与完成时间均约为左对齐的一半。左置是既定布局决定，**右对齐是左置这一既定布局内的最优**，不是全场最优。
- **第 2 条（取 C）**：C 是三个候选里**唯一有外部原文支撑**的（NN/g `#5 fields with stuff in them are less noticeable`、`#6 users may mistake a placeholder for data that was automatically filled in`——语义占位同样会被读成已填值；A「跟随默认」/ B「默认（模型上限）」均为本仓自定词表）。另有一条项目内证据：原型里三个数值框右侧本就有 `.clear`「留空=默认」按钮，placeholder 再说一遍语义属重复。`maxTokens` 之所以「留空」而非给示例，是因为任何具体数字（`如 4096`）都会暗示"这是推荐值"。
- **第 3 条（thinking 文案）**：`enabled` / `disabled` 是契约枚举值，暴露到界面违反 `design-system.md` H5（术语一致）与 page-spec「label 用业务词」。
- **第 4 条**：两处阈值同为 5，不存在冲突；强行合并成一套数值反而是本次要避免的「两套口径」。

**维护纪律**：同一控件问题第 2 次出现 → 按现有回流规则升格进 `design-system.md`（M 系列），本文件只做趋势判断与案例沉淀；数值一律引 `tokens.ts`，不在本文件出现色值/字号。

---

## 附：本规范未覆盖的（避免被误用）

- 不覆盖**业务语义**（某个字段该不该存在、默认值取多少）——那是 page-spec 与产品判断；
- 不覆盖**强校验规则**（值域/互斥的具体数值）——引 `docs/api/contracts.md`；
- 不覆盖 C 端品牌端（Claymorphism 体系），那边只共享"开关即时生效"这一条语义原则。
