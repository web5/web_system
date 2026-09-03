# 科豆 AI · Admin 系页面判断层规范（design.md）

> 版本：v0.1（草案，待批注）｜ 日期：2026-09-03
> 定位：AI 生成/改造 admin 系页面的**判断层**（管"怎么排、怎么交互"），与 Token 约束层、走查验证层配套。
> 事实源分级：**所有数值一律引用 `packages/ui/src/tokens.ts` / `tokens.css`（不在此重复抄值）**；判断条目以本文档为准；回流规则以《geist-token-评审记录.md》为准。
> 配套文档：《page-spec-template.md》（生成前必填）；读取地图见《README.md》；DR/回流模板见《archive/geist-token-需求文档.md》§9、《archive/geist-token-实现文档.md》§5.3/5.4。

---

## 0. 何时加载（适用边界）

- **适用**：deploy-console / admin / mcp-admin / 未来内部工具端。**任何 UI 任务**（新页面、大改、视觉调整、交互修改）生成代码前必须先读本文档 + 填页面规格书。
- **不适用**：portal / mini-app 品牌端（DR-5，Claymorphism 品牌 DNA，不套 admin 系规范）。
- 机制目标：**生成前 30 秒改规格，好过生成后 3 屏再推翻**。本文档不追求 AI 一次到位，追求偏差可预期、可快速修正。

## 1. 页面类型模板（先判定类型，再谈布局）

新页面第一步不是画布局，是**回答"这是哪类页 + 参照谁"**。类型判定写进页面规格书第 1 行。

| 类型 | 骨架顺序（定死，勿自创） | 参照页（真实存在） |
|---|---|---|
| 列表/管理页 | 页头 →（可选统计卡）→ 筛选条 → 表格 → 分页 | deploy-console `ServiceManager.vue`、admin `UserList.vue` |
| 详情页 | 面包屑/页头 → 概览卡 → 分区信息块 →（关联列表） | `ModuleDetail.vue`、`PipelineDetail.vue`、`UserDetail.vue` |
| 表单/向导页 | 分组表单 / 分步条（步骤清晰、可回退） | `DeployCenter.vue`、`PipelineCenter.vue` |
| 仪表盘/监控 | KPI 卡行 → 图表区 → 明细列表（数据驱动，勿堆装饰） | `Dashboard.vue`、`ServiceMonitor.vue` |
| 登录/例外页 | 例外（专属视觉，改前须注明"例外"） | `Login.vue`（R1 已标记） |

**列表页双参照裁决（2026-09-03）**：
- **ServiceManager = 视觉/Token canonical**：唯一已过 R1 验收的 token 化页面，视觉、间距、状态色照它长。
- **UserList = 页头信息架构补充**：标题 + 副标题 + 右上主操作的页头形态并入列表页模板；UserList 自身视觉未灰度，不作为视觉参照。

## 2. 布局铁律（判断条目）

1. 主操作（primary）一屏 ≤ 1 个，放页头右上或表格区左上；次操作 default；危险操作 danger 语义。
2. 行内操作 > 3 个折叠进 dropdown，不铺满操作列。
3. 数据类页面页头/筛选/表格三区顺序固定；**禁止插入无信息量的创意模块**（装饰卡、无意义 banner）。
4. 布局用 antd 栅格，不自造布局体系；卡片/面板用 `.ws-hairline`（shadow-as-border，评审 R1-4），普通分隔线用 border。
5. 信息密度对齐参照页（ServiceManager 为准）：同屏操作数、表头字号、行高不得明显更疏或更挤。
6. 页头形态（列表页推荐）：h1 标题 + caption 级副标题（一句话说明此页用途）+ 主操作。
7. 数字列开 `tabular-nums`；端口/ID/路径/代码列加 `.ws-mono`。
8. 文案克制：按钮动词开头（"重启""新建"）；不要"您""亲爱的"等冗余敬语；副标题一句话，禁产品宣传腔。
9. 颜色只编码语义（状态 success/error、内置 brand），**类型/枚举不配色**（评审 R1-1 回流规则）。
10. **互斥单选且选项 ≤5 且固定时，用 `a-tabs` 或 `a-radio-group`，不用 `a-select`**（R2 升格 · 用户反馈）。
    - ≤4 个选项：`a-tabs`（横向完整展示，更显眼）
    - 5 个或横向空间紧：`a-radio-group`
    - `a-select` 仅用于：选项动态（>5）、选项文案过长、需要搜索
    - **适用边界（R6 澄清）**：强制范围 = **页面主导筛选维度**（浏览型页面顶部的互斥切换，如灰度管理按环境 / 服务管理按类型）；豁免 = 表单内选择字段（动态选项/提交字段）、复合查询表单（多字段 + 日期范围 + 查询/重置，如 AuditLog）
