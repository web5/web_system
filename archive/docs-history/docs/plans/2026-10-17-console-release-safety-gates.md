# Console 发布验收：安全门与阻断项（2026-10-17）

> 最新状态：安全边界修复已于 2026-10-17 02:04（北京时间）部署 dev，独立构建目录已启用，模块回滚三场景通过；完整构建发布与其余 S1c 验收未完成。详见 [收口报告](2026-10-17-console-boundaries-closeout.md)。
> 第 1–5 节保留修复前盘点时点：当时未改源码/配置、未重启、未成功发布或回滚。后续实际变更见 §6；全程未操作 prod。
> 关联：[三主线计划](2026-10-16-three-track-delivery-plan.md)、[验收矩阵](2026-10-16-console-acceptance-baseline.md)、[前序修复及 dev 部署](2026-10-16-console-dev-alignment.md)。
> 2026-10-18 续验：真实拉码后已核对 Console 运行产物和备份摘要不变，但构建暴露新编排遗漏依赖准备钩子；本地修复待部署和复测，不能宣布 S1c 通过。见 [最新记录](2026-10-18-console-s1c-build-preparation.md)。

## 1. 当前结论

Console 的整体验收不能按“跑一次流水线、再点回滚”直接完成。真实环境核查发现两个必须先处理的安全门：

| 编号 | 发布前阻断项 | 证据 | 本轮处置 |
|---|---|---|---|
| B01 | 构建工作区与 Console/应用运行根共用；拉码清理会删除回退材料 | dev 实际 RELEASE_WORKSPACE 与运行仓库根相同；所选流水线的托管 git 动作执行 git clean -fd，无排除参数；只读 git clean -nd 明确列出现存 Console 备份目录 | 不提交完整构建流水线，不执行 checkout/reset/clean，不搬迁或改写全局配置 |
| B02 | 计划中的“模块回滚”不能使用当前 MCP rollback 的整站脚本路径 | 已部署的 startRollback 委派 executeRollbackScript，spawn 参数仅有 env/tag；实际 rollback.sh 会清空 servers/apps 后还原整站快照，并 pm2 restart all；component 未限制脚本执行范围 | 不调用该接口进行模块演练，不生成回滚任务，不执行脚本 |

B02 是**既有整站恢复能力与本轮模块验收目标的范围不匹配**，不能把“整站恢复脚本存在”本身说成所有代码都有缺陷。但 component 只作任务定位不能证明执行已按模块收口，必须先确认并接通正确入口。

两项均列为本轮发布前 P0 安全门，不代表本轮已造成故障；本轮没有触发危险操作，也没有全局禁用用户现有服务或替用户取消任务。

## 2. 真实环境及回退版本盘点

| 对象 | 当前版本 | 数据库 previous_version | 磁盘指针 | 保留产物 |
|---|---|---|---|---|
| admin / dev | e2a2866c | e2a2866c | e2a2866c | 10 个候选版本目录 |
| portal / dev | f77577ef | f77577ef | f77577ef | 19 个候选版本目录 |
| shell / dev | a82270f9 | a82270f9 | 本轮未单独复验 | 部署模式为 site-version，不套用微前端 env-dir 判据 |

- admin、portal 是 micro-frontend/env-dir；shell 是 shell/site-version。三者不能统一套一份目录和切换判据。
- admin 和 portal 的 previous_version 都与 current_version 相同，不能直接把这一列当作“可回退到不同版本”的证据。
- 磁盘上有历史产物不等于版本适合恢复；后续必须显式选择不同版本，核对记录、入口、依赖与业务兼容性后再演练。
- 现有 1 条待审批流水线为 prod 的 todo-service，停在“发布确认”。本轮未审批、拒绝、取消或重跑它。
- 构建目录隔离会影响后续动态解析的路径，必须评估已有挂起 run 的构建产物/路径与恢复方式，不能直接全局改 RELEASE_WORKSPACE 然后假设旧 run 不受影响。

### B01 的具体证据

