# 原型稿索引（docs/ui/prototypes）

> 更新：2026-10-22 第二批 —— **目录收敛（散落 16 → 0）**。此前 `release-platform` 一个模块
> 堆了 11 个版本（v5～v14 + 一份「原型_v5」），v9 和 v14 在目录里平级，评审只能靠文件名猜
> 哪份是当前的。本次**只留 `release-platform-v14-整合框架.html` 一份**，其余 10 份连同存档的
> `admin-content-hub.html` 一并 `git rm`（git 历史即归档，需要追溯时 `git show <sha>:<path>`）。
> 另把 5 份「宿主不是 admin」的稿（deploy-console ×3 / 部署目标专题 / 圆角风格探索）登记进
> `proto-registry.mjs` 的 `OUT_OF_SCOPE_PROTOS`，**从此不算散落**；`proto-audit-baseline.json`
> 清空为 `{}` —— 基线归零后，目录里再出现一份没登记的稿立刻 FAIL。
> 更新：2026-10-22 第一批 —— **自媒体运营模块并入整合稿**——原件
> `apps/admin/prototype/自媒体运营模块-原型稿.html` 已归位为 `admin-media-ops.html`，
> 由注册表以 **mount 源**登记（一份 DOM 服务 5 页）；同时**下线旧的「内容中心」5 屏**
> —— 真实 `router/index.ts` 已无 采集总览 / 龙虎榜 / 席位库 三个路由，继续留着就是第二真相源。
> 详见 §2.1 与 §五 0.5）
> 上一次：2026-10-15（内容中心 5 屏作为**模块稿** `admin-content-hub.html` 并入整合稿；
> 壳支持多 sub-menu；两份 admin 整合稿重叠问题已裁决，见 §2.1）
> 目的：一眼分辨「哪些是当前对照源」，避免照旧稿实现。**落地真相以代码与 `specs/` 为准**；
> 原型与落地不一致时，回写原型 + `specs/**/page-spec*.md`，而不是反向改代码。
> **查阅入口**：`node scripts/proto-serve.mjs` → `http://127.0.0.1:5180/`（索引页按最近修改排序，第一条即当前在做的那份）。
> 入口口径、为什么不用在线发布、长时服务注意事项见 `docs/api/contracts.md` §11。
>
> ⚠️ **依赖提示（2026-10-15 入仓时补）**：本目录 Agents 相关原型 —— 定义详情页的「高级 → 模型参数调试」及整合稿
> `admin-agents-hub.html` 对应屏 —— 中的 **`maxTokens` / `topP` / `thinking` 属 C7 调参契约**，该契约当前
> **仅在分支 `feat/llm-tuning-multi-model`，master 尚未合入**（master 的 `agent-engine.ts` 只透传 `temperature`）。
> **C7 合入前，这几个控件为设计态，不得照此落码**。落地顺序见
> `docs/architecture/agent-evolution-roadmap.md` **B3**（其前置即"先合 C7"）。
>
> ✅ **两份 admin 整合稿重叠 · 已裁决（2026-10-15）**：`admin-agents-hub.html` 是**唯一** admin 整合容器。
> 内容中心 5 屏已切为**模块稿** `admin-content-hub.html`（无壳，只管内容），经
> `scripts/lib/proto-registry.mjs` 以 **shared 共享源**登记后重跑 build 合入 hub；
> 此前重复造壳的 `admin-console.html` **已删除**（备份不在仓内，内容中心的 CSS/JS 已完整迁入模块稿）。
> **不要再新建 admin 整合 HTML**：新模块一律「模块稿 + 注册表一行 + 重跑 build」。

## 一、当前有效（与落地一致，可作对照源）