11. **hover/active 反馈分层，禁止随意定义 hover 色**（R3 升格 · 约定详见《color-reference.md》§3）：
    - 容器类（表格行/菜单项/下拉项）：hover = `--ws-bg-hover`；按压 active = `--ws-bg-active`（tokens 补 gray-300 阶梯）
    - 悬浮触发器类（header 用户卡/图标按钮）：**默认不加整块灰底**，用文字色加深（secondary→primary）或透明度/阴影微反馈
    - 深色固定面板内的 hover/selected 透明叠加：升具名 token（--panel-item-hover / --panel-item-selected），禁散写 rgba
    - 禁 hover 状态写裸 hex/rgba/深浅随意的灰——一律走 `--ws-bg-*` 阶梯

## 3. 交互契约（状态矩阵）

每个"会产生结果的操作"必须覆盖下表，**不许只做成功路径**：

| 状态 | 要求 |
|---|---|
| 加载中 | 表格 loading / 按钮 loading；禁止假 loading（无 loading 状态却延迟展示） |
| 成功 | `message.success` 简短文案；列表类操作后刷新数据 |
| 失败 | `message.error` + 可重试路径（重试按钮或刷新入口），不静默失败 |
| 空态 | **原因 + 出路**（"暂无部署记录，点右上发起首次部署"）；禁裸"暂无数据" |
| 破坏性操作 | 必 `Modal.confirm`，文案写明后果（影响面/是否可恢复），禁直接执行 |
| 禁用态 | 按钮禁用时用 tooltip 说明原因（"需先启用环境"），禁无声禁用 |
| 弹窗嵌套 | 弹窗内不套弹窗；二级表单改 step 或抽 drawer |
| 编辑一致性 | 打开编辑弹窗即回填当前值；保存中禁重复提交（saving 锁） |

## 4. 视觉约束（Token 层，只引用不抄值）

- 所有颜色/圆角/字号/阴影引用 `--ws-*` CSS 变量或 `uiTokens`，**禁止裸 hex/rgba 进业务代码**。
- 组件级外观优先走 ConfigProvider（`antdTheme`），CSS 兜底用 `:deep` 且**不新增 `!important`**。
- 字重只用 400/500/600；标题梯度 h1 32 / h2 24 / h3 18 / h4 16（对齐 tokens.ts `font.size`）。
- 主橙 = DR-3 裁决值（tokens.ts `brand[500]`）；暖橙 accent 仅 hover/图表装饰，不参与主交互。
- 暗色不是"调暗"，同一 `--ws-*` 名下 light/dark 双值由 `[data-theme]` 切换；写新样式时两种主题都过目一遍。
- 图标用 SVG（@tabler/@ant-design icons），禁 emoji 当图标。

## 5. 生成后自检（验证层）

生成完对照验收，逐条给出**证据位置**（文件 + 行/组件），不空口"已完成"：

1. 页面类型与参照页一致，骨架未自创。
2. 全页无裸色/无新增 `!important`（grep 自查）。
3. 主路径 + 状态矩阵（§3）全部覆盖。
4. 切 `[data-theme='dark']` 无错位、无遗漏变量。
5. Before/After 截图存档到 `docs/ui/baselines/`（命名 `{app}-{page}-{before|after}.png`）。
6. 修正记录追加到 `docs/ui/geist-token-评审记录.md`（§5.4 模板；**同一问题第 2 次出现即升格为本文档条目**）。
7. **规则整改执行门**：规则升格若涉及 **≥2 文件 / 跨页面 / 跨端** 的批量整改 → 先向负责人产出《整改影响清单》（涉及文件 / 改动点 / 风险 / 工作量 / 优先级），**负责人确认后才动代码**（R6 教训：只升格规则不绑定整改文件，导致文档与代码脱节，如 R2 灰度筛选器漏改）。单文件小改可直达，但须在评审记录登记。

## 6. 事实源索引（防止多源漂移）

| 层 | 唯一事实源 | 备注 |
|---|---|---|
| 数值（色/圆角/字号/阴影） | `packages/ui/src/tokens.ts` ↔ `tokens.css`（须同值） | 两处人工同步，diff 核对 |
| 组件外观 | `packages/ui/src/antd-theme.ts` | ConfigProvider 单一出口 |
| 判断条目 | 本文档 | 版本化演进 |
| 回流规则 | `docs/ui/geist-token-评审记录.md` | 只追加不覆盖 |
| 决策（裁决） | `docs/ui/archive/geist-token-需求文档.md` §9 DR 表 | 新裁决补 DR，不口头推翻 |

---

*草案待用户批注。批注修订后升 v0.2 并进入流程固化（挂接 UI 任务强制加载）。*
