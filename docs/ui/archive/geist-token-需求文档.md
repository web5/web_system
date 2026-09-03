# Geist 范式 Token 化改造 · 需求文档

> 项目：web_system 前端统一 UI 层（@web-system/ui）升级
> 版本：v1.0（草稿待评审）
> 日期：2026-09-02
> 状态：待评审（评审通过后按 P0 开工）
> 关联实现文档：`docs/ui/geist-token-实现文档.md`（同目录）

---

## 0. 文档用途（跨会话接力说明）

本文档 + 同目录《geist-token-实现文档.md》是本改造的**唯一事实源（source of truth）**。
任何新会话开始本任务时，先读这两份文件，再按实现文档第 0 节的「新会话接力清单」开工。
核心决策均记录于本文档第 9 节，新会话不得在未评审情况下推翻既有决策。

---

## 1. 背景与动机

### 1.1 缘起（决策链回溯）

1. **2026-09-02 阅读《当审美成为基础设施：Vercel 如何用 design.md 重构 Agent 设计》**
   结论：Vercel 的资产是「design.md 管判断 + 公共样式表管约束 + 评测闭环管验证」的三层设计工程系统。
2. **评估"web_system UI 库能否换成 Vercel 的 UI"**
   调查结论（事实）：
   - Vercel 的 UI 体系 = **Geist**，由三部分组成：设计 Token/规范（框架无关）、Geist 字体（OFL 开源）、组件库（`@vercel/geist-ui` / `@geist-ui/core`，**仅 React，官方无 Vue**）。
   - web_system 前端 5 个 app（portal / admin / deploy-console / mini-app / shell）全部为 **Vue3 + ant-design-vue 4.x**，微前端基座 shell 亦为 Vue3。
   - 用户工程原则：**统一 Vue/TS 栈**（全栈 TypeScript，不做 React 双栈分裂）。
3. **决策**：组件库层面**不换**（React-only，换栈成本不可接受）；**采纳 Geist 的 Token 范式与克制范式**，移植进现有 `packages/ui`（antd 主题适配层），聚焦 **admin 系内部工具端**。

### 1.2 要解决的问题（现状痛点）

- `ant-design-vue` 默认视觉（蓝紫主色、默认脸）与"工程感"内部工具定位不符，各 app 大量临场 CSS 覆盖（含 `!important`）。
- `packages/ui` 已存在 Token 雏形，但**命名是"组件级"而非"语义 scale 级"**（如 surface-0~4 / text-primary 等，无 100~1000 分步语义），且**几乎未被 app 实际消费**（2026-09-02 探测：apps 内无 `@web-system/ui` css/theme 的 import；deploy-console 自带 style.scss 自成体系）——规范与落地脱节。
- 无暗色主题的工程化路径（tokens.css 中 `[data-theme='dark']` 为"预留未启用"）。
- 无 design.md 式"判断层"规范，AI 出页仍靠每轮提示词碰运气。

### 1.3 为什么是现在

- **deploy-console admin 端重构窗口期**（微前端迁移中），重构期顺手建基线成本最低。
- 多端（portal/admin/deploy-console/mcp-admin）需要统一 Token 单一来源，越早收敛，后续端越省。

---

## 2. 目标与边界

### 2.1 目标（Goals）

1. 将 `packages/ui` 升级为**语义分步 Token 体系**：色板/中性灰走 100~1000 分步语义（借鉴 Geist color scale 的 intent 编码），并补齐 typography / 圆角 / 间距 / 阴影 / 边框 Token。
2. 建立 **Light / Dark 双主题的工程化路径**（Token 级双值 + 单一 `[data-theme]` 开关）。
3. **antd ConfigProvider 主题化**：把 Token 映射进 antd v4 theme token（含组件级 token），大幅收敛 `theme.css` 中的 `!important` 覆盖。
4. 以 **deploy-console「服务管理」页**为试点，先肉眼可见地摆脱 antd 默认脸，沉淀「页面基线 → 人工修正 → 回流 Token/规则」的闭环样板。
5. 沉淀一份**判断层规范**（design.md 式，短版），供 AI 在本仓库生成 admin 页面时遵循。

