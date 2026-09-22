# 原型稿索引（docs/ui/prototypes）

> 更新：2026-09-21（双域重构落地后的一次对齐巡检）
> 目的：一眼分辨「哪些是当前对照源」，避免照旧稿实现。**落地真相以代码与 `specs/` 为准**；
> 原型与落地不一致时，回写原型 + `specs/**/page-spec*.md`，而不是反向改代码。

## 一、当前有效（与落地一致，可作对照源）

| 文件 | 覆盖范围 | 说明 |
|---|---|---|
| `deploy-console-domain-split.html` | deploy-console 控制台（微前端域 / API 网关域）+ 产品页环境切换 + **系统设置 / 存储配置（A6）** | 双域重构主原型。2026-09-21 对齐落地：API 网关域只有「服务管理」、服务详情 4 Tab（接口/概览/网关路由/环境与发布）、行内「构建发布」原地开抽屉且环境锁定禁用。**2026-09-22 增量（A6）**：「系统设置」从占位 generic 屏升级为真实屏（通知与审批按 `SystemSettings.vue` 还原 + 新增「存储配置」区块：双值展示 / 目录树与手填 / 校验前置 / 待重启提示）；新增样式改引 `--ws-*` token（对齐 `packages/ui/src/tokens.ts` roles.dark） |
| `pipeline-env-branch-canvas.html` | 流水线编辑 · 步骤/任务画布 | 对应 `OrchestrationEditor.vue`（步骤 → 任务 → 动作模型）。2026-09-21 补入动作行并修复删除按钮遮挡 |
| `deploy-console-version-deploy.html` | 版本部署（微前端域 `/deploys/micro`） | 对应 `VersionDeploy.vue` + `VersionDeployDrawer.vue` |

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

1. 新增原型请在本文件登记（属于「当前有效」还是「历史稿」）。
2. 落地代码改动前，按 UI 动作门要求「原型 + 页面规格」先行；原型/规格单独 commit，落地 commit message 带 `Proto: <sha>`。
3. 巡检（2026-09-21）修掉的同类问题：原型里残留的旧菜单项、已合并的 Tab、已移除的「部署记录」屏 —— 发现即改，并在文件头注明日期与依据。
