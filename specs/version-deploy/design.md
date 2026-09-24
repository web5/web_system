# 版本部署（独立部署界面）· 设计文档

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 日期：2026-09-21 ｜ 原型：`docs/ui/prototypes/deploy-console-version-deploy.html`（已确认）

## 1. 需求与决策（用户 2026-09-21 拍板）

微前端模块 / API 网关后端服务的**部署**不再跳转发布流水线，改为独立界面：选择已有发布版本直接部署。

| # | 决策 |
|---|------|
| D1 | 部署与发布流水线解耦：独立「版本部署」界面，微前端 / API 网关**双域各挂入口**，共用一个页面组件 |
| D2 | `AppDetail`（应用详情）的「部署」按钮从跳流水线改为**打开本抽屉**（应用域数据源） |
| D3 | **后端服务开放**「选版本直接部署」（复用 `deployVersion`：换产物目录 + pm2 重启 + 改指针） |
| D4 | 产物存在性守卫**先不做**（用户明确；后果：指向被 cleanup 清掉的版本时用户侧 404，属已知取舍） |

## 2. 现状真相源（探索结论，编码依据）

### 2.1 两套指针机制（并存，本设计不合并、只在各自域内使用）

| 域 | 版本记录 | 当前指针 | 写入方 |
|----|---------|---------|--------|
| **部署域**（流水线语义） | `deploy_versions`（versionTag/gitBranch/gitCommit/releasedBy/releasedAt） | `deploy_deployments`（envId+moduleKey 唯一，gateway manifest 真相源） | 流水线 version/pointer 阶段（`ReleaseRegistryService`） |
| **应用域**（apps 模块） | 磁盘版本目录（`listEnvVersions`） | `deploy_app_versions` 行 + env-dir 入口指针文件（`writeEnvEntryPointer`） | `AppsService.switchVersion` |

**裁决**：新「版本部署」页走**部署域**接口（与流水线 pointer 行为一致）；`AppDetail` 抽屉走**应用域**接口（与其展示与入口指针机制一致）。抽屉组件共用，数据源注入。

### 2.2 复用的后端接口（全部已存在，零后端改动）

| 用途 | 接口 | 说明 |
|------|------|------|
| 模块清单 | `GET /deploy/modules` | `type` 字段区分：micro → `micro-frontend`/`frontend`；backend → `backend` |
| 环境清单 | `GET /environments`（environmentApi.list） | 部署抽屉内的目标环境下拉（可能数十个 → a-select + show-search） |
| 模块最近部署 | `GET /deploy/module-deployments/:moduleKey`（含各环境 currentVersion/deployedAt/deployedBy）或 `GET /deploy/current-versions?env=` 聚合 | 表格「最近部署版本/环境/发布时间/发布人」列（取 deployedAt 最新一条） |
| 版本记录（抽屉） | `GET /deploy/versions?env=&component=` | deploy_versions，含分支/commit/发布人 |
| **部署动作** | `POST /deploy/modules/:moduleKey/envs/:env/deploy` | `DeployService.deployVersion`：前端=只 upsert 指针；后端=先 `applyBackendVersion`（换 dist + pm2 重启，本机 cp / 远程 SSH）再改指针；带审计 `release.deploy` |
| AppDetail 版本（抽屉） | `GET /apps/:key/versions`（availableVersions：ref/isCurrent/isPrevious） | 应用域 |
| AppDetail 切换 | `POST /apps/:key/switch-version` | 应用域，含产物存在守卫 + 入口指针写入 |

## 3. 前端设计

### 3.1 路由与导航

- 新路由：`/deploys/:domain`（domain ∈ `micro` | `backend`），同一组件 `VersionDeploy.vue`。
- `MainLayout.vue`：
  - `micro` 域 children 增加 `{ key: '/deploys/micro', label: '版本部署' }`（应用管理之后）
  - `gateway` 域 children 增加 `{ key: '/deploys/backend', label: '版本部署' }`（服务管理之后）

### 3.2 组件

