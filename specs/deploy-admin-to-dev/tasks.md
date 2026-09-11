# admin 发布到 dev · 实施任务

> 类型：tasks.md（Design 阶段产物）
> 日期：2026-09-11
> 关联：需求 `requirements.md` · 设计 `design.md` · 接口 `api-design.md` · 脚本 `scripts.md`
> 实施细节（代码骨架 / seed 方案 / 任务分配图 / 回滚）：[`详细设计.md`](./详细设计.md)
> 说明：按「可独立验证」切分；每项含改动文件、验收命令。实现目录 = 本仓库。

## 依赖与前置

| 前置 | 状态 |
|---|---|
| dev 机可达（SSH 22 / console 6200 / gateway 6000） | ✅ 已验证 |
| `deploy_servers.dev-default = 175.27.189.123 / ubuntu / /data/web_system` | ✅ 已存在 |
| `RELEASE_HOOK_SECRET` 本机与 dev 机同值 | ✅ 已存在 |
| 本机 `~/.ssh/id_ed25519_servers` 可登录 dev 机 | ✅ 已验证 |
| 代码拉取既有能力：内置 `pull`（`PullExecutor`+`ReleaseGitService`）可作回退；dev 机 `RELEASE_WORKSPACE=/data/web_system` 且为 git clone（master、origin 可达）、默认模板首节点为 `platform/git` | ✅ 已核实（2026-09-11） |
| `git` 脚本化前置（零期 T0a~T0e） | ⬜ 待做（影响所有模板/流水线） |
| 需求决策 D1~D8 已闭合（见 `requirements.md` 决策记录） | ✅ 已定稿（2026-09-11） |
| 配置中心 `REMOTE_*` 两条（env=dev） | ⬜ 待补（T4） |

---

## 零期-A · `git` 节点 DB 脚本化（平台级前置，锁定不可编辑）

> 影响面：**所有模板/流水线（含 `local`）**，不只 dev 发布；存量模板必须零回归（未 seed → 回退内置执行体）。

| 编号 | 任务 | 改动 | 验收 |
|---|---|---|---|
| T0a | 节点命令表加 `locked` 列 | `entities/deploy-pipeline-step-command.entity.ts` + 迁移 SQL（默认 false） | 迁移后表含 `locked`；存量行默认 0 |
| T0b | seed `git` 脚本 | 迁移/seed 写入全局模板（key=`default` 等）`nodeKey='git'` 且 `locked=true`，内容 = `scripts.md` S0（**含 origin 校验 / 分支解析不吞错 / commit 可达 fail-fast / HEAD 自证**） | 两端 `select template_id,node_key,locked from deploy_pipeline_step_commands where node_key='git'` 有值；V14 通过 |
| T0c | 引擎优先执行 DB 脚本 | `pipeline.service.ts`（`executeV5Node`）：git 分支先 `runStageCommand(p,'git')`，无则回退内置 `pull`；脚本后平台回填 `gitCommit`/`versionTag` 并做 `commitId` 一致性断言 | 单测：有脚本走脚本 / 无脚本回退内置 / 不一致抛错 |
| T0d | 接口拒写 + UI 只读 | `pipeline-step-command.service.ts`（`locked` 拒写）、controller（`list` 返回 `locked`）、`PipelineDetail.vue` / `PipelineEdit.vue` 只读展示 + 「平台托管」标签 | 单测：`PUT .../steps/git` → 400；页面可查看脚本文本、无编辑入口 |
| T0e | 零回归验证 | 未 seed 的存量模板跑一次 `local` 发布 | V8 通过（与改造前行为一致） |

**零期-A DoD**：`git` 脚本文本在 DB 可见、页面只读、接口拒改；本机发布走脚本且 `gitCommit`/`versionTag` 回填正确；存量模板行为不变。

---

## 零期-B · ⛔ 恢复 v5 下 `check` 的 base 语义（阻塞项修复）

