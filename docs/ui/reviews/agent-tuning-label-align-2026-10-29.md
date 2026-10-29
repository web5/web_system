# 调参面板 label 对齐——按 page-spec §3.2 落地 label 左置 84px 栅格

- 日期：2026-10-29
- 分支：`feat/agent-tuning-label-vertical`（PR #487，基于 `origin/master` @ `0742cc6f`）
- Proto 凭证：`9b52ed84`（本分支规格/机检先行提交）；原型真源 `062ed3f3`（祖先已验）
- 评审对象：`apps/admin/src/views/Agents/AgentTuningPanel.vue`、`scripts/verify-agent-def-detail.mjs`
- 用户意见（唯一一条）：dev 上功能可用，但**表单 label 要对齐**——四个数值控件 label 右缘各不相同

## 一、症状与根因（先查证，后动手）

真实页面量测（本地 vite 起真实代码 + dev 网关 API，1440px）：

```
hasFormParent: false   ← 五个 a-form-item 游离在 form 上下文外
```

ant-design-vue 的 FormItem 拿不到 `layout` 时回落 horizontal，且 **label 列宽按各自文字宽自适应**：

| 控件 | label 右缘 = 输入框左缘（改前，px） |
|---|---|
| Temperature | 349 |
| 输出上限 maxTokens | 398 |
| Top P | 303 |
| 最大步数 max_steps | 397 |

最大差 95px——与用户截图症状完全吻合（dev 上独立量测一遍，四值相同）。

## 二、口径裁定与弯路记录（本节必读）

**定稿口径（规格早已裁定，不是自由选择）**：

- 原型 `admin-agent-def-detail.html:215-216`：「上一版 label 上置 + hint 各占一行 → 每字段 3 行、整卡看起来『一堆小字』。现统一为『左 label / 右控件 / 控件下一行短 hint』，控件左缘对齐，行数减半。」`:221` `.flb{flex:0 0 84px}`
- page-spec `agent-def-detail-v2.md` **§3.2「表单排版规则（v2.1 新增，落地须遵守）」**:120：栅格 = `.flb`（label，**固定 84px**）+ `.fld`（控件 + hint），**控件左缘对齐**；`:125` label 用业务词不用字段名

**弯路（本稿如实记录，防复发）**：

1. 主理人第一版指令误判原型为「label 在上、控件在下」（据 `.flb` 是独立块级 div 误读；实际 CSS 是 `flex:0 0 84px` 左置），拍板改 vertical；
2. 实现者核实原型时发现矛盾并如实上报，但当时按「两种都能对齐、vertical 与同页基础卡一致」执行了 vertical（第一版，已在机检历史上留痕）；
3. 主理人复核 page-spec §3.2 后纠正：**§3.2 已裁定 label 左置 84px，vertical 恰是被原型注释点名否掉的上一版**——第二版（本稿）改回规格口径。

教训：**「原型/规格已经裁定过」的口径没有选择空间**；实现前应先查 page-spec 规则表再动手，冲突时以书面规格为准，而不是以「页内一致性」等次级理由推翻主规格。

## 三、最终实现（horizontal + 固定 84px）

```vue
<a-form
  layout="horizontal"
  label-align="left"      ← 原型 .flb 左对齐（antd 默认 right）
  :colon="false"          ← 原型 .flb 无冒号（antd 默认渲染「:」，84px 里「Top P:」冒号会折行悬挂）
  :label-col="{ style: { width: '84px' } }"
  :wrapper-col="{ style: { flex: '1 1 auto', minWidth: 0 } }"
  :model="{}"
>
```

配套 scoped CSS（唯一一处）：

```css
.b3-tuning :deep(.ant-form-item-label > label) { height: auto; white-space: normal; line-height: 20px; padding-top: 6px; }
```

- antd horizontal label 默认 `nowrap`，84px 里「输出上限 maxTokens」会被截断 → 纠正为可换行；
- 行高 20px + 上内距 6px：单行时文字在 32px 控件高度内视觉居中；换代后向下撑开；
- `:model="{}"` 仅为补齐 form 上下文，**数据流未动**（defineModel 直连父组件）；
- label 文案本轮未动（「输出上限 maxTokens」等改业务词属 §3.2:125 的后续文案拍板，等主理人）。

## 四、几何实测（两视口，真实渲染环境）