```
apps/deploy-console/src/
├── views/VersionDeploy.vue                 # 新页：模块表格（最近部署摘要，无页面级环境筛选）
└── components/VersionDeployDrawer.vue      # 共用抽屉（props 注入数据源）
```

`VersionDeployDrawer` props：
```ts
{
  open: boolean
  title: string                    // 部署 <模块名>（<key>）
  envs: { id: string; name: string }[]   // 环境选项（GET /environments）
  env: string                      // 默认目标环境（入口环境，抽屉内可切换）
  loading: boolean                 // 版本列表加载中
  versions: DrawerVersion[]        // 统一视图模型（按当前所选环境）
  currentVersion?: string          // 置灰标记
  deploying: boolean
  backend?: boolean                // true = 确认弹窗带 pm2 重启警告
  @changeEnv(env)   // 抽屉内切换目标环境 → 重新加载版本列表
  @select(version)  @deploy(version)  @close
}
/** 统一视图模型（两个域各自映射） */
interface DrawerVersion { tag: string; branch?: string; commit?: string; time?: string; by?: string; isCurrent: boolean }
```

### 3.3 各入口的数据源映射

| 入口 | 版本列表 | 部署动作 | 部署后刷新 |
|------|---------|---------|-----------|
| 版本部署页（micro） | `GET /deploy/versions?env&component` | `POST /deploy/modules/:k/envs/:env/deploy` | `current-versions` + 本行 |
| 版本部署页（backend） | 同上 | 同上（自动走 applyBackendVersion） | 同上 |
| AppDetail「部署」 | `GET /apps/:key/versions`（ref→tag，无 branch/commit 元信息） | `POST /apps/:key/switch-version` | AppDetail load() |

### 3.4 AppDetail 改动（D2）

- `goDeploy()` 删除跳转流水线逻辑，改为打开 `VersionDeployDrawer`（应用域数据源，预选该环境）。
- 表格「部署」行内按钮同样改为打开抽屉；原「切换版本」入口**保留**（同一抽屉承载后可考虑合并，本期不动，避免行为面扩大）。
- 页头主按钮「部署」（无环境上下文）→ 打开抽屉默认第一个环境。

## 4. 交互契约（关键状态）

| 状态 | 处理 |
|------|------|
| 抽屉加载中 | 版本列表骨架（loading） |
| 版本列表空 | 原因+出路：「该模块在 {env} 还没有版本记录，去发布流水线发布一次」+ 跳流水线按钮 |
| 版本列表加载失败 | 错误态 + 重试按钮 |
| 未选版本 | 部署按钮 disabled（文案：先选版本） |
| 当前版本 | radio 置灰不可选 |
| 部署中 | 按钮 loading + 防重复提交 |
| 确认弹窗 | 前端：仅切指针说明；后端：「替换产物目录并重启 pm2，服务将短暂中断」 |
| 成功 | toast + 刷新当前版本（backend 域后端已有探活则展示，本期不做前端探活轮询） |
| prod | 不加额外限制（deployVersion 现状，审计有记录）；如需 prod 审批门后续迭代 |

## 5. 风险与已知取舍

| 风险 | 处置 |
|------|------|
| D4：版本目录被 cleanup 清掉后仍可被选中部署（前端模块 → 线上 404 白屏） | 已知取舍，用户拍板先不做；后端模块有 `assertArtifactUsable` 守卫兜底，不受影响 |
| 双指针机制并存（部署域 vs 应用域）可能让用户困惑 | 本期不合并；界面各自域内闭环，规格文档记录真相 |
| 后端部署失败（SSH/产物缺失） | deployVersion 先落地后改指针，失败抛错 → 前端 message.error 展示后端 message |
| AppDetail 抽屉（应用域）与版本部署页（部署域）对同一模块显示的「当前版本」可能不同 | 既有现象（两表独立），非本期引入；如用户反馈再对齐 |
| **「当前版本」是账面值，未必等于线上真正在跑的版本** | **专项 P1（见 §7）**：多机场景下指针写在控制台所在机，远端网关未必加载 |

