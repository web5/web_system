# Console P0 执行拆分（2026-10-18）

> 2026-10-19 后续进展见 [剩余项收口](2026-10-19-console-p0-closeout.md)；本文保留当日历史结果，不代表最新代码、部署或验收状态。

> 北京时间。用户已授权按计划持续推进，本轮只做 P0，不启动 Content-hub 或 Agent 主线。不自动提交/合入，不批准既有 prod 发布单，不强推 MCP gateway 的 schema 变更。
> 关联：[三主线计划](2026-10-16-three-track-delivery-plan.md)、[前序 S1c 记录](2026-10-18-console-s1c-build-preparation.md)。

## 1. 子任务与当前状态

| 子任务 | 工作范围 | 出口 | 当前状态 |
|---|---|---|---|
| P0.1 依赖准备与资源约束 | 恢复 git 后置钩子；冻结锁文件安装；核实 pnpm 及内存/并发上限 | 红绿回归、本地全量测试及构建通过 | 完成：90 suites / 1077 tests；pnpm 10.33.0，子进程堆上限 768 MiB，安装 child/network concurrency=1/4 |
| P0.2 dev 候选部署 | 备份、实体/只读 schema 对比、只重启 Console、复核审批和其他服务 | health=200，schema 差异为 0，业务状态保持 | 当前补丁于 23:29:24–23:29:32 激活；41 个实体文件一致；dev 启动自动对表已关闭；旧 prod 审批不动 |
| P0.3 真实流水线验收 | 新建 admin/dev 构建；审批点检查；投递、激活、独立验证及恢复；再补适用场景 | 每项记录真实状态和副作用，不以单测代替实机 | admin/dev 新建版本全链路通过，36/36 资源核验，previous_version 保留正确，已完成实际恢复基线；不是全部产物类型通过 |
| P0.4 剩余矩阵与归档 | shell/后端、浏览器登录态、取消/重复请求/失败保护、生产适用性边界 | 明确已验、未验、阻塞与回退点，出 P0 结论 | 待审批取消及重复取消已实测；shell、后端、Console 登录态和生产适用性仍未全部完成，后端另有安全阻断 |

## 2. 候选身份与回退材料

- 独立源码工作树仍未提交：`<workspace>/.worktrees/console-acceptance-fixes-20261016`。
- 当前 dev Console 候选源码清单 SHA-256：`9a5546ba5bb75a1e26bebdc969779e3e478d67784da1c7b7aae44978675c8bac`；压缩包 SHA-256：`fff2abd9bd8c5c6efb31d5102e1c96075773f2f7ee23482c48dd09b72cc85a32`。第一批 1073 测试候选的身份保留在对应部署回执，不与当前候选混算。
- 当前 dev 持久备份：`/home/ubuntu/web_system_backups/console-p0-20261018-1792337353900`，含旧配置、旧 Console dist、候选包、验证及激活回执；配置 0600，目录 0700。先前备份 `console-p0-20261018-1792334305109` 仍保留。
- 本轮累计涉及五项服务配置：RELEASE_PNPM_BIN、NODE_OPTIONS、npm_config_child_concurrency、npm_config_network_concurrency、DB_SYNCHRONIZE；最后一批只将 dev Console 的 DB_SYNCHRONIZE 改为 false。构建根、运行根、静态根和原切换栅栏不变；MCP gateway 文件/配置/元数据不在本次部署范围。
- 首次传输因 macOS 压缩包扩展属性失败，发生在候选暂存阶段，未停止服务或切换运行版本；随后使用无扩展属性的 USTAR 包重新暂存并完成验证。失败暂存材料保留，不作为可用回退点。
- 原 dev.env 路径再次不可用；执行器使用此前用户授权轮换时保留的私有安全副本，已重新验证记录归属及真实 API 可用。未再次生成 Key，也未恢复/覆盖用户移走的配置。

## 3. 验收边界

1. 新建 run 固定已评审的完整 commit，不能自动发布远端 master 最新提交；先构建到审批点，核实入口/分包资源与目标目录，再放行 dev 激活。
2. 构建/投递失败不应变更当前线上版本；记录失败任务，不删库美化。只恢复实际测试目标，保留真实 previous_version 历史。
3. 本机浏览器登录与特定生产写操作若需要用户身份/明确授权，单列阻塞；不自签 JWT、伪造身份或借 dev 确认越过 prod 门禁。
4. 任何范围未验证必须如实列出。本地测试、dev 模块成功和 Console 整体验收分别记账。