量测脚本 `/tmp/measure-label3.mjs`（vite 起本分支真实代码 + dev 网关 API 经 puppeteer 请求拦截透传）。

### 1440px

| 指标 | 实测值 |
|---|---|
| 四个数值输入框 left | **337 / 337 / 337 / 337**（全等，容差 0） |
| label 盒 width（5 个 form-item） | **84 / 84 / 84 / 84 / 84**（恒 84px） |
| label 文字顶 vs 输入框顶 | 1365=1365、1445=1445、1525=1525、1757=1757（同处一行，水平排列） |
| 横向滚动 | scrollWidth 1440 = innerWidth 1440 ✓ |

### 1280px

| 指标 | 实测值 |
|---|---|
| 四个数值输入框 left | **337 / 337 / 337 / 337**（全等，容差 0） |
| label 盒 width | **84 × 5**（恒 84px） |
| label 文字顶 vs 输入框顶 | 917=917、997=997、1077=1077、1329=1329 ✓ |
| 横向滚动 | scrollWidth 1280 = innerWidth 1280 ✓ |

### 长 label 换行实测（84px 内）

| label | 行数 | label 文字高 | 结论 |
|---|---|---|---|
| 输出上限 maxTokens | **2 行** | 46px（20×2 + 6 内距） | 行高 56px 内，**不溢出、不压控件**（label 右缘 337 = 控件左缘 337，无交叠） |
| 最大步数 max_steps | **2 行** | 46px | 同上 ✓ |
| Temperature / Top P / thinking | 1 行 | 26px | 视觉与控件居中 ✓ |

截图：`/tmp/lab4-1440-panel.png`、`/tmp/lab4-1440-budget.png`、`/tmp/lab4-1280-panel.png`、`/tmp/lab4-1280-budget.png`。

### `.b3-budget-preview` 负上边距——实测后不动

thinking=enabled 态「上方 form-item 底 → 预览框顶」：

| 视口 | 改前（无 form 上下文时） | 本版（horizontal 84px） |
|---|---|---|
| 1440 | 1693 → 1709 = **16px** | 1688 → 1704 = **16px** |
| 1280 | — | 1260 → 1276 = **16px** |

三态一致（24 margin-bottom − 8 = 16px），`margin: -8px 0 16px` 维持不变，实测结论在 CSS 注释。

## 五、机检（verify-agent-def-detail.mjs，145 → 147 项）

本脚本是 **file:// 原型机检**（与本地服务解耦，见 `docs/api/contracts.md`「无头验证」），量不到真实 app 几何；几何证据见 §四实测表。26a/26b 按 25a/25d 先例做**静态结构断言**（断言成因）：

- **26a**：`label-col` 必须含固定 `84px`，且代码中（剥掉 HTML 注释后）`layout="vertical"` 残留必须为 **0**（防回潮到被否掉的上一版）；
- **26b**：`label-col` 不得出现 84px 以外的固定宽度（防改成 120px 之类再破坏规格）。

### 变异验证（判据不是摆设）

| 变异体 | 注入方式 | 结果 |
|---|---|---|
| ① 改回 vertical（layout="horizontal"/label-align/label-col/wrapper-col 四行 → layout="vertical"） | python 替换 | **仅 26a FAIL**（❌ 失败 1 项） |
| ② `84px` → `120px` | python 替换 | **26a + 26b 双 FAIL**（❌ 失败 2 项） |

还原后 diff 仅剩本任务两文件。

## 六、验证门

| 门 | 结果 |
|---|---|
| `vue-tsc --noEmit` | exit 0 |
| `eslint src/views/Agents/AgentTuningPanel.vue` | exit 0 |
| `npm test`（apps/admin） | 9 suites / 115 tests 全过 |
| `verify-agent-def-detail.mjs` | 147 项全过（含新口径 26a/26b） |
| `build-agents-hub.mjs` 重生成 | hub diff = 0（未手改生成物） |
| `verify-agents-hub.mjs` | 243/246——3 条 FAIL（8b/8e/9r）stash 基线复跑证实为既有菜单漂移（BasicLayout 新增「封面素材」），非本次引入 |

## 七、遗留 / 风险

