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