### 2.2 非目标（Non-Goals）

- ❌ 不引入 React / `@vercel/geist-ui` / `@geist-ui/core` 组件库。
- ❌ 不改变 portal / mini-app / 品牌落地页的 Claymorphism 品牌 DNA（暗底 #0A0A0D、橙 #F97316、青 #4ECDC4 的 C 端气质不受影响；admin 系与品牌端 Token 分离）。
- ❌ 不做一次性全量替换：admin / mcp-admin 等端按灰度节奏跟进（见实现文档第 6 节）。
- ❌ 本轮不做截图评测平台（只存人工基线 + 对照表，机制先行）。

### 2.3 成功标准（可观察）

- P0 完成后：`packages/ui` 输出「语义 Token + antd 主题」单一包，deploy-console 服务管理页不再出现 antd 默认蓝紫主视觉、无新增 `!important` 覆盖、全部颜色/圆角/字体引用来自 Token。
- `theme.css` 中既有 `!important` 覆盖条目减量 ≥ 70%（转移进 antd 组件 token）。
- `[data-theme='dark']` 切换在试点页可正常工作（Layout/Table/Card/Form 全套跟随）。
- 下次 AI 生成 deploy-console 新页面时，产出物可直接引用 Token 与判断层规范，人工修正轮次减少（主观体验指标，试用一版后回填）。

---

## 3. 现状基线（2026-09-02 探测，新会话可复核）

### 3.1 packages/ui（唯一 UI 规范包，pnpm workspace 内）

| 文件 | 现状要点 |
|---|---|
| `packages/ui/src/tokens.css` | `:root` 定义科豆橙品牌（--color-brand-50~700、--accent #FF8C42）+ Element Plus 风格中性系；分组：surface / card / header / text / border / input / table / modal / overlay / shadow / tab / tag / login / chart。浅色默认；`[data-theme='light']` 重复一份；`[data-theme='dark']` 已有一版值但未启用。**命名=组件级，非语义 scale** |
| `packages/ui/src/theme.css` | 全局 reset + antd Layout/Menu/Table/Card/Statistic 覆盖 + 登录页样式，**大量 `!important`** |
| `packages/ui/src/antd-theme.ts` | 极简：仅 `colorPrimary/colorInfo/colorLink = #F97316`、`borderRadius: 4` |
| `packages/ui/src/setupAntd.ts` | `setupAntd` 安装 + `message` 导出（未读细节，实现时确认） |
| `packages/ui/package.json` | name `@web-system/ui`；exports：`.`(dist) / `./tokens.css` / `./theme.css`；dep：ant-design-vue ^4.2.0、vue ^3.5.0 |
| 消费现状 | **apps 内几乎无实际消费**（grep `@web-system/ui` 仅 admin/McpAdminPanel.vue 一处理性命中；无 css/theme import）。deploy-console 自带 `src/style.scss` 自成体系 |

### 3.2 前端 app 依赖一览（5 端全 Vue3 + antd-vue 4.x）

| app | 关键依赖 | 备注 |
|---|---|---|
| portal | ant-design-vue、@tabler/icons-vue、@ant-design/icons-vue | 用户端 |
| admin | ant-design-vue、echarts、vue-echarts | 管理端（含 McpAdminPanel.vue 引用 @web-system/ui） |
| deploy-console | ant-design-vue、dayjs | **试点端**，自带 style.scss |
| shell | ant-design-vue + @web-system/shell-loader | 微前端基座 |
| mini-app | 无运行时依赖 | 微信小程序（jest/miniprogram 测试栈），不在本次范围 |

### 3.3 deploy-console 页面清单（试点候选）

`apps/deploy-console/src/views/`：Dashboard / ServiceManager / ServiceDetail / ServiceMonitor / DeployCenter / PipelineCenter / ConfigCenter / ModuleDetail / EnvironmentManager / ServiceAddressManager / AuditLog / Login（12 页）。
**试点选定：ServiceManager（服务管理）** —— 列表 + 状态标签 + 操作按钮 + 搜索，信息密度最高、形态最典型、评审意见最容易重复。