> **为什么必须先做**：实测（流水线 `1789113846813-crzopdc`）v5 模式下 `check` 是 `optional=true` 的 script 节点且 DB 无命令 → 整段跳过（`reuse_artifact=0`）→ 复用 / 分支缺省 / prod 约束全丢，本设计依赖的「远端 reuse → 跳过拉码·构建·投递」不成立。详见 [`详细设计.md`](./详细设计.md) §2。

| 编号 | 任务 | 改动 | 验收 |
|---|---|---|---|
| T0f | check 恢复 base | `pipeline.service.ts`（`executeV5Node`）：script 分支对 `key==='check'` 先跑内置 `CheckExecutor` 再叠加命令 | 单测：无命令也执行内置；有命令则叠加 |
| T0g | 入参 commit 快照 | `entities/deploy-pipeline.entity.ts` 加 `requestedCommit` + `submit` 写入 | 单测：提交后字段 = 入参；被拉码结果覆盖后仍可断言 |
| T0h | 复用回归 | 同 commit 发第二次 | 日志「复用已有产物…」「已跳过 pull / build / upload」；`reuse_artifact=1`（V15） |

**零期-B DoD**：复用真正生效（`reuse_artifact=1`），且 `check` 的 prod 分支约束、分支缺省 `master` 恢复；既有模板行为无破坏。

---

## 一期 · 目标解析与产物投递（可独立验收）

| 编号 | 任务 | 改动 | 验收 |
|---|---|---|---|
| T1 | 环境→target 解析器 | `pipeline.service.ts`：新增 `resolveTargetForEnv(env, explicit?, templateDefault?)`；`run()` 使用；缺配置 fail-fast | 单测：`local→local`、`dev→remote`、显式覆盖生效 |
| T2 | 目标机改读 DB | `remote-delivery.service.ts`：`resolveTarget(env)` 走 `ServerService.resolveEnvDefaultServer`；`~` 展开绝对路径 | 单测：mock `deploy_servers` 返回 175.27.189.123；无配置时报错 |
| T3 | 远端变量下发 | `pipeline.service.ts`：`resolveStageVars` 增加 `GIT_COMMIT/REMOTE_*` 字段；`StageVarsInput` 扩展 | 单测：变量值正确（含 `REMOTE_ARTIFACT_DIR` 拼装） |
| T4 | 配置补齐 | 配置中心（`web_system_deploy.config_items`，scope=env, env_id=dev）：`REMOTE_CONSOLE_URL`、`REMOTE_GATEWAY_URL` | `curl` 读配置接口返回两条 |
| T4b | 远端模块注册补齐 | dev 机 `deploy_modules.admin`：`dir='admin'`、`public_path='admin'`（决策 D4） | 远端 `resolveStageVars` 不再依赖 `moduleKey` 兜底 |
| T5 | upload 脚本 | DB `deploy_pipeline_step_commands`（本机默认模板 nodeKey=upload）写入 `scripts.md` S1 | 手工跑 S6 步骤 3：`ssh ls` 远端产物存在且含 `index.js` |
| T5b | remote reuse 语义修正 | `steps/step-registry.ts`：remote 模式下 `upload` 不因**本机** `reuseArtifact` 跳过（design P9 / R6）；`pull`/`build` 仍按 reuse 跳过 | 单测：本机已有同 commit 产物时，`env=dev` 的 upload 仍执行；`env=local` 行为不变 |
| T5c | hook 必带 `branch` + `commitId` | `remote-release.client.ts` / 调用处：两者缺失即前置校验报错（缺 `commitId` → 远端误走 pull+build；缺 `branch` → 远端兜底 `master`，记录/分支名不一致） | 单测：缺任一 → 抛错并给出提示 |

**一期 DoD**：`env=dev` 提交后，产物出现在 dev 机 `/data/web_system/.../modules/admin/default/<commit>/`；`env=local` 行为无变化；本机流水线日志含 `git` 节点的拉码输出与 `版本 default/<commit>` 回填。