| 文件 | 覆盖范围 | 说明 |
|---|---|---|
| `admin-user-memory.html` | admin 用户管理 · **用户详情页「用户记忆」卡**（UserDetail.vue）：摘要卡置顶 + 明细折叠表 + 删除二次确认 + 「待更新」标记 +「重新生成摘要」，场景包 S1–S6 可切换 | 2026-10-30 新建（台账 #8229 批次 2.1，R11 原型门）。依据 `specs` 外的 page-spec《用户记忆面板》（30-任务产物/2026-10-29-web_system-AI-Agent能力盘点/）——交互清单 + 9 场景包矩阵 1–6；portal 端 7–9 见 `portal-user-memory.html`。**模块稿，不并入 Agents 整合稿**（宿主是用户管理模块）。表单口径遵守 `page-specs/form-controls-and-toggles-v1.md` v1.3（同屏唯一 primary / 破坏性二次确认 / label 业务词）。实现约束已标注：摘要正文 LLM 提炼属半可信输入，渲染须转义不得 `v-html` 直出。设计决策与遗留项见 `admin-user-memory-设计决策记录.md` |
| `portal-user-memory.html` | portal · **记忆画像页**（/profile/memory，Memory.vue 升级）：顶部摘要卡 + 现有 事实/偏好/习惯 分组与删除入口（不退化）+ 删除补二次确认，场景包 S7–S9 | 2026-10-30 新建（同上台账）。⚠️ page-spec 原假设「portal 移动壳」与实测不符——portal 为桌面三栏壳（App.vue 顶栏 + 工作区），本稿按实测壳画并已回填 page-spec 更正。设计决策见 `portal-user-memory-设计决策记录.md` |
| `admin-media-ops.html` | **自媒体运营（content:view / content:manage）模块稿**：采集源管理 / 采集明细 / 公众号成文 / 发布管线 / 采集监控 5 个菜单页 + 3 个二级页（采集源编辑、明细详情、管线编辑），共 8 个 `section` | 2026-10-22 由 `apps/admin/prototype/自媒体运营模块-原型稿.html` **归位**而来（此前落在 app 目录，与其它原型稿不在一处 —— 即产品意见「原型散落」的根因之一）。**模块稿，不是整合稿**：壳与菜单**不在本稿内**（归 `scripts/lib/proto-shell.mjs` 单源），菜单与路由逐项对齐 `BasicLayout.vue`（`a-sub-menu key="content"`）与 `router/index.ts`（`content` 子树 10 条路由）。由注册表以 **mount 源**登记：**DOM 不拆**，5 个菜单页共用这 8 个 `section` 和一份 JS 状态机，切屏时由 hub 运行时把整块搬到当前屏（`data-zm-module`）—— 因为模块内二级页之间有**跨根键跳转**（明细详情 →「去公众号成文」、成文空态 →「前往发布管线」），按菜单页拆 DOM 就跳不过去。自带**原型演示控件**（四区：稿头 / 10 个场景包 / 角色 / 8 屏直达，规格见 `skills/ux-prototype-designer/references/demo-control-panel.md`）；**该控件只在本稿独立打开时生效**，抽进 hub 时整段丢弃（它写 `location.hash = '#s=<key>'`，与 hub 的 hash 路由互斥，见注册表 `jsDrop`）。设计决策 Q1–Q8 与 D1–D11 见 `admin-media-ops-设计决策记录.md`；D3 一致性复查见 `docs/ui/reviews/media-ops-d3-2026-10-22.md` |
| `deploy-console-domain.html` | deploy-console 控制台（微前端域 / API 网关域）+ 产品页环境切换 + **系统设置 / 存储配置（A6）** | 双域重构主原型。2026-09-21 对齐落地：API 网关域只有「服务管理」、服务详情 4 Tab（接口/概览/网关路由/环境与发布）、行内「构建发布」原地开抽屉且环境锁定禁用。**2026-09-22 增量（A6）**：「系统设置」从占位 generic 屏升级为真实屏（通知与审批按 `SystemSettings.vue` 还原 + 新增「存储配置」区块：双值展示 / 目录树与手填 / 校验前置 / 待重启提示）；新增样式引 `--ws-*` token（对齐 `packages/ui/src/tokens.ts` **roles.light**，与 #107 起的整稿亮色口径一致）。**2026-09-23**：新规范 token 整改（业务裸 hex 275→0、字号/行高/圆角/动效全归阶梯；见 `p3-新规范整改-质检记录.md`）。**2026-09-24**：文件由 `deploy-console-domain-split.html` 统一更名为 `deploy-console-domain.html`；「基础设施 → 服务监控」由 generic 占位升级为真实屏（页签来自主机管理 / PM2 按主机分组 / 顶部诊断横幅，4 场景可切换） |
| `pipeline-env-branch-canvas.html` | 流水线编辑 · 步骤/任务画布 | 对应 `OrchestrationEditor.vue`（步骤 → 任务 → 动作模型）。2026-09-21 补入动作行并修复删除按钮遮挡。**2026-09-23**：换壳为两级导航（顶部一级 + 左侧二级随动）+ 新规范 token 整改（见 `p2-新规范整改-质检记录.md`） |
| `deploy-console-version-deploy.html` | 版本部署（微前端域 `/deploys/micro`） | 对应 `VersionDeploy.vue` + `VersionDeployDrawer.vue`。**2026-09-23**：换壳为两级导航（新增顶部一级通栏，弃用原侧栏分组写法）+ 新规范 token 整改（见 `p1-新规范整改-质检记录.md` / 清单 §6） |
| `admin-settings.html` | admin「系统设置」（A6：移除「存储配置」tab） | 2026-09-22 新建。admin 目录下原本无原型；含「[原型] 变更对照」移除前/后切换，目标态为 4 tab（基本信息/功能开关/安全策略/通知配置）+ 副标题去掉「与存储」。**2026-10-12**：由 `proto-registry.mjs` 登记为整合稿「系统设置」屏源稿（`ns:'AS'`，类名自带 `.st-` 前缀 → 直接合入） |
| `admin-agent-def-detail.html` | admin Agents · **定义详情页**（列表 → 新页面）· 高级 → 模型参数调试（参数面板 + 对话试跑 + 调参测试用例表）+ 三级参数对比 | 2026-10-10 新建，**v2.1 / v2.2 两次修订**。**取代** `admin-agents.html` 屏②（编辑弹窗 + 生成参数区）：产品意见要求编辑改用新页面、表单单开「高级」、调试可直接对话、用例可多个、改参数给对比提示。**v2.1 按评审意见再调**：① 表单改 label 左置栅格、hint 压成一行短句（去实现细节与契约代号）② 每个定义自带**本业务真实用例与示例问题**（原先三个定义共用一套财报用例 → demo 不好懂）。**v2.2**：调试台对话改为与屏① Playground **同构同款消息结构**（.turn/[.proc]/.bubble-wrap/[.avatar]/.bubble/[.bubble-meta]/.ans blocks），回答只出 blocks 不再 `<br>` 拼串，落地两处复用同一组组件（Turn/Bubble/AnswerBlocks/ProcCard）。落地前过 UI 门，规格见 `page-specs/agent-def-detail-v2.md`；交互回归 `node scripts/verify-agent-def-detail.mjs`（118 项）+ 结构 parity `node scripts/verify-playground-parity.mjs`（31 项）。**2026-10-11 v5**：壳由 `scripts/lib/proto-shell.mjs` 单源注入（`sync-prototype-shell.mjs`）——菜单升级为真实 admin 的 antd 结构（Sider+SubMenu+折叠+顶栏），对拍 `verify-proto-shell.mjs`（39 项） |
| `admin-agents.html` | admin Agents 模块 · 对话调试 Playground 屏（P4 首屏） | 2026-09-22 新建。AI 回答 blocks 渲染（p/lead·h·ol·law·code·tcard，解析复用 `@web-system/agent-message`）+ **深色代码块**（`--ws-code-*` 新 token，三端统一，规格见 `specs/agent-message-extract/page-spec.md`）；壳复用 admin-settings 样板。**2026-10-11 v2.2**：屏① 消息结构定为模块共用组件（详情页调试台已同构改造），并回填 AA/字阶（橙底白字头像/气泡 → brand-700/brand-soft、text-tertiary 元信息 → text-secondary、h4 13.5px → 14px 等），详见文件内变更台账。**2026-10-11 v5**：壳由 `scripts/lib/proto-shell.mjs` 单源注入（`sync-prototype-shell.mjs`，两屏分别选中「对话调试 / 定义管理」），对拍 `verify-proto-shell.mjs`。**⚠️ 屏②（编辑弹窗 · 生成参数区）已被 `admin-agent-def-detail.html` 取代，不要再照屏② 实现** |
| `admin-agents-hub.html` | admin 管理后台 · **菜单级整合稿**（唯一容器）+ 组件复用地图 | 2026-10-11 新建。`scripts/build-agents-hub.mjs` **生成物（禁手改）**：从定稿 + 注册表登记的源稿同源抽取拼接 —— 菜单**全量可达（22 项 ↔ 23 屏）**（定义管理 / 定义详情 / 对话调试 / 系统设置 / 字典管理 / **自媒体运营 5 页** 为真实内容；其余为占位，骨架与复用件已标注）+ 页面底部组件复用地图（Turn / Bubble / AnswerBlocks / ProcCard 四件套使用点 + 表单侧复用件 + 门禁命令）。复用什么、是否一致由机检守：`verify-agents-hub.mjs`（**211 项**）+ `verify-playground-parity.mjs`（**31 项**，含整合稿与定稿同源段 E/F 与稿内对拍段 G）。口径见 `page-specs/agent-def-detail-v2.md` §10。**v8（2026-10-22）：自媒体运营以 mount 源合入 / 内容中心下线** —— 注册表新增四个字段：`mount`（一份 DOM 服务多屏，hub 运行时搬块 + 调源稿 `go(根键)` + `zmSync` 回写菜单与 hash）、`trails`（多段弹层：手动触发弹窗 + 成文预览抽屉 + toast）、`jsDrop`（整段丢弃源稿自带的评审台脚本）、`sprite`（图标库 `<svg><symbol>` 在内容区之外，只注入一次）；另加 `cssExtra`（`body` 规则被丢后补回作用域内的基准排版）。⛔ 旧的「内容中心」5 屏同时下线：真实 `router/index.ts` 已无 采集总览 / 龙虎榜 / 席位库 三个路由。⑧d2 由「未落地守卫」翻转成正向断言，⑨r 收回「+1 原型增量」补偿。**v7（2026-10-15）：内容中心以 shared 共享源合入** —— 壳支持**多 sub-menu**（`SHELL_SUBS` = 内容中心 + Agents），注册表新增 `shared/rootToGlobal` 字段：一份稿服务多屏（CSS/JS 只注入一次，DOM 按 `data-cc` 拆给各屏）、源稿补的设计系统级 token 并进全局 `:root`。新增 ⑩g 段断言守「共享源真合进去了 / 5 态可切 / 模块级弹层 5 屏共用」。**v6（2026-10-12）：「整合」不再是手工动作** —— 每屏内容收口到 `scripts/lib/proto-registry.mjs`（每屏一行：来源文件/内容区起止/尾挂弹层/CSS 筛选或作用域隔离/JS IIFE 命名空间），build 脚本消费注册表自动抽取并注入 `SOURCE_CSS/SOURCE_JS`；`admin-settings.html` 与 `dict-module.html` 由占位升级为**真实合入屏**（抽屉/tab 交互可跑，运行时 computed 证明隔离不泄漏）。以后某模块出稿或改稿 = **改注册表一行 + 重跑 build**，不再改 build 脚本、不再手工拼接。新增 ⑩ 段约 20 条断言守「登记=合入 / 隔离不泄漏 / 批次对账」，均经变异测试。**v5（2026-10-11）**：**壳单源化**——菜单结构升级为真实 admin 的 antd 布局（Sider 220/收起 80 + 一级图标项 + Agents SubMenu + 顶栏 Home/主题/用户 + 页脚），壳收口 `scripts/lib/proto-shell.mjs` 单源：整合稿由 build 内联、两份定稿由 `sync-prototype-shell.mjs` 注入、三稿一致由 `verify-proto-shell.mjs`（39 项，含折叠交互与选中项 computed 样式）对拍守。**v4（2026-10-11）**：**菜单全量对齐真实 admin**（`BasicLayout.vue` 文案/顺序逐项一致 + router path 同构，17 项菜单 ↔ 18 屏、去全部 `.nolink` 死项）——工作台/变变管理/用户管理/系统设置/角色权限/字典管理/MCP 管理/数据浏览 均可点进对应模块页（非 Agents 模块为骨架式占位，登记归属批次与复用口径、不伪造业务数据）；新增「菜单 ↔ BasicLayout.vue」对账断言（⑧ 段，经变异测试验证）。**v3（2026-10-11）**：对话面板统一为 `.chatpanel` 三段（工具栏 + 消息区 + 输入区），两份定稿逐节点一致；parity 扩到 31 项（H 段守外围与运行按钮 computed，T1 守 :root token）。**v2（2026-10-11）**：hash 路由（点菜单即进入模块页面，浏览器前进后退可用）+ 每屏页头 `.page-head`；修复 v1 两处样式事故（字面 `<style>` 污染 CSS 流致 `:root` token 全丢、Playground 专属 CSS 未合入致 SVG 撑成 1026px 顶翻整屏）——build 脚本已加生成自检（style 标签数 / token 数 / div 配平 / pg svg 规则 / 菜单无死项 / 屏数对账 / 占位屏范围说明） |

