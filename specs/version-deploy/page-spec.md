# 页面规格书 · 版本部署（VersionDeploy）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 原型（已确认）：`docs/ui/prototypes/deploy-console-version-deploy.html` + 质检记录
> 设计文档：`specs/version-deploy/design.md`（接口真相源 / 双指针裁决 / 验证判据 V1–V7）

- 页面类型：列表页
- 参照页：`ServiceManager.vue`（视觉/Token canonical）；页头形态参照 `UserList.vue`（标题+副标题+主操作）
- 需求一句话：不跑流水线，选已有发布版本直接部署到目标环境（微前端=切指针，后端=换产物+重启），与发布流水线解耦

## 页头

- 标题：版本部署
- 副标题：选择已有发布版本直接部署到目标环境；构建与发布走「流水线」，部署不依赖流水线（micro/backend 域文案各一句）
- 主操作：无（部署动作在行内与抽屉内，页头不放 primary）

## 模块清单（自上而下）

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 | 备注 |
|---|------|-------------|---------|---------|------|
| 1 | 模块表格（无页面级环境筛选：环境可能数十个，环境维度收进部署抽屉） | `GET /deploy/modules`（按 type 过滤）+ 各模块最近一次部署记录 | a-table | 整表空态：原因+出路「暂无模块，请先在模块注册表登记」；单行从未部署显示 — | type 过滤：micro→micro-frontend/frontend；backend→backend |
| 2 | 选版本部署抽屉（内含目标环境下拉） | `GET /environments` + `GET /deploy/versions?env=&component=` | `VersionDeployDrawer`（共用组件） | 抽屉空态+错误态见交互清单 | 共用组件，AppDetail 也用；环境选项可能数十个 → a-select（动态选项 + show-search） |

## 表格列清单

| 列 | 来源字段 | 展示规则 | 操作 |
|----|---------|---------|------|
| 模块 | moduleName + key | 名称常规 + key 副行 mono 小字 | — |
| 最近发布版本 | 各环境 `deploy_versions` 中 releasedAt 最新一条的 versionTag（**不是指针**；见下方「2026-09-24 修正」） | `.ws-mono`；从未发布显示 — | — |
| 环境 | 上述那条记录的 envId | 中性徽标 | — |
| 发布时间 | releasedAt | tabular-nums，YYYY-MM-DD HH:mm | — |
| 发布人 | releasedBy（流水线为 `pipeline-script`） | 常规 | — |
| 操作 | — | 「部署」link 按钮 | 打开抽屉（默认环境 = 该模块最近部署的环境，可换） |

## 抽屉（VersionDeployDrawer，共用组件，props 注入数据源）

| 区块 | 内容 |
|------|------|
| 头部 | 「部署 {模块名}（{key}）」+ 关闭 |
| 环境选择条 | **目标环境下拉（默认入口环境，抽屉内可切换）**；切换后清空已选版本并重新加载该环境的版本记录；选项来自 `GET /environments`（含自建环境，可能数十个 → a-select + show-search） |
| 当前版本条 | 所选环境的**当前指针**（`deploy_deployments.currentVersion`，mono），无则 — |
| 版本列表 | radio 项×N：tag（mono 600）+「当前」ok tag + meta（branch · commit · 时间 · 发布人）；当前版本置灰不可选 |
| 底部 | 取消（default）+「部署到 {env}」（primary；未选版本 disabled + tooltip「先选版本」） |

## 交互清单

| 操作 | 触发 | 反馈（成功/失败） | 破坏性确认文案 | 完成后动作 |
|------|------|------------------|---------------|-----------|
| 切换抽屉目标环境 | 环境下拉 | 版本列表 loading 重新加载（已选版本清空） | 否 | 当前版本条/按钮文案随环境更新 |
| 打开抽屉 | 行内「部署」 | 版本列表骨架 loading | 否 | — |
| 选版本 | radio | 选中高亮 | 否 | 部署按钮激活 |
| 部署（micro） | 抽屉 primary | success toast「{env}/{key} 已部署到 {tag}」/ message.error | Modal.confirm：将把 {env}/{模块} 的版本从 {from} 切换到 {to}；仅切换版本指针，刷新页面即生效，不影响运行中进程 | 关抽屉、刷新表格当前版本 |
| 部署（backend） | 同上 | 同上 | 同上 + 警告行：将替换产物目录并重启 pm2 进程，服务预计短暂中断，请避开业务高峰 | 同上 |
| 抽屉空态 | 模块无版本记录 | — | 否 | 显示「去发布流水线」按钮（跳 /pipelines 带模块预选） |
| 抽屉错误态 | 版本列表加载失败 | — | 否 | 错误文案 +「重试」按钮 |
| AppDetail「部署」 | 应用详情部署 tab 行内 / 页头按钮 | 同上（应用域接口） | 同上（backend=false 语义） | 打开本抽屉（应用域数据源：`GET /apps/:key/versions` + `POST /apps/:key/switch-version`），成功后 AppDetail load() 刷新 |

> **2026-09-24 修正（缺陷修复，UI_GATE=off，不动原型布局）**
> 原实现把 `deploy_deployments.currentVersion`（**当前指针**）当作「最近部署」展示，语义写错：
> 指针是最后一次**部署（切指针）动作**的结果，而「最近发布」在 `deploy_versions`（releasedAt，
> 流水线产物）。发布后未切指针、或指针被回滚时两者不同，页面会把指针冒充成最新发布。
> 修正后：表格「最近发布版本 / 时间 / 发布人」一律取发布记录；指针另存 `pointer` 字段，
> 当 `pointer !== 发布版本` 时在该单元格副行显示「当前指针：xxx」（`.ptr-hint`，三级文字色）。
> 后端 `GET /deploy/module-deployments/:key` 每环境新增 `latestRelease {versionTag, releasedAt, releasedBy}`。

## 状态覆盖自查（design.md §3）

- [x] 加载中：表格 loading / 抽屉骨架
- [x] 空态（原因+出路）：整表、抽屉两处
- [x] 失败可重试：抽屉错误态重试按钮
- [x] 破坏性二次确认：backend 部署写明 pm2 重启中断后果
- [x] 禁用有 tooltip 原因：未选版本时部署按钮
- [x] 部署中防重复提交：deploying 锁
- [x] 无弹窗套弹窗：确认 Modal 在抽屉之上（非嵌套表单，允许）
- [x] 无裸色：全部 `--ws-*` / antd token；版本 tag mono、时间 tabular-nums

## 风险/待澄清

- 产物存在性守卫先不做（D4，已拍板）：前端模块可能指向已清理目录 → 线上 404，属已知取舍。
- 双指针机制（部署域/应用域）并存，本规格不合并，见 design.md §2.1 裁决。
- AppDetail 原「切换版本」入口本期保留不动，避免行为面扩大（待澄清：是否后续合并为同一抽屉入口）。
