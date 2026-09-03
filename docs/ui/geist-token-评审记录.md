# geist-token · 评审记录

> 配套：《geist-token-需求文档.md》《geist-token-实现文档.md》（同目录）
> 按实现文档 5.4「评审回流」模板追加，**只追加不覆盖**。
> 同一问题第 2 次出现即升格为规则。

---

## R1 · 2026-09-02 · 试点首轮（deploy-console ServiceManager · M4 验收）

### 走查清单（实现文档 5.3）

| # | 检查项 | 结果 | 备注 |
|---|---|---|---|
| 1 | 主色/hover/active 全程品牌橙，无 antd 默认蓝紫 | ✅ | 主按钮橙；深色侧栏由 #001529 蓝紫改为中性 #171717 + 橙选中；头像渐变由 #1677ff 蓝改为品牌橙 |
| 2 | 页面背景灰/卡片白分层与 token 一致 | ✅ | light: page #FAFAFA / card #FFF（hairline 细边框）；dark: #0A0A0A / #1A1A1A 卡片浮起 |
| 3 | 无新增 !important；table/card/layout 经 ConfigProvider | ✅ | theme.css 0 条（原 20+ 条 → 0，减量 100%）；经全局 alias token + Layout/Menu 组件 token |
| 4 | 服务状态/按钮语义/表格数字/代码文本符合 5.2 | ✅ | 状态=success/default；内置=品牌橙徽标；key/dir/pm2/pub 列 .ws-mono + tabular-nums |
| 5 | 切 dark 无错位、无遗漏回退变量 | ✅ | 38 个主题相关 ws-* 变量 :root 与 [data-theme=dark] 集合 diff 相等（脚本核对 7.3） |
| 6 | 旧名 alias 存在期无回归 | ✅ | 本试点未消费旧名，未触达；alias 完整保留（7.1） |
| 7 | Before/After 截图已存档 | ⚠️ | After light/dark 已存 `docs/ui/baselines/`；Before 因改造前 antd 默认蓝紫脸不可回放，暂以需求文档 3.1 基线描述替代（下轮新页面必须先截 Before） |

### 修正记录（5.4 模板：问题 → 是否重复 → 可否观察化 → 归属 → 行动）

| # | 问题描述 | 是否重复 | 可观察行为 | 归属 | 行动 |
|---|---|---|---|---|---|
| 1 | ServiceManager 类型列 4 种 a-tag 预设色（blue/green/purple/orange）与克制范式冲突 | 新 | 类型标签同质化，仅"启用/内置"有色 | token/规则 | 类型 Tag 统一中性（bg-subtle+border-subtle）；颜色只编码"状态(success)/内置(brand)"语义 → 入规则 |
| 2 | antd 深色 Menu（theme="dark"）在 ConfigProvider 无可用组件 token（该版本类型无 darkItem* 键） | 新 | 侧栏仍为 antd 默认 #001529 | 组件/css 兜底 | `:deep(.ant-menu-dark)` 覆盖选中/hover + `.app-sider` 固定 #171717（反白面板，不随主题）→ 记录规则 |
| 3 | 头像/按钮默认蓝紫渐变（#1677ff）残留品牌外色 | 新 | 全页无蓝紫 | token | 头像改品牌橙渐变（brand-500 → accent）→ 入规则"角色识别/渐变用品牌色" |
| 4 | 页面卡片为 antd 实线边框，观感"格子化" | 新 | 卡片细边框平滑 | token/工具类 | 卡片用 shadow-as-border：`box-shadow: 0 0 0 1px var(--ws-border)`；theme.css 沉淀 `.ws-hairline` 工具类 |
| 5 | 内联裸色（#888 / #bbb 占位符） | 可能 | grep 可发现 | token | 替换 `--ws-text-tertiary` / `--ws-text-disabled`；下轮新页面由 lint 拦 |
| 6 | style.scss body 重复 font-family，与 ui theme.css 冲突（谁后加载谁赢） | 新 | 视觉漂移难查 | 规则 | 业务全局 css 不声明 font-family，由 ui theme.css 统一（--ws-font-sans） |
| 7 | style.scss 死代码 .status-tag-*（无任何页面消费） | 新 | grep 可发现 | 规则 | 删除（收口后清理） |
| 8 | 登录页深蓝品牌渐变保留（#1a1a2e→#0f3460），与 admin 系灰色调不一致 | 观察 | — | 观察 | 登录页专属视觉，本轮保留注释"例外"；后续单独裁决是否切品牌橙黑 |