## 二、已整合与待裁决

### 2.1 ✅ 已裁决（2026-10-15）：唯一整合容器 = `admin-agents-hub.html`

| 文件 | 产出期 | 定位 | 当前口径 |
|---|---|---|---|
| `admin-agents-hub.html` | 2026-10-12 | **唯一** admin 整合容器（生成物）；屏内容由 `scripts/lib/proto-registry.mjs` 单源登记 | admin 侧**全部**模块的对照源 |
| `admin-media-ops.html` | 2026-10-22 | 自媒体运营**模块稿**（无壳），经注册表 **mount 源**合入 hub | 自媒体运营 **6 页**的**源稿**（2026-10-23 增「账号管理」= 10 个 section），落地对照看 hub 里那 6 屏 |
| ~~`admin-content-hub.html`~~ | 2026-10-15 | 内容中心**模块稿**（无壳），原经 **shared 共享源**合入 hub | ⛔ **2026-10-22 已下线并删除**（真实路由已无 采集总览/龙虎榜/席位库；稿本体已 `git rm`，追溯用 `git log`） |
| ~~`admin-console.html`~~ | 2026-10-15 | 重复造的第二份 admin 整合容器 | ❌ **已删除**（内容中心 CSS/JS 已迁入模块稿；系统设置/对话调试/占位屏 hub 侧本就有） |

