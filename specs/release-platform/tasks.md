# 发布平台 · 实施计划

> 类型：tasks.md（Plan 阶段产物）
> 日期：2026-09-02
> 关联：需求 `requirements.md` · 方案 `design.md`
> 执行：`rd-execute`（TDD 红→绿→重构）→ `verification-before-completion` → `rd-review`
> 约定：每个任务 = 一个可独立验证的功能模块；验收 EARS；标注依赖；**本文件是进度真相源**（勾选状态跨会话可续）。

## S0 · 已完成并收编（原批 1）

- [x] 0.1 ① 本地服务监控（`execLocal` + 3 个非 SSH 路由 + 前端「本地」tab）
- [x] 0.2 ② 模块管理按类型 tab 化 + 计数
- [x] 0.3 评审 MUST 收尾：命令注入 DTO / CORS 白名单 / 全局异常过滤器 / 清理 `any`

## S1 · P0 命令驱动流水线（L3）

> 目标：消除构建硬编码，统一阶段命令为唯一真相源。

- [x] 1. 数据模型 `deploy_module_stage_commands` + 建表
  - 依赖：无
  - _验收：当 应用启动后，应存在 deploy_module_stage_commands 表且 (module_key, stage) 唯一_
  - 落地：`src/entities/deploy-module-stage-command.entity.ts`（synchronize 自动建表）
- [x] 2. 迁移脚本：`buildCmd` + `deploy_module_hooks` → `stage_commands`（冲突列清单）
  - 依赖：1
  - _验收：当 执行迁移后，每个已配置阶段应在 stage_commands 中有且仅有一条命令；当 buildCmd 与 build hook 冲突时，应输出冲突清单而非静默覆盖_
  - 落地：`scripts/migrate-stage-commands.ts`（默认 dry-run，`--apply` 才写库）；**待建表后执行 dry-run 验证**
- [x] 3. 执行器 `runStageCommand` + 阶段统一（含 build 接入）+ 删除 `buildBackend`/`buildFrontend` 硬编码
  - 依赖：2
  - _验收：当 模块配置了阶段命令时，pipeline 应执行该命令；当 命令退出码非 0 时，应中断发布_
  - 落地：`pipeline.service.ts` 新增 `runStageCommand`/`runShell`，删除 `runHook`/`runScriptFile`/`stageBuild`；`pipeline.module.ts` 以 `StageCommandModule` 取代 `HookModule`
- [x] 4. fail-fast + 超时控制
  - 依赖：3
  - _验收：当 模块未配置某可配置阶段命令时，应在该阶段失败并明确报错，不执行任何内置技术栈命令；当 超过 timeoutSec 时，应超时中断_
  - 落地：编排中 build 未配置命令即抛错终止；`runShell` 按 `timeoutSec`（缺省 `BUILD_TIMEOUT_MS`）超时中断
- [x] 5. 默认命令模板（按 type 一键填充）
  - 依赖：1
  - _验收：当 按 backend 填充模板时，应生成可用构建命令；当 按 frontend/micro-frontend 填充时，应生成 vite build_
  - 落地：迁移脚本 `DEFAULT_BUILD_CMD`（backend→`npx tsc -p tsconfig.json`；frontend→`npx vite build`；micro-frontend→`npx vite build --mode mf`；mini-app→`npx vite build`）
- [x] 5b. 阶段命令服务单元测试（防回归）
  - 依赖：1
  - _验收：当 resolve 遇到未配置/空白/未启用时应返回 null；当 upsert 传入 version/pointer 或空命令时应抛 BadRequestException_
- [x] 6. 模块详情「阶段命令」页面配置（`bash -n` 校验，仅 JWT 可写）
  - 依赖：3
  - _验收：当 保存非法 shell 时应拒绝并提示；当 保存合法命令时应落库且审计留痕_
  - 落地：后端 `stage-command.controller.ts`（GET/PUT/DELETE/validate/templates，仅 JWT 不暴露 MCP）；前端 `api/index.ts` 新增 `stageCommandApi`，`ModuleDetail.vue` 的「发布脚本」tab 替换为「阶段命令」tab（build 标红「必填」）
