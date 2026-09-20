# admin 发布到 dev · 设计方案

> 类型：design.md（Design 阶段产物 · **实现级**：决策 / 矩阵 / 变量 / 文件级改动）
> 人类阅读优先 → 先看 [`人读版-设计.md`](./人读版-设计.md)（白话 + 一张链路图，10 分钟）
> 日期：2026-09-11（v0.8）
> 关联：需求 `requirements.md` · 接口 `api-design.md` · 脚本 `scripts.md` · 实施 `tasks.md`
> 实现目录：本仓库（`~/workspace/web_system`）
> 设计原则（已确认）：**① 能用脚本的用脚本；② 不得已才做接口封装；③ 涉及数据库操作的一律走接口。**

## 概要

本机 deploy-console 作为**发起端**，把 admin 发布到 dev。链路三段式：

```
本机 console(6200)
 ├─ 脚本 ：本机 release 目录 git pull + vite build --mode mf        （现有能力，不改）
 ├─ 脚本 ：tar + scp → dev 机 /data/web_system/.../modules/admin/default/<commit>/   （改造：目标机按环境解析）
 ├─ 接口 ：POST http://{{DEV_HOST}}:6200/api/hooks/release（HMAC） → 远端写版本表 + 切指针（DB 操作只发生在接口内）
 └─ 脚本 ：curl https://dev.kedouai.com/__manifest__ 断言版本 + 产物 200（等 TTL 10s）
```

分层职责：

```
L3 编排   PipelineService（环境→target 解析、阶段调度）              ← 改
L2 运行时 stages = 脚本（upload/verify/restart/cleanup）             ← 脚本化
L2 语义   version / pointer = 接口（远端 console，DB 操作唯一出口）  ← 改
L1 资源   deploy_servers（目标机）+ 配置中心（远端地址/密钥）        ← 配置
```

## 关键决策

1. **「环境 → 发布目标」显式建模**（不再用全局 `PIPELINE_UPLOAD_TARGET` 一刀切）

   | env | target | 目标机 | 来源 |
   |---|---|---|---|
   | `local` | `local` | 本机 | 现状不变 |
   | `dev` | `remote` | `deploy_servers.dev-default`（{{DEV_HOST}} / ubuntu / /data/web_system） | 已存在，直接复用 |
   | `prod` | `remote` | `deploy_servers.prod-default`（{{PROD_HOST}}） | 同机制，后续复用 |

   解析优先级：**入参 `target` > 模板 `defaultTarget` > 环境级配置 `PIPELINE_TARGET`（配置中心） > 内置规则（local→local，其余→remote）**。
   现状 `p.env === 'local' ? 'local' : (effectiveTarget ?? resolveDefaultTarget())` 改为调用按环境解析的解析器，且**配置缺失时报错**而非静默投本机。

2. **DB 操作只走接口**：本机流水线在 remote 模式下**不再写本机库**；`version`/`pointer` 通过远端 console 接口执行。
   一期复用 `POST /api/hooks/release`（HMAC）；二期可选新增 `POST /api/internal/release/register`（只写库，不拉码不构建）。

3. **脚本承接所有"非 DB"动作**：`upload`（tar+scp）、`verify`（curl 断言）、`restart`（ssh pm2）、`cleanup`（保留 N 版）。
   平台只负责**下发变量**（目标机、远端地址、版本引用），路径与命令逻辑写在脚本/DB 命令里，便于按环境调整。

4. **verify 由本机执行**：因为 dev 侧 `verify` 脚本对 micro-frontend 直接跳过，且本机能直连 `dev.kedouai.com`；
   断言对象是"指针生效"（manifest 读的就是指针），因此**无需再等远端 job 终态**，闭环成立。