私有原始证据位于 `/tmp/web-system-console-s1c-20261018/`；公开报告只保留脱敏结论，不能把含凭据配置或原始数据库快照提交 Git。

## 4. 登录入口归属核对

用户截图中的白色卡片、橙色标识、「管理后台」标题及「登录/注册」页签，对应 Admin 的 `/admin/login`，源码为 `apps/admin/src/views/Login.vue`。这是 Admin 管理后台的登录入口，不是发布控制台。

Beehive 蜂巢样式对应独立 Console 的 `/console/login`，源码为 `apps/deploy-console/src/views/Login.vue`。两者分别验收，不因为都出现 admin 账号就混为一个页面。

前述 Admin 工作台/用户管理页加载验证只覆盖发布样例模块；不能据此记作 Console 登录态验收通过。后续 Admin 入口以用户截图对应页面为准；Console 流水线等页面仍需独立验证。此次只纠正入口归属和验收记账，未改登录界面或切换环境。

## 5. 实机发现、修复及结论

1. **dev 构建 base 与投递路径不一致**：第一条构建成功的 run `1792334459842-ggb9xl7` 产物使用 admin-dev/c38423cc，而投递要求 dev/c38423cc；未放行，实际取消并重复取消均成功，关联审批转 rejected，旧 prod 审批未变。仅修正 tpl-admin-dev 托管构建动作的 dev 分支，local/prod 分支保持；新增配置 revision=6 和审计，变更前脚本已持久备份。
2. **重复收尾覆盖回滚历史**：首次发布 run `1792335291273-lxihodc` 的资源/页面可用，但额外核对发现 previous_version 被写成当前 c38423cc，不能记作完整验收通过。已修复本地 registry 及云库镜像相同版本重写语义；云库部分只做桩测试，未发起 prod 发布。阶段显示同时改为实际运行/审批步骤。
3. **启动探活回退**：第二批候选启动日志停在 TypeORM 初始化，30 秒探活失败后自动回退；旧服务恢复健康，运行产物与打包完成后的本地 dist 完全一致，没有发现压缩包缺文件。关闭自动对表的独立 DI 容器探针 945ms 完成，未监听端口、未调用模块启动钩子。随后在只读 schema 差异=0 的前提下关闭 dev Console 自动对表，第三批候选成功启动；不把这项诊断描述成已抓到具体 SQL 锁证据。
4. **最后一轮真实回归**：使用与已评审 c38423cc 完全相同 Git tree 的 e1618537，新建版本目录，避免覆盖已有 immutable 资源。run `1792337429466-l68mhgj` 完成构建→审批→投递→激活；release_verify 显式版本及 jobId 均通过，36/36 HTTP 资源的状态、MIME、磁盘字节和构建摘要一致。发布后 current=e1618537、previous=e2a2866c，重复收尾不再丢失真实回滚目标。测试结束通过真实模块回滚恢复 e2a2866c，不手工改 SQL 修饰 previous_version。

### 仍未收口的出口

- shell/site-version 的真实发布与恢复尚未完成，不能套用 admin/env-dir 结果。
- 后端 todo-service/dev 的旧 sync 动作仍会在运行仓库 reset 到 origin 分支头，并重建共享运行依赖；只读检查又确认运行目录与构建目录的 pnpm-lock 不一致。因此未启动该危险发布演练，不能靠“先跑再说”证明隔离安全。后续需先改造此投递前置或采用隔离的运行依赖交付，再测重启、探活与回退。
- Console 自身登录态浏览器流程尚待完成；Admin 的登录态页面加载不能替代它。生产适用性核查、其余取消/重复请求/失败组合也须逐项记账。

**当前结论：已完成核心修复和 admin/dev 的真实闭环回归，P0 整体验收仍未全部通过。** 私有证据包括 p0-round3 部署回执、p0-history-live-verification-summary、p0-history-final-restore-task、p0-verified-closeout-summary；未提交/合入源码，未批准旧 prod 任务。

最终复核：Admin/dev current=e2a2866c、previous=e1618537，恢复后的 HTTP 资源 4/4 一致；无活动 run/task/锁残留，其他模块/环境指针及非 Console 进程保持不变，旧 prod 审批仍为 pending。恢复走实际模块回滚，没有调用整站恢复脚本或手工回填 SQL。
