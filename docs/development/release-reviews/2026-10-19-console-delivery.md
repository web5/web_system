# Console dev P0 交付准备与生产适用性核查

> 本次分支最终本地验证：100 suites / 1184 tests，Console 后端、前端和 MCP Gateway 构建通过；脚本体检 0 error / 8 条既有 warning。新增入口归属门禁已真实只读验证：dev canonical 入口通过，生产当前登记旧树被拒绝。生产迁移计划为 `promote-legacy-tree`，仍有 10 个在线进程，仅生成计划，未 apply。目录统一新增代码没有冒充已部署的 dev P0 快照，也未执行生产目录切换。

核查日期：2026-10-19。用户已授权创建独立分支、提交并开 PR，并指定运行根统一到 web_system。当前交付分支为 `feature/manual-review/console-delivery-closeout`，基于已核实的 master `0127aacb`；提交/草稿 PR 以 Git 记录为准，不自动合并。生产实际目录切换仍未执行，本文不能替代维护窗口授权。

## 1. 交付基线

- 原修复工作树基线：`e16185379d860ab9fa009fa64152d95eff3bee68`；现已转入基于最新 master 的独立人工评审分支，保留原修复和验收记录。
- 本次查询的受保护远端 master：`0127aacb62a1b6348655496e764d2b787c6de7c1`。期间已合入 Admin 登录守卫及 AI 模型默认值修复；不得覆盖这些改动。
- 两个基线之间与本轮 Console 修改文件无交叉。锁文件只有 Admin importer 改变，Console 相关 importer 和既有 package snapshots 不变。补丁已在独立的最新 master 源码快照中 dry-run、应用并核对源码摘要，97 suites / 1156 tests、Console 后端/前端及 MCP Gateway 构建均通过。复用本地已安装依赖，未重新安装或改写锁文件；正式 PR 仍须在冻结锁的 CI 环境复验。
- 已部署 dev Console 后端：`console-p0-20261019-1792378478196`，源码变更集摘要 `59968e1a03f34bbea9005902371ad2c0041a4b8338cd666a3c6d523eaf519bdc`；该摘要是未提交源码快照，不伪装成 Git commit。
- 已部署 dev 前端：`console-ui-p0-20261019-1792378566424`，53/53 文件 HTTP 状态、MIME 和构建字节一致，旧 hash 资源保留。
- dev 验收：97 suites / 1156 tests、前后端构建通过；Admin/Shell/隔离后端发布与恢复、发布安全门、Console 本人登录态、详情和列表两处 dev 手动探活均有证据。详细记录见 `docs/plans/2026-10-19-console-p0-closeout.md`。

## 2. 建议评审切片

| 切片 | 改动 | 必看边界 |
|---|---|---|
| 构建与调度安全 | 构建根隔离、Git 清理预检、目录切换时间栅栏、依赖准备、冻结锁、提交/取消竞态 | 不在运行树构建；待审批也阻止同模块重复提交；交付中不能强杀取消；旧 prod 单不恢复 |
| 运行根统一 | 共享解析器、旧格式部署入口归属检查、离线迁移/回退脚本 | canonical 为 web_system；静态根/构建根不搬；在线进程不迁；两棵树完整保留，不在非运行树报部署成功 |
| 模块级恢复 | MCP component 必填、回滚按应用/服务分域、操作锁、重复指针历史 | 不降级为整站脚本；不执行 pm2 restart all；Shell 不生成 JS 指针 |
| 隔离后端运行包 | 平台/ABI/锁/文件摘要、不可变投递、仓库外运行依赖、单进程探活和失败恢复 | 仅对已迁移模板生效；已知 RROOT reset 脚本拒绝；并非任意 shell 沙箱 |
| 提案与验证 | 环境目录、HTML 入口、应用域指针真相源、unknown 边界 | 不以流水线 succeeded 代替当前生效；自动 HTTP/配置摘要仍属既有 knownGaps |
| dev 手动探活 | 显式 SSH 目标机内 HTTP，界面展示真实通道 | 只启用 SERVICE_HEALTH_TRANSPORT_DEV；prod/local 默认 direct；显式 upstream URL 保持直连；无主机/端口/SSH 时不回落控制台本机 |
| MCP 兼容声明 | rollback 工具元数据与接口一致 | 只读检查声明，不因几行源码变化整包部署 MCP Gateway 或自动对表 |