### 3.4 已有规范文档

- `docs/ui/ui-design-spec.html`：《科豆 AI · UI 设计规范》单页（含品牌橙系变量，注意其 --brand-500=#FF8C42 与 tokens.css 的 #F97316 **两套橙色值不一致**，本轮需统一裁决）。
- `docs/ui/` 下另有 Vercel design.md 启示分析（本次改造之外的上游文档，见第 8 节）。

---

## 4. 设计原则（继承的工程约定）

1. **统一栈**：Vue3 + TS + ant-design-vue，不引入 React/新框架。
2. **Token 单一来源**：所有颜色/圆角/字号等不允许裸值进业务代码；antd 组件走 ConfigProvider token，业务样式走 CSS 变量。
3. **系统化重构而非打补丁**：收敛 `!important` 覆盖为组件 token 声明，不逐条加码。
4. **语义 scale 编码 intent**：颜色每一步代表用途（100 背景 / 200 hover / 400 边框 / 700 实心 / 900 次文本 / 1000 主文本），不靠"看着像"。
5. **暗色是独立主题而非"调暗"**：同一 Token 名下 light/dark 双值，由 `[data-theme]` 切换。
6. **分层消费**：admin/deploy-console 类内部工具端 → Geist 式克制范式；portal/mini-app 品牌端 → Claymorphism，两套并行不串。
7. **可检测优先于可劝告**：能进 token/lint 的约束不进自然语言。

---

## 5. 需求清单（P0 / P1 / P2）

### P0（本轮必须完成，试点闭环）

| # | 需求 | 验收 |
|---|---|---|
| P0-1 | `packages/ui` 新增语义 Token 层（中性灰 100~1000 + 品牌橙 scale + 语义色 success/warning/error/info + typography/radius/spacing/shadow 分组），light/dark 双值 | 新文件通过 lint；值全部来自一处，无重复散落 |
| P0-2 | 统一橙色裁决：spec（#FF8C42）与 tokens（#F97316）二选一作为品牌主色，其余拉齐 | 决策记录于实现文档 2.2 |
| P0-3 | `antd-theme.ts` 升级为完整 ThemeConfig：全局 token（colorPrimary/colorText/colorBgLayout/colorBorder/borderRadius/fontFamily/ControlHeight 等）+ 组件级 token（Layout/Menu/Table/Button/Card/Form 等） | 试点页不新增 `!important`；antd 主视觉脱离默认蓝紫 |
| P0-4 | deploy-console「服务管理」页试点改造完成 | 前后截图基线存档；走查清单通过（见实现文档 5.4） |
| P0-5 | `[data-theme='dark']` 试点页全套跟随（Layout/Table/Card/Form/状态色） | 手动切换无错位 |
| P0-6 | `theme.css` 收敛：既覆盖条目减量 ≥70%（转移进 antd 组件 token）；保留项注释原因 | 数量核对通过 |

### P1（本轮尽量，至少出方案）

| # | 需求 | 验收 |
|---|---|---|
| P1-1 | deploy-console `style.scss` 去裸值：颜色/圆角/字号全部改为 var() 引用 | grep 无裸 hex/rgba 残留（业务渐变色除外，须注释） |
| P1-2 | 表格数字启用 `tabular-nums`；代码/端口/标识类文本走 mono 栈（Geist Mono 或系统 mono fallback） | ServiceManager 列表肉眼可辨 |
| P1-3 | 判断层规范（短版 design.md）：admin 页生成时要遵循的"信息架构/层级/文案克制/避免套路"条目，落到 `docs/ui/` 并可在提示词中引用 | 文档存在且被试点评审引用 |
| P1-4 | 试点闭环样板：本次人工修正逐条记录 → 分流（进 token / 进规则 / 观察） | `docs/ui/geist-token-评审记录.md` 建立 |

### P2（后续迭代，本次只记录不实现）