### 本轮回流结论

- 进 token：灰阶/语义/角色变量全部沉淀（tokens.ts + tokens.css）；内联裸色清理。
- 进规则（本记录即首次沉淀）：
  1. 类型枚举不配色，颜色只编码"状态/内置徽标"类语义；
  2. antd Menu theme="dark" 及深色面板颜色覆盖走 `:deep` + 固定面板色（组件 token 类型不支持时 css 兜底，但不得用 !important）；
  3. 业务 css 不重复声明 font-family / reset；
  4. 全局样式死代码（无消费者 class）随改造清理。
- 观察：登录页品牌渐变、图表/echarts 色板（P2 灰度随 Dashboard 页评审）。

### 待办（后续迭代）

- Before 基线流程化：下轮新试点页改造前先截图存档。
- tokens.css 自动生成脚本（与 tokens.ts 同源）—— 当前人工同步 + 7.3 diff 核对。
- 灰度计划：admin → mcp-admin → shell（实现文档第 6 节），每端一页试点后全量。

---

## R2 · 2026-09-03 · 用户反馈：Selector 用法规范（升格 design.md §2 #10）

> 触发：用户指出灰度管理页（`CanaryCenter.vue`）"环境/模块"使用 `a-select`，违反"选项少且互斥时首选 Tabs/Radio"的判断原则。
> 性质：**单条规则首次出现即升格** —— R1 试点（视觉层）漏检了"控件选型"这一类判断维度；本条由用户口头反馈直接沉淀。

### 修正记录

| # | 问题描述 | 是否重复 | 可观察行为 | 归属 | 行动 |
|---|---------|---------|-----------|------|------|
| 1 | 灰度管理页"环境"用 `a-select`，4 个固定选项互斥单选，宜 `a-tabs` | 新 | 折叠选项增加操作成本；右侧"模块"项同理 | 规则 | 已升格 `design.md` §2 #10（≤4 用 tabs / 5 用 radio / 仅动态或>5 才用 select） |
| 2 | `ServiceManager.vue` "按类型筛选" 4 个固定类型（backend/frontend/micro-frontend/mini-app）同样用 select | 同 #1 | 黄金参照页亦犯此错 → R1 漏检 | 规则 | 同规则覆盖；整改时一并改 Tabs（按 §6 灰度节奏排期） |

### 观察

- R1 试点验收时聚焦"视觉/Token 收敛"，未覆盖"控件选型"类判断层。下轮灰度评审（R3 起）需把控件选型列入走查清单（§5.3 扩展项）。
- 灰度管理页"模块"项选项数动态（来自 deploy_deployments 表），按 #10 规则保留 select 合理；评注记录为"观察"不强制改。

---

## R3 · 2026-09-03 · 用户反馈：hover 高亮颜色治理（升格 design.md §2 #11 + 新建 color-reference.md）

> 触发：MainLayout 用户卡（`.user-trigger`）hover 为整块灰底（`--ws-bg-hover` #F2F2F2），浅色 header 上反馈近乎不可见、与圆形头像叠置观感脏。
> 根因：hover 无分层语义 —— 行/项/trigger/按压共用同一值；且深色侧栏 hover/selected 散写 rgba 裸值（R1 规则 2 的"固定面板色例外"允许了散写，未升具名 token）。

### 修正记录

| # | 问题描述 | 是否重复 | 可观察行为 | 归属 | 行动 |
|---|---------|---------|-----------|------|------|
| 1 | 用户卡 hover 整块灰底不优雅（浅底几乎无反馈 + 灰底套圆） | 新 | hover 反馈弱、形态脏 | 规则 | 升格 design.md §2 #11：悬浮触发器类不加整块灰底，用文字加深/阴影微反馈 |
| 2 | hover 无分层：行/项/trigger/按压共用 `--ws-bg-hover`，无 active 阶梯 | 新 | 无按压态表达 | token | tokens.roles 补 `bgActive`（gray-300：light #EBEBEB / dark 待定稿） |
| 3 | 深色侧栏 hover/selected 散写 alpha（`rgba(255,255,255,.06)` / `rgba(249,115,22,.18)`）与 `#ededed`/`#a3a3a3` | 新 | grep 裸值可发现 | token | R1 规则 2 例外面板色升具名 token（--panel-item-hover/selected）；扫全仓库同类 |
| 4 | 头像阴影 `rgba(249,115,22,.25)`、头像渐变（已 token） | 新 | grep 可发现 | token | 阴影 alpha 进 tokens.shadow 或透明引用（已登记 color-reference.md §4） |