选择的 admin 流水线为 tpl-admin-dev。其有效托管 git 动作包含：

```sh
cd "$RELEASE_DIR"
git checkout -B "$BRANCH" "origin/${BRANCH}"
git reset --hard "$WANT"
git clean -fd
```

以上为动作关键语句摘录，不是本轮实际执行的命令。实际执行的只有只读预览 git clean -nd。

预览命中 8 个现有 Console dist 备份/previous 目录，以及候选临时目录和小程序目录内的未跟踪内容。不能通过“先删备份”“把备份加进 Git”或假定它们都是可丢缓存来让验收继续。

另外，平台 ReleaseGitService 自己也包含 checkout/reset/clean；只修该服务还不够，DB 托管动作脚本同样有直接 git 指令。安全校验必须覆盖真实执行路径，不能只在一处函数加守卫便宣布闭环。

### B02 的具体证据

调用链：McpController.rollback → DeployService.startRollback → executeRollbackScript → scripts/rollback.sh。

- component 写入回滚任务的定位字段，但没有传入脚本的 argv。
- 脚本按 releases/tag/web_system.tar.gz 整站快照恢复，不是 env-dir 微前端版本切换。
- 现有 rollbackUnified / AppsService.switchVersion 是可复用的模块级能力，但不能因此推断外部 MCP rollback 已经使用它们。
- 工具声明也将现有 rollback 描述为脚本级回滚，并建议前端优先使用 publish_version。后者的实际 env-dir 生效链路仍需检查，不能为了绕过 B02 就默认它已完成指针/数据库一致性验证。

## 3. 本轮实际通过的检查

### 网关资源：6/6 通过

使用安全配置中 dev 站点的 Host，经 dev 本机 gateway 探测。admin 与 portal 各检查：

- 当前版本 index.js：200、JavaScript MIME，与磁盘内容 SHA-256 一致。
- 当前版本 index.css：200、CSS MIME，与磁盘内容 SHA-256 一致。
- index.js 声明的首层 main 分包：200、JavaScript MIME，与磁盘内容 SHA-256 一致。

共 6 个资源全部通过，且磁盘入口指针与数据库当前版本一致。

这只证明本次采样的 gateway HTTP 资源可消费，不包含公网 Nginx/TLS/CDN、全部动态分包、登录后业务流程或浏览器 pageerror 验收。

### 受控负向 API：5 个场景通过

全部只发往 dev；使用既有有效运维用户 Key，不输出凭据，不调用 rollback。

| 场景 | 实际结果 | 验收意义 |
|---|---|---|
| pipeline 的分支含空格 | 400 | 在创建发布任务前拒绝非法分支 |
| pipeline 的 commit 含非法字符 | 400 | 不把非法 commit 交给 git/shell |
| publish_version 的目标版本不存在，且未传 component | 400 | 未触发历史版本兜底切换 |
| release_verify 显式输入与线上不符的版本 | 201，verdict=failed | HTTP 成功响应不掩盖验证失败 |
| release_plan 未指定 versionTag | 201，artifact.target=unknown | 现场构建前不把尚未生成的产物误报成 pass/fail |

受控复跑前后：pipeline run 均为 152，部署/回滚 task 均为 0，待审批单仍为 1；新旧版本指针、legacy 部署状态、run/task 及审批状态的汇总摘要一致。

认证按既有流程可能更新 Key 使用时间，因此不宣称整个检查过程完全没有数据库写入；上述一致性结论限定为部署与审批业务状态。

## 4. 修复顺序与验收出口

### S1a. 先隔离构建与运行