- [x] 7. 废弃 `buildCmd` 字段与 `deploy_module_hooks` 表 + 对齐 `deploy-pipeline-dev.md:101` / `release-system-design.md`
  - 依赖：3、迁移验证通过
  - _验收：当 查阅两份文档时，其关于阶段命令的陈述应与 design.md 一致_
  - 落地：`deploy.service.ts`（旧 `deploy.sh` 路径）改读 `stage_commands`；`buildCmd` 标 `@deprecated`；两份文档矛盾表述已对齐
  - ⚠️ **物理删列/删表待执行**：本轮只做逻辑废弃以保证可回滚；建议观察一个发布周期后再删 `deploy_modules.build_cmd` 列与 `deploy_module_hooks` 表
- [x] 8. `pipeline.service.ts` 纳入独立子代理评审
  - 依赖：3
  - _验收：当 S1 代码完成后，design.md 应存在独立评审结论记录_
  - 结论见 `design.md`「独立子代理评审结论（2026-09-02 终版，任务 8）」
  - 修复 3 项 MUST：**发布锁原子互斥**（CAS 替代 find+upsert，防同模块×环境并发双跑）、
    **取消立即 SIGKILL + 取消终态优先**（防"已取消仍跑完并上报成功"）、**git 命令注入面**（branch/commit 白名单）
  - 顺手修复：runShell 日志 300ms 节流落库
  - 补测试：release-lock acquire 互斥与并发落败用例（全量 113/113 通过）

## S2 · P0 配置中心（L2）

- [x] 9. `config_items` + `config_snapshots` 数据模型
  - 依赖：无
  - _验收：当 保存配置时，应生成快照并与版本关联_
  - 落地：`entities/config-item.entity.ts`、`entities/config-snapshot.entity.ts`
  - 注意：`envId`/`moduleKey` 用**空串而非 NULL** 表示"不适用"——MySQL 唯一索引中 NULL 互不相等，用 NULL 会让全局配置被重复插入
- [x] 10. 密钥 AES 加密 + 页面掩码（不可读明文）
  - 依赖：9
  - _验收：当 保存密钥后读取，应返回掩码且 DB 中无明文_
  - 落地：`config/config-crypto.ts`（AES-256-GCM，格式 `iv:tag:ciphertext`；主密钥 `CONFIG_MASTER_KEY` 服务侧持有，已写入发布环境 .env）
  - 密文被篡改会因 GCM 认证失败而报错，可据此发现数据被非法改动
- [x] 11. 三级作用域合并 + 发布/重启时强制覆盖注入 pm2 env（禁 shell 写死 PORT）
  - 依赖：9
  - _验收：当 注入执行时，应按 模块级>环境级>全局默认 覆盖；当 shell 中已存在 PORT 时，应被配置中心值强制覆盖_
  - 落地：`ConfigService.resolve()`；`pipeline.service.ts` 新增 `resolveInjectEnv()`，在**阶段命令**与 **`pm2 restart --update-env`** 两处注入；`exec()` 扩展 `extraEnv` 参数
- [x] 12. 配置中心页面 + 校验
  - 依赖：9、10
  - _验收：当 保存非法配置时应拒绝并提示_
  - 落地：后端 `config.controller.ts`；前端 `views/ConfigCenter.vue` + 路由 `/config` + 侧边菜单
  - 已覆盖校验：作用域合法性、配置键非空、环境级缺 envId、模块级缺 moduleKey、**禁止把掩码当密钥真实值写回**
  - ⚠️ **端口冲突检测尚未实现**（验收标准里有，本次未做，列为后续增强）
- [x] 13. 配置变更审计（前后 diff，密钥不记明文）
  - 依赖：9
  - _验收：当 配置变更时，应可查询到变更人/时间/前后值_
  - 落地：controller 记录 `config.create` / `config.update` / `config.delete` 三类审计；密钥值统一记为 `<密钥·不记录>`，明文不入审计
  - 坑：`ConfigController` 注入 `AuditService` 后必须在 `ConfigCenterModule` 里 `imports: [AuditModule]`，否则 Nest 依赖解析失败导致**服务崩溃循环**

## S3 · P0 可靠性（L4/L5）

- [x] 14. 真实端口/HTTP 健康探活（替换仅查 pm2 status）
  - 依赖：S1
  - _验收：当 verify 执行时，应做 HTTP 探活并写入发布记录与审计_
  - 原有实现已做端口探活（pm2 online → 取 `pm2_env.PORT` → HTTP 探测），但**探活失败只告警不阻断**
  - 本次补齐：端口无响应时**直接抛错终止发布**，交由 verify 失败逻辑自动回滚——
    避免"进程在、端口没起"的假健康被当成发布成功
