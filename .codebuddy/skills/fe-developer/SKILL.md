---
name: fe-developer
description: web_system 前端开发技能 — admin 系（deploy-console/admin/mcp-admin）页面/UI/交互任务的标准执行方式。触发：新页面、页面大改、样式调整、交互修改、antd 覆盖。
version: 1.0.0
---

# web_system 前端开发（fe-developer）

## 职责

把 UI 任务按 web_system 规范落地：类型判定 → 规格书确认 → 编码 → 自检 → （微前端产物四步）。通用前端工程质量按 `fe-dev-common`（ai-agent-kit `references/fe-dev-common.md`）执行，本卡只写 web_system 特有部分。

## 触发条件

- 新页面 / 布局级大改 / 样式调整 / 交互修改（deploy-console / admin / mcp-admin / 未来内部工具）
- 原型稿生成（需求对齐用的可点击交互 HTML，见「原型稿生成」一节）
- 不适用：portal / mini-app（品牌端 DR-5，Claymorphism，走 `docs/ui/ui-design-spec.html`，不套本卡）

## 工作流

1. **判类型 + 读规范**：判定页面类型（列表/详情/表单/仪表盘/例外，参照页见 `docs/ui/design.md` §1）；按 `docs/ui/README.md` §2 任务×最小文档集取读，**不全目录翻读**。
2. **填规格书**：新页面 `page-spec-template.md` Full / 小改 Quick。
3. **用户确认**：规格书先交用户确认，**确认后才写码**（禁止跳过直接实现）。
4. **编码**：`docs/ui/design.md` 布局铁律（§2）/ 交互状态矩阵（§3）/ 视觉 Token 约束（§4）；antd 覆盖冲突走 `css-override-rules.md`；改色/加色走 `color-reference.md`。
5. **自检（证据化）**：design.md §5——页面类型一致 / 无裸色 / 无新增 !important / dark 过目 / 状态矩阵全覆盖 / 截图基线到 `docs/ui/baselines/`（命名 `{app}-{page}-{before|after}.png`）/ 修正记录追加 `geist-token-评审记录.md`（只追加）。
6. **规则整改执行门**：≥2 文件/跨页面/跨端的批量整改 → 先出《整改影响清单》交负责人确认，再动代码（R6 教训）。
7. **微前端产物四步**（admin/portal/mcp-admin 改动后，否则等于没改）：构建（`RELEASE_TAG=$V MF_FORMAT=system npx vite build --mode mf`）→ 拷贝 `dist/*` 到 gateway `static/modules/<module>/<V>/` → 更新 `web_system_deploy.deploy_deployments`（不是 web_system 库！）→ 等 gateway TTL（10s）验证 `__manifest__`。详见 CODEBUDDY 微前端铁律与 `docs/development/admin-dev.md` §一·C。

## 原型稿生成（prototype）

原型稿是需求对齐用的可点击交互 HTML，是**沟通产物，不是最终代码**。通用方法论（定义与分层 / 触发决策 / 单文件约束 / Token 方法 / 交互模式库概念 / 页面类型最小结构 / 通用评审清单 / 不做什么）统一按 **fe-prototype-common**（ai-agent-kit `references/fe-prototype-common.md`）执行；**本卡只写 web_system 特有装配**，骨架与数值以 `docs/ui/prototype-scaffold.html` 为准，不在此复制细则。

### 1. 何时生成

- **必生成**：新功能/新页面、信息架构多方案、跨页面流程、用户先要「看」交互。
- **不生成**：纯样式微调、字段明确的简单表单——直接走规格书（§工作流 2）。
- 时机：判类型 → 填规格书 → 用户确认 **之前或并行**；确认后回填 page-spec-template。

### 2. 形态二选一（按目标端，复制 scaffold 删形态）

| 形态 | 容器 | 适用 | 基准 |
|------|------|------|------|
| 移动端 | `.phone` | 品牌/产品/C 端（portal/mini-app） | 390px |
| 桌面端 | `.desktop` | admin / deploy-console / 内部工具 | 1180–1440px |

生成时**直接复制 `docs/ui/prototype-scaffold.html`**，删掉不用的那种形态，不从零写结构。

### 3. 文件位置与命名

| 场景 | 路径 | 命名 |
|------|------|------|
| 产品/品牌端交互原型 | `docs/products/<产品名>/` | `<产品名>_原型_vN_<特性>.html` |
| 早期分析/探索原型 | `docs/analysis/<产品名>/` | `<产品名>_原型_vN_<特性>.html` |

- 版本递增 `v1 → v2 → v3`；特性词描述本版重点（如 `_风险信号`、`_升级版`）。
- 范例：`docs/products/合同翻译官/合同翻译官_原型_v3_风险信号.html`（基础）、`docs/analysis/合同翻译官/合同翻译官_原型_v4_升级版.html`（进阶交互）。

### 4. Token 换值点（scaffold `:root` 处改）

