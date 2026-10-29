# 调参面板 label 对齐——a-form-item 放回 vertical 上下文

- 日期：2026-10-29
- 分支：`feat/agent-tuning-label-vertical`（基于 `origin/master` @ `0742cc6f`）
- Proto 凭证：`062ed3f3`（调参区布局单列化原型提交，`git merge-base --is-ancestor` 已验）
- 评审对象：`apps/admin/src/views/Agents/AgentTuningPanel.vue`、`scripts/verify-agent-def-detail.mjs`、`docs/ui/page-specs/agent-def-detail-v2.md`
- 用户意见（唯一一条）：dev 上功能可用，但**表单 label 要对齐**——四个数值控件 label 右缘各不相同

## 一、根因（先查证，后动手）

真实页面量测（本地 vite 起真实代码 + dev 网关 API，1440px，量测脚本 `/tmp/measure-label2.mjs`）：

```
hasFormParent: false        ← .b3-tuning 内外都没有 <form>
inVerticalForm:  false
```

五个 `a-form-item` 在 `AgentTuningPanel.vue` 里是**裸的**——游离在 form 上下文外。
ant-design-vue 的 FormItem 拿不到 `layout` 时回落 **horizontal**，且 label 列宽按各自文字宽自适应：

| 控件 | label 右缘 = 输入框左缘（改前，px） |
|---|---|
| Temperature | 349 |
| 输出上限 maxTokens | 398 |
| Top P | 303 |
| 最大步数 max_steps | 397 |

最大差 95px——与用户截图症状完全吻合（dev 上独立量测一遍，四值相同，见 `/tmp/dev-before.log`）。

同页基础配置卡 `AgentDefDetail.vue:42` 是 `<a-form layout="vertical" :model="form">`——**只有调参面板**的 form-item 落在 horizontal 上下文里。

## 二、前提勘误（口径差异，如实记录）

任务前提称「原型参数面板的字段结构是 label 在上、控件在下」。查证结果**相反**：
原型 `docs/ui/prototypes/admin-agent-def-detail.html` 的参数面板（`:883` `.params` 起全部 8 行字段）
用的是 **label 左置固定 84px 栅格**：

- `:215-216` CSS 注释：「上一版 label 上置 + hint 各占一行 → 每字段 3 行、整卡看起来『一堆小字』。现统一为『左 label / 右控件 / 控件下一行短 hint』，控件左缘对齐，行数减半。」
- `:217` `.frow{display:flex;…}`、`:221` `.flb{flex:0 0 84px;…}`、`:224` `.fld{flex:1;…}`
- 文件头 v2.1 调整 ⑦：「表单细节『看起来好乱』→ **label 左置栅格（控件左缘对齐）**」

也就是说原型**刻意放弃过 label 上置**来达成「控件左缘对齐」。两种做法都能让左缘对齐，本次按拍板执行 vertical，理由：

1. **页内一致性**：同页基础配置卡已实现为 vertical（实现与原型在该卡上也已存在同类偏差），整页表单统一 vertical 比两卡两套栅格更可维护；
2. **不引入固定 label 宽度**（`labelCol`/`label-width` 是明确排除项）；
3. 用户诉求（对齐）达成效果等价：四控件左缘全部对齐、label 上置后右缘天然一致。

原型本稿不改（「原型不用改」的结论成立，但理由是本条记录的口径差异，不是「原型就是 label 在上」）。

## 三、改动

### `AgentTuningPanel.vue`

1. 五个 `a-form-item`（含 budget 预览行）包进 `<a-form layout="vertical" :model="{}">`：
   - `:model="{}"` 仅为补齐 form 上下文；字段值仍走 `defineModel` 直连父组件，**数据流不变**；
   - `a-form` 无 `@finish` 且 antd 自带 `submit.prevent`，Enter 不会触发提交；
2. `.b3-tuning` 类与全部既有样式**原样保留**（包裹发生在类内部，不改选择器）；
3. 文件头注释补拍板记录。

### `.b3-budget-preview` 负上边距——实测后决定：不动

`margin: -8px 0 16px` 实测（thinking=enabled 态）：

| | 上方 form-item 底 | 预览框顶 | 视觉间距 |
|---|---|---|---|
| 改前 | 1693 | 1709 | **16px**（24 margin-bottom − 8） |
| 改后 | 1781 | 1797 | **16px**（同） |

