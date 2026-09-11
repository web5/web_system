# 页面规格书 · 模型（ModelsPage，由「模型 + 模型单价」两表合并为单表）

> 配套：`design.md`（先读设计）｜模板：`docs/ui/page-spec-template.md`
> 状态：**待评审**，未写码
> 影响文件：`apps/admin/src/views/Settings/ModelPricingPage.vue`（重写并更名 `ModelsPage.vue`）、`apps/admin/src/router/index.ts`、`apps/admin/src/api/model-pricing.ts`（删除）、`apps/admin/src/api/dict.ts`（复用）

---

## 页面类型与参照

- **页面类型**：列表管理页（单表 CRUD + 弹层表单）
- **参照页**：现 `ModelPricingPage.vue`（Token 化写法、`a-table` + `a-modal` 形态），信息架构对齐 `DictManagePage.vue` 的明细区
- **需求一句话**：把「模型是否可用」与「模型价格」收在一张表里维护，不再出现同一模型两行、也不漏配价格

## 页头

- 标题：`模型`
- 副标题：`维护可用模型与计价（数据存于字典 llm_models，Agent 侧 60s 内生效）`
- 主操作：`新增模型`（右上 primary，唯一）
- 次操作：`刷新`、`去字典管理`（link，跳 `settings/dicts/llm_models`）

## 模块清单（自上而下）

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 |
|---|------|-------------|---------|---------|
| 1 | 页头 | — | 标题 + 副标题 + 主操作/次操作 | — |
| 2 | 一致性提示条 | 由当前表格数据本地计算（`enabled && 未配价`） | `a-alert`（`type=warning`，`show-icon`），无差异时**不渲染** | — |
| 3 | 模型表 | `GET /admin/dict/types/llm_models/items`（`pageSize=200`，本页不做分页器，模型量级 ≤ 数十） | `a-table`（行内操作 + 状态开关） | `还没有可用模型，点右上「新增模型」添加` |
| 4 | 新增/编辑弹层 | `POST /admin/dict/items`、`PUT /admin/dict/items/:id` | `a-modal` + 按 `dict_fields` 动态渲染表单（复用字典项表单逻辑） | — |
| 5 | 删除确认 | `DELETE /admin/dict/items/:id` | `a-popconfirm` | — |

### 一致性提示条文案

- 有未配价模型时：
  `有 N 个启用中的模型未配置单价，这些模型的 run 成本将记为 0。` + 操作按钮 `只看未配价`（点击后表格筛选）。
- 点击 `只看未配价` 后提示条变为可关闭的筛选态：`已筛选「未配价」模型，共 N 个` + `查看全部`。

## 表格列清单

| 列 | 来源字段 | 展示规则 | 操作 |
|----|---------|---------|------|
| 模型 id | `value` | `.ws-mono`，`--ws-text-primary` | — |
| 展示名 | `label` | `--ws-text-secondary` | — |
| 提供方 | `attrs.provider` | 直接出值；空值展示 `—` | — |
| 上下文 | `attrs.context_window` | 数字千分位 + `k` 后缀（如 `128k`）；空值 `—` | — |
| 输入价 / 1K | `attrs.input_price_per1k` | `¥ 0.000000`（`.ws-mono`）；未配价显示 `未配置` tag（`warning`） | — |
| 输出价 / 1K | `attrs.output_price_per1k` | 同上 | — |
| 币种 | `attrs.currency` | 默认 `CNY`，`USD` 时价格前缀 `$` | — |
| 状态 | `enabled` | `a-switch`；停用行整体 `--ws-text-tertiary` | 行内切换（即时保存） |
| 排序 | `sort` | `a-input-number`（行内，失焦保存）或 `↑↓` 按钮 | 行内 |
| 操作 | — | `编辑` / `删除`（2 个，直接铺，不折叠） | 行内 |

列较多 → `a-table :scroll="{ x: 'max-content' }"`。

## 弹层表单（新增 / 编辑）