> 拉码说明：`git`(pull) 由**DB 锁定脚本**执行（`deploy_pipeline_step_commands`，`locked=true`，见 `scripts.md` S0），未 seed 时回退内置 `PullExecutor`；本机与远端各自拉各自的 `RELEASE_DIR`，本机**不** ssh 过去跑 git，也不新增 ssh git 脚本。

---

## 二期 · 版本与指针接口化（DB 操作走接口）

| 编号 | 任务 | 改动 | 验收 |
|---|---|---|---|
| T6 | 远端发布客户端 | 新增 `remote/remote-release.client.ts`：HMAC 签名、时间窗、`deliveryId` 幂等、错误映射、超时（30s） | 单测：签名串正确、401/400 映射、duplicate 视为成功 |
| T7 | pointer 接入 | `steps/pointer.executor.ts`：`uploadTarget==='remote'` → 调 T6；local 原逻辑 | 单测 + 联调：dev 库 `deploy_deployments` 指针更新 |
| T8 | version 接入 | `steps/version.executor.ts`：remote 模式由远端接口承担（本机不写本机库） | 联调：本机库**无** dev 记录新增 |
| T9 | 灰度守卫 | remote + `mode=grayscale` → 明确报错 | 单测：抛 `BadRequestException` |

**二期 DoD**：提交后 dev 库指针 `default/<commit>`，`https://dev.kedouai.com/__manifest__` 在 TTL 后返回新版本。

---

## 三期 · 探活与重启

| 编号 | 任务 | 改动 | 验收 |
|---|---|---|---|
| T10 | verify 命令补 remote 分支 | DB `deploy_pipeline_step_commands`（默认模板 nodeKey=`verify`）写入 `scripts.md` S3 的分派版（原有分支保留 + remote 断言）；**不改** `verify.executor.ts`（R9） | 手工构造旧版本 → 断言失败且流水线 failed；`env=local` 发布仍为「跳过探活」 |
| T11 | 远端模板 verify 保持不变 | dev 机模板 `verify` 命令不新增断言（由本机兜住，避免双口径） | 远端流水线日志仍为「跳过探活」且 succeeded |
| T12 | restart remote（后端预留） | `steps/restart.executor.ts`：remote + backend → ssh pm2 restart；micro-frontend 跳过 | 单测（mock ssh）+ 文档 |

**三期 DoD**：V3/V4/V7 验收通过（manifest 一致、产物 200、失败可感知）。

---

## 四期 · 入口与文档

| 编号 | 任务 | 改动 | 验收 |
|---|---|---|---|
| T13 | 页面提示 | `apps/deploy-console`：`PipelineSubmit.vue` / `PipelineCenter.vue` 展示远端目标机与"由目标环境控制台切指针" | 页面文字可见 |
| T14 | MCP 冒烟 | 确认 `publish_pipeline(env=dev, moduleKey=admin)` 全链路 | `get_job_status` 终态 succeeded |
| T15 | 文档 | `docs/development/local-release-runbook.md` 增章 + `mcp-skills/kedou-deploy/SKILL.md` | 文档评审通过 |

---

## 五期 · 可选增强

| 编号 | 任务 | 说明 |
|---|---|---|
| T16 | 4b 内部接口 | 新增 `POST /api/internal/release/register`（只写库），替代 4a，消除远端 pull 副作用 |
| T17 | cleanup remote | 远端保留最近 N 版（`scripts.md` S5） |
| T18 | 远端 verify 口径统一 | dev 侧 `verify` 命令补 micro-frontend 分支，避免双口径 |

---

## 全量验收清单（对应 requirements.md）

