# Console S1c：真实构建失败与依赖准备修复（2026-10-18）

> 后续更新：本文保留早期构建失败与凭据恢复的过程。依赖准备等后续修复已在 dev 部署并完成 admin 新建版本回归，最新 90 suites / 1077 tests；当前状态与未完成出口以 [P0 执行记录](2026-10-18-console-p0-execution.md) 为准，不能把下文历史“尚未部署”当作当前状态。

> 北京时间。状态：新建 dev 流水线已真实运行，发现并本地修复一项编排缺陷；新补丁尚未部署/真实复测，Console 整体验收不通过。未操作 prod、未改现网配置/模板/凭据、未重启进程、未执行 DDL。
> 后续凭据变更单独记账：用户明确授权重新生成原自动化 Key 并更新数据库；现已完成轮换，见 §6。上述“未改凭据”限定于前述构建验收批次，不包含授权轮换。
> 关联：[三主线计划](2026-10-16-three-track-delivery-plan.md)、[前批 dev 修复](2026-10-17-console-boundaries-closeout.md)、[验收矩阵](2026-10-16-console-acceptance-baseline.md)。

## 1. 本次真实执行

- dev Console /health=200；构建 checkout 与 node_modules 均在独立构建根，工作树与 git clean 预览干净；无活动 run/task/锁。构建前可用内存约 1.3 GiB，空闲 swap 约 8 GiB，仅运行一条构建。
- 核对 admin/dev 托管脚本、环境条件、目标机与静态根，确认发布确认节点位于构建后、投递前；保留旧 prod 审批，不使用整站回滚。
- 对候选 c38423cc 做 release_plan；产物不存在为 blocker，因此本次仅启动有独立审批门的构建，不以该提案授权直接激活。后续必须重新 plan 并核验构建产物。
- 新建 run：`1792324675171-h10xwrf`，env=dev、module=admin、branch=master，显式 commit=`c38423cc94021c4c15b583d53a811c5cd2de6a59`。真实完成 fetch/checkout/reset/clean，实际身份为 `admin-dev/c38423cc`，commit 校验通过。
- build 中 UI 预构建动作完成，但 vite 报 `Failed to resolve entry for package "@web-system/types"`。任务失败，审批、投递、写版本与激活均未执行。次生 version.json ENOENT 是打包失败后输出目录尚不存在，不是主因。
- 同一 admin/dev 在 run 正运行期间再次提交，真实 API 返回 409，未增加第二条 run。此次新增审计 run 仅一条，保留失败记录，不删库美化结果。
- 原始 run.stage 仍显示 git，不能用该字段断定失败发生在拉码；本次依具体 action 日志与 error 判定实际失败在 build。阶段展示/度量偏差单列待核，不混入此次依赖修复。

## 2. 根因与本地修复

旧 v5 脚本路径会调用 builtin pull.afterRun，完成依赖同步和 shared/types 共享包预构建。新「步骤→任务→动作」编排的 git afterTask 只回填/验证 commit，没有调用该钩子。已有缓存目录会掩盖遗漏，刚启用的干净构建 checkout 将其暴露。

本地修改 `PipelineService.runOrchestrationMode`：传入实际 uploadTarget；git 任务成功后先校验请求 commit，再 await 既有 pull.afterRun，然后才运行后续 build 步骤。复用既有能力，不通过手工 SSH 构建、写假依赖指纹或临时补 dist 绕过真实流水线。

沿用既有 PullExecutor 对依赖安装/共享构建失败的日志及兼容语义，本轮不宣称其安装必成功。构建根当前没有 .deploy-lock-hash，后续重跑前须复核实际包管理器/锁文件与安装资源限制；不能因补回钩子而跳过这一步。

## 3. 验证结果

