# 页面规格书 · 模型（ModelsPage，只读总览）

> 配套：`design.md`（先读设计）｜模板：`docs/ui/page-spec-template.md`
> 状态：**待评审**，未写码
> 影响文件：`apps/admin/src/views/Settings/ModelPricingPage.vue`（重写并更名 `ModelsPage.vue`）、`apps/admin/src/api/model-pricing.ts`（删除）、`apps/admin/src/router/index.ts`（路由不变，仅组件与标题）、复用 `apps/admin/src/api/dict.ts`

---

## 0. 定位（用户 2026-09-11 裁定）

**模型的维护统一在「字典管理」**，「模型」页不再提供任何写操作：

| 维护对象 | 去哪 | 形态 |
|---|---|---|
| 表的定义（`llm_models` 字段：provider / context_window / supports_vision / note / input_price_per1k / output_price_per1k / currency） | 字典管理 →「编辑」 | **独立页面**「字典编辑」（`settings/dicts/llm_models`） |
| 记录（每个模型及其价格） | 字典管理 → 明细区「新增记录 / 编辑」 | **抽屉式**表单（`a-drawer`，按 `dict_fields` 动态渲染，价格字段自动出现） |

因此本页存在的唯一价值：**一眼看清"哪些模型可用、价格多少、谁还没配价"**，并把维护动作一键跳到字典管理。这样彻底消除"两处维护"，同时保留成本视角。

> ⚠️ 这是本页与设计文档 §7 待确认 9 的对应形态。若你更希望**直接下线本页**（模型完全并入字典管理），本节及下方表格整体作废，我改为删除菜单 + 路由。

## 页面类型与参照

- **页面类型**：只读总览页（单表 + 一致性提示，无写操作）
- **参照页**：`DictManagePage.vue`（Token 化、`a-table` 信息密度）、现 `ModelPricingPage.vue` 的页头写法
- **需求一句话**：模型清单与价格的**查看**入口（维护走字典管理），并能立刻发现"漏配价"

## 页头

- 标题：`模型`
- 副标题：`清单与价格维护在「字典管理 · 大模型清单」；本页用于总览与漏配检查（Agent 侧 60s 内生效）`
- 主操作：`去字典管理维护`（右上 primary，跳 `settings/dicts/llm_models`）
- 次操作：`刷新`

## 模块清单（自上而下）

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 |
|---|------|-------------|---------|---------|
| 1 | 页头 | — | 标题 + 副标题 + 主/次操作 | — |
| 2 | 漏配提示条 | 本地计算（`enabled && 未配价`） | `a-alert`（`type=warning`，`show-icon` + 跳转按钮），无则不渲染 | — |
| 3 | 模型总览表 | `GET /admin/dict/types/llm_models/items?pageSize=200`（本页不分页，量级 ≤ 数十） | `a-table`（只读，无行内操作，仅一个跳转链接） | `还没有可用模型，去「字典管理」添加` |
| 4 | 加载失败 | — | 顶部 `a-alert` error + `重试` | — |

### 漏配提示条文案

`有 N 个启用中的模型未配置单价，它们的 run 成本将记为 0。` + 按钮 `去看这些模型`（点击筛选表格为"未配价"）。

## 表格列清单

| 列 | 来源字段 | 展示规则 |
|----|---------|---------|
| 模型 id | `value` | `.ws-mono`，`--ws-text-primary` |
| 展示名 | `label` | `--ws-text-secondary` |
| 提供方 | `attrs.provider` | 直接出值；空 `—` |
| 上下文 | `attrs.context_window` | 千分位 + 后缀（如 `128k`）；空 `—` |
| 输入价 / 1K | `attrs.input_price_per1k` | `¥ 0.000000`（`.ws-mono`）；未配价 → `未配置` tag（`warning`） |
| 输出价 / 1K | `attrs.output_price_per1k` | 同上 |
| 币种 | `attrs.currency` | 默认 `CNY`；`USD` 时价格前缀 `$` |
| 状态 | `enabled` | `a-tag`（启用 `success` / 停用 默认色）；停用行整体 `--ws-text-tertiary` |
| 操作 | — | `在字典中编辑`（link → `settings/dicts/llm_models`，带该行 `value` 作为搜索词预填） |

- 列较多 → `:scroll="{ x: 'max-content' }"`。
- 表格**无行内写操作**（无 switch、无删除），避免与字典管理重复维护。

## 交互清单

| 操作 | 触发 | 反馈 | 完成后 |
|------|------|------|--------|
| 去字典管理维护 | 页头主操作 | 路由跳转 | 进入字典编辑页（字段定义） |
| 在字典中编辑 | 行内 link | 路由跳转 | 进入字典管理页并预填搜索词为该模型 id |
| 去看这些模型 | 提示条按钮 | 表格加「未配价」筛选态 | 按钮变 `查看全部` |
| 刷新 | 页头次操作 | 表格 loading | 重新拉取 |
| 加载失败 | — | error alert + 重试 | 可重试 |

## 状态覆盖自查

- [x] 加载中：表格 `loading`
- [x] 空态：无模型 → 出路文案指向字典管理；筛选态空态 → `当前筛选下没有模型`
- [x] 失败可重试：顶部 alert + 重试
- [x] 破坏性二次确认：**本页无破坏性操作**（全为只读/跳转）
- [x] 禁用有 tooltip：不适用（无禁用按钮）
- [x] 无弹窗套弹窗：本页无弹层

## 涉及 Token（不写裸值）

`--ws-text-primary` / `--ws-text-secondary` / `--ws-text-tertiary` / `--ws-bg-surface` /
`--ws-border-base` / `--ws-brand-500` / `--ws-font-mono` / `--ws-font-size-caption`

## 权限与菜单

- **权限**：`system:dict:view`（与其它字典表一致，**不新增权限点** —— 用户 2026-09-11 裁定）。
  菜单项 `models` 的 `v-if` 从 `agents:cost:view` 改为 `system:dict:view`。
- **旧权限**：`agents:cost:view` 保持存在，继续给成本/观测相关页面使用（本页不再依赖它）。
- 影响提醒：若有只读角色仅配了 `agents:cost:view`，上线后 `模型` 菜单会消失 —— 需在发布说明中提示去角色页勾选 `system:dict:view`（发布流水线会自动同步权限点本身，角色勾选仍需人工）。

## 风险 / 待澄清

1. **本页是否保留**：见 §0 的说明（保留只读总览 / 直接下线）。
2. **价格显示位数**：`precision` 展示 6 位小数与 `decimal(12,6)` 口径一致；若评审决定改「每 1M 报价」，本列格式与 design §4.1 同步调整。
3. **模型量级**：一次拉 200 条不分页；超过 100 条再引入服务端分页。