5. **local 零回归**：`env=local` 的所有分支保持原路径（本机投递、本机写库、本机 verify），由单测守护。
6. **`git` 节点也落 DB 脚本，但锁定不可编辑**：`deploy_pipeline_step_commands(templateId,'git')` 存脚本，引擎优先执行脚本、缺省回退内置 `pull`；表加 `locked` 列，接口拒写、UI 只读，写入只经迁移/seed。语义回填（`gitCommit`/`versionTag`）与依赖同步仍归平台。详见下节「改造决策」。
7. **前端 verify 断言落 DB 脚本，不改执行体**：模板已配 `verify` 命令时，`executeStage` 的 `commandMode='override'` 会**覆盖内置 `VerifyExecutor`**（实测两端默认模板的 verify 命令均为 `backend) ;; *) 跳过探活; exit 0`，即前端 verify 现在是空操作）。因此断言必须写进**本机模板的 verify 命令**，按 `DEPLOY_ENV` / `REMOTE_GATEWAY_URL` 分支：remote 断言、local 保持跳过；`VerifyExecutor` 仅在模板无命令时兜底。
8. **远端拉码的分支口径与确认**（回答「拉哪个分支、怎么确认」）：

   | 环节 | 事实（代码 / 实测） |
   |---|---|
   | 入参 | `SubmitPipelineDto.branch` → `deploy_pipelines.git_branch`；正则 `^[A-Za-z0-9._/-]{1,128}$` 白名单（防命令注入） |
   | 缺省 | `check` 阶段兜底 `p.gitBranch || 'master'`；`prod` 另有硬约束：分支非 `master` 直接报错 |
   | 下拉来源 | `GET /api/modules/:key/branches` → `ReleaseGitService.listRemoteBranches()`：`git fetch --all --prune` + `git branch -r --sort=-committerdate`，过滤 `origin/*` 与 `->`（HEAD 指针），上限 200 → **页面只读选择，用户不手输** |
   | 实际拉取 | `syncToBranch(branch, commit)`：`git fetch --all --prune` → `git checkout -B <branch> origin/<branch>`（失败回退本地同名分支）→ 有 commit 则 `git reset --hard <commit>` → `git clean -fd` → 返回 `rev-parse --short HEAD` |
   | **关键结论** | **最终代码由 `commitId` 决定**；`branch` 只决定 fetch 来源与本地检出名 —— 远端分支名与发起端不一致也不会导致内容错误，但会切换远端目录 HEAD 分支（R2） |
   | 确认① 日志 | `代码已就绪: <branch>@<commit> → 版本 <templateKey>/<commit>（发布目录 …）`（本机/远端同款，`PullExecutor` 输出） |
   | 确认② 流水线 | `deploy_pipelines.git_branch / git_commit / version_tag` → `GET /api/pipelines/:id` |
   | 确认③ 版本表 | `version` 阶段写 `deploy_versions(env, component, version_tag, git_commit, git_branch, released_by, task_id)`；4a 时落在**远端库** |
   | 确认④ 端到端 | 产物路径 `modules/admin/<templateKey>/<commit>/` + manifest 断言 `default/<commit>` → 版本引用即 commit，可反查代码 |
   | 新增保障 | 脚本执行后平台读 `shortHead` 与入参 `commitId` 比对，不一致 fail-fast（`GIT_COMMIT` 的 `COMMIT_ID##*/` 兜底一并纳入校验） |

   **对本期的要求**：4a 请求体**必须同时带 `branch` 与 `commitId`** —— 缺 `commitId` → 远端走全量构建；缺 `branch` → 远端兜底 `master`（误切远端分支名，且与发起端记录不一致）。
9. **`git` 脚本稳定性加固：三处前置校验 fail-fast + HEAD 自证**（比内置 `PullExecutor` 更严格，属有意为之）

   | 加固点 | 内置行为 | 本脚本行为 | 为什么必须堵 |
   |---|---|---|---|
   | commit 可达性 | `rev-parse` 失败就**跳过 reset**，继续用分支最新代码构建 | 不可达 → `exit 1`（提示先 push） | 静默降级 = 「传了版本引用却打出分支最新代码」，与历史高危「传 versionTag 打出当前 HEAD」同源 |
   | 分支解析 | `checkout -B origin/x 2>/dev/null \|\| 本地同名` —— 错误被吞，可能悄悄用本地分支 | origin 缺失 → warn 后退回本地；两者皆无 → `exit 1` | 不吞错误，代码来源可追溯 |
   | origin 存在性 | 未校验（靠 `fetch` 失败兜底） | **显式校验**，缺失即 `exit 1` | 无 origin 的仓库无法保证「代码 = 目标 commit」 |
   | HEAD 自证 | 无 | `reset` 后自证 `HEAD == ${TARGET}` | 把错误锁在 **git 阶段**（日志直指原因），不拖到 version/pointer 之后 |

   **与平台断言的分工（双保险，各管一段）**：
   - **脚本**管「本次拉码动作正确」—— 前置校验 + 自证，错误在 git 阶段暴露，提示可操作（先 push / 核对分支名）
   - **平台**管「结果与入参一致」—— 回填 `gitCommit`/`versionTag` 并用**全哈希**（`rev-parse --verify <commitId>^{commit}`）与 HEAD 断言；**对未 seed 脚本、走内置回退的模板同样生效**（脚本可被换掉，端到端契约不能只靠脚本）
   - 平台还需入参快照：新增 `deploy_pipelines.requestedCommit`（`versionTag` 会被拉码结果覆盖，入参必须另存才能断言）