**裁决理由**：① 壳与菜单必须单源（`BasicLayout.vue` → `proto-shell.mjs`），第二份容器 = 第二真相源；
② 合入 hub 可复用既有 4 条机检（207 / 118 / 31 / 39 项），不用再养第五套；
③ 「出稿即合入」的既有生态（改注册表一行 + 重跑 build）不该为单个模块破例。

**代价与后续**：内容中心 5 屏的路由（`#/content/*`）与权限码（`content:view` / `content:manage`）
**在 `apps/admin` 尚未落地** —— 机检 ⑧d2 守着「确实未落地」，等落地时它会 FAIL 提醒同步
`router/index.ts`、`BasicLayout.vue` 与 `packages/types/src/index.ts`（契约门 C4）。

### 2.2 源稿（内容已被整合稿消费，**不要再单独作为落地对照**）

| 文件 | 产出期 | 为什么不再单独对照 |
|---|---|---|
| `admin-settings.html` | 2026-09-22 | hub 整合稿「系统设置」屏源稿（注册表 `ns:'AS'`）。原稿独立复制了一份壳（侧栏 210px、菜单 9 项），与落地 `BasicLayout.vue` 已不一致 |
| `admin-agents.html` | 2026-09-22 | hub 整合稿「对话调试」屏源稿。⚠️ **屏②（编辑弹窗 · 生成参数区）已被 `admin-agent-def-detail.html` 取代，不要再照屏② 实现** |