- **label 文案未动**：「输出上限 maxTokens」「最大步数 max_steps」在 84px 内换行两行、无溢出（§四），但 §3.2:125 要求业务词命名——待主理人拍板后另行改文案（改完可能变单行）。
- 26a/26b 是结构断言；纯 CSS 层面的对齐回归仍需可视回归/人工量测（`/tmp/measure-label3.mjs` 可复跑）。
- 未触碰：D4 七天留存、`canAccessTuning` 门禁、策略预览整宽、hub/原型文件、主工作区。

---

## 八、thinking 行折行（2026-10-29 二次修正，dev 复测抓到）

#489 合并并发布 dev（master `ac8dc94e`）后，主理人在 dev 复测发现：**四个数值控件对齐了，但 thinking 那一行的整块 control 折到了 label 下方、左缘退回行首**。

### 8.1 症状（dev 实测，1440）

| 行 | label 左 | `.ant-form-item-control` 左 |
|---|---|---|
| Temperature | 253 | **337** |
| 输出上限 maxTokens | 253 | **337** |
| Top P | 253 | **337** |
| **thinking** | 253 | **253**（折到下一行，从行首排） |
| 最大步数 max_steps | 253 | **337** |

是「label 左置 84px」这次改动带来的新问题（control 列可用宽从 569 收到 485）。

### 8.2 根因（定量，含一次错误假设的排除）

主理人初判「radio 组三按钮 ≈550px > 483，组太宽把 control 挤下去」。实测**否定**了它：

| 行 | extra 文案 max-content | radio 组 max-content | 可用宽（1440/1280） |
|---|---|---|---|
| Temperature | 287 | — | 485 / 405 |
| 输出上限 maxTokens | 237 | — | 485 / 405 |
| Top P | 352 | — | 485 / 405 |
| **thinking** | **535** ← 超预算 | **292** ← 放得下 | 485 / 405 |
| 最大步数 max_steps | 182 | — | 485 / 405 |

真因链条：`wrapper-col` 用 `flex: 1 1 auto` → **flex-basis:auto 时基线尺寸取内容 max-content**；antd `.ant-form-item-row` 默认 `flex-wrap: wrap`；thinking 行的 control max-content = max(extra 535, radio 292) = **535 > 485** → 整块 control 折行。其余四行 extra 182–352 均 < 485，故只有 thinking 折。

**对照实验（先证伪再动手）**：

| 变体 | 改动 | 结果 |
|---|---|---|
| A（主理人初判方案） | 只加 `.ant-radio-group{display:flex;flex-wrap:wrap;gap:8px}` | **仍折行**：control 左缘 337/337/337/**253**/337，`foldedRows=[thinking]` |
| B（真修法） | A + `wrapper-col flex:'1 1 0'`（basis 归 0） | **不折行**：337×5，`foldedRows=[]` |

→ 「只让 radio 换行」治不了这个病；必须让 control 的**基线尺寸**不再取 max-content。

### 8.3 最终实现

```vue
:label-col="{ style: { width: '84px' } }"
:wrapper-col="{ style: { flex: '1 1 0', minWidth: 0 } }"   ← basis 0：control 恒占 label 之外剩余宽
```

```css
/* 防御：更窄容器（侧栏展开/更小视口）下按钮组内部换行，最小占宽降到单按钮 ≈124px */
.b3-tuning :deep(.ant-radio-group) { display: flex; flex-wrap: wrap; gap: 8px; }
```

- `:deep()` 是必要的（antd 子组件内部类，scoped 样式够不到）；
- 按钮间隙统一走 `gap`，不靠 margin；
- **不缩字号、不压 padding 硬塞一行**——1280 下三按钮仍一行，1024 下自然换两行（见 8.4）。

### 8.4 几何实测（三视口）

| 视口 | 五行 control 左缘 | 折行行 | radio flex-wrap | 组右溢 control | radio 底 − extra 顶 | 横向滚动 |
|---|---|---|---|---|---|---|
| 1440 | **337 / 337 / 337 / 337 / 337** | 无 | wrap | 0 | 0 | 无 |
| 1280 | **337 / 337 / 337 / 337 / 337** | 无 | wrap | 0 | 0 | 无 |
| 1024（窄容器验证） | **337 / 337 / 337 / 337 / 337** | 无 | wrap | 0 | 0 | 无 |

1024 下 control 宽 277 < radio 292 → 按钮组自然换行：第 1 行「未配置 (NULL)」(337–461) +「enabled」(469–552)、第 2 行「disabled」(337–423)，组高 72（两行×32+8 gap），**不溢出 control（右缘 614 = control 右缘）、不与 extra 重叠（组底 1295 = extra 顶 1295）**。