10. **⛔（阻塞项，实测 2026-09-11）恢复 v5 下 `check` 的 base 语义**：`PIPELINE_V5_NODES=on` 时模板懒转存为 v5 nodes，`check` 变成 `script` 节点（`optional=true`），而 `reuseArtifact` / 分支缺省 `master` / `prod` 分支约束**只在 `CheckExecutor` 实现** → DB 无 `check` 命令时整段被跳过（实测流水线 `1789113846813-crzopdc` 日志 `[check] 校验 未配置脚本，已跳过（optional）`、`reuse_artifact=0`）。后果：**本设计依赖的「远端 reuse 跳过拉码/构建/投递」不成立**，远端会全量拉码+构建+投递。
   **改法**：`executeV5Node` 的 script 分支对 `key==='check'` 先执行内置 `CheckExecutor`，再叠加 DB 命令（与 legacy `commandMode='base'` 完全对齐）；不改 `PLATFORM_RESERVED`（避免存量模板校验失败）。详见 `详细设计.md` §2。

## 阶段执行体矩阵（`env=dev`）

| 阶段 | 执行体 | 类型 | 说明 |
|---|---|---|---|
| `check` | 平台内置安全基线（复用检测 / 分支缺省 `master` / prod 分支约束）+ DB 命令叠加 | 内置 + 脚本 | **改造**（v5 下恢复 base 语义，见决策 10） |
| `git`(pull) | DB 脚本（locked，平台托管）执行 fetch/checkout/reset/clean；未配置回退内置 `PullExecutor` | 脚本（锁定） | **改造**（见下节；本机必执行=构建来源） |
| `build` | 现有 R6 命令（本机 `vite build --mode mf`） | 脚本 | 不变 |
| `upload` | tar + scp → `REMOTE_ARTIFACT_DIR` | 脚本 | **改造**（目标机按环境解析） |
| `version` | 调远端 console 接口（4a） | 接口 | **改造** |
| `pointer` | 调远端 console 接口（4a） | 接口 | **改造** |
| `restart` | 前端跳过；后端 ssh pm2 restart | 脚本 | 本期仅设计 |
| `verify` | DB 命令：remote 分支 curl manifest 断言 + 产物 200；local 保持「跳过探活」 | 脚本 | **改造**（落 DB 命令，不改执行体，见决策 7 / R9） |
| `cleanup` | 远端保留最近 N 版 | 脚本 | 二期可选 |

## 既有能力核查与改造决策：代码拉取（git）

**现状核查（2026-09-11 实测）**：拉码已有平台内置能力；本期在其基础上**改造为 DB 脚本（锁定，不开放编辑）**。

| 事实 | 证据 |
|---|---|
| 拉码现状 = 平台内置步骤 | `pull` 步骤 `commandMode='override'`，默认执行体 `PullExecutor`（`pipeline/steps/pull.executor.ts`）→ `ReleaseGitService`（`git/release-git.service.ts`） |
| v5 模板中即 `platform` 节点 `git` | `template-node.ts`：`git` 必须首位，与 `version`/`pointer` 同属不可裁剪的平台语义 |
| 命令序列 | `git fetch --all --prune` → `git checkout -B <branch> origin/<branch>` → （指定 commit 时）`git reset --hard <commit>` → `git clean -fd`；随后 pnpm-lock 指纹变化才 `pnpm install --prefer-offline`，再预构建 `@web-system/shared` / `@web-system/types` |
| 作用目录 = **执行进程**的 `RELEASE_WORKSPACE` | `ReleaseGitService.workspace()` 读 `configService.get('RELEASE_WORKSPACE')`（默认 `{{RELEASE_DIR}}`） |
| dev 机该配置已就绪 | dev console `.env`：`RELEASE_WORKSPACE=/data/web_system`；该目录为 git clone（master、工作区干净、`origin` 可达）；console 进程 cwd 即此目录 |
| dev 模板确含 git 节点 | `deploy_pipeline_templates` 默认模板 nodes 首节点 `{"key":"git","kind":"platform"}` |
| dev 的 step commands 无 git | 仅 build/upload/restart/verify/cleanup —— 本期把它补上（见下） |