## 三、历史稿（设计过程记录，**不要作为落地对照**）

| 文件 | 产出期 | 为什么不再对照 |
|---|---|---|
| `release-platform-v14-整合框架.html` | 2026-09-15~17 | 左侧全平铺菜单、「模块管理」组、独立部署屏，与双域结构不一致（标题写 v5 系历史遗留）。**2026-10-22 收敛：同系列 `v5-nodes` / `v6-pipeline-scripts` / `v7-pipeline-ia` / `v8-pipeline-history` / `v9-pipeline-console` / `v10-pipeline-edit-page` / `v11-env-select` / `v12-module-context` / `v13-pipeline-product-logic` / `原型_v5_整合发布平台框架` 共 10 份已删除，只留这一份作设计过程记录**（要追溯旧版：`git log --diff-filter=D -- 'docs/ui/prototypes/release-platform-*'`） |
| `module-deploy-target-prototype.html` | — | 部署目标专题稿，非当前控制台结构 |
| `dict-module.html` | — | ⚠️ 原列历史稿，**2026-10-12 已升为当前有效**：由 `proto-registry.mjs` 登记为整合稿「字典管理」屏源稿（`ns:'DM'`，裸通用类名 → `scopeCssBlocks` 加 `.screen[data-screen="dicts"]` 作用域隔离、`:root` 私有变量转作用域保留） |