| # | 需求 | 备注 |
|---|---|---|
| P2-1 | admin / mcp-admin / shell 灰度套用新 Token + antd 主题 | 依赖 P0 稳定后按端灰度 |
| P2-2 | Geist Sans/Mono 自托管引入（西文/数字增强），中文回退系统栈 | 离线部署场景需自托管；先行 P1-2 的系统 mono 方案 |
| P2-3 | 截图基线 → 半自动评测（固定 N 类场景 + 人工盲测 A/B） | Vercel 评测闭环的轻量版，机制先行 |
| P2-4 | 将 Token 规范沉淀为可在 WorkBuddy/AI 会话加载的规范文件（仓库 AGENTS.md 或用户级 skill 双份） | 沿用双目录同步习惯 |

---

## 6. 影响范围与风险总览

| 维度 | 说明 |
|---|---|
| 影响代码 | `packages/ui/*`（主要）、`apps/deploy-console`（试点 + style.scss）、后续灰度端 |
| 不动范围 | portal / mini-app / shell 视觉、品牌端 Token、后端服务 |
| 兼容性风险 | tokens.css 既有变量名若被引用需 alias 双写过渡（实测引用少，风险低）；antd v4 组件 token 名需对照官方类型核对 |
| 行为风险 | theme.css `!important` 收敛后可能出现个别组件样式回归 → 用走查清单 + 截图基线兜底 |
| 治理风险 | 两套橙色值并存是历史债，本轮必须裁决，否则规范再次分裂 |

---

## 7. 里程碑（建议节奏）

| 里程碑 | 内容 | 出口 |
|---|---|---|
| M1 | 评审本需求文档 + 实现文档 | 开工授权 |
| M2 | Token 语义层 + 主题裁决落地 packages/ui | P0-1/P0-2 验收 |
| M3 | antd-theme.ts 完整版 + theme.css 收敛 | P0-3/P0-6 验收 |
| M4 | 服务管理页试点 + 暗色验证 + 基线存档 | P0-4/P0-5 验收 |
| M5 | 评审记录回流 + 灰度计划确认 | P1 收尾，P2 排期 |

---

## 8. 关联上下文与文档索引（新会话回溯入口）

| 文档/事实 | 位置 | 作用 |
|---|---|---|
| 本需求文档 | `docs/ui/geist-token-需求文档.md` | 任务唯一事实源 |
| 详细实现文档 | `docs/ui/geist-token-实现文档.md` | 落地细节 + 接力清单 |
| Vercel design.md 启示分析（上游调研） | `~/WorkBuddy/2026-09-02-15-32-24/Vercel-design.md对web_system工程的启示.md` | 背景方法论 |
| 既有 UI 规范（待裁决/整合） | `docs/ui/ui-design-spec.html` | 品牌视觉参考 |
| 微前端技术设计（重构背景） | `docs/architecture/micro-frontend-technical-design.md` | deploy-console 演进上下文 |
| Geist 官方参考 | https://vercel.com/design.md 、github.com/vercel/geist-ui 、designsystems.one 分析 | 范式来源 |

---

## 9. 决策记录（DR）

| # | 决策 | 理由 | 状态 |
|---|---|---|---|
| DR-1 | 不换 UI 库，移植 Geist Token 范式 | Geist 组件库 React-only；统一 Vue 栈原则 | 已定 |
| DR-2 | 试点端 = deploy-console，试点页 = ServiceManager | 重构窗口 + 形态典型 | 已定 |
| DR-3 | 品牌主橙二选一（待评审）：建议以 **#F97316**（tokens.css/antd 现行）为规范主色，spec 文档 #FF8C42 作"暖橙强调色"降级 | 少改动、运行时一致优先 | **待确认** |
| DR-4 | 暗色主题 default = off（浅色为 canonical，沿用现状），但 Token 双值就绪、开关可随时启用 | 与 Geist dark-first 相反，尊重产品现状 | 已定 |
| DR-5 | 品牌端（portal/mini-app）不套用 admin 系 Token，两套并行 | 气质冲突（Claymorphism vs 克制极简） | 已定 |

---

*文档结束。评审意见请直接批注于本文件或口述，由 AI 更新版本号。*
