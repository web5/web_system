# 原型稿索引（docs/ui/prototypes）

> 更新：2026-09-21（双域重构落地后的一次对齐巡检）
> 目的：一眼分辨「哪些是当前对照源」，避免照旧稿实现。**落地真相以代码与 `specs/` 为准**；
> 原型与落地不一致时，回写原型 + `specs/**/page-spec*.md`，而不是反向改代码。

## 一、当前有效（与落地一致，可作对照源）

| 文件 | 覆盖范围 | 说明 |
|---|---|---|
| `deploy-console-domain-split.html` | deploy-console 控制台（微前端域 / API 网关域）+ 产品页环境切换 + **系统设置 / 存储配置（A6）** | 双域重构主原型。2026-09-21 对齐落地：API 网关域只有「服务管理」、服务详情 4 Tab（接口/概览/网关路由/环境与发布）、行内「构建发布」原地开抽屉且环境锁定禁用。**2026-09-22 增量（A6）**：「系统设置」从占位 generic 屏升级为真实屏（通知与审批按 `SystemSettings.vue` 还原 + 新增「存储配置」区块：双值展示 / 目录树与手填 / 校验前置 / 待重启提示）；新增样式引 `--ws-*` token（对齐 `packages/ui/src/tokens.ts` **roles.light**，与 #107 起的整稿亮色口径一致）。**2026-09-23**：新规范 token 整改（业务裸 hex 275→0、字号/行高/圆角/动效全归阶梯；见 `p3-新规范整改-质检记录.md`） |
| `pipeline-env-branch-canvas.html` | 流水线编辑 · 步骤/任务画布 | 对应 `OrchestrationEditor.vue`（步骤 → 任务 → 动作模型）。2026-09-21 补入动作行并修复删除按钮遮挡。**2026-09-23**：换壳为两级导航（顶部一级 + 左侧二级随动）+ 新规范 token 整改（见 `p2-新规范整改-质检记录.md`） |
| `deploy-console-version-deploy.html` | 版本部署（微前端域 `/deploys/micro`） | 对应 `VersionDeploy.vue` + `VersionDeployDrawer.vue`。**2026-09-23**：换壳为两级导航（新增顶部一级通栏，弃用原侧栏分组写法）+ 新规范 token 整改（见 `p1-新规范整改-质检记录.md` / 清单 §6） |
| `admin-settings.html` | admin「系统设置」（A6：移除「存储配置」tab） | 2026-09-22 新建。admin 目录下原本无原型；含「[原型] 变更对照」移除前/后切换，目标态为 4 tab（基本信息/功能开关/安全策略/通知配置）+ 副标题去掉「与存储」 |
| `admin-agents.html` | admin Agents 模块 · 对话调试 Playground 屏（P4 首屏，其余 Agents 页待补） | 2026-09-22 新建。AI 回答 blocks 渲染（p/lead·h·ol·law·code·tcard，解析复用 `@web-system/agent-message`）+ **深色代码块**（`--ws-code-*` 新 token，三端统一，规格见 `specs/agent-message-extract/page-spec.md`）；壳复用 admin-settings 样板（`--ws-accent` 选中态） |

## 二、历史稿（设计过程记录，**不要作为落地对照**）

| 文件 | 产出期 | 为什么不再对照 |
|---|---|---|
| `release-platform-v13-pipeline-product-logic.html` | 2026-09-14~15 | 侧栏「流水线管理」父菜单、模块管理三子模块、编辑页无 Tab 等**均未采纳** |
| `release-platform-v14-整合框架.html` | 2026-09-15~17 | 左侧全平铺菜单、「模块管理」组、独立部署屏，与双域结构不一致（标题写 v5 系历史遗留） |
| `release-platform-v5-nodes.html`、`v6-pipeline-scripts`、`v7-pipeline-ia`、`v8-pipeline-history`、`v9-pipeline-console`、`v10-pipeline-edit-page`、`v11-env-select`、`v12-module-context`、`release-platform_原型_v5_整合发布平台框架.html` | 2026-09-09~11 | 更早迭代，已被上述文件取代 |
| `dict-module.html`、`module-deploy-target-prototype.html` | — | 字典模块 / 部署目标专题稿，非当前控制台结构 |

## 三、质检记录

- `release-platform-v13-质检记录.md`
- `deploy-console-version-deploy-质检记录.md`
- `deploy-console-settings-storage-质检记录.md`（2026-09-22，A6 系统设置 / 存储配置；含设计决策、逐条质检结论、浏览器实跑证据）

## 四、维护约定

0. **待补原型清单**：admin 其余模块尚无原型（仅「系统设置」有），补齐计划与执行约定见
   `specs/admin-prototype-coverage/tasks.md`（P1 用户管理 → P2 角色权限/字典 → P3 变变/数据浏览 → P4 MCP/Agents → P5 工作台与例外页）。
1. 新增原型请在本文件登记（属于「当前有效」还是「历史稿」）。
2. 落地代码改动前，按 UI 动作门要求「原型 + 页面规格」先行；原型/规格单独 commit，落地 commit message 带 `Proto: <sha>`。
3. 巡检（2026-09-21）修掉的同类问题：原型里残留的旧菜单项、已合并的 Tab、已移除的「部署记录」屏 —— 发现即改，并在文件头注明日期与依据。