### 改造决策：`git` 也落 DB 脚本，但不开放编辑

| 项 | 决定 |
|---|---|
| 存取 | 与 upload/verify 同表同构：`deploy_pipeline_step_commands(templateId, nodeKey='git')`。DB 即运行时唯一真相源（可审计、可用 SQL 调、可随迁移同步到远端） |
| 不可编辑 | 表新增 `locked` 列（`git` 置 `true`）；`PUT`/`DELETE /api/pipeline-templates/:id/steps/git` 一律拒绝（400）；UI **只读展示**脚本 + 「平台托管」标签；写入只经**迁移/seed**，不经接口 |
| 执行 | 引擎 `executeV5Node` 的 platform/git 分支改为：**DB 有脚本 → 执行脚本；无 → 回退内置 `pull` 执行体**（存量模板零回归） |
| 脚本边界 | 脚本只做「代码位置同步」；**依赖同步（pnpm-lock 指纹 install）与 shared/types 预构建仍由平台在 git 之后执行**（并发安全 + 流水线级一次，理由见 `pull.executor.ts` 注释） |
| 语义回填 | `gitCommit`/`versionTag` **仍由平台回填**：脚本跑完后调 `ReleaseGitService.shortHead(RELEASE_DIR)`，组装 `versionTag=<templateKey>/<commit>`；若入参指定 `commitId` 且与 HEAD 不一致 → fail-fast（防「脚本换了代码但版本号没变」） |
| 脚本约束 | **机器无关**：只用 `RELEASE_DIR / BRANCH / COMMIT_ID / MODULE_* / WS_SAFE_DELETE` 等「本机自身」变量；**禁止**依赖 `REMOTE_*`（那是发起端概念，两端会各自解析成不同值） |
| 复用守卫 | `reuseArtifact` 守卫仍在脚本**之前**生效（复用产物时根本不执行 git 脚本） |
| 谁来同步 | 现无"每模块一次"的仓库凭证问题：脚本随**迁移 SQL/seed** 落库，本机与 dev 机随各自 console 发布各跑一次迁移，天然一致 |

**谁执行**：本机流水线跑本机脚本（`RELEASE_DIR` = 本机发布目录，服务「本机构建 admin 产物」）；远端 console 被 hook 触发时跑它自己的脚本（`RELEASE_DIR=/data/web_system`）——本机**不** ssh 过去跑 git。

**两条硬前提**（实现须保证）：

1. **hook 必须带 `commitId` 与 `branch`**。带 `commitId` → 远端 `check` 按 `default/<commit>` 命中 S1 已投递产物 → `reuseArtifact=true` → `step-registry` 守卫把 `pull`/`build`/`upload`/`restart` 全跳过（**不切分支**）；不带 `commitId` → `versionTag` 为空 → `reuseArtifact=false` → 远端走完整构建路径，此时远端 pull 会 `checkout -B <branch>` + `reset --hard`，产生分支切换副作用（即 R2）；`branch` 与 `commitId` 同时带上，远端记录/检出才与发起端一致（见决策 8）。
2. **远端目录必须是 git clone**。否则 `ReleaseGitService.ensureRepo()` 直接抛「发布目录不存在…请先 git clone」。

## 平台下发变量（`resolveStageVars` 扩展）

现有：`DEPLOY_ENV / MODULE_KEY / MODULE_TYPE / MODULE_DIR / BRANCH / COMMIT_ID / RELEASE_DIR / PM2_NAME / PORT / PUBLIC_PATH / ENTRY_FILE / BUILD_OUTPUT_DIR / ARTIFACT_DIR / GATEWAY_URL / GATEWAY_TTL_SEC / KEEP_VERSIONS / PROTECTED_VERSIONS / WS_SAFE_DELETE`

**新增（remote 模式）**：