## 四、质检记录

- `admin-console-质检记录.md`（2026-10-15，**内容中心 5 屏**；含设计决策、A~I 逐条结论、浏览器断言与截图证据。⚠️ 出稿时该 5 屏尚在 `admin-console.html` 内 → 迁入 `admin-content-hub.html` → **2026-10-22 稿已删除**（该 5 屏被「自媒体运营」5 页取代）。**保留本记录只为追溯当时的判断依据，不要再据此实现**）
- `docs/ui/reviews/admin-console-d2-20261015.md`（2026-10-15，同一批 5 屏的 D2 盲审报告 + 整改回执）
- `release-platform-v13-质检记录.md`
- `deploy-console-version-deploy-质检记录.md`
- `deploy-console-settings-storage-质检记录.md`（2026-09-22，A6 系统设置 / 存储配置；含设计决策、逐条质检结论、浏览器实跑证据）

## 五、维护约定

0. **待补原型清单**：admin 其余模块尚无原型（仅「系统设置 / 字典管理」有），补齐计划与执行约定见
   `specs/admin-prototype-coverage/tasks.md`（P1 用户管理 → P2 角色权限/字典 → P3 变变/数据浏览 → P4 MCP/Agents → P5 工作台与例外页）。
0.5. **出稿即合入（不用再手工整合）**：admin 整合稿 `admin-agents-hub.html` 的每屏内容由
    `scripts/lib/proto-registry.mjs` 单源登记。某模块出了新原型稿 / 改了稿 ——
    **在注册表里把该屏的 `source` 补上（改一行）→ `node scripts/build-agents-hub.mjs` → 跑四条机检**，
    即完成合入；build 脚本与机检都不用改。抽壳/CSS 作用域隔离/JS 命名空间由
    `scripts/lib/html-utils.mjs` + 注册表字段（`from/to/wrapper/trail/cssDrop/cssKeep/scope/ns/exports/trace`）表达。
    ⚠️ 反例：在 hub HTML 里直接贴内容 —— 那是生成物，下次 build 会被覆盖。
    ✅ **2026-10-15 已按本条落地**：内容中心 5 屏走「模块稿 + 注册表 shared 一行
    + 重跑 build」，**没有新建容器**（此前重复造的 `admin-console.html` 已删，见 §2.1；
    该模块稿本身已于 2026-10-22 被「自媒体运营」5 页接替并删除）。
    一组二级页（一个 sub-menu 下的多屏）用 `shared: { hostSel, screens }`，单屏用 `source`；
    **若组内二级页之间还有跨页跳转**（如「明细详情 → 去公众号成文」），用 `mount: { screens }`
    —— DOM 不拆，切屏时由 hub 把整块搬到当前屏（2026-10-22 自媒体运营即按此落地）。
    `admin-media-ops.html` 这类「整页带壳稿」还要额外声明 `trails`（多段弹层）/ `jsDrop`（丢弃稿自带评审台）/
    `sprite`（图标库）/ `cssExtra`（补回基准排版）。
