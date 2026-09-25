# 本地开发发布 + 发布平台基础设施梳理（2026-09-25）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **定位**：回答「本地发布怎么跑、dev/prod 发布为什么跑不通、要打通需要做什么」。
> **主机地址一律不落本文**：机器 IP / 部署根看 deploy-console「基础设施 → 主机管理」的 `<env>-default` 主机组（`deploy_hosts` / `deploy_servers`）。
> **判据来源**：`docs/development/local-release-runbook.md`、`specs/pipeline-node-model/design.md`、`scripts/apply-migrations.sh`、`scripts/modules.json`、`ecosystem.config.cjs`、`servers/deploy-console/src/**`。
> 关联总表：`docs/development/master-todo-2026-09-25.md`（跨战线待办索引）。

---

## 0. 结论先行

| 问题 | 答案 |
|---|---|
| **本地（local）发布能用吗** | ✅ 能用，且已反复验证。三条通道分工明确（见 §2） |
| **dev / prod 发布能用吗** | ❌ **不能闭环**。代码链路大部分已就位（SSH、远端动作脚本、远端写库、远端指针），但**从未真机跑过一次**，且有 8 个点会让它在实际执行时失败或静默出错 |
| **最致命的三个** | ① `PIPELINE_UPLOAD_TARGET` 未配置时**默认投递到本机**（dev/prod 发布实为发到编排者本机）；② 内置 `verify` **已被删除**且自动回滚锚点仍指向它 → 发布后零验证、回滚可能不触发；③ `apply-version` action **只配了 gateway 三条流水线** → 其余后台模块「跑完不生效」 |
| **打通需要多久** | 数据登记半天 + 一个变更窗口做一次真机演练（建议拿 `system-service`），其余可后续 |

---

## 1. 本地发布：现状地图（已通）

### 1.1 三条通道（不可混用）

| 发布对象 | 通道 | 入口 | 源 |
|---|---|---|---|
| deploy-console 自身（6200） | **传统发布** | `scripts/publish-deploy-console.sh`（默认本机；`--env dev|prod` 可远端） | **工作区**（不是发布目录） |
| 后端服务 + admin/portal | **发布流水线** | `POST /api/pipelines`（6200）/ 控制台 UI | git 拉取到发布目录 |
| admin/portal 微前端切换版本 | 控制台「版本部署」 | `apps.switchVersion` | 已投递的版本目录 |

> ⚠️ deploy-console 不能走流水线（`stageRestart` 会 restart 执行者 = 自杀式中断）。

### 1.2 本地链路的已知坑（都有对策，勿再踩）

| # | 坑 | 对策（已落地） |
|---|---|---|
| L-1 | 构建 ≥500 文件删除触发 IDE 批量删除审批，后台进程无确认通道 → 构建失败 | Hook 把旧产物 `mv` 到 `/tmp`（`A5` 级已注册在内容/上传/AI/前端模块） |
| L-2 | pnpm 硬链接同上，且 install 中断残留 `*_tmp_*` 导致 `TS2688` | 写 `.deploy-lock-hash` 跳过 install；残留 `mv` 到 /tmp |
| L-3 | `pm2 restart --update-env` 把 `PORT` 传播给所有服务 → 全部 EADDRINUSE | 一律 `delete + start`；`publish-deploy-console.sh` 用 `env -i` 只留 PATH/HOME/主密钥路径 |
| L-4 | 孤儿进程占端口（改了不生效头号根源） | 验收判据 = **`lsof` 持有者 == `pm2 jlist` 的 pid**，不是看 `pm2 list` online |
| L-5 | 进程 online 但 DI 缺注册 → 秒级崩溃，端口探活骗得过 | 采样 `restart_time` 是否增长（脚本已内建崩溃检测） |
| L-6 | 发布目录停在 master 却在 feature 分支开发 → 构建源错位、无报错 | deploy-console 自身源固定为**工作区**，脚本打印分支/HEAD/未提交数 |
| L-7 | nginx `/static/modules/` 双源（工作区 vs 发布目录） → 新版本 404 | alias **单源化到发布目录**（已结论，见 runbook §4.5） |
| L-8 | 主密钥与部署库不同域 → console 启动 FATAL 崩溃循环 | `scripts/verify-config-master-key.mjs` 退出码 0/2/3；值与库必须同域 |