| 变量 | 值示例 | 用途 |
|---|---|---|
| `GIT_COMMIT` | `1a2b3c4` | 纯短哈希（接口 `commitId` 用）；缺省 `COMMIT_ID##*/` 兜底 |
| `REMOTE_HOST` | `{{DEV_HOST}}` | SSH 目标 |
| `REMOTE_USER` | `ubuntu` | SSH 用户 |
| `REMOTE_KEY` | `{{SSH_KEY_PATH}}` | SSH 私钥**绝对路径**（平台侧展开 `~`） |
| `REMOTE_DIR` | `/data/web_system` | 目标机部署根目录 |
| `REMOTE_ARTIFACT_DIR` | `/data/web_system/servers/gateway/public/static/modules/admin/default/1a2b3c4` | 远端产物目录 |
| `REMOTE_GATEWAY_URL` | `https://dev.kedouai.com` | 探活入口 |
| `REMOTE_CONSOLE_URL` | `http://{{DEV_HOST}}:6200` | 接口出口 |
| `RELEASE_HOOK_SECRET` | （已有，全环境同值） | HMAC 密钥 |

> `COMMIT_ID` 在 R6 下是**完整引用**（`default/1a2b3c4`）；`GIT_COMMIT` 是纯短哈希。两者用途不同，勿混用。
> 当 `reuseArtifact=true` 跳过 pull 时，本机 `gitCommit` 由 `check` 阶段从版本表回填（`registry.findByVersionTag`），此时 `GIT_COMMIT` 依赖 `COMMIT_ID##*/` 兜底取值 —— 该兜底必须保留。

## 目标机与远端参数来源

| 数据 | 来源 | 现状 |
|---|---|---|
| host / user / key / remoteDir | `deploy_servers`（`<env>-default` 或环境服务路由） | `dev-default` 已存在 |
| `REMOTE_GATEWAY_URL` / `REMOTE_CONSOLE_URL` | 配置中心 `config_items`（scope=env, env_id=dev） | 需新增 2 条 |
| `RELEASE_HOOK_SECRET` | `.env`（本机与 dev 机同值 `15ca…`） | 已存在 |

解析失败（缺目标机/缺 URL）→ **阶段 fail-fast**，错误信息含缺失项与配置指引。

## 改动清单（文件级）

