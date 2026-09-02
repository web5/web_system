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