### 1.3 本地也有两处待修（新发现）

| # | 问题 | 证据 |
|---|---|---|
| L-9 | `scripts/release-deploy-console.sh:93` 调 `publish-deploy-console.sh --skip-sync`，但后者**不支持该参数**（`:62` 未知参数即 `exit 2`）→ console 的封装/CI 链路是断的 | `release-deploy-console.sh:93` vs `publish-deploy-console.sh:62` |
| L-10 | nginx 配置仍指向**已不存在的目录**：`apps/admin-web`、`apps/mcp-admin`（仓库 `apps/` 下只有 admin / deploy-console / kedou-ai-minigram / mini-app / portal / shell） | `local.nginx.conf:332,393`、`nginx-server.conf:126,202` |

---

## 2. dev / prod 发布：为什么跑不通

### 2.1 链路现状：代码大部分在，靠的是「DB 里的动作脚本」

| 能力 | 状态 | 落地位置 |
|---|---|---|
| 远端 SSH 投递（tar→scp→解包） | ✅ 已合（PR #135） | `scripts/migrations/p5-pipeline-shell-approval-3env.mjs:167-215` |
| 远端 sync / restart / verify 动作 | ✅ 已合，**默认只挂 `system-service`** | `p26-remote-backend-release.mjs:26-27,56` |
| 远端发布写**远端库**的版本/指针 | ✅ 已合，默认后端 3 个、前端 admin | `p27-remote-release-remote-db.mjs:52-60` |
| 远端微前端 env-dir 布局 | ✅ 已合，默认 admin/portal/shell、env=dev | `p28-remote-mf-envdir.mjs:43-44` |
| 后端「部署生效」到 `dist` + pm2 重启 | ✅ 代码在，**❌ 从未真机执行** | `deploy.service.ts:1352-1440`；`specs/deploy-console/backend-deploy-effect-tasks.md:53-58` |

> ⚠️ **四条远端通道的地址来源互不相同** —— 同一模块不同阶段可能打到不同机器：
> `PUBLISH_*` 流水线变量（p5/p20/p26）｜`DEV_SERVER`/`PROD_SERVER` 环境变量（`remote-delivery.service.ts:33-48`）｜`deploy_hosts`（`deploy.service.ts:1551`）｜`deploy_hosts.scope`（监控，`monitor.service.ts:198-204`）。

### 2.2 阻塞清单（P = 链路侧）