| 项目 | 结果及范围 |
|---|---|
| 回归红灯 | 6 项新测试中 2 项在修复前失败，复现漏准备/未等待行为 |
| 定向绿灯 | 新编排、pull executor、registry、审批共 4 suites / 30 tests 通过 |
| 全量本地 | 90 suites / 1072 tests 通过，Console nest build 通过；仅本地，不等同 dev 新补丁生效 |
| 用例覆盖 | 等待准备且顺序正确、收尾抛错不构建/激活、git 动作失败不准备、commit 不匹配不准备、审批恢复不重复、无 git 任务不误触发 |
| 运行保护 | Console 当前 dist、旧 dist、用户目录持久备份的递归文件摘要前后均一致 |
| 业务状态 | 所有环境/模块版本指针、部署状态、审批均未变；PM2 PID/状态/重启计数不变；无活动 run/task/锁残留 |
| HTTP 实证 | admin/dev 仍为 e2a2866c，指针及 index.js/index.css/主 chunk 共 4/4 为 200，字节与磁盘一致 |
| 匿名权限 | health 200；无凭据访问配置和本次 MCP 流水线均 401 |
| 浏览器 | dev /console/ 跳转 /console/login，登录表单可见；当前标签页未捕获 error/warn；未输入凭据，未验证登录后流程 |

## 4. 源码与证据身份

- 源码仍在独立工作树 `<workspace>/.worktrees/console-acceptance-fixes-20261016`，未提交/合入；前批 dev 补丁仍运行，新补丁未部署。
- 本次新增 `servers/deploy-console/src/pipeline/orchestration-git-preparation.spec.ts`，修改同目录 pipeline.service.ts 及接口契约。全工作树累计 21 个源码/测试/契约文件的清单 SHA-256：`eb1997111b6975fbe79b13914f56b946cd63b9735f2d6ef4197d91e751a2e9d6`。前批报告的摘要保留为其部署时点证据。
- 本机私有证据：`/tmp/web-system-console-s1c-20261018/`（0700）；含 preflight-before/after、candidate-db-status、failure-safety-summary、http-after-failure-summary、匿名检查、红绿测试、全量测试、构建日志及 source-manifest。未提交原始 DB 内容或凭据。
- 并发提交响应及初始状态另在前批私有目录的 `s1c-20261018-*-private.json`。不要把临时目录当作永久归档，公开报告只保留脱敏结论。

## 5. 凭据阻塞历史与继续顺序

构建启动时成功从 `~/env_config/web_system/dev.env` 读取合法 MCP_OPS_KEY_DEV；执行期间观测该目录/文件变为不存在。`~/env_config/servers.env` 仍可用于只读 SSH/DB 核对，但不能代替 API 操作身份。未恢复已移走文件、创建替代 Key、自签 JWT 或直接改库伪装审批。

1. 凭据阻塞已按 §6 解除；继续使用恢复后的 dev.env，不在聊天中粘贴 Key。
2. 先核对新增准备钩子所需包管理器、锁文件、依赖状态和资源上限，再按原 dev 候选部署流程交付新 Console 补丁，保留当前回退点；不整包部署有 schema 差异的 gateway。
3. 新建 dev run，构建到审批点后检查产物入口/分包路径、再 plan，确认后完成投递→激活→独立 HTTP/浏览器验证，必要时恢复测试前版本。旧 prod 审批保持不动。
4. 再补 shell、后端、取消/重复请求/故障矩阵、阶段展示偏差及生产适用性检查。未完成前不宣布 Console 验收收口。

## 6. 用户授权的自动化凭据轮换（2026-10-18）

用户确认找不到旧配置，明确授权重新生成并更新对应数据。执行前原 dev.env 刚恢复，因此先用恢复文件中的旧值精确定位原记录，再按授权轮换，不另建无归属 Key。