### 观察

- R1-5"lint 拦裸色"只覆盖了业务页面，**深色面板/头像等 header 区域例外值未被拦截** → 扩大裸值扫描范围至 layouts/全局组件。
- 治理结论落 `docs/ui/color-reference.md`（颜色定义点地图）：色值只能出现在 8 类位置，hover 色只有 6 种 Token 来源，不得自行发明深浅。

### 待办（下轮迭代）

- [ ] tokens.roles 补 `bgActive`（light #EBEBEB / dark 值核 gray 阶梯）。
- [ ] MainLayout 深色侧栏裸值 → 具名 token；用户卡 hover 按 §3 弱反馈整改。
- [ ] 全仓库裸色扫描（color-reference §5 命令），登记/清理。

---

## R4 · 2026-09-03 · !important 清零 + 外壳色收敛 + bgActive 落地（R3 遗留实操）

> R3 三项待办本轮全部落地；全部改动通过 lint；`!important` CSS 声明清零（grep 验证，仅注释提及）。

### 落地明细

| # | 事项 | 做法 | 验证 |
|---|---|---|---|
| 1 | style.scss 4 处 `!important`（.app-sider 背景 / .logo-text / .app-header 背景 + 边框） | Header 背景 → App.vue `Layout.colorBgHeader`（app 侧扩展，共享 antdTheme 保持中性）；Sider 背景 → MainLayout.vue scoped `:deep(.ant-layout-sider.app-sider)` (0,3,0)（**ant-design-vue 4.2.6 实测无 `siderBg` token**）；logo-text/边框提特异去 `!important` | grep 无声明级 !important；lint 0 |
| 2 | antd-theme `SIDER_BG` #171717 与 style.scss #0F0F12 漂移 | 统一为 #0F0F12（colorBgTrigger 与侧栏同色） | 注释留痕 |
| 3 | 外壳散写 rgba/hex（menu hover/selected、sider/header 容器、文字） | 升 app 局部变量 `--dc-panel-*`（style.scss `:root`，遵循 css-override §3 app 局部 `--app-*` 规则，不进共享 tokens） | MainLayout scoped 全部改 var 引用 |
| 4 | tokens.roles 补 `bgActive` | light #EBEBEB（gray-300）/ dark #333333（按压微亮）| tokens.ts ↔ tokens.css 双同步 |
| 5 | Beehive logo `#001529`/`#F5A623` | 登记 color-reference §4 品牌图标例外（不参与主题） | 保留 |

### 遗留（下轮）

- 用户卡 hover 按 color-reference §3 弱反馈整改（`.user-trigger:hover` 灰底改文字加深 + caret 反馈）——本轮未动 `.user-trigger`，避免与"头像 hover 不优雅"问题混淆，单独一轮做并截图对比。
- 视觉回归目检：本轮为结构整改（色值全部等价迁移），需 `pnpm dev` 目检确认外壳视觉无回退。

---

## R5 · 2026-09-03 · 用户卡 hover 弱反馈整改（R3 用户反馈闭环）

> R3 用户反馈的"头像 hover 不优雅"最终落点：`.user-trigger:hover` 原用 `--ws-bg-hover`（浅灰 #F2F2F2）铺整块灰底，在 deploy-console **深色 header**（#161618）上突兀刺眼——根因是"浅色面板 hover 色被用在深色外壳的可点击触发器上"（hover 语义错配，color-reference §3 已沉淀该规则）。

### 变更（MainLayout.vue scoped）

- hover 底：`var(--ws-bg-hover)` → `var(--dc-panel-menu-hover)`（白 6% 透明，深壳 hover 语言，与侧栏菜单 hover 同款）。
- hover 文字：`.user-name/.user-role/.user-caret` tertiary → `var(--dc-panel-header-text)`（#f5f5f5）提亮。
- transition 补 `color 0.2s`。

### 验证

- lint 0；规则落 color-reference §3（深壳内触发器 hover 参考本节）。
- 待用户 `pnpm dev` 目检 hover 观感（Before = 浅灰块，After = 白 6% subtle 块 + 文字提亮）。

### 观察

- 本轮顺带确认：header 内所有 hover 触发（用户卡等）应统一用"深壳语言"（--dc-panel-menu-hover 白透明），不可引用随主题的浅色面板 hover（--ws-bg-hover）。已作为 color-reference §3 补充认知，后续 header 内新触发器直接沿用。

---