历史失败记录、生产旧审批和真实 previous_version 不清理、不美化。未纳入他人维护的 AI 应用目录文档、模型计费记录或模型修复分支。

## 3. 代码之外必须随交付记录的配置

1. dev 构建 checkout 与运行根独立，目录切换栅栏为 `1792173663816`。旧 prod run 早于该值，审批恢复应拒绝且不改变原审批状态。
2. dev 运行设置包含 `DB_SYNCHRONIZE=false`、pnpm 10.33.0、Node heap 768 MiB、安装并发限制，以及 `SERVICE_HEALTH_TRANSPORT_DEV=ssh`。不能把 dev 的 SSH 探活选择全局扩散到 prod。
3. `tpl-admin-dev` revision 6 修正 dev 资源 base；`tpl-todo-service-dev` revision 8 包含仅 dev 生效的隔离运行包动作。数据库中的模板不是“合入源码后自动迁移完成”，必须单独核对 revision、脚本摘要、备份和审计。
4. 源码 `backendRuntimeProgram()` 与模板中嵌入的程序应一致；后续修改运行包实现时，要重新生成、评审模板动作，不留过期的内嵌程序。
5. dev Todo 的恢复基线是明确标注的运行现场检查点 `runtime-checkpoint/1792343661257`，不是旧错误账本中的 Git 版本，不得改回 SQL 伪造历史。

原 dev 验收实际核对 revision 8 的打包、投递、格式校验、激活及复验 5 个动作，均包含当时相同的运行程序；程序摘要 `0c807e53e595154a11f1bb201d1771ea81890ba7ee943a81109ef97ac81ad6df`，该核对只读。本次 PR 将子程序输出包装改为明确的 stdout JSON 行，以通过产品代码红线检查；运行主函数不变，但整个包装程序摘要会改变。合入后若重新生成模板，应按新完整程序核对并记录 revision，不能把历史摘要当作新包装验证结果。

## 4. 生产只读盘点结论

生产业务仍健康，所查 Todo、Gateway、MCP Gateway 的本机 `/health` 均 200；没有通过初始化应用容器、启动迁移或自动对表来做检查。

| 核查项 | 实际证据 | 上线约束 |
|---|---|---|
| 登记部署根与实际运行根 | 登记为 `/data/web_system`；10 个 PM2 进程实际入口在 `/data/web_system_git`；两个树的 Git HEAD 不同 | 先统一环境运行根真相源并验证发布/回滚都命中实际服务，不能在不被使用的树里复制 dist 后就报成功 |
| PM2 cwd | Todo cwd 为服务目录；Gateway/MCP Gateway 等仍使用仓库根 cwd | 新隔离运行包的单服务 cwd 门禁会拒绝不匹配形态；不得为了“放行”削弱门禁，调整须在生产窗口计划内 |
| 静态根 | 实际生产 Gateway 使用 `/data/web_system_static/public`，与控制台登记一致；抽查 Admin/Portal/Shell 当前入口均存在 | 保持该静态根，不迁到 dev 默认目录；Shell 读取 env/version/index.html，不检查 JS 指针 |
| 后端模板 | 10 个启用的生产后端模板仍含已知运行仓库 reset 同步动作，0 个已迁移为隔离运行包 | 新代码会拒绝这些旧动作。逐模板迁移、修正路径并验收后才允许发起新生产发布，不靠放宽安全门解决 |
| 版本引用 | Todo/MCP Gateway 账本当前为纯 `b08b2199`，实际留存入口在 `todo-service-dev/b08b2199` / `mcp-gateway-dev/b08b2199`；留存的 43/34 文件摘要分别与当前运行字节一致 | 具备真实留存材料，但全版本引用与路径仍需对齐；不把字节一致当作已做生产回滚演练，不自动改生产账本 |
| 前端回退指针 | Admin previous 为空，Shell previous 与 current 相同；Portal 有不同的 previous 且入口存在 | 为生产窗口选择、核验真实可用的不同回退目标，不以 previous 字段存在就判可恢复 |
| 旧 prod 审批 | run `1790749237193-nn2w34p`、approval `1790749249606-mncs8f1` 仍 pending，早于构建目录切换 | 不批准、不取消；需要在新目录/模板完成准备后重新提交新单 |
| 生产 Console 形态 | 本次所查两个部署树和既有 PM2 列表中未发现 deploy-console，本轮部署的是 dev 上的控制台服务 | 区分“更新控制平面”与“向生产业务发布”，不能把升级 Console 当作生产业务已验收 |