- [x] 15. 回滚真正重建后端进程
  - 依赖：无
  - _验收：当 回滚执行后，目标 pm2 进程应实际运行旧版本代码（探活确认）_
  - 现状：回滚走 `scripts/rollback.sh`（远端 `git reset --hard` + 重启），**重建动作由脚本负责**
  - 本次补齐：`DeployService.waitTask()` 等回滚到终态 + `probeBackendHealth()` 回滚后探活确认，
    使"自动回滚"从"发起动作"变成"确认结果"，失败不再静默
  - ⚠️ **边界**：探活只确认服务健康（端口有响应），**不校验实际运行的代码版本**；
    版本级确认需服务暴露版本端点，列为后续增强
- [x] 16. verify 失败自动回滚
  - 依赖：14、15
  - _验收：在 verify 失败时，应自动回滚到上一稳定版本并留痕_
  - 原已实现（`p.stage === 'verify'` 时调 `startRollback`）；本次补齐等结果与探活确认，
    审计 `pipeline.auto-rollback` 记录 outcome 与探活结论
- [x] 17. 并发锁/幂等（moduleKey+env）
  - 依赖：无
  - _验收：当 并发发布同一模块同一环境时，应串行化或拒绝，不覆盖指针_
  - 落地：`deploy_release_locks` 表 + `ReleaseLockService`（`canAcquire` 为纯函数便于单测）；
    `run()` 入口获取锁（失败则标记 `rejected` 并审计），`finally` 释放
  - 设计要点：锁带 TTL 防持有者被强杀后死锁；支持重入（同一流水线重跑不锁死自己）与过期抢占；
    查锁异常时按无锁处理，**不阻断发布**（并发保护失效好过发不出去了）

## S4 · P1 治理与可观测（L5/L6）

- [x] 18. 审批门禁（prod）— _验收：当 未审批的 prod 发布提交时，应被阻断并留记录_
  - `deploy_approvals` 审批单 + `ApprovalService`：需要审批的环境读系统设置 `REQUIRE_APPROVAL_ENVS`
    （「系统设置 → 审批门禁」页可配，逗号分隔；未配置默认仅 prod）
  - 门禁点：`PipelineService.submit` —— 提交到需审批环境的发布**不立即执行**，进入 `pending-approval` 状态、
    留审批单（提交人/审批人/意见/时间）并通知；approve 通过后自动触发执行（执行人记审批人）；
    reject 则取消并留意见；撤回（cancel）联动关闭审批单，避免孤儿单
  - 接口：`POST /api/pipelines/:id/approve` / `:id/reject`、`GET|PUT /api/system-settings/approval-envs`
  - 前端：发布流水线页新增「待审批」状态标签与 通过/拒绝/撤回 操作（拒绝必填意见）；
    prod 提交按钮文案改为「提交审批」；通知中心新增 pending-approval/approved/rejected 事件标签
  - ⚠️ 当前单账号（admin）环境，审批人可与提交人相同；多用户账号体系落地后应加「禁止自审」规则
    （审批单已存 operator/reviewer，可直接判定）
- [x] 19. 通知中心 — _验收：当 发布/失败/审批/回滚事件发生时，应送达已配置通道_
  - `NotificationService`：写 `notification_logs`（站内历史）+ 异步分发
  - 通道（服务端环境变量配置，可选）：`NOTIFY_WEBHOOK_URL`（通用 Webhook，结构化 JSON）、`NOTIFY_WECOM_URL`（企业微信 markdown）
  - 事件接入点：`pipeline.succeeded` / `pipeline.failed` / `pipeline.auto-rollback`（pipeline.service 3 处）
  - **铁律：通知尽力而为**——任何失败（无通道/超时/推送失败）都不抛错、不阻塞发布；送达结果写回 `delivery` 供运维发现"推不出去"
  - API：`GET /api/notifications`（历史）、`GET /api/notifications/channels`（通道状态）
  - 前端：新增「通知中心」页（站内历史 + 送达状态 + 事件筛选）与「系统设置」页（通知渠道配置）
  - **系统设置模块**（`system_settings` 通用键值表 + `SystemSettingsModule`）：通知渠道从"仅 env 硬编码"改为 **DB 可配置、env 兜底**——
    未在页面配置过的通道自动回退到环境变量，升级迁移期间通知不丢；后续审批开关等系统级配置也收进本模块
  - ⚠️ 独立「消息通知服务」**暂不建设**：当前仅发布平台一个生产者，内嵌实现足够；
    启动信号（第二个服务要发通知 / 用户级订阅已读 / 需要消息队列）出现时再拆
