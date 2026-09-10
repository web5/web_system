# 页面规格书 · 字典管理（DictManagePage）

> 配套：`../specs/dict-module/design.md`（先读设计）｜模板：`docs/ui/page-spec-template.md` Full
> 状态：**待评审**，未写码

---

## 页面类型与参照

- **页面类型**：列表/管理页（主从双栏：左字典类型，右字典明细）
- **参照页**：`apps/admin/src/views/Settings/ModelPricingPage.vue`（Token 化写法、表格 + Modal 表单形态）；
  视觉/信息密度以 `deploy-console ServiceManager.vue` 为 canonical（design.md §1 裁决）
- **需求一句话**：让用户自己在后台维护字典/维表数据（首个字典：大模型清单），不靠改环境变量、不发版

## 页头

- 标题：`字典管理`
- 副标题：`维护系统维表数据；停用比删除安全，已落库的值仍可被解释`
- 主操作：`新建字典`（右上，primary，唯一）

## 模块清单（自上而下）

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 |
|---|------|-------------|---------|---------|
| 1 | 页头 | — | 标题 + 副标题 + 主操作按钮 | — |
| 2 | 主体双栏 | `GET /admin/dict/types` + `GET /admin/dict/types/:code/items` | `a-row`：左 6 列字典列表卡 / 右 18 列明细卡 | 左空：`暂无字典，点右上「新建字典」创建`；左搜索无果：`未匹配「xxx」，换个关键词或新建`；右空：`该字典暂无明细，点「新增字典项」添加` |
| 3 | 左：字典搜索框 | `keyword` 参数 | `a-input-search`（allow-clear，防抖 300ms） | 见上 |
| 4 | 左：字典类型列表 | 同上 | 列表：`名称`（次行 `.ws-mono` code）+ `内置` tag + 启用点 + 项数；**超过一屏内部滚动** | 见上 |
| 5 | 右：字典明细搜索 + 状态筛选 | `keyword` / `enabled` | `a-input-search` + `a-select`（全部/启用/停用，表单内字段豁免 tabs 规则） | — |
| 6 | 右：字典明细表 | 同上 | `a-table`（**服务端分页** `page`/`pageSize`，`showTotal`，`showSizeChanger`）+ 行内操作 | 见上 |
| 7 | **独立页面**：新建/编辑字典 | `POST`/`PUT /admin/dict/types` + `PUT …/fields` | 路由 `settings/dicts/:code`（面包屑 + 基本信息 + 字段定义表格 + 危险区 + 页脚保存/取消） | — |
| 8 | 弹层：新增/编辑字典项 | `POST`/`PUT /admin/dict/items` | `a-modal` + **按 `dict_fields` 动态渲染**的表单 | — |
| 9 | 删除确认 | `DELETE …` | `a-popconfirm`（字典项）/ `a-modal.confirm`（字典类型） | — |

## 表格/列表列清单（右侧明细表）

**固定列**（恒定出现）

| 列 | 来源字段 | 展示规则 | 操作 |
|----|---------|---------|------|
| Value | `value` | `.ws-mono`，`--ws-text-primary` | — |
| 名称 | `label` | `--ws-text-secondary` | — |
| 排序 | `sort` | `tabular-nums`，升序在前 | — |
| 状态 | `enabled` | `a-switch`；停用时该行 `--ws-text-tertiary` | 行内切换 |
| 更新时间 | `updatedAt` | `YYYY-MM-DD HH:mm:ss`，`.ws-mono` | — |
| 操作 | — | 编辑 / 删除（2 个，直接铺，不折叠） | 行内 |

**动态列**（来自 `dict_fields`，排在 "Value"/"名称" 之后、**排序**之前）

| 来源 | 展示规则 |
|---|---|
| `type=string/number/enum/date` | 直接出值；`enum` 显示其 `label` 而非 value |
| `type=boolean` | `a-tag`（启用/停用语义色） |
| `type=text` | 超长 `ellipsis` + tooltip |

动态列表头 = `field.label`；**全部字段都出列，不做「更多」折叠**，列多时表格整体横向滚动
（`a-table :scroll="{ x: 'max-content' }"`），并在字段 > 3 个时给一行浅提示"列较多，可左右滑动"。

左侧字典列表项：名称（`--ws-text-primary`）+ code（`.ws-mono` 次行）+ 内置 tag（`--ws-brand-*` soft）+ 项数角标；选中态用 `--ws-brand-soft` 底色 + `--ws-brand-500` 文字。

## 字段定义区（字典编辑页内，2026-09-10 用户选定）

