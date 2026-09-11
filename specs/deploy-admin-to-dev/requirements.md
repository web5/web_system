# admin 发布到 dev · 需求文档

> 类型：requirements.md（Design 阶段产物 · **实现级**：字段 / 判据 / 决策依据）
> 人类阅读优先 → 先看 [`人读版-需求.md`](./人读版-需求.md)（白话，5 分钟）
> 日期：2026-09-11
> 关联：方案 `design.md` · 接口 `api-design.md` · 脚本 `scripts.md` · 实施 `tasks.md`
> 方法论：`rd-plan`（spec 三件套 + EARS 验收）

## 背景与问题

**事实（2026-09-11 核实）**：本机 deploy-console（`:6200`）发 `env=dev` **不等于**发布到 dev 环境。

| 环节 | 本机 console 当前行为 | 后果 |
|---|---|---|
| upload | `PIPELINE_UPLOAD_TARGET=local` + 模板 `defaultTarget=auto` → 投递目标落 `local` | 产物进本机发布目录，dev 机无产物 |
| pointer | 写本机库 `web_system_deploy` | dev gateway 读不到指针 |
| verify | 查本机 `:6000/__manifest__`，本机 gateway `DEPLOY_ENV_ID=local` | 版本断言必失败 → 自动回滚 |

dev 是**独立一套**：

```
dev.kedouai.com → 42.194.200.69 (nginx SSL) → 175.27.189.123 (应用机)
  应用机: /data/web_system（git clone, master）· gateway:6000（DEPLOY_ENV_ID 缺省=dev）
          deploy-console:6200 · MySQL 127.0.0.1（deploy 表复用 web_system 库）
  指针: deploy_deployments(dev/admin) = default/41fffaa
```

本机 → dev 可达性已验证：`6200` 401（接口在）、`6000` 在线、`https://dev.kedouai.com/__manifest__` 200。

### 代码拉取：改为 DB 脚本（平台托管 · 锁定不可编辑）

「拉码」现状是平台内置能力（`PullExecutor` + `ReleaseGitService`）。本期要求：**把 `git` 节点也落成 DB 脚本**，与 upload/verify 等同表同构；**但不开放编辑**（平台托管）。2026-09-11 实测如下：

| 项 | 事实 / 要求 | 结论 |
|---|---|---|
| 实现形态 | 存 `deploy_pipeline_step_commands(templateId, nodeKey='git')`（**改造**）；引擎优先执行脚本，未配置时**回退**内置 `PullExecutor` | 进 DB 真相源，可审计/可 SQL 调/可随迁移同步 |
| 可编辑性 | 表加 `locked` 列（`git` 置 true）；接口拒写、UI 只读展示 | **不开放编辑** |
| 命令序列 | `git fetch --all --prune` → `git checkout -B <branch> origin/<branch>` → （指定 commit）`git reset --hard <commit>` → `git clean -fd`；随后 pnpm-lock 指纹变化才 install，并预构建 shared/types | 与本机发布同口径（后两项仍由平台执行） |
| 作用目录 | **执行进程**的 `RELEASE_DIR`/`RELEASE_WORKSPACE`：本机 `/Users/geekwen/web_system_release`；dev 机实测 `/data/web_system`（git clone、master、工作区干净、origin 可达） | 各机拉自己的目录 |
| 谁执行 | 本机 pull = 服务「本机构建 admin 产物」（构建源头，必执行）；远端 pull = 服务「远端构建」（本期不触发） | 分工明确，互不干扰 |
| 本期是否触发远端 pull | **否**：hook 带 `commitId` → 远端 `check` 命中 S1 已投递产物 → `reuseArtifact=true` → git/build/upload/restart 全跳过 | 正常链路无拉码动作 |
| 语义归属 | `gitCommit`/`versionTag` 回填与 `commitId` 一致性断言**由平台**做，不由脚本产出 | 脚本可调而不破坏发布语义 |

> 前提：执行机发布目录必须是 git 仓库，否则脚本/内置执行体 fail-fast 并提示 `git clone`。
> 影响面：`git` 脚本化是**平台级改动**，对所有模板与流水线（含 `local`）生效，须零回归（未 seed → 回退内置）。

## 目标用户与场景

| 角色 | 场景 |
|---|---|
| 平台运维 | 在本机控制台页面选 `环境=dev + 模块=admin + 分支`，一键发布到 dev 并看到探活结果 |
| 研发 | 本地改完 admin，push 后在本机页面（或让 Agent 调 MCP）发 dev 验证 |
| Agent | MCP `publish_pipeline(env=dev, moduleKey=admin, branch=...)` 与页面等价 |

## 范围