1. 明确专用构建 checkout、Console 运行位置、业务运行位置、静态伺服根和产物暂存根，逐项固定真相源；不通过软链把构建根指回运行根。
2. 使用独立 clone/依赖布局。仅移动 git 目录但继续共用可变 node_modules，会把依赖安装风险留在运行服务上，不能算隔离完成。
3. 明确保留现有静态目标根；切换构建工作区不能让 STATIC_PUBLIC_ROOT 的默认推导把指针写到新构建目录。
4. 为 run 固定必要的工作区/路径上下文，先确定既有待审批 run 如何兼容，再改全局配置。不得擅自关闭该 prod 待审批任务。
5. 在实际执行前阻止构建根与运行根重合/包含/经软链重合，以及工作区中存在将被清除的非构建内容；托管脚本和内置执行路径均需覆盖。
6. 配置与编排变更按现有门禁评审，保留旧配置/脚本 revision 和回退方式；用临时目录验证清理只发生在专用构建范围内。

出口：能对同一运行根和备份做事前事后摘要核对，真实 git/build 不触碰它们；当前 dev 服务与既有审批状态不受影响。

### S1b. 再收口模块版本激活/回滚

1. 按契约明确模块级入口，env 与 module/component 必须参与真实执行，不只写日志；复用 rollbackUnified、AppsService.switchVersion 等既有能力。
2. 保留整站恢复为独立危险能力，不能在模块回滚失败时自动降级为整站恢复；对应工具、接口声明和风险提示同步。
3. 确认 publish_version 在 env-dir 应用上同时处理产物校验、DB 版本、磁盘指针、缓存与审计，避免仅写数据库却返回成功。
4. 在没有目标产物、模块错误、环境错误、重复请求等情况下先拒绝，确认版本和指针未改变；模块回滚不得调用整站脚本或 pm2 restart all。
5. 以显式目标版本完成一次 dev 模块切换、独立 HTTP/浏览器验证、再回到基线版本，逐步保留证据。

出口：确实切换到不同版本后恢复基线，前端资源与版本事实一致，审计及任务终态准确，其他模块/环境不变。

### S1c. 恢复原验收矩阵

S1a/S1b 通过后，继续完整构建发布、shell 专属路径、后端发布、并发/取消/权限/失败及回滚矩阵，最后再单独评估 prod 适用性。原 2–4 人日的 S1 估算需在安全边界方案确认后重估，不以赶进度绕过这两道门。

## 5. 证据保管与范围

脱敏结论在本文件；原始配置/动作树/资源与 API 响应、状态摘要仅保存在本机私有目录 `/tmp/web-system-console-e2e-20261017/`，权限 0700，禁止把 DB 动作脚本快照或凭据提交进公开仓库。

盘点时没有修改上一轮候选源码或重新部署；该历史结论不代表 §6 后续修复的状态。

## 6. 后续修复与当前出口（2026-10-17）

- B01：已部署路径重合/包含/软链校验、工作区脏内容及清理预览保护，覆盖 submit、内置 Git、实际 shell cwd 和最终 RELEASE_DIR；dev 构建 checkout、依赖、运行根、静态根已分离。真实新建 run 的构建/清理端到端补证仍待 S1c。
- 旧 run：切换时间栅栏在 submit、shell、两种审批路径生效，审批检查发生在改状态之前；保留既有 prod todo-service 的 awaiting-approval/pending。仅只读求值确认 409，未调用实际审批 API；需新建 run，不自动迁移旧 run。
- B02：带 component 的回滚改用 rollbackUnified，MCP 必须给出 component；失败不降级整站脚本，成功不重复记版本。admin/dev 缺产物、不同历史版本、恢复基线三场景通过，指针/数据库/HTTP 一致，其他指针与审批不变；浏览器登录态仍待验证。
- 本地 89 suites / 1066 tests，Console/MCP 构建通过。仅重启 dev Console；MCP 使用声明最小兼容补丁，并只更新一条 rollback 工具元数据，不整包部署 gateway、不执行其 24 项 schema 差异。
- 已将旧配置、旧 MCP 声明、旧工具记录、939 个旧 Console 产物文件及回执复制到 dev 用户目录的持久备份，校验通过；不依赖 /tmp 作为唯一回退材料。
- 结论：两项边界修复已上线并完成限定范围实测；不等同 S1a/S1b 所有出口或 Console 整体验收完成。下一步执行 S1c，细节、回退边界与证据见收口报告。