- 载体：**字典编辑页内的表格**（页面宽度足够，行内直接编辑，不再用抽屉/弹层）。
- 列：`#` / 字段名(`name`) / 标签(`label`) / 类型(`type`，select) / 长度(`length`) / 必填(`required`，switch) / 枚举项或默认值 / 操作（↑↓ 排序、删除）。
- 类型联动：`enum` 行的最后一列变「枚举项（逗号分隔）」；`boolean`/`date`/`enum` 时长度输入禁用。
- 保存：随字典一起提交（`PUT /admin/dict/types/:code/fields` **整体覆盖**，前端负责校验字段名规则与去重）。
- 空态：`暂未定义字段，记录将只含 Value / 名称 两个字段`。
- 提示：`删除字段只丢这一列的值，不删数据行`。
- 已有明细的字典删除某字段时提示：`该字段在 N 条明细中已有值，删除后这些值不再展示（数据保留）`。
- 空态：`该字典暂未定义字段，明细只含 Value / 名称 两列`。
- 校验：`name` 唯一且符合 `^[a-z][a-z0-9_]*$`；`length` 正数；`enum` 至少 1 个选项。

## 交互清单

| 操作 | 触发 | 反馈 | 破坏性 → 确认文案 | 完成后 |
|------|------|------|------------------|--------|
| 新建字典 | 页头主操作 | success/error message | 否 | 关闭弹层，刷新类型列表并选中新字典 |
| 编辑字典 | 左侧行内「编辑」/右侧标题区 | 同上 | 否 | 刷新列表 |
| 删除字典 | 左侧行内「删除」 | 同上 | 是：「删除「大模型清单」将同时删除其下 N 个字典项，且不可恢复。已引用该字典的业务将回落至环境变量/内置默认值。」内置字典禁用删除（tooltip 说明原因） | 刷新并选中首个字典 |
| 新增字典项 | 明细区右上 primary | 同上 | 否 | 关闭弹层，刷新明细 |
| 编辑字典项 | 行内「编辑」 | 同上 | 否 | 回填当前值，刷新 |
| 停用/启用字典项 | 行内 `a-switch` | 同上 | 否（可恢复） | 就地更新 |
| 删除字典项 | 行内「删除」+ popconfirm | 同上 | 是：「删除后使用该值的历史数据将无法在字典中解释（建议改用「停用」）」 | 刷新明细 |
| 搜索字典（左） | `a-input-search` 输入/清空 | 300ms 防抖 | 否 | 就地过滤列表 |
| 搜索明细（右） | 同上 + 状态筛选 | 表格 loading | 否 | 重置到第 1 页并刷新 |
| 翻页 / 改每页条数 | `a-table` 分页器 | 表格 loading | 否 | 服务端取数（不做前端假分页） |
| 维护字段定义 | 编辑字典弹层「字段定义」Tab 内增删行 | 保存时 success/error | 否（但删除字段时提示影响行数） | 关闭弹层时随字典一起提交（REST：整体覆盖 `PUT …/fields`） |
| 字典项表单渲染 | 打开新增/编辑弹层 | 按 `dict_fields` 渲染对应控件，缺失值用 `default_value` 回填 | — | — |
| 加载失败（类型/明细/字段任一） | — | 顶部 `a-alert` error + [重试]；明细区保持上次数据不空白 | — | 可重试 |

## 状态覆盖自查（design.md §3）

- [x] 加载中：表格 `loading`、按钮 `loading`（骨架屏非必需）
- [x] 空态：左右各自原因 + 出路文案
- [x] 失败可重试：顶部 alert + 重试按钮
- [x] 破坏性二次确认：删类型（Modal.confirm）/ 删项（popconfirm），文案写明后果
- [x] 禁用有 tooltip：内置字典的删除按钮禁用 → tooltip「内置字典不可删除」
- [x] 保存中防重复提交：`saving` 锁
- [x] 无弹窗套弹窗：二级表单一律走独立 modal，不嵌套

## 涉及 Token（不写裸值）

`--ws-text-primary` / `--ws-text-secondary` / `--ws-text-tertiary` / `--ws-bg-surface` /
`--ws-border-base` / `--ws-brand-500` / `--ws-brand-soft` / `--ws-font-mono` / `--ws-bg-hover`

## 风险/待澄清（已由用户答复收敛）

1. ~~列表 vs Tab~~ → 定为**列表 + 右侧明细**，左侧**带搜索框**（用户明确要求）。
2. 字典项批量导入（CSV/JSON）：本期不做，POST 单条接口保留扩展空间（P3）。
3. 「项数」统计：`GET /admin/dict/types` 带 `itemsCount`（一次聚合查询，避免 N+1）。
4. 动态字段超过 4 个时列会很宽 → 归入「更多」列 + 横向滚动，若实际字典字段普遍较多再评估抽屉式详情（P3）。