**In**
- `admin`（micro-frontend）从**本机 console 发起**发布到 `dev`
- 目标机解析走 `deploy_servers`；产物投递走 SSH 脚本；版本/指针写库走**接口**；探活走脚本
- 页面与 MCP 两个入口的可用性
- `local` 行为零回归

**Out**
- 从 dev 机 console 发起发布（不需要）
- `prod` 发布验证（机制同构，本期不验证）
- 远端 `verify` 命令口径统一（可选增强）
- 灰度发布到 dev（可后续）

## 验收标准（EARS）

### 目标解析
- 当 提交 `env=local` 时，系统应保持**现状**（投递本机、写本机库、查本机 gateway），不产生任何远端动作
- 当 提交 `env=dev` 且未显式指定 `target` 时，系统应按环境规则判定 `target=remote`，目标机取 `deploy_servers.dev-default`
- 当 显式传入 `target` 或模板配置了 `defaultTarget` 时，应以显式值为准

### 产物投递（脚本）
- 当 构建完成时，系统应把 `apps/admin/dist` 打包投递到 `175.27.189.123:/data/web_system/servers/gateway/public/static/modules/admin/default/<commit>/`
- 当 目标目录已存在时，应先把旧目录改名移出（`mv`）再解包，**不得**执行可能被安全策略拒绝的批量删除
- 当 SSH/scp 失败时，阶段应失败并把 stderr 写入流水线日志
- 当 本机发布目录已存在该 commit 产物时，系统应跳过本机 build，但**仍执行**投递（不得因本机复用跳过远端 upload）

### 代码拉取（DB 脚本 + 平台托管）
- 当 流水线执行 `git` 节点时，系统应先执行该模板 `deploy_pipeline_step_commands(nodeKey='git')` 的脚本；该脚本不存在时，应回退内置拉码逻辑
- 当 展示 `git` 节点脚本时，系统应只读展示脚本文本并标注「平台托管，不可编辑」
- 当 请求新增/修改/删除 `locked=true` 的节点脚本时，系统应拒绝（400），且不得变更库中内容
- 当 `git` 脚本执行完成时，系统应由平台回填 `gitCommit` 与 `versionTag=<templateKey>/<commit>`
- 当 入参指定了 `commitId` 而脚本执行后的 HEAD 与之不一致时，系统应失败（fail-fast）并输出实际值与期望值
- 当 `reuseArtifact=true` 时，系统应跳过 `git` 脚本（不产生任何拉码动作）
- 当 本机流水线执行 `env=dev` 时，系统应先在**本机**发布目录（`RELEASE_DIR`）完成拉码与依赖同步，再构建 admin 产物
- 当 远端 console 受理发布意图且携带 `commitId`、该版本产物已存在于远端时，系统应**不执行**远端拉码/构建/投递
- 当 远端 console 受理发布意图但未携带 `commitId` 时，系统应按既有语义执行远端拉码 → 构建 → 投递；因此本期实现**必须**显式传 `commitId` 以避免该路径
- 如果 执行机发布目录不是 git 仓库，则拉码应失败并提示初始化方式（`git clone`）
- 脚本约束：`git` 脚本应机器无关，只依赖 `RELEASE_DIR`/`BRANCH`/`COMMIT_ID` 等「本机自身」变量，不应依赖 `REMOTE_*`

### 安全基线（check）
- 当 流水线执行 `check` 节点时，系统应先执行安全基线内置逻辑（模块类型快照、复用产物检测、分支缺省 `master`、prod 分支约束）
- 当 `check` 节点配置了脚本时，系统应在内置逻辑**之后**叠加执行（与 legacy `commandMode='base'` 一致）
- 当 指定 commit 且该版本产物已存在时，系统应置复用标记，并跳过后续拉码 / 构建 / 投递（远端按环境决定投递是否跳过）
- 当 平台在拉码后回填版本时，应使用入参 commit 快照做**全哈希**一致性断言

### 分支与代码确定性
- 当 提交发布时，系统应把「本机实际拉取的分支」与「实际 commit」一并确定下来：`branch` 缺省 `master`，`commitId` 由本机拉码后的 `rev-parse --short HEAD` 回填
- 当 提交远端发布意图（4a）时，请求体应同时携带 `branch` 与 `commitId`（缺一不可告警）
- 当 执行拉码时，系统应按 `BRANCH` 检出（`checkout -B`），并在 `COMMIT_ID` 存在时 `reset --hard` 到该 commit —— **最终代码由 `commitId` 决定，分支只决定 fetch 来源与检出名**
- 当 拉码完成时，系统应把 `git_branch` / `git_commit` 写入流水线记录，并在 `version` 阶段写入远端 `deploy_versions`
- 如果 拉码后实际 HEAD 与入参 `commitId` 不一致，则流水线应失败，且不得继续构建/投递
- 如果 发布目录未配置 `origin`，则拉码应在 `git` 阶段失败并提示（不得用本地仓库代码继续构建）
- 如果 目标分支在 `origin` 与本地均不存在，则拉码应失败并提示分支名（不得静默改用其他分支）
- 如果 指定 `commitId` 在 `origin` 不可达，则拉码应失败并提示「先 push」；**不得**退化为使用分支最新代码
- 当 `git` 脚本完成 `reset` 时，脚本应自证 `HEAD` 等于目标 commit（失败即失败），使错误在 `git` 阶段暴露