## R6 · 2026-09-03 · R2 控件选型代码整改落地（用户验收指出遗漏）

> 触发：发布验收时用户指出"灰度管理筛选器仍用 select"。R2 只升格了规则，代码整改（灰度管理页）漏排期——R2 记录待办未闭环的教训：**升格规则必须同轮绑定一个"整改者"（具体文件），否则文档与代码脱节**。

### 落地

| # | 事项 | 做法 |
|---|---|---|
| 1 | CanaryCenter 环境筛选 select → `a-tabs`（页面主导筛选维度，design.md §2 #10） | envId 用 a-tabs 切换即刷新；模块（动态）保留 select + 查询按钮 |
| 2 | **更正 R2 #2 误报**：ServiceManager 类型筛选在试点改造时已是 `a-tabs`（template 174-181），并非 select——R2 登记时只核对了 script 未核对 template | 评审记录只追加原则下，以此更正为准 |

### 同类扫描结论（R2 规则适用边界澄清）

- **适用**：页面主导筛选维度（浏览型页面顶部互斥切换，如灰度管理按环境、服务管理按类型）。
- **豁免**：
  - 表单内选择字段（PipelineSubmit/PipelineCenter 的 env/module/template/branch/release/grayscaleType）——动态选项或提交字段；
  - 复合查询表单（AuditLog 环境/操作类型 + 日期范围 + 查询/重置）——多字段查询工具栏，select 紧凑合理。
- 结论已足够支撑走查：**新页面"主导筛选维度"互斥单选 ≤5 必须 tabs/radio；工具型表单 select 不违规**。下轮把此边界补进 design.md §2 #10 措辞。

### 观察

- AuditLog 环境筛选**硬编码 dev/prod**（未走 environmentApi），与系统环境表（dev/local/prod/prev）不一致——下轮改走环境 API，避免审计日志查不到 local/prev 环境操作。

---

## 整改 Backlog（负责人确认 · 2026-09-03 起生效）

> 流程（design.md §5-7）：升格规则涉及 ≥2 文件/跨页/跨端 → 先出本清单 → **负责人勾选后才动代码**。勾选方式：在对应行追加 `✅ 已确认` 或直接告知编号。

| # | 候选项 | 影响文件 | 改动点 | 状态 |
|---|---|---|---|---|
| A | design.md §2 #10 补适用边界（R6 结论） | `design.md` | 文档措辞补充 | ✅ 2026-09-03 |
| B | AuditLog 环境筛选走 `environmentApi` | `AuditLog.vue` | select 选项动态化 | ✅ 2026-09-03 |
| C | 头像阴影 alpha token 化（R3 #4 遗留） | `MainLayout.vue` + tokens | 加 `shadow.avatar` / `--ws-shadow-avatar` | ✅ 2026-09-03 |
| K | 死代码清理（logo-title/logo-text-block） | `MainLayout.vue` | 删未用 class | ✅ 2026-09-03 |
| D | **admin 接入 @web-system/ui** | admin 多文件 | 删 style.css（-271 行，17 !important 清零）→ ui tokens.css/theme.css + antdTheme；默认主题 dark→light（负责人裁决）；mf cssScope 豁免 :root 确认可行 | ✅ 2026-09-03 发布 2c36dab + 目检通过（默认亮色生效）；注：admin 旧 style.css 本就是 ui 前身拷贝（#F97316 早一致），接入为**架构收敛**（去双份/去 !important/antd token 全量），视觉变化小属预期 |
| E | ~~mcp-admin 独立灰度~~ | — | — | ✅ 已取消：mcp-admin 无独立模块（已并入 admin `/mcp` 页 McpAdminPanel，D 覆盖）；shell 基座独立评估（登录/容器视觉另议，非 admin 系 mf token 灰度对象） |
| F | tokens 同步校验脚本 | `scripts/check-tokens-sync.mjs` | diff 校验（剥离注释，防"ts 改 css 忘同步"） | ✅ 2026-09-03（生成器有覆盖 alias 风险，采用只读校验替代） |
| G | 登录页渐变裁决 | Login + tokens | 视觉决策 | ⏸ 待负责人拍板：保留深蓝 / 切品牌橙黑 |
| H | echarts 色板 token 化 | `Dashboard.vue` | 图表/状态色改 `uiTokens` 常量（echarts 不解析 CSS var，DOM 内联改 `--ws-*` var） | ✅ 2026-09-03 |

> 已闭环不在此列：R4 !important 清零、R5 用户卡 hover、R6 CanaryCenter tabs。