| # | 阻塞 | 后果 | 证据 |
|---|---|---|---|
| **P-1** | 流水线节点**无远程执行通道**（design 的 P1 未开工）：`runStageCommand` cwd 恒为发布目录，节点无 `host` 字段 | dev/prod 只能靠 DB 脚本里的 ssh 串 assumption | `pipeline.service.ts:2340,2504`；`template-node.ts:41-52` |
| **P-2** | `resolveDefaultTarget()` 未配 `PIPELINE_UPLOAD_TARGET` 时返回 **`'local'`**，而 `.env.example` 默认值就是 local | **dev/prod 发布实际投递到编排者本机** | `pipeline.service.ts:2082-2086,1464-1472`；`servers/deploy-console/.env.example:47` |
| **P-3** | 远端部署生效**从未真机执行**（会改远端的 dist 并重启 pm2） | 全链路最大的未知项 | `master-todo-2026-09-25.md:97` |
| **P-4** | T1 的 V1–V4 判据未取证；单测只覆盖「远端就地换 dist」分支，本机中转 tar+sftp、回滚命令、dist 内容一致性**均无覆盖** | 出问题无法定位 | `deploy.service.spec.ts:264-294` vs `deploy.service.ts:1382-1439` |
| **P-5** | 远端 LLM 目标依赖 `deploy_hosts` 登记；未登记回退 `deploy_servers.<env>-default`，都无则 **502**；且前端模块**尚未登记进 `deploy_service_envs`** | 模块发出去落在错机器 | `deploy.service.ts:1547-1566,1242-1243` |
| **P-6** | 远端端口真相源 `deploy_service_envs.port` 未登记 → PORT 为空 → verify 探错端口 → **自动回滚 dist**（2026-09-23 auth-service 事故） | 「流水线 failed 但线上没变」 | `pipeline.service.ts:317-348,570-584` |
| **P-7** | 内置 `verify` / manifest 断言**已删除**（注册表只剩 7 步），DB 未配脚本即**零验证**；自动回滚锚点仍写死 `verify` | 发布结果不可判定，回滚可能不触发 | `step-registry.ts:17-21`；`pipeline.service.ts:167` |
| **P-8** | `apply` 是纯内置不可命令覆盖，未配 `apply-version` action 的后台模块**跑完流水线不生效**（只到产物+版本记录，dist 不换） | 目前只有 gateway 三条流水线配了 | `step-registry.ts:68-77`；`apply.executor.ts:29-30` |
| **P-9** | `scripts/pipeline/fetch-config.sh` 要 `DEPLOY_ENV_ID`，平台注入的是 **`DEPLOY_ENV`** → 恒成立 skip | 远端**重启型**发布拿不到配置下发 | `fetch-config.sh:32,37` vs `pipeline.service.ts:381` |
| **P-10** | `scripts/pipeline/*.sh` 头部指向 `servers/deploy-console/src/pipeline/scripts/`（**目录不存在**）；p5 依赖的 `git-step.sh` 也不存在 | 迁移不可重跑 | `restart-backend.sh:3-4`；`p5-*.mjs:48-49` |
| **P-11** | `PIPELINE_STAGES` 仍含 `restart`/`verify`，与 7 步注册表不一致；`PIPELINE_V5_NODES=off` 时 legacy 路径**必抛**「未知或不可编排步骤」 | 开关误用即全线失败 | `deploy-pipeline.entity.ts:10-20` vs `step-registry.ts:42-95` |
| **P-12** | console 远端发布用 **`pm2 restart`**（非干净重建），与本地 `env -i`+`delete+start` 语义不同 | `--update-env` 污染的历史风险在远端未消除 | `publish-deploy-console.sh:236` vs `:341-344` |
| **P-13** | 旁路脚本（`publish-deploy-console.sh` / `publish-ai-agent.sh`）与流水线争抢发布目录，`releaseLock` **只保护流水线内部** | 并发/交叉发布会互相覆盖 | `pipeline.service.ts:1477`；`specs/pipeline-concurrency/design.md:50` |
| **P-14** | 环境双模型并存（`deploy_environments` 模块级 vs `deploy_envs` 站点级）且流水线**不校验 env 存在性** | env 拼错 → 静默发到不存在的环境 | `pipeline.service.ts:682-683` |
| **P-15** | env-dir 前端（admin/portal）**无远端指针通道**：`deployVersion` 的 env-dir 分支直接 return，SSH 分支只服务 backend | 远端切指针只能靠脚本 curl 内部接口 | `deploy.service.ts:310-327` vs `504-511` |
| **P-16** | 远端 cleanup 直接跳过；`deploy-dev.sh` / `deploy-prod.sh` 依赖**不存在**的 `scripts/.env.dev` / `.env.prod`，且 deploy-prod 写死 3000/3001 | 这两条「兜底通道」实际不可用 | `cleanup.executor.ts:30-40`；`deploy-dev.sh:17`；`deploy-prod.sh:3-15,29` |

### 2.3 基础设施侧阻塞（I = 事实层）