截图：`/tmp/final-1440-panel.png`、`/tmp/final-1280-panel.png`、`/tmp/final-1024-panel.png`。

### 8.5 机检补洞（26c/26d）与「判据有效性」

上一版 26a/26b 只覆盖 label 列与数值 input，**等于把 thinking 整行排除在外**——这才是缺陷绿着过关的原因。

- **26c**：`wrapper-col` 的 flex 必须是 `'1 1 0'`，且不得残留 `'1 1 auto'`（防回退到 max-content 基线）；
- **26d**：源码中 `.ant-radio-group` 规则必须含 `flex-wrap: wrap`（防窄容器下按钮溢出）。

**判据为什么必须从「数 input 左缘」改成「数 control 左缘」**（同一构建、同一页面实测，注入 basis:auto 缺陷）：

| 判据 | 实测值 | 结论 |
|---|---|---|
| 旧：四个数值 input 左缘 | `337 / 337 / 337 / 337` | **全等 → 绿（瞎）** |
| 新：五行 control 左缘 | `337 / 337 / 337 / 253 / 337` | **不等 → 红（有效）** |

折行时 input 在折下来的 control **内部**，input 左缘只能是 337——这就是旧判据结构性看不见该缺陷的原因。

### 8.6 变异验证

| 变异体 | 注入 | 结果 |
|---|---|---|
| ① 删掉 `.ant-radio-group` 的 `flex-wrap: wrap` | python 替换 | **仅 26d FAIL**（❌ 失败 1 项） |
| ② `wrapper-col` flex `'1 1 0'` → `'1 1 auto'` | python 替换 | **仅 26c FAIL**（❌ 失败 1 项）；真实页面同步复现 `ctrlLefts=[337,337,337,253,337]`、`foldedRows=[thinking]` |

还原后 diff 仅本任务两文件。

### 8.7 验证门（本次）

| 门 | 结果 |
|---|---|
| `vue-tsc --noEmit` | exit 0 |
| `eslint src/views/Agents/AgentTuningPanel.vue` | exit 0 |
| `npm test`（apps/admin） | 9 suites / 115 tests 全过 |
| `verify-agent-def-detail.mjs` | **149 项全过**（26a/26b/26c/26d） |
| `build-agents-hub.mjs` 重生成 | hub diff = 0（本次纯实现，hub 不改） |
| `verify-agents-hub.mjs` | 243/246——同上 3 条既有菜单漂移 |

### 8.8 遗留 / 风险

- 26c/26d 仍是结构断言（file:// 机检量不到 app 几何）；真实几何靠 `/tmp/measure-label4.mjs`（数 control 左缘，含 radio 行）复跑——**后续量测请用它，不要再用只数 input 的旧脚本**。
- thinking 行 extra 文案 max-content 535px 是折行的触发源；若后续按 §3.2:125 改成业务词短文案，max-content 会缩短（basis 0 仍然是对的，不必回退）。
- 未触碰：D4 七天留存、`canAccessTuning` 门禁、策略预览整宽、hub/原型、主工作区。

## 九、label 右对齐（用户 2026-10-29 追加拍板）

用户在左对齐版本上追加拍板：**label 文字右对齐**（84px 定宽不变）。改动仅 `AgentTuningPanel.vue` 一处 + 机检两条。

### 9.1 改动

1. `label-align="left"` → `label-align="right"`（prop 落位，无 CSS hack 替代 prop）。
2. **判据盲区实测**（这是本次的核心发现）：只有 prop 是不够的。antd 把 prop 落成
   `.ant-form-item-label` 的 `text-align: end`（管列内摆放），但 `<label>` 本身是
   **inline-flex 容器**、`justify-content` 默认 normal（≈flex-start）→ 容器内文字仍贴左。
   只改 prop 时五个 label 文本右缘实测 `335/325/319/319/323`（不全等），且
   「Temperature」文本 82px > 内容盒、溢出到距控件仅 **2px**（拍板要求 ≥8px）。
   需三条配套（均已落 scoped CSS，见 9.2）：
   - ① label 容器 `justify-content: flex-end`（flex 容器内文字对齐由它管）；
   - ② 清掉 `:colon="false"` 下**仍占位**的 `::after` 冒号位——antd 对无冒号 label 的
     处理是 `content: " "` + `margin: 0 8px 0 2px`（实测 `getComputedStyle(lab,'::after')`），
     字符不渲染但 10px margin 仍在 flex 布局里占位，右对齐时把文字顶离列右缘
     （实测文字右缘 327 vs 列右缘 337）；
   - ③ 列距 `column-gap: 12px` 落在 `.ant-form-item-row` 上——原型 `.fitem{gap:12px}`
     的口径。**不占用 84px 定宽**（若用 padding-right 挤在 84px 内，「Temperature」82px
     文本反而溢出内盒贴向控件）。