### 复现性要求
- 当 通过 `env=dev` 发布时，发布所用代码应等于目标 `commitId` 且来源为发布目录（非开发工作区），不得出现「本地未提交代码被发出去」

### 版本与指针（接口）
- 当 投递完成时，系统应通过**目标环境控制台接口**（HMAC）写入版本记录并切换指针，**不得**从本机直连远端数据库
- 当 目标环境产物已存在时，接口语义应触发"复用产物"，跳过远端构建
- 当 使用同一 `deliveryId` 重复调用时，接口应幂等返回，不产生第二次发布
- 当 签名错误、时间戳超窗或未配置密钥时，接口应返回 401

### 探活（脚本）
- 当 指针切换后，系统应等待 gateway 版本缓存 TTL（默认 10s，多等 2s 余量）
- 当 断言时，`<REMOTE_GATEWAY_URL>/__manifest__` 中该模块版本应等于本次版本引用（`<templateKey>/<commit>`）
- 当 断言时，`<REMOTE_GATEWAY_URL>/static/modules/<publicPath>/<fullRef>/index.js` 应返回 200
- 如果 上述任一断言失败，则流水线应标记失败并输出实际值与期望值
- 当 环境为 `local` 时，`verify` 应保持现状（不做远端断言），确保 local 零回归
- 当 执行机模板未配置 `verify` 命令时，系统应回退内置 `VerifyExecutor`（前端 manifest 断言 / 后端 pm2 + 端口探活）

### 重启（后端，本期仅设计）
- 当 模块类型为 `backend` 且 `target=remote` 时，系统应通过 SSH 在目标机执行 `pm2 restart <name> --update-env`
- 当 模块类型为 `micro-frontend` 时，重启阶段应跳过

### 入口一致性
- 当 通过页面提交 `env=dev` 时，页面应提示"远端发布：目标机 175.27.189.123；产物投递后由该环境控制台切指针"
- 当 通过 MCP `publish_pipeline(env=dev, moduleKey=admin)` 调用时，结果应与页面等价（同一 `PipelineService.submit`）

## 非功能需求

| 类别 | 要求 |
|---|---|
| 安全 | HMAC-SHA256 + 时间窗（±300s）；SSH key 路径不下发到日志；本机不持有远端 DB 凭证 |
| 幂等 | 远端调用以 `deliveryId` 为幂等键；重复提交不产生第二条远端发布 |
| 可观测 | 每阶段日志打印实际目标机、tar 路径、接口返回的 jobId/status、断言实际值 |
| 兼容 | 环境级配置缺失时给出明确错误（不静默投本机） |
| 可维护 | 脚本与命令存 DB（平台托管节点如 `git` 只读）；平台只下发变量，不内嵌业务路径 |
| 复用/治理 | `git` 落 DB 脚本（与其余阶段同表同构）但 `locked` 锁定：接口拒写、UI 只读、迁移/seed 写入；未 seed 回退内置；不新增 ssh git 脚本 |

## 决策记录（原「待确认项」已全部闭合）

> 2026-09-11 逐条核实后闭合，每条给出结论与依据（实测 / 代码）。如无异议即按此定稿。