## 6. 验证判据（V1…Vn，交付验证门用同一编号）

- V1：侧边栏「微前端 > 版本部署」「API 网关 > 版本部署」均可进入，各自只显示本域模块（micro：admin/portal/mcp-admin/shell；backend：auth-service/system-service/…）。
- V2：版本部署页表格显示各模块最近发布版本/环境/时间/发布人（取 `deploy_versions` releasedAt 最新一条）；页面无环境 tabs（环境维度在抽屉内选择）。（2026-09-24 修正：原判据写的是「deployments 的 deployedAt」，语义错误，已改）
- V3：点行内「部署」→ 抽屉列出 `deploy_versions` 版本记录（含分支/commit/发布人），当前版本置灰；空模块显示空态+去发布出路。
- V4：选版本 → 确认弹窗（backend 模块含 pm2 重启警告文案）→ 部署成功 toast，表格当前版本刷新为所选版本；后端模块经 `applyBackendVersion` 实际换 dist + pm2 重启（查 `deploy_deployments` + `pm2 list` 进程重启时间）。
- V5：AppDetail「部署」按钮打开本抽屉（不再跳流水线），选择版本部署成功后应用详情当前版本刷新。
- V6：部署动作在审计日志出现 `release.deploy` 记录（版本部署页入口）。
- V7：自检通过：无裸色/无新增 `!important`、dark 主题过目、`deploy_versions` 时间列 tabular-nums、版本 tag 用 mono。

## 7. 专项 P1（2026-09-24 立项，未排期）：远端网关的入口指针/manifest 未接通

### 7.1 现象

用户在「版本部署」页看到 shell/prod「当前版本 = shell-dev/4ea6d64」，但判断线上在跑的不是它。
实测确认页面口径没错（DB 指针确实指向 4ea6d64），**问题在线上链路本身**。

### 7.2 实测事实（2026-09-24）

| 位置 | 现状 |
|------|------|
| prod 产物 | `servers/gateway/public/static/modules/shell/prod/{c934736, 4ea6d64}`（流水线投递成功） |
| prod 指针文件 | `modules/shell/prod/index.js` **不存在**（新机制 A' 指针缺失） |
| prod gateway | `dist/apps/` 无 entry-pointer、`dist/deploy-version/` 缺失 → **仍是旧机制** |
| prod `__manifest__` | `env=prod`，只有 `portal/admin @ 98f29b6`（flat 旧布局 `modules/<app>/<version>/index.js`），**无 shell 条目** |
| 控制台所在机（dev） | `modules/shell/prod/` 只有旧三版目录，同样无指针文件 |

结论：流水线把产物投到了 prod，但 prod 网关没有新指针/manifest 能力去加载它 ——
`deploy_deployments` 里的「当前版本」对 prod 只是**账面值**。

### 7.3 设计方案

已产出：`specs/remote-mf-pointer/design.md`（方案对比 A/B/C + 决策表 D1–D7 + 分期 P0/P1/P2 + 验收 V1–V7 + 待确认 Q1–Q6），待确认后实现。

补充一条**机制澄清**（2026-09-24 勘察修正）：gateway 的 `__manifest__` 真相源是**数据库**
（`deploy_app_env_versions` 等，`index-html.service.ts:161-182`），它**从不读磁盘指针文件**，
只是把指针 URL 拼进 manifest。因此「未接通」的根因是三件事：prod gateway 旧二进制 + 远端投递无 env 层 +
指针写入只在编排者本机；缺口表见新文档 §1.3。

### 7.4 方向（与 pipeline-node-model 的 P1 多节点/host+SSH 同源）

- 远端网关升级到新入口机制（env-dir + 入口指针文件 + manifest 服务），或
- 指针切换动作必须落到**目标机**（当前写的是控制台所在机的磁盘），并校验远端指针文件生成成功。
- 在接通之前，页面「当前版本」对远端环境只能当账面值看待，界面宜给出「未校验远端生效」提示（可选）。