### 9.2 几何实测（1440 / 1280 双视口，`/tmp/measure-label5.mjs`，vite + dev 后端代理）

| 行 | label 文本右缘 | control 左缘 | 间距 | 行数 | 逐行右缘 |
|---|---|---|---|---|---|
| Temperature | 337 | 349 | 12 | 1 | 337 |
| 输出上限 maxTokens | 337 | 349 | 12 | 2 | **337 / 337**（两行均右对齐，无首行右次行左） |
| Top P | 337 | 349 | 12 | 1 | 337 |
| thinking | 337 | 349 | 12 | 1 | 337 |
| 最大步数 max_steps | 337 | 349 | 12 | 2 | **337 / 337** |

- 五行文本右缘 `337×5` 全等、五行 control 左缘 `349×5` 全等，两视口**逐像素一致**（label 列定宽，与视口无关）。
- 间距 12px ≥ 拍板的 8px（12px 即原型 `.fitem{gap:12px}`，非新发明口径）。
- `scrollWidth === innerWidth`（1440/1280 均无横向滚动）；radio 单行（高 32）、`radioRightVsCtrlRight=0`、`radioBottomVsExtraTop=0`（不与 extra 重叠）。
- 截图：`/tmp/right-align2-1440-panel.png`、`/tmp/right-align2-1280-panel.png`。

### 9.3 机检（26e + 26f）

- **26e**：源码 `label-align` 必须为 `"right"` 且不得残留 `"left"`（注释剥离后计数）。
- **26f**：右对齐三条配套（label 规则含 `justify-content: flex-end`、`::after` 规则含
  `content: none` + `margin: 0`、`.ant-form-item-row` 规则含 `column-gap: 12px`）。
- **为什么两条而非一条**：26e 对 9.1 的盲区是瞎的——prop 为 right 时文本右缘仍可参差。
  变异实测（同一份代码）：

| 变异体 | 注入 | 结果 |
|---|---|---|
| ① `label-align="right"` → `"left"` | python 替换（仅模板 prop） | **仅 26e FAIL**（❌ 失败 1 项），26f 仍绿 |
| ② 删掉 `justify-content: flex-end` | python 删行 | **仅 26f FAIL**（❌ 失败 1 项），26e 仍绿——证明 26e 单独存在是瞎的 |

还原后 `verify-agent-def-detail.mjs` **151 项全过**（149 + 26e + 26f）。

### 9.4 验证门（本次）

| 门 | 结果 |
|---|---|
| `vue-tsc --noEmit` | exit 0 |
| `eslint src/views/Agents/AgentTuningPanel.vue` | exit 0 |
| `npm test`（apps/admin） | 10 suites / 124 tests 全过 |
| `verify-agent-def-detail.mjs` | **151 项全过**（含 26e/26f） |
| `build-agents-hub.mjs` 重生成 | hub diff = 0（本次不动原型/hub） |
| `verify-agents-hub.mjs` | 243/246——仅既有 8b/8e/9r 菜单漂移（master 上的「封面素材」菜单项增量，与本改动无关） |

### 9.5 遗留 / 风险

- page-spec §2.1「label 对齐」行原写 `label-align="left"`，本轮已同步为右对齐拍板口径（单独 commit，先于 UI commit 落库作 Proto 凭证）。
- 产品同学出《表单控件与开关规范》时，本行即基线：**label 右对齐 + 84px 定宽 + 列距 12px（原型 `.fitem{gap:12px}`）**；antd 无冒号 label 的 `::after` 占位（10px）是全局坑，规范落地其他表单时同样要清。
- 未触碰：D4 七天留存、`canAccessTuning` 门禁、策略预览整宽、thinking 折行修复（§八）、hub/原型、主工作区。