| 编号 | 文件 | 改动 |
|---|---|---|
| P1 | `servers/deploy-console/src/pipeline/pipeline.service.ts` | 新增 `resolveTargetForEnv(env, explicit?, templateDefault?)`；`run()` 改用它；remote 时注入远端变量；新增 `GIT_COMMIT` |
| P2 | `servers/deploy-console/src/remote/remote-delivery.service.ts` | `resolveTarget(env)` 改读 `deploy_servers`（经 `ServerService.resolveEnvDefaultServer`），回退旧 env 变量；`~` 展开为绝对路径 |
| P3 | 新增 `servers/deploy-console/src/remote/remote-release.client.ts` | HMAC 签名 + 调 `REMOTE_CONSOLE_URL/api/hooks/release`；`deliveryId` 幂等；超时与错误映射 |
| P4 | `servers/deploy-console/src/pipeline/steps/pointer.executor.ts`、`steps/version.executor.ts` | `uploadTarget==='remote'` → 走 P3；local 保持原逻辑 |
| P5 | DB `deploy_pipeline_step_commands`（默认模板 nodeKey=`verify`） | 补 micro-frontend 分支：`DEPLOY_ENV != local` 且 `REMOTE_GATEWAY_URL` 存在 → 走 `scripts.md` S3 断言；否则保持现有「跳过探活」。**`verify.executor.ts` 不改**（有 DB 命令时它不会被执行，见 R9） |
| P6 | `servers/deploy-console/src/pipeline/steps/restart.executor.ts` | remote + backend → ssh pm2 restart；micro-frontend 跳过 |
| P7 | `servers/deploy-console/src/pipeline/steps/upload.executor.ts` | remote 分支接 P2，日志打印 `ssh target` 与远端目录 |
| P8 | `apps/deploy-console/src/components/PipelineSubmit.vue`、`views/PipelineCenter.vue` | `env=dev/prod` 时提示远端目标机与"由该环境控制台切指针" |
| P9 | `servers/deploy-console/src/pipeline/steps/step-registry.ts` | remote 模式下 `upload` 的 skip 守卫不得因**本机** `reuseArtifact` 跳过（见 R6）；`pull`/`build` 仍按 reuse 跳过 |
| P10 | `servers/deploy-console/src/entities/deploy-pipeline-step-command.entity.ts` + 迁移 SQL | 新增 `locked` 列（默认 false；`git` 置 true） |
| P11 | 迁移/seed SQL（本机 + dev 机 `web_system` 库） | 给全局模板（key=`default` 等）写入 `nodeKey='git'` 的锁定脚本（`scripts.md` S0） |
| P12 | `servers/deploy-console/src/pipeline/pipeline.service.ts`（`executeV5Node`） | platform/git 分支：优先执行 DB 脚本（`runStageCommand(p,'git')`），无则回退内置 `pull`；脚本后由平台回填 `gitCommit`/`versionTag`，并用**全哈希**与入参 `commitId` 断言（`rev-parse --verify <commitId>^{commit}`，避免短哈希位数差异误判） |
| P13 | `pipeline-step-command.service.ts` / `pipeline-step-command.controller.ts` | `upsert`/`remove` 对 `locked=true` 拒绝（400）；`list` 返回 `locked` |
| P14 | `apps/deploy-console/src/views/PipelineDetail.vue`、`PipelineEdit.vue` | `git` 节点可点开**只读**查看脚本 + 「平台托管，不可编辑」标签（替代当前"点击无反应"的提示） |
| P15 | `pipeline.service.ts`（`executeV5Node`） | script 分支对 `key==='check'` 先执行内置 `CheckExecutor` 再叠加命令（恢复 base 语义，阻塞项修复，见决策 10） |
| P16 | `entities/deploy-pipeline.entity.ts` + `submit` | 新增 `requestedCommit` 列（入参快照），供 P12 一致性断言 |
| P17 | `pipeline/step-scripts.ts`、`pipeline-step-command-seed.service.ts`（均新增） | 脚本正文作为代码常量 + 启动/建模板时幂等 upsert（`locked=true`），替代 SQL 迁移 |
| C1 | 配置中心（本机库 `web_system_deploy.config_items`，scope=env, env_id=dev） | `REMOTE_CONSOLE_URL`、`REMOTE_GATEWAY_URL` |
| C2 | 本机 `servers/deploy-console/.env` | 保持 `PIPELINE_UPLOAD_TARGET=local`（**不改**，local 语义不变） |
| D1 | `docs/development/local-release-runbook.md` | 新增「发布到 dev（远端）」章节 |
| D2 | `mcp-skills/kedou-deploy/SKILL.md` | 补 dev 远端发布说明 |

## 兼容与回归

| 场景 | 期望 |
|---|---|
| `env=local` 发布 admin | 与现状完全一致（本机投递/本机写库/本机 verify） |
| `env=dev` 未配置远端参数 | fail-fast，提示缺 `REMOTE_CONSOLE_URL` 等 |
| 历史版本（`versionTag` 复用） | 本机产物已存在 → 跳过本机 build；远端同理由接口复用 |
| `env=dev` 且本机已有同 commit 产物 | 复用**仅跳过 build**；`upload` **仍执行**（投递到目标机，见 R6） |
| `env=dev` 且远端无该 commit 产物 | 远端 `reuseArtifact=false` → 远端会真正 pull+build+upload（本期由「必传 `commitId`」约束避免） |
| 存量模板未 seed `git` 脚本 | 回退内置 `pull` 执行体 → 行为与改造前完全一致（零回归） |
| 尝试从接口改/删 `git` 脚本 | 400 拒绝（`locked`） |
| `env=local` 的 `verify` | 保持现状（跳过探活），**不**新增断言 → local 发布严格度不变 |
| 模板未配 `verify` 命令 | 回退内置 `VerifyExecutor`（前端 manifest 断言 / 后端 pm2+端口探活） |
| 发布目录无 `origin` / 指定 commit 未 push | **`git` 阶段 fail-fast**（比内置严格）：提示「未配置 origin」/「commit 不可达: <hash>」；不会用分支最新代码代替 → 宁失败不发错版本 |
| 某机确为本地无 origin 仓库（罕见） | 需显式调整脚本（去掉 origin 校验）—— 默认按「发布目录必须是 clone」处理 |
| 灰度（`mode=grayscale`） | 本期不支持 remote 灰度，明确报错 |