- [x] 20. 审计增强（全量 diff）— _验收：当 任意变更发生，应可追溯人/时间/前后 diff_
  - `audit_logs` 新增 `changes` JSON 列（字段级 `[{field,before,after}]`）+ `AuditService.diffObject` 纯函数
  - 接入点：配置中心保存/删除（原本 detail 已含 before/after，现结构化）、审批通过/拒绝（approval.status/comment）、
    通知渠道与审批门禁配置（系统设置写操作首次带审计）、阶段命令保存/删除与发布脚本 Hook 保存/删除
    （**这两个此前完全没有审计，本次补齐**，脚本前后全文可查）
  - 前端：审计页新增「变更」列（N 处变更）→ diff 抽屉：红底=变更前 / 绿底=变更后，长脚本自动折叠滚动
  - 说明：发布/回滚/流水线等动作类已有 detail 审计（人/时间/动作/结果），不强制结构化 diff
- [x] 21. 发布度量仪表盘 — _验收：当 查看度量页，应按环境/模块/时间筛选展示成功率与时长_
  - 数据源即 `deploy_pipelines`（流水线本就记录 status/stage/起止时间），**零埋点、零采集改造**
  - 后端 `metrics` 模块：`overview`（成功率/平均/P95 时长）、`trend`、`stage-failures`、`top-modules`、**`failures` 下钻**
  - 前端：ECharts（按需引入 + `manualChunks` 单独分包：Dashboard 602KB→8.4KB，echarts 独立缓存）；Dashboard 新增发布度量区块：
    成功率卡片（**无终态记录显示"—"而非 0%**）、按天堆叠柱状趋势、失败阶段横向条形（**点击下钻**查看具体失败记录与错误信息）
  - 防 SQL 注入：过滤条件全部参数化；`limit` 限上限
  - 基线数据：保留（含 48 次 build 历史失败，可用于对比修复前后的成功率变化）

## S5 · P1 灰度与接入（L7/L8）

- [x] 22. 灰度增强（规则/放量/全量）— _验收：当 灰度放量时，命中流量应加载 canary 版本_
  - 命中链路（既有）：gateway 按规则加载 canary 版本；percent 用 userId+ruleId FNV-1a 稳定哈希
  - 新增「灰度管理」页：规则列表（环境/模块/灰度版本/规则类型/状态）、**百分比放量滑块调整**、
    **命中预览（输入 userId 判断）**、启用/停用、删除
  - `canary.update` 审计补 matchRule/canaryVersion/enabled 前后 diff（复用审计 diff 能力）
  - 灰度规则由「发布流水线 → 灰度发布」自动创建；转全量走「流水线 → 转全量」
- [x] 23. 自助诊断工具 — _验收：当 执行端口检测/进程重启/日志检索时，应在页面完成无需 SSH_
  - monitor 新增运维操作端点（本机 + 远程 env 各一组）：
    `POST pm2/restart`（重启留审计）、`GET port`（lsof LISTEN 占用检测）、`GET logs?keyword=`（**关键词在结果侧过滤，不进命令**，service 名白名单）
  - 新增「自助诊断」页：诊断目标（本机 / dev / prod）+ 服务下拉，
    **端口占用检测 / 进程信息+一键重启 / 日志关键词检索**三卡片，全程页面操作、无需 SSH
  - 覆盖历史遗留：6200 端口冲突的排查已可在页面完成（此前需命令行 lsof）
  - 重启均写审计（action=monitor.restart）

## S6 · 流水线模板 + 实例（L3b）

- [x] 24. 模板数据模型 + 模块懒建 builtin 默认模板
  - 依赖：无
  - _验收：当 模块无模板且首次提交/打开模板页时，应存在不可删除的默认模板；实例表新列可空兼容历史_
- [x] 25. 后端模板 CRUD API（`/modules/:key/pipeline-templates`，仅 JWT，写操作审计 diff）
  - 依赖：24
  - _验收：当 新建模板名称冲突时 409；builtin 不可删；复制默认可生成同名自定义模板_