| # | 阻塞 | 是否需要你提供信息 |
|---|---|---|
| **I-1** | `scripts/migrations/**` 的 26 个 `.mjs` **不在 `apply-migrations.sh` 扫描范围内**（只扫仓库根 `migrations/*.sql`）→ dev/prod 执行过没有**完全不可知** | 否（纯仓库缺口） |
| **I-2** | `migrations/0014_deploy_host_scope.sql` **缺 `-- @database web_system_deploy` 头** → 走脚本会加列到默认的 `web_system`（**错的库**） | 否（建议立刻补头） |
| **I-3** | prod 缺 3 个服务的端口登记（ai-agent / upload-service / deploy-console）→ `PORT_SOURCE=unresolved` | **是**：给这 3 个服务的 prod 端口 |
| **I-4** | prod `upload-service` 未运行、`.env` 为空（卡住 A8 上 prod） | **是**：PORT / 存储根（密钥须与 prod ai-service 完全一致） |
| **I-5** | 边缘机（`dev.kedouai.com` 的 nginx 所在机）未登记为主机，缺 SSH 用户/密钥/部署根 | **是** |
| **I-6** | dev 控制台 `.env` 未写 `CONSOLE_INSTANCE=dev`（缺即启动 FATAL）；0014 迁移 SQL 待在**两份库**应用并复核 | 否（值已拍板） |
| **I-7** | 迁移账本 3 条待定（`0008` knowledge 表 / `0010` 过时 / `0012` music 未上）—— **记账不可逆，错记会永久跳过** | **是**：逐条拍板 |
| **I-8** | prod 是否跑 `scripts/migrate-uploads.mjs` 未决（dev 已跑） | **是** |
| **I-9** | `deploy_env_service_routes` 在 dev/prod 是否要登记未定 | **是** |
| **I-10** | 远端链路默认范围极窄（p26 只 system-service、p27 只 3 后端+admin、p28 只 admin/portal/shell 且 env 默认 dev） | **是**：变更窗口与推广范围 |
| **I-11** | `ecosystem.config.js` vs `.cjs` 双文件漂移：pm2 名两套（`web-*` vs 裸名）、auth 端口 6101 vs 6001、**prod 3000 系两份都没有** | **是**：哪份是真相源、prod 是否保留 3000 系 |
| **I-12** | **代码 bug**：`services.service.ts:151` 从 `modules.json` 播种时读 `m.pm`（字段实际叫 `pm2`）→ 新表 `pm2Name` 恒为 `null`，远端重启解析不到进程名 | 否（可直接改） |
| **I-13** | `INTERNAL_API_KEY` / 各服务 `.env` **无同步脚本、无轮换方案**；生产新 KEY 漏配只能人工发现 | 否（补指纹巡检脚本） |
| **I-14** | prod 上 ai-agent 与 deploy-console **根本不存在** → 发布这两个模块到 prod 必然失败 | **是**：是否要在 prod 上线 |

---

## 3. 打通 dev / prod 的任务拆解

> 顺序按依赖排，同一档内可并行。**前三档做完，dev 就能发；第四档做完 prod 能发。**

### M0 · 数据登记与安全修复（半天，无变更窗口）

| # | 任务 | 验收 | 归属 |
|---|---|---|---|
| M0-1 | `0014_deploy_host_scope.sql` 补 `-- @database web_system_deploy` 头（**防止加到错库**） | 脚本 dry-run 显示目标库正确 | 研发 |
| M0-2 | 修 `services.service.ts:151` 的 `m.pm` → `m.pm2` | 新表播种后 `pm2Name` 非空 | 研发 |
| M0-3 | 统一 `fetch-config.sh` 的 `DEPLOY_ENV_ID` → `DEPLOY_ENV`（或平台侧同时注入两个） | 流水线里不再恒 skip | 研发 |
| M0-4 | 修 `release-deploy-console.sh --skip-sync`（或在 publish 脚本支持该参数） | 封装链路可执行 | 研发 |
| M0-5 | 主机管理登记 dev/prod 主机 + 环境服务指向补 `hostName + port`（**含 prod 缺的 3 个**） | `deploy_service_envs` 三环境齐全；`PORT_SOURCE` 不再出现 `unresolved` | 运维 + 你给端口 |
| M0-6 | dev 控制台 `.env` 写 `CONSOLE_INSTANCE=dev`；两份库应用 0014 并复核 `scope`/`managed_by` | 控制台启动无 FATAL；`SELECT name,scope,managed_by FROM deploy_hosts` 正确 | 运维 |
| M0-7 | 目标环境 console 显式设 `PIPELINE_UPLOAD_TARGET=remote` | 发布日志 target 不是 local | 运维 |

### M1 · dev 最小闭环（一个变更窗口，半天）

> **拿 `system-service` 做第一个**（p26 已挂 sync/restart/verify），它最有可能一次通过。