- **主色三态**：admin 系平台主橙 `#F97316`（DR-3）；品牌端换产品品牌色（如合同翻译官 `#1E6FFF`）。
- **暗底/亮底** 随目标端二选一；暗底只改 `--bg/--card/--text/--text-2/--border`，主色不变。
- 其余 Token（语义色 / 圆角 / 阴影 / 间距栅格）沿用 scaffold，不在原型里改值或裸写。

### 5. 交互与状态（scaffold 已内置，取用不另造）

- 交互函数从 scaffold `<script>` 直接取：`go/back`（栈式导航）、`switchTab`、`desk`、`openModal/closeModal`、`toast`、`toggle`、`simulate`；表单校验用 `.field.err + .msg`。
- 列表四态（骨架屏 / 空态 / 错误态 / 加载更多）必须可在原型体现；关键异步流程用 `setTimeout` 模拟进度。

### 6. 页面类型对齐 `design.md` §1

类型判定与最终编码一致（列表/详情/表单/仪表盘/例外）；原型最小结构即该类型最终页的骨架雏形，编码时按 `design.md` §2 布局铁律精化。

### 7. 评审清单（通用清单 + 工程特有核对）

- 通用逐条自检按 fe-prototype-common §七：IA 完整 / 流程闭环 / 状态矩阵 / Token 一致 / 主操作 ≤1 / 真实文案 / 形态不混排。
- **工程特有核对**：产物落在 §3 目录且命名合规；形态容器与主色符合 §2/§4；浏览器双击可开、无外部依赖；确认结论回流进规格书（page-spec-template）再编码。

### 8. 与规格书 / 最终代码的关系

- 原型确认 → 填 `docs/ui/page-spec-template.md` → 用户确认 → 按 `design.md` 编码。
- admin 系落地 Vue3 + Ant Design Vue；品牌端落 portal / mini-app（Claymorphism，`ui-design-spec.html`，不套本卡）。
- 原型 Token 与 `packages/ui/src/tokens.ts` 对齐，但原型内联 CSS 变量，**不 import 业务包**。

### 9. 不做什么（工程特有补强）

- 不把原型当最终产物提交进 `apps/*`（只活在 `docs/products` / `docs/analysis`）。
- 不跳过 §7 评审清单直接宣布「原型完成」。
- 其余「不做什么」同 fe-prototype-common §十（不引外部依赖 / 不裸 hex / 不 emoji 图标 / 形态不混排）。

## 覆盖核对（已有资产 ↔ 通用规则）

| 通用规则（fe-dev-common §二） | web_system 落点 | 状态 |
|---|---|---|
| 颜色语义化 / 样式覆盖 / 图标 | CODEBUDDY 最小禁项 + design.md §4 + color-reference | 已覆盖（项目优先） |
| 交互状态矩阵 | design.md §3 | 已覆盖 |
| 类型安全 / 组件状态 | CODEBUDDY 开发规则（TS strict） | 已覆盖 |
| 前端安全（XSS/敏感信息） | 无专项文档 | **按通用层补充** |
| 性能（懒加载/列表 key/包体积） | 无专项文档 | **按通用层补充** |
| 可访问性 | 无专项文档 | **按通用层补充** |
| 请求竞态/超时/拦截器 | CODEBUDDY 超时分层（shared） | 部分覆盖，细则按通用层 |
| 测试 | 无强制前端测试门 | 按通用层（任务涉及时） |

## 不做什么

- 不跳过规格书与用户确认；不写裸 hex/rgba、不新增 `!important`、不用 emoji 图标、不互斥单选 ≤5 用 `a-select`。
- 不把 `docs/ui/` 数值/细则复制进业务代码（只引 `--ws-*` / `uiTokens`）。
- 不套本规范到品牌端（portal/mini-app）。
- 微前端改动不执行"四步"不宣布完成。

## 参考文档

| 文档 | 何时加载 |
|------|---------|
| CODEBUDDY.md「UI 页面生成铁律 + 最小禁项 + 微前端四步」 | 任何 UI 任务（常驻） |
| `docs/ui/README.md`（读取地图）→ design.md / page-spec-template / color-reference / css-override-rules | 按任务类型（§2 最小集） |
| `docs/ui/geist-token-评审记录.md` | 完成自检回流 |
| `docs/ui/prototype-scaffold.html` | **生成原型稿的基础骨架（移动端+桌面端双形态、Token、交互模式库）** |
| `docs/products/合同翻译官/合同翻译官_原型_v3_风险信号.html` | 移动端原型范例（复制参考） |
| `docs/analysis/合同翻译官/合同翻译官_原型_v4_升级版.html` | 移动端原型范例（进阶交互参考） |
| fe-dev-common（ai-agent-kit `references/fe-dev-common.md`） | 通用工程质量规则 |
| fe-prototype-common（ai-agent-kit `references/fe-prototype-common.md`） | **原型稿通用方法论**（分层/触发/Token 方法/交互模式/评审清单）；本卡「原型稿生成」节为 web_system 装配 |