- [x] 26. submit 按 templateId 解析：实例落模板快照 + 审批策略判定（always/never 覆盖 env 规则）
  - 依赖：24
  - _验收：当 提交指定 always 审批模板到 dev 时，应进入待审批；指定 never 模板到 prod 时应直接执行_
- [x] 27. run 按快照跳过 verify（含「verify 失败自动回滚」同步跳过）
  - 依赖：26
  - _验收：当 skipVerify 模板的实例执行时，应无 verify 阶段且无自动回滚逻辑_
- [x] 28. 前端：ModuleDetail「流水线模板」tab + PipelineCenter 模板选择与展示
  - 依赖：25、26
  - _验收：当 页面操作时，应能新建/编辑/启停模板并随提交生效，记录/详情可见模板名_
- [x] 29. 回归：MCP/旧调用不传模板走默认、历史实例展示「默认」、metrics/审批/通知不回归
  - 依赖：26、27、28
  - _验收：当 不传 templateId 提交时，行为与 S5 完全一致；全量测试与既有发布流程通过_

### S6-II · 步骤编排化 + 工具目录（v2，依赖 S6-I）

- [x] 30. 步骤执行器注册表：内置步骤 SPI + `stageXxx` 逐一迁移（check/pull/upload/restart/verify/cleanup）
  - 依赖：S6-I 完成
  - _验收：当 同一流水线按新内核跑通时，失败/通知/进度语义与 S5 完全一致；每迁移一个执行器跑一次既有发布回归_
- [x] 31. version/pointer 语义步骤 + run 数据驱动（模板 steps 序列执行，含下限白名单校验）
  - 依赖：30
  - _验收：当 模板序列不含/前置 version/pointer 时 400 拒绝；默认模板序列执行结果与 S5 一致_
- [x] 32. rollback 内置步骤 + 模板级 `rollbackOnFailure`（替代硬编码 verify 失败自动回滚）
  - 依赖：30、31
  - _验收：当 模板 rollbackOnFailure=previous 时，verify 失败自动回滚行为与 S5 一致；=none 时不回滚；显式 rollback 步骤可用于紧急回滚线_
- [x] 33. 工具目录 tool_catalog：种子数据 + CRUD（仅 JWT，审计）+「工具管理」页（分类/说明/示例）
  - 依赖：无（可与 30-32 并行）
  - 范围：统一目录同时收录 **service 工具（内置执行器：探活/回滚/写版本/切指针/重启/投递等）** 与 **shell 工具（git/pm2/curl…）**，`kind` 区分；探活等平台逻辑从 `pipeline.service.ts` 收敛进对应 service 工具实现
  - _验收：当 打开工具管理页，应看到按分类分组、标注 kind 的工具（内置服务工具不可删、可停用；shell 工具可增改/停用）；审计留痕_
- [x] 34. 模板步骤编排编辑器（选步骤/排序/换执行器/rollbackOnFailure）+ 步骤分类分组展示
  - 依赖：31、32、33
  - _验收：当 编辑模板时，应能从步骤库按分类选取并排序生成序列；保存后随提交生效_
- [x] 35. 回归：S1-S5 全部发布场景（dev/prod/灰度/回滚/审批/度量）+ 全量测试通过
  - 依赖：34
  - _验收：当 跑既有场景时无行为回退；测试全绿_

## S7 · 执行体工具化收口（V6 落地，2026-09-02）

> V6「平台逻辑应收敛为工具」执行体下沉完成，详细映射见 `design.md`「工具化落地状态」。

- [x] 7.1 平台执行体全部下沉为可注入 service 工具 + 路径收口
  - 依赖：35
  - 范围：新增 `probe`（HTTP）/`pm2`（进程探活）/`shell`（命令执行）/`git`（发布目录拉取）/`artifact`（产物存储）/`registry`（版本+指针）/`remote`（远程投递）模块与 `release-paths` 纯函数；`pipeline.service.ts` 删除内联 exec/http/git/产物 fs/远程投递逻辑（净删约 390 行）
  - _验收：当 检查 pipeline.service.ts 时，应不再包含手写 HTTP / pm2 / git / 产物 fs / 远程投递执行体；公共 API（submit/get/list/cancel/retry/approve/reject/listReleaseCandidates/switchPointer/promote）签名与 controller/MCP 调用不变_
- [x] 7.2 verify 后端探活抛错被查询失败 catch 吞掉的 bug 修复
  - 依赖：7.1
  - _验收：当 端口不可达时，verifyBackend 应立即抛错（不再 12 轮耗尽后仍判成功），触发 verify 失败自动回滚_