| # | 事项 | 结论 | 依据 |
|---|---|---|---|
| D1 | 版本/指针接口：复用 `POST /api/hooks/release`（4a）还是新增内部接口（4b） | **一期用 4a（已拍板 2026-09-11）**；4b 不再考虑 | 实测 dev 机模板链路：带 `commitId` → `check` reuse 命中 → `version` → `pointer` → `verify`（脚本对 micro-frontend `exit 0`）→ `restart`（跳过）→ succeeded。远端锁/审批/审计/回滚白得 |
| D2 | 远端 `verify` 是否补 micro-frontend 分支 | **补 —— 且本机也要补** | 实测两端 verify 命令均为 `case $MODULE_TYPE in backend) ;; *) 跳过探活; exit 0`；且 DB 命令以 `commandMode='override'` **覆盖内置 `VerifyExecutor`** → 前端 verify 目前是空操作（无 manifest/产物断言） |
| D3 | 前端 verify 断言落在哪（改执行体 还是 落脚本） | **落 DB 脚本（本机模板 verify 命令），不改执行体** | 既有模板都配了 verify 命令 → 内置执行体不会执行（`executeStage` 的 override 语义）。故把 `scripts.md` S3 写进本机 verify 命令，并按 `DEPLOY_ENV` / `REMOTE_GATEWAY_URL` 分支：remote 断言、local 保持跳过（零回归） |
| D4 | 远端 `deploy_modules.admin` 的 `dir` / `public_path` 为空 | **一期顺手补齐** | `resolveStageVars` 兜底 `dir=moduleKey`、`public_path=moduleKey`，恰好等于 `admin`，功能上可用；补上后远端构建/断言路径不再依赖巧合 |
| D5 | 远端 `cleanup` 是否保留 N 版 | **本期不做** | 实测 dev 机 cleanup 命令即 `echo 跳过历史版本清理; exit 0`；本机 cleanup 照旧（本机产物保留 5 版）。二期再议 |
| D6 | 本机 `reuseArtifact` 会连 `upload` 一起跳过 | **一期修**（design P9 / R6） | `step-registry` 的 skip 只看 reuse、不看 target；否则出现「dev 机无产物但指针已切」 |
| D7 | 远端拉码是否需要独立脚本 | **不需要** | `git` 落 DB 锁定脚本（S0），未 seed 时回退内置 `PullExecutor`；正常链路远端被 reuse 跳过 |
| D8 | `locked` 只用于 `git` 还是通用化 | **通用化** | 列名语义「平台托管、接口拒写」；本期只给 `git` 置位，未来 `version`/`pointer` 若脚本化可复用 |
| D9 | 远端拉码**拉哪个分支、怎么确认** | 分支取 hook 的 `branch`（本机流水线带入，缺省 `master`）；**最终代码由 `commitId` 决定**（`reset --hard`），分支只决定 fetch 来源与检出名。确认途径四层：流水线日志 / `deploy_pipelines.git_branch+git_commit` / 远端 `deploy_versions` 的 `git_branch+git_commit` / 产物路径与 manifest 引用 `default/<commit>`；并新增「HEAD == commitId」断言（全哈希比对） | 详见 design 决策 8（含实证） |
| D10 | 上述保障放**脚本**还是**平台** | **两边都要**：脚本做前置校验 + HEAD 自证（fail-fast 在 `git` 阶段、提示可操作）；平台做回填 + 全哈希断言（对走内置回退的模板同样生效）。脚本侧加固三处：origin 存在性、分支解析不吞错、commit 可达性；**比内置 `PullExecutor` 严格（有意为之）：宁可失败，不用分支最新代码顶替** | 详见 design 决策 9 / `scripts.md` S0 |

| D11 | v5 模式下 `check` 阶段是否执行 | **恢复 base 语义**：恒执行内置安全基线，配置了命令则叠加 | 实测（流水线 `1789113846813-crzopdc`）v5 下 `check` 是 `optional=true` 的 script 节点且 DB 无命令 → 整段跳过（日志「已跳过（optional）」、`reuse_artifact=0`）→ 复用 / 分支缺省 / prod 约束全丢，**本设计依赖的「远端 reuse 跳过拉码构建投递」不成立**；详见 design 决策 10 |

**遗留待确认**：无（D1 已拍板 4a）。

## 变更日志

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-11 | v0.1 | 初稿：背景事实、范围、EARS 验收、非功能、待确认 |
| 2026-09-11 | v0.2 | 补「已有能力核查：代码拉取」（内置 pull 可复用）；新增「代码拉取」EARS 组与非功能「复用」项；待确认补 Q5（reuse 跳过 upload）/Q6 |
| 2026-09-11 | v0.3 | 拉码改为「DB 脚本 + 平台托管（`locked` 不可编辑）」，新增对应 EARS 判据；非功能改「复用/治理」；待确认补 Q7 |
| 2026-09-11 | v0.4 | 「待确认项」全部核实闭合为「决策记录」D1~D8（遗留 0 项）；探活 EARS 补 2 条（local 保持跳过、无命令回退执行体） |
| 2026-09-11 | v0.5 | D1 拍板 4a（4b 不再考虑）；新增 D9「远端拉哪个分支、怎么确认」与 EARS「分支与代码确定性」5 条 |
| 2026-09-11 | v0.6 | 新增 D10「保障放脚本还是平台 = 两边都要」；分支确定性 EARS 补 4 条（无 origin / 分支不存在 / commit 不可达均 fail-fast、脚本 HEAD 自证） |
| 2026-09-11 | v0.7 | 新增 D11（⛔ 实测 v5 下 `check` 被跳过 → 恢复 base 语义）与 EARS「安全基线（check）」4 条 |