| # | 任务 | 验收 |
|---|---|---|
| M1-1 | 确认该模块流水线配了 `apply-version` action，否则补上（**P-8**） | 流水线节点列表可见该 action |
| M1-2 | 补一条 verify 动作或接受「无验证」，明确告诉自己这次发布后**需要人工确认**（**P-7**） | 有共识：谁来验、验什么 |
| M1-3 | 执行发布到 dev，留存 V1–V4 证据：远端 dist 内容与版本目录一致 / pm2 online / 失败保留旧 dist / 日志 | 四条证据落盘到 `specs/deploy-console/backend-deploy-effect-tasks.md` |
| M1-4 | 同步验证 `fetch-config.sh` 修好后重启型发布能拿到配置 | 远端 `.env.generated` 存在且生效 |

### M2 · prod 逐步放行（依赖 I-3/I-4/I-14 决策）

| # | 任务 |
|---|---|
| M2-1 | prod 补环境登记（依赖 I-3 端口、I-4 upload-service） |
| M2-2 | 先发 **gateway**（唯一配了 apply-version 且成熟的通道）→ 发 **system-service** → 其余逐个验投递路径 |
| M2-3 | admin/portal 远端 env-dir 发布（依赖 P-15 的远端指针通道改造或继续用脚本 curl 内部接口） |
| M2-4 | 每发一个模块回填 `scripts/modules.json` 的核验状态 |

### M3 · 结构性改造（独立立项，不必阻塞 dev/prod）

| # | 任务 | 说明 |
|---|---|---|
| M3-1 | **流水线远程执行通道**（P-1） | 给节点加 `host` + SSH 通道，去掉「DB 脚本里硬编 ssh」的现状 |
| M3-2 | **四条远端通道收敛到一个地址解析**（P-7 的重复 section） | 统一走 `deploy_hosts` + `deploy_service_envs` |
| M3-3 | 旁路脚本纳管 / runbook 禁令（P-13） | `specs/pipeline-concurrency` 的 V11/T10 |
| M3-4 | 环境模型二选一（P-14） | 消掉 `deploy_environments` 与 `deploy_envs` 并存 |
| M3-5 | 恢复 manifest 断言或把它做成可选 action（P-7） | 回滚锚点同步跟着改，否则锚点指到不存在的步骤 |
| M3-6 | 迁移账本工具化（I-1） | `.mjs` 迁移纳入扫描或单独记账，否则「执行过没」永远靠人记 |

---

## 4. 需要你拍板 / 提供的信息

| # | 事项 | 卡住谁 |
|---|---|---|
| Q1 | prod 三个服务端口：ai-agent / upload-service / deploy-console | M0-5 → 整个 M2 |
| Q2 | prod upload-service 的存储根 + 上线与否 | I-4 / A8 上 prod |
| Q3 | 边缘机 SSH 用户 / 私钥 / 部署根 | I-5 |
| Q4 | 迁移账本 3 条：执行 or 记账跳过（**不可逆**） | I-7 |
| Q5 | prod 是否跑上传迁移；是否要 deploy_env_service_routes | I-8 / I-9 |
| Q6 | **dev/prod 变更窗口**（要改 dist 并重启 pm2） | 整个 M1/M2 |
| Q7 | `ecosystem.config.js` vs `.cjs` 谁作真相源；prod 是否保留 3000 系 | I-11 |
| Q8 | ai-agent / deploy-console 是否要在 prod 上线 | I-14 |

---

## 5. 一条提醒：发布前必做的事

> **先跑迁移**：`NODE_ENV=production` 下 TypeORM synchronize 关闭，新表不会自动建 → 表现是「进程 online 但端口不监听」。
> `DRY_RUN=1 ./scripts/apply-migrations.sh dev` → 确认无异常 → 去掉 DRY_RUN 再跑。

## 6. 关联文档

| 主题 | 入口 |
|---|---|
| 本手册：日常发布操作与踩坑 | `docs/development/local-release-runbook.md` |
| 发布流水线设计 | `docs/development/deploy-pipeline-dev.md` |
| 部署目标知识（drill 目标） | `docs/development/deploy-target-knowledge.md` |
| 环境配置清单 | `docs/development/dev-env-config-inventory.md` |
| 远端部署生效任务表 | `specs/deploy-console/backend-deploy-effect-tasks.md` |
| 并发发布（未开工） | `specs/pipeline-concurrency/requirements.md` |
| 跨战线待办总表 | `docs/development/master-todo-2026-09-25.md` |
</content>