- [x] 7.3 回归：全量 jest 186/186 + `nest build` + lint 通过

## S8 · 步骤执行器化 + 数据驱动分派（V1/方案 B 落地，2026-09-02）

> executeStage 由 switch 硬编码改为配置驱动：步骤行为/守卫/命令覆盖语义收敛为注册表元数据，
> 执行体外迁独立 executor。详见 `design.md`「内置步骤执行器化」。

- [x] 8.1 内置步骤注册表 `step-registry.ts`（category/commandMode/skip/run 九步声明）+ `executeStage` 数据驱动
  - 依赖：7.3
  - _验收：当 检查 executeStage 时，应无 switch case 与任何步骤实现细节；分派只按注册表元数据（守卫跳过 → commandMode 命令覆盖优先级 → 执行体）_
- [x] 8.2 九步骤执行体外迁独立 executor（`steps/*.executor.ts`），各自注入工具，经 `StepContext` 与 engine 通信
  - 依赖：8.1
  - _验收：当 增加/修改步骤行为时，只改对应 executor 与注册表元数据，engine 无感知；build 步骤无内置执行体（required 命令驱动）_
- [x] 8.3 回归：全量 jest 197/197（新增 step-registry/check.executor 11 用例）+ `nest build` + lint 通过

## 发布记录

- **2026-09-02 首次上线**（分支 `feature/contract-risk-ai`）
  - 提交：`c447795`（命令驱动流水线）→ `d9703bf`（tsconfig 只编译 src）→ `3974e70`（迁移脚本原生 SQL + SnakeNamingStrategy）
  - 发布目录 `~/web_system_release`：`git pull` → `nest build` → `pm2 start web-deploy-console`
  - 结果：服务 online、监听 6200、`synchronize` 无报错；阶段命令 6 个路由全部 Mapped
  - 数据：`deploy_module_stage_commands` 20 条（11 条迁移 + 9 条默认模板）

### 上线踩坑（务必记住）

1. **新增 `scripts/` 导致构建产物错位**：tsconfig 无 `include` 时，运维脚本被纳入编译，
   tsc rootDir 退化为项目根，产物由 `dist/main.js` 变为 `dist/src/main.js`，pm2 启动报 `MODULE_NOT_FOUND`。
   → 已修：`include: ["src/**/*"]` + `exclude` 加 `scripts`。**今后新增非服务代码目录必须同步检查 tsconfig**。
2. **独立脚本的 DataSource 必须对齐 `SnakeNamingStrategy`**：否则建表列是驼峰（`moduleKey`），
   与服务端 synchronize 期望的下划线列（`module_key`）互相 ALTER，服务连不上库。
   → 复用 `app.module` 的 namingStrategy，勿在脚本里另起一套配置。
3. **typeorm `repo.upsert` 传 `conflictPaths` 会漏写列**：曾导致 20 行 `module_key` 全为空串，
   唯一索引建不起来。→ 批量迁移改用原生 `INSERT ... ON DUPLICATE KEY UPDATE`。
4. **`pm2 restart` 退不干净旧进程 → 双实例抢端口（`EADDRINUSE: 6200`）**：
   直接 restart 会出现两个 `dist/main.js` 并存、restart 计数飙升（本次已达 65）。
   → 正确姿势：`pm2 stop` → `pkill -f "deploy-console/dist/main.js"` → 确认 `lsof -i :6200` 空闲 → `pm2 start`。
   这正是本项目历史上「改代码 → 重建控制台 → 6200 端口冲突」反复踩坑的直接原因，
   也正因如此，把构建命令数据化（不必为改一条命令而重建重启）才格外重要。

## 执行约定（方法论）

- **TDD**：每个任务 RED（写失败测试）→ GREEN（最少代码通过）→ REFACTOR，逐项勾选本文件。
- **防回归**：每个缺陷修复补一个「修复前会失败」的测试；校验对外可见行为，不校验实现细节。
- **证据**：宣称通过必须附实际运行结果（lint / 测试 / 接口返回）。
- **收尾**：每阶段完成走 `verification-before-completion` + `rd-review`；**不主动 commit**。
- **阶段门**：S1 完成并评审后启动 S2；S1/S2/S3 为 P0，必须先闭环。
- **上下文对抗**：每轮开工先重读本文件与 `design.md`，不依赖对话记忆。