| 编号 | 判据 | 命令 |
|---|---|---|
| V1 | 本机页面 `env=dev,module=admin,branch=<b>` → succeeded | 流水线详情 |
| V2 | 远端产物存在 | `ssh … ls /data/web_system/servers/gateway/public/static/modules/admin/default/` |
| V3 | 远端指针已切 | `select current_version from deploy_deployments where env_id='dev' and module_key='admin'` |
| V4 | manifest 断言一致 | `curl https://dev.kedouai.com/__manifest__` |
| V5 | 产物 200 | `curl -o /dev/null -w '%{http_code}' …/index.js` |
| V6 | Agent 等价 | MCP `publish_pipeline` + `get_job_status` |
| V7 | 失败可感知 | 构造错误版本 → verify 报错、流水线 failed |
| V8 | local 零回归 | `env=local` 发布 admin 与改造前行为一致 |
| V9 | 拉码走 DB 脚本 | 本机流水线日志出现 `[git] fetch → checkout …` / `[git] HEAD=…`；远端因 reuse 未执行（日志「已跳过 pull / build / upload（复用已有产物）」） |
| V10 | reuse 不跳过远端投递 | 本机预置同 commit 产物 → `env=dev` 仍投递到 dev 机（远端目录时间戳/内容更新） |
| V11 | git 脚本已锁定 | `select node_key,locked from deploy_pipeline_step_commands where node_key='git'` → `locked=1`；`PUT /api/pipeline-templates/<id>/steps/git` → 400 |
| V12 | 回填与一致性 | `versionTag=default/<commit>` 且等于入参 `commitId`；人为改脚本指向错误 commit → 流水线 fail-fast |
| V13 | 分支口径可确认 | 流水线详情含 `gitBranch` + `gitCommit`；远端 `deploy_versions` 同值；日志出现「代码已就绪: `<branch>@<commit>`」 |
| V14 | 脚本级 fail-fast | 传「未 push 的 `commitId`」→ `git` 阶段失败并提示「commit 不可达」；传不存在的分支 → 失败并提示分支名；两者均**不得**退化为用分支最新代码继续构建 |
| V15 | 复用真正生效（零期-B） | 同一 commit 发第二次 → 日志「复用已有产物: admin/default/<commit>」「已跳过 pull / build / upload」；`select reuse_artifact from deploy_pipelines …` = 1 |

---

## 变更日志

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-11 | v0.1 | 初稿：五期任务拆解 + 全量验收清单 |
| 2026-09-11 | v0.2 | 前置补「远端拉码可复用」已核实项；一期补 T5b（reuse 不跳过 upload）/T5c（必带 commitId）与 DoD 拉码说明；验收补 V9/V10 |
| 2026-09-11 | v0.3 | 新增「零期 · `git` 节点 DB 脚本化」（T0a~T0e：locked 列、seed、引擎优先脚本、接口拒写/UI 只读、零回归）；一期 DoD 与前置随之改写；验收补 V11/V12 |
| 2026-09-11 | v0.4 | 三期 T10/T11 按决策 D3 改写（断言落 DB verify 命令、远端模板不动）；一期补 T4b（远端模块注册，D4）；前置记「D1~D8 已闭合」 |
| 2026-09-11 | v0.5 | D1 拍板 4a、新增 D9（分支口径）；T5c 扩为「必带 `branch` + `commitId`」；验收补 V13（分支口径可确认） |
| 2026-09-11 | v0.6 | 新增 D10（脚本 + 平台双保险）；T0b 明确脚本含四处加固；验收补 V14（脚本级 fail-fast） |
| 2026-09-11 | v0.7 | 零期拆为 A/B；新增「零期-B ⛔ 恢复 v5 下 check 的 base 语义」（T0f~T0h，阻塞项）；验收补 V15（复用生效）；顶部挂 `详细设计.md` |
| 2026-09-11 | v0.8 | **零期 A/B 代码落地**：T0a~T0d/T0f/T0g 完成（308 单测 + nest build + vue-tsc 全绿）；T0e/T0h 的真机验证待发布 console（见 `详细设计.md` §9） |