- 仅更新 dev user-service 的 mcp_api_keys 记录 ID=6、name=ai-ops-automation：替换 SHA-256 key_hash、脱敏 key_prefix 和 updated_at。保留 ID、owner_id=1、状态、有效期、名称和其余元数据；其他 Key 记录不变。
- 使用与服务签发逻辑一致的 kedou_ 前缀和 24 字节密码学安全随机值；数据库不存明文。未自签 JWT、扩大权限、修改 prod 或重启服务。
- 仅替换 `~/env_config/web_system/dev.env` 的 MCP_OPS_KEY_DEV，保留其他配置值。文件权限 0600、目录 0700；本地原文件和候选保存在同目录 `.backups/mcp-ops-rotation-20261018-*` 私有子目录，旧文件中的 Key 已失效，不能直接恢复使用。
- 数据库旧记录备份位于 dev 用户目录的 `web_system_backups/mcp-ops-rotation-20261018-*`；轮换校验摘要在本机 `/tmp/web-system-mcp-rotation-20261018/verification-summary.json` 及本地持久备份内。备份和凭据均不提交 Git。
- 实证：内部验证新 Key 有效且仍归属同一记录/用户，旧 Key 无效；Console 读取原有归属流水线新 Key 为 200、旧 Key 为 401；MCP 网关初始化新 Key 为 200、旧 Key 为 401，临时校验会话已删除；进程 PID/状态/重启计数不变。
- 原 S1c API 执行器已直接读取更新后的本地配置并取得 200。客户端如果仍硬编码旧 ai-ops-automation Key，需从恢复后的安全配置同步新值；本次不触碰无关 WorkBuddy/legacy Key。

此项仅解除凭据阻塞，不代表依赖准备补丁已部署或完整发布验收已通过。

## 7. 旧 Key 客户端引用排查（2026-10-18）

按用户要求执行只读排查，比较本次轮换前后 Key 的原始值及 base64 形态，不输出明文，不修改客户端/服务配置、不重启进程，也不清理历史记录。

| 范围 | 结果 |
|---|---|
| 本机客户端及项目配置 | 检查 WorkBuddy、CodeBuddy、Codex、Claude、候选 .config 配置、本地存储、项目配置和 env_config，共 2986 个候选文件；未发现非备份配置引用本次作废的旧 Key |
| 本地安全备份 | 一份 dev.env.before 含旧值，为本轮显式保留的轮换前备份；不是活动客户端配置 |
| 历史残留 | 初步定位发现 WorkBuddy 的 4 份历史 trace 含已失效旧值；不是客户端连接配置，不据此断言仍有客户端在用，也未擅自删除 |
| dev 运行配置 | 13 个 PM2 进程的启动环境及 15 个相关配置文件中，未匹配旧 Key |
| dev 数据库配置 | 检查 6 条 MCP 模块鉴权配置、12 条配置中心记录（含成功解密比对的 10 条密钥项），旧 Key 匹配为 0、未读项为 0；仅在内存中比对，不回显配置值 |
| 凭据身份 | 旧 key_hash 对应记录为 0；新 Key 仅对应原 ID=6 的一条记录 |
| Agent 内部链路 | dev ai-agent 与 MCP gateway 的共享 MCP_CLIENT_KEY 一致，且不同于本次轮换的旧 OPS Key；本轮不改这把共享凭据 |

结论：在已检查范围内，没有需要同步新值的其他旧 Key 客户端配置。历史 trace 与备份仍须按敏感材料保管；旧 Key 已经由真实鉴权验证为 401，不因文件残留重新有效。

范围限制：这是静态引用排查，不是全球调用方清单。未扫描其他机器或 prod 服务、未解锁系统钥匙串；本机目录深度最多 7 层、单文件最多 32 MiB，历史会话/日志等不作为活动配置判断依据。不能据此保证外部或加密存储中绝无副本。

脱敏结果见本机私有目录的 `client-audit-summary.json`，已另存到本地凭据持久备份目录；原始路径清单只保存在私有证据目录，不提交 Git。排查前后进程 PID/状态/重启计数保持不变。