## 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 本机 pm2 进程需可读 `~/.ssh/id_ed25519_servers` | 启动前自检（脚本检查文件存在与权限）；key 路径不入日志 |
| R2 | 远端 `git` 节点切分支：**仅在远端无该 commit 产物时发生**（正常链路走 reuse，pull 被跳过） | 实现侧强制 hook 带 `commitId`；文档提示；如需彻底消除转 4b |
| R3 | 双端各有 `(env,moduleKey)` 发布锁，互不可见 | 文档约定同一模块不同时从两端发布 |
| R4 | `deliveryId` 设计影响重试语义 | 采用 `local-<commit>-<module>`，同 commit 重复提交幂等；换 commit 即新发布 |
| R5 | console 自身改动需传统发布 | 本机用 `scripts/publish-deploy-console.sh` |
| R6 | **本机 `reuseArtifact` 会连 `upload` 一起跳过**（`step-registry` 的 skip 只看 reuse、不看 target）：本机 release 目录已有同 commit 产物时，remote 投递被跳过 → dev 机无产物但指针已切 → verify 404 | P9：remote 模式下 `upload` 不因本机 reuse 跳过（upload 幂等，重投成本低）；`pull`/`build` 仍可跳过 |
| R7 | 远端拉码依赖 dev 机 git 凭证与 clone 状态 | 已实测可用；`ensureRepo()` 缺仓库时 fail-fast 并提示 clone 命令 |
| R8 | 两端 DB 的 `git` 脚本不一致（本机跑了新迁移、dev 机未跑） | 脚本随 console 代码的迁移各自落库；`GET /pipeline-templates/:id/steps` 可核对脚本文本；本期远端 pull 被 reuse 跳过，不一致不影响链路 |
| R9 | **verify 断言落点陷阱**：DB 命令以 `override` 覆盖内置 `VerifyExecutor`，若只改 executor 不改 DB 命令 → 断言永不执行，前端 verify 静默通过（验收会"看起来成功"） | 按决策 7 / P5 落 DB 脚本；用 V4/V5 验收（断言实际执行、失败可感知）验证 |
| R10 | **⛔ v5 下 `check` 整体被跳过（已实测，阻塞本设计）** → 复用不生效，远端会全量拉码+构建+投递，本设计架构不成立 | 零期-B 恢复 base 语义（决策 10 / P15）；用 V15 验收（复用命中且跳过 build/upload） |

## 变更日志

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-11 | v0.1 | 现状核实 + 双路线选型（推荐 dev 机 console） |
| 2026-09-11 | v0.2 | 执行面改定本机 console；环境→target 模型、阶段矩阵、4a/4b |
| 2026-09-11 | v0.3 | 落盘 `~/workspace/web_system`；新增变量清单、文件级改动、兼容/风险；配套 `api-design.md` / `scripts.md` / `tasks.md` |
| 2026-09-11 | v0.4 | 补「既有能力复用核查：远程代码拉取」（内置 pull 可复用、正常链路不触发远端 pull）；修正 R2、新增 R6/R7 与改动 P9；补 remote reuse 不跳过 upload 的兼容行 |
| 2026-09-11 | v0.5 | 决策 6：`git` 节点改为 DB 脚本（`locked` 锁定、接口拒写、UI 只读、迁移 seed）；引擎优先执行脚本、缺省回退内置；回填与依赖同步仍归平台；补 P10~P14、R8、兼容行 |
| 2026-09-11 | v0.6 | 决策 7：前端 verify 断言落 DB 命令（实测 DB 命令 override 内置执行体，前端 verify 现为空操作）；改写 P5 与阶段矩阵 verify 行；补 R9、兼容行 |
| 2026-09-11 | v0.7 | 决策 8：远端拉码的分支口径与确认（入参/缺省/下拉来源/实际命令/四层确认途径/HEAD==commitId 断言）；硬前提 1 补 `branch` 必带 |
| 2026-09-11 | v0.8 | 决策 9：`git` 脚本稳定性加固（origin 校验 / 分支解析不吞错 / commit 可达 fail-fast / HEAD 自证）与「脚本 vs 平台断言」分工；P12 断言改全哈希；兼容补 2 行 |
| 2026-09-11 | v0.9 | 决策 10：⛔ 实测 v5 下 `check` 被跳过（复用从未生效，阻塞本设计）→ 恢复 base 语义；阶段矩阵补 check 行；改动清单补 P15~P17；新增 R10；配 `详细设计.md` |