MCP Gateway 的整包 schema 差异仍属于独立阻断项：本轮未连接生产 ORM 执行差异日志或 DDL，不能把之前记录的 24 项差异说成本次重新核实的当前数目；正式整包升级前须重新做只读差异评估和迁移审批。

公网 6005 的对照请求仍超时；dev 手动健康判据已改为显式 SSH 目标机内探活，没有开放公网端口，也不宣称公网连通问题已恢复。

## 5. 合入及发布顺序

1. 保存可校验补丁、源码文件清单、测试/部署摘要与本报告；私有凭据、原始数据库快照、SSH 配置和临时操作载荷不得进入 PR。
2. 已获得 Git 操作授权，使用独立 `feature/manual-review/` 分支，复核远端是否前进并创建草稿 PR。该前缀不触发自动创建/启用合入；不要提交到原 Content-hub 功能分支，不强推受保护 master。
3. 本次不合并，保持草稿及自动合入关闭；评审和正式合并另行处理。
4. 单独准备生产根目录、模板、cwd、配置、schema 与真实恢复点清单；保存原配置/模板 revision 和操作级回退方式。
5. 明确生产窗口和新发布单，按模块试发及独立 HTTP/资源/版本/进程归属复核，再按约定恢复演练。原待审批单不复用。

只读生产核查不能复用 `scripts/_test-p0.mjs`：该历史集成测试含 DELETE/INSERT。也不执行 git reset/clean、pnpm install、应用 init、迁移、pm2 restart 或版本指针写入来“辅助检查”。

## 6. 证据及当前限制

- 运行原始证据：`/tmp/web-system-console-p0-20261019/`；本次交付/生产核查证据：`/tmp/web-system-console-delivery-20261019/`。目录仅本机用户可读，不能整目录提交。
- 生产核查使用已登记 SSH 目标、已有密钥和 known_hosts，不自动接受新主机指纹；仅读取进程/文件元数据并 GET 健康端点。
- dev 已部署的运行包来自原基线加未提交源码；最新 master 集成验证不会改写当前 dev，也不会把另一批 master 改动隐式发布到生产。
- 最终交付状态以补丁清单、最新基线 dry-run 和后续集成测试结果为准；“材料准备完成”不等于“PR 已创建/已合入/生产已发布”。

目录统一操作与安全门见 `docs/operations/runtime-root-normalization.md`。原 60 文件交付包是增加目录统一工作之前的 P0 快照，不作为本次分支最新内容的替代；新测试和提交记录应单独记账。本轮公开评审材料不包含私有配置快照、数据库动作原文或主机凭据。

交付包应包含源码补丁、逐文件 SHA-256 清单、测试/构建摘要、脱敏的模板程序一致性结果及生产门禁清单。dev 已验证的编译产物仅作当前 dev 回退/取证材料，不作为直接推广生产的候选；正式发布产物应从评审合入后的完整 commit 重新冻结构建。