- **渲染方式**：按 `dict_fields` 动态渲染（`llm_models` 当前 7 个字段：provider、context_window、supports_vision、note、input_price_per1k、output_price_per1k、currency），字段增删后页面自动跟随，**不在前端硬编码字段**。
- **固定区（不走动态渲染）**：`模型 id（value）`、`展示名（label）`、`状态（enabled）`、`排序（sort）`。
- 新增时 `模型 id` 可编辑（`^[A-Za-z0-9._/-]+$`，提交前查重提示）；编辑时只读（字典项 value 为唯一键，后端 `updateItem` 不接受改 value，改为禁用 + tooltip：`模型 id 不可修改；如需更换请新建后停用旧的`）。
- 价格字段：`a-input-number`，`:min=0`、`:precision=6`、`style="width:100%"`，helper 文案 `每 1K tokens 价格（CNY）`。
- `currency` 为 `enum` → `a-select`，默认 `CNY`。
- 校验：必填（`provider`）由后端 `validateAttrs` 兜底，前端按 `required` 提前标红；价格留空视为「未配价」。

## 交互清单

| 操作 | 触发 | 反馈 | 破坏性 → 确认文案 | 完成后 |
|------|------|------|------------------|--------|
| 新增模型 | 页头主操作 | success/error message | 否 | 关弹层，刷新表格 |
| 编辑模型 | 行内「编辑」 | 同上 | 否 | 回填 → 刷新 |
| 切换启用/停用 | 行内 `a-switch` | 同上；切换为「停用」时**无需确认**（可恢复） | 否 | 就地更新，`Agent 下拉 60s 后移除该模型` 的轻提示 |
| 改排序 | 行内输入/箭头 | 同上 | 否 | 就地更新 |
| 删除模型 | 行内「删除」+ popconfirm | 同上 | 是：`删除后使用该模型的 run 记录将无法在字典中解释；建议改用「停用」` | 刷新表格 + 一致性提示重算 |
| 只看未配价 | 提示条按钮 | 表格加筛选态 | 否 | 展示 `查看全部` 恢复 |
| 加载失败 | — | 顶部 `a-alert` error + `重试` | — | 可重试 |
| 保存中 | 弹层 OK | 按钮 `loading` + `maskClosable=false` | — | 防重复提交 |

## 状态覆盖自查

- [x] 加载中：表格 `loading`、按钮 `loading`
- [x] 空态：无模型 → 出路文案（指向「新增模型」）；**筛选态空态**：`当前筛选下没有模型`
- [x] 失败可重试：顶部 alert + 重试
- [x] 破坏性二次确认：仅「删除」需要（启停/排序可恢复，不弹确认）
- [x] 禁用有 tooltip：编辑态下 `模型 id` 禁用 → tooltip 说明原因
- [x] 保存中防重复提交
- [x] 无弹窗套弹窗：行内不用二级弹窗
- [x] 长文本：`note` 不在此表出列（保留在字典编辑页）

## 涉及 Token（不写裸值）

`--ws-text-primary` / `--ws-text-secondary` / `--ws-text-tertiary` / `--ws-bg-surface` /
`--ws-border-base` / `--ws-brand-500` / `--ws-brand-soft` / `--ws-font-mono` / `--ws-font-size-caption`

## 风险 / 待澄清

1. **权限归属**：本页底层调 `admin/dict`（`system:dict:view` / `system:dict:manage`），而旧的单价页用 `agents:cost:view`。
   合并后：
   - 菜单与页面访问 → 建议用 `system:dict:view`；
   - `agents:cost:view` 保留给成本/观测相关页面（`AgentRunList` 等）。
   若现有只读角色只配了 `agents:cost:view`，上线后会出现「菜单消失」——需在发布说明中提示**同步权限点**（发布流水线已自动化，见 playbook §7 坑 2）。
2. **菜单命名**：左侧菜单项从 `模型` 改为 `模型`（不变），但副标题明确「存于字典 llm_models」，避免与「字典管理」重复感。
3. **分页**：模型量级小，本页一次拉 200 条不分页；若未来超过 100 条再引入服务端分页。
4. **价格显示位数**：`precision=6` 与后端 `decimal(12,6)` 对齐（迁移前的历史口径）；若评审决定改「每 1M 报价」，此列格式化规则与 §4.1 字段口径需同步调整。