0.55. **范围外登记（不是所有稿都该进 admin 整合稿）**：宿主不是 admin 的稿（deploy-console 控制台、
    发布平台历史终稿、外观风格探索）登记在 `proto-registry.mjs` 的 `OUT_OF_SCOPE_PROTOS`，
    每条必须写**理由**。判定口径是「该不该进 admin 整合稿」，不是「这份稿好不好」：
    有理由进 admin 却没登记 → 散落（FAIL）；宿主是别的端 / 已定性历史 → 范围外（不报）。
    ⚠️ 只是「还没排期并入」的别放这里 —— 那是散落，该留在散落清单里被催。
0.6. 🔴 **写新稿前必读：三条命令，别让稿再散落**（2026-10-22 立，因为踩过）
    曾经 `docs/ui/prototypes/` 下 **22 份稿只有 5 份真正进了整合稿** —— release-platform 一个模块
    堆了 11 个版本（v5～v14 + 一份「原型_v5」），评审只能靠文件名猜哪份是当前的。这不是「文件没整理」，
    是**流程缺闸门**：做原型时新开一份 html 没有任何成本，于是就地堆着。
    **2026-10-22 已收敛为 11 份：并入 5 · 范围外 6 · 散落 0**（基线 `{}`）。

    | 时机 | 命令 | 它拦什么 |
    |---|---|---|
    | 稿写完（还没登记） | `node scripts/check-proto-adopt.mjs docs/ui/prototypes/<稿>.html` | 12 项技术体检：位置 / 自带壳 / 自带 hash 路由 / 评审台 / sprite / `.screen` 撞名 / 裸通用类名 / 跨屏跳转（决定 mount 还是 shared）/ 内容区外弹层 / 屏名对账 / 决策记录。**FAIL 必须先修**，并直接给出可粘贴的 registry 字段骨架 |
    | 登记完 / 改完稿 | `node scripts/verify-proto-all.mjs` | 一键跑 build + 4 条机检 + 审计 + 体检（约 90 秒）。`--fast` 跳过浏览器项（约 0.5 秒） |
    | 想确认目录干净 | `node scripts/audit-proto-registry.mjs` | 散落稿 / 多版本族 / 登记自洽 / 屏覆盖。**基线已归零，任何新增未登记稿 = FAIL** |

    **三条硬规则**：
    - **稿只有一个落脚点**：`docs/ui/prototypes/`。写在 `apps/*/prototype/` 之类的地方，注册表抽不到 = 白做
      （2026-10-22 自媒体运营稿就是这么散落的）。
    - **多版本不许平级堆放，旧版直接删**：同一模块只留一份（当前版；模块已废弃则留最后一份作记录），
      其余 `git rm`。**不建 `_archive/`** —— 留在目录里的旧版仍会被当成「可参考的稿」，而 git 历史本身就是归档
      （`git show <sha>:<path>` 随时可回）。审计会按版本号指出该保留哪份并打印可复制的 `git rm` 命令。
    - **散落清单只许变短**：`scripts/proto-audit-baseline.json` 现为 `{}`（存量已清零）。
      再出现未登记稿就 FAIL —— 要么并入、要么登记进 `OUT_OF_SCOPE_PROTOS`（写理由）、要么删掉。
      `--update-baseline` 仍可用，但**基线不再是「容忍列表」而是「分期承诺」**，只该临时用。

1. 新增原型请在本文件登记（属于「当前有效」、「源稿」还是「历史稿」）。
2. 落地代码改动前，按 UI 动作门要求「原型 + 页面规格」先行；原型/规格单独 commit，落地 commit message 带 `Proto: <sha>`。
3. 巡检（2026-09-21）修掉的同类问题：原型里残留的旧菜单项、已合并的 Tab、已移除的「部署记录」屏 —— 发现即改，并在文件头注明日期与依据。
4. **admin 壳的唯一真相源 = `apps/admin/src/layouts/BasicLayout.vue`**：菜单顺序 / 权限码 / 子项 / 宽度一律从它派生；
   原型侧发现与它不一致（如旧稿侧栏 210px）时，改原型，不要改落地。