vertical 下间距与改前完全一致，不照搬调整；实测结论已写进 CSS 注释。

## 四、实测数据（改前 → 改后）

| 指标 | 改前 | 改后 |
|---|---|---|
| 四个数值输入 left（px） | 349 / 398 / 303 / 397 | **253 / 253 / 253 / 253**（容差 0） |
| label 右缘 | 349 / 398 / 303 / 397（各不相同） | 822（label 整行宽，右缘一致） |
| label 盒底 vs 输入框顶 | 1421 > 1365（同行，无序） | **1395 = 1395**（label 底 = 控件顶，恒成立） |
| 输入框宽 | 473 / 424 / 519 / 425 | 569（= 面板全宽） |
| form 上下文 | 无（horizontal 回落） | `form.ant-form-vertical` ✓ |
| 横向滚动 | 无（scrollWidth 1440 = innerWidth） | 无（1440 = 1440） |

截图（/tmp）：
- 改前 `/tmp/app-before-panel.png`、`/tmp/app-before-budget.png`
- 改后 `/tmp/app-after-panel.png`、`/tmp/app-after-budget.png`

复现：本地 `vite --config`（worktree 真实代码）+ dev 网关 API 经 puppeteer 请求拦截透传
（vite 代理层对 dev 网关间歇 500，拦截转发更稳；量测脚本 `/tmp/measure-label2.mjs`）。

## 五、机检（verify-agent-def-detail.mjs，145 → 147 项）

本脚本是 **file:// 原型机检**（与本地服务解耦，见 `docs/api/contracts.md`「无头验证」），
量不到真实 app 几何；原型本身左缘本就对齐，几何断言放原型上恒真、必空转。
故 26a/26b 按 25a/25d 先例做成**静态结构断言**（断言成因），几何证据见上文第四节实测表：

- **26a**：`<a-form layout="vertical"` 开标签在首个 `<a-form-item` 之前、`</a-form>` 闭标签在最后一个 `</a-form-item>` 之后——五个 form-item 必须整体处于 vertical 上下文；
- **26b**：禁走「固定 label 宽度」补丁——不得出现 `label-col` / `labelCol` / `wrapper-col` / `wrapperCol` / `label-width` / `labelWidth`。

### 变异验证（判据不是摆设）

| 变异体 | 注入方式 | 结果 |
|---|---|---|
| ① 撤掉 a-form 包裹（回到 horizontal 回落态） | python 删 `<a-form …>` / `</a-form>` 两行 | **仅 26a FAIL**（❌ 失败 1 项）；真实页面复测几何同步回退：`numericLefts = [349,398,303,397]`、`AllEqual=false`、`labelBottomsLE=false`——精确复现用户报的症状 |
| ② 注入 `:label-col="{ style: { width: '84px' } }"` 固定宽度补丁 | python 替换 `<a-form …>` 标签 | **仅 26b FAIL**（❌ 失败 1 项） |

两变异体均单独命中目标断言、互不误伤；还原后 diff 干净（仅本任务两文件）。

## 六、验证门

| 门 | 结果 |
|---|---|
| `vue-tsc --noEmit` | **exit 0** |
| `eslint src/views/Agents/AgentTuningPanel.vue` | **exit 0** |
| `npm test`（apps/admin） | **8 suites / 108 tests 全过** |
| `verify-agent-def-detail.mjs` | **147 项全过**（含新 26a/26b） |
| `build-agents-hub.mjs` 重生成 | **hub diff = 0**（未手改生成物） |
| `verify-agents-hub.mjs` | 243/246——3 条 FAIL（8b/8e/9r）经 stash 基线复跑确认为**既有**菜单漂移（BasicLayout 新增「封面素材」），非本次引入 |

## 七、遗留 / 风险

- ⚠️ **原型口径差异未闭环**：本稿实现为 vertical，原型定稿为 label 左置 84px 栅格（§二）。两者左缘对齐效果等价，但若后续整页回归原型像素稿，需要补一次口径对齐（改原型或改实现，须再拍板）。
- 机检 26a/26b 是结构断言，真实几何依赖人工跑量测脚本（§四）——若未来 FormItem 上下文被绕开（如样式覆盖），结构断言仍会拦 26a，但纯 CSS 层面的对齐回归需另行可视回归。
- 改动未触碰：D4 七天留存、`canAccessTuning` 门禁、策略预览整宽结构、hub/原型文件。
