# 圆角存量收敛方案（第 6 步 / 分批执行）

> 上游：`specs/radius-style-dual/page-spec.md`（§2 语义档契约 / §3 机制与实现约束 / §5 存量策略）
> 状态：**方案待负责人确认分批顺序**；每批独立执行 + 验证 + 提交（按动作门，批量机械改动可走 `UI_GATE=off` 豁免）

## 1. 现状盘点（2026-09-23 实测）

| 端 | 裸值处数 | 文件数 | Top 文件 |
|---|---:|---:|---|
| portal | 134 | 29 | Draw 14 / Create 11 / LoginPanel 10 / Home 9 / Profile 8 / Album 7 |
| 小程序 | 156 | 31 | contract/result 22 / chat/index 11 / bianbian/create 10 / contract/assistant 9 / taste 8 |
| admin | 59 | 17 | BianbianManage 14 / AgentPlayground 12 / UserList 6 / BasicLayout 4 |
| deploy-console | 51 | 14 | OrchestrationEditor 12 / ProgressFlow 9 / StepBranchEditor 4 / PipelineEdit 4 |
| **合计** | **400** | **91** | |

## 2. 映射规则（按语义定档，禁止只按数值替换）

⚠️ **同一数值在不同语义下归一档会制造新的不一致**（如 `8px` 在标签上是 chip、在卡片上是 card）。判定顺序：先看元素**是什么**，再看数值是否接近当前端该档的值。

| 元素语义 | 目标档 | 说明 |
|---|---|---|
| 标签 / 徽标 / 小色块 / 微角 / 代码片段背景 | `--r-chip` | 点状、条状小元素 |
| 输入框 / 按钮 / 选择器 / 下拉 / 分段控件 / 日期选择 / 上传按钮 | `--r-control` | 可交互控件 |
| 卡片 / 面板 / 弹窗 / 抽屉 / 列表容器 / 表格容器 / 浮层 | `--r-card` | 容器类 |
| 胶囊按钮 / 开关（轨道 + 圆钮）/ 标签式筛选片 | `--r-pill` | 形状语义（R5：开关归 pill） |
| 头像 / 状态点 / 圆形图标 | `border-radius: 50%` | **不改**（R3 例外） |
| 气泡贴边角 / 贴边抽屉 | `border-radius: 0` | **不改**（R3 例外） |

**数值线索（仅用于定位候选，不直接决定归属）**：`≤4px` 多为 chip；`6–8px` 在 admin 为 control、在品牌端为 card/chip；`10–16px` 多为 card；`≥20px` / `999px` 多为 pill 或刻意大圆角。

**端内取值**（按各端 token 层，不跨端套用）：

| 档 | admin / console（px） | portal（px） | 小程序（rpx，1px≈2rpx） |
|---|---|---|---|
| chip | 4 | 4 | 8 |
| control | 6 | 6 | 12 |
| card | 8 | 8 | 16 |
| pill | 9999 | 9999 | 999rpx |

## 3. 分批计划（建议顺序：小 → 大、已就绪 → 待判断）

| 批 | 范围 | 处数 | 选它的理由 |
|---|---|---:|---|
| **P1** | admin（17 文件） | 59 | 最小；语义档与 antd 映射已验证（LG/SM 零变化） |
| **P2** | deploy-console（14 文件） | 51 | 次小；外壳固定深色，圆角独立不受主题干扰 |
| **P3** | portal 高频页（Profile / Home / Album / LoginPanel / Memory / Glossary / Taste） | ~45 | 含已 token 化页面作对照，便于建立手感 |
| **P4** | portal 剩余（Draw / Create / tools/* 等） | ~89 | 裸值混排最多（12/14/16/20px 并存），需逐个判断 |
| **P5** | 小程序主包（10 页） | ~60 | 与 30 页 `{{radiusClass}}` 绑定配套验收 |
| **P6** | 小程序分包（20 页） | ~96 | 最后做（含 contract/result 22 处最大单文件） |

## 4. 例外清单（一律不改）

- `border-radius: 50%`、`border-radius: 0`
- 刻意的大圆角：如小程序 `24rpx`（=12px）卡片、`999rpx` 胶囊 —— 若该端语义档已覆盖则归 card/pill，否则保留
- 非圆角来源的圆角：如 `overflow: hidden` 容器的临时值（需保留视觉，改 token 前先确认该处是"设计意图"还是"顺手写的值"）

## 5. 每批验收（缺一不可）

1. **计数**：该批文件的裸值计数归零，或仅剩 §4 例外；
2. **视觉一致**：柔和档下与改动前**逐处一致**（AC2 的局部版）——必要时用浏览器读 computed 抽样比对；
3. **切换可用**：三档切换下该页无异常（无负值、无角部撕裂）；
4. **提交**：每批一个 commit，message 带 `Proto: <sha>`（本文件的 commit）与 `Design: pass`；跨多端的机械批可走 `UI_GATE=off`。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 语义误判 → 同层级更不一致（比不收敛更糟） | 按 §2 顺序判定；每批抽检 10% 处；拿不准的**保留原值**并在批记录里标注 |
| 品牌端与 admin 档值不同，套用会错 | §2 的端内取值表；禁止跨端套用 |
| 回归面大（400 处） | 严格分批（P1→P6），单批 ≤60 处 |
| 与并行「原型侧整改」重叠 | 原型侧由 `specs/ui-prototype-token-alignment` 负责；本方案只做**落地代码侧**，不碰 `docs/ui/prototypes/**` 与 `apps/*/prototype/**` |
