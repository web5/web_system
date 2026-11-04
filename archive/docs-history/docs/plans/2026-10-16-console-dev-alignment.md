# Console dev 运行版本对齐与验收进展（S1）

> 计划日期：2026-10-16；续验至 2026-10-17（北京时间）。结论：dev 后端版本已对齐，首轮缺陷及后续安全边界修复已部署，模块回滚三场景实测通过；整体验收仍未完成。
> 关联：[三主线计划](2026-10-16-three-track-delivery-plan.md)、[C0 验收矩阵](2026-10-16-console-acceptance-baseline.md)。
> 早期版本对齐未改源码；首轮修复见 §7。后续独立构建工作区切换、四项配置变更、MCP 声明兼容补丁及 dev 模块回滚见 §8。未执行现网 schema DDL、未操作 prod。

> 曾发现构建/运行共目录和 MCP rollback 整站恢复两项安全门，现已修复部署 dev；全量构建发布仍未执行。当前顺序以 [安全修复收口报告](2026-10-17-console-boundaries-closeout.md) 为准，前序章节保留各时点证据。

## 1. 本轮完成项

| ID | 动作 | 证据与结果 |
|---|---|---|
| D01 | 核实部署对象 | 仅 dev 的 deploy-console，PM2 fork 进程，端口 6200 归属与 PM2 PID 一致 |
| D02 | 核实配置与风险 | 现网是 .env 模式而非 bootstrap 模式；NODE_ENV=production，但 DB_SYNCHRONIZE 显式 true，会覆盖默认关闭规则；本轮不改该配置 |
| D03 | 发布工作与回退前置 | 无 running/pending 流水线、无活动发布任务、无有效发布锁；流水线名称重复为 0；有 1 条待审批单及 1 条挂起流水线，保留不处理 |
| D04 | 本机构建 | pnpm --filter deploy-console-server build 成功；源码为 e16185379d860ab9fa009fa64152d95eff3bee68，已随 PR #353 合并 |
| D05 | 部署前实体/数据库检查 | 41 个编译实体与旧产物逐字节一致；新实体元数据加载成功；只读 SchemaBuilder.log 的 up/down SQL 都为 0，未执行 DDL |
| D06 | 依赖及包完整性 | 28 个外部生产依赖可由现有运行环境解析；本地与远端压缩包 SHA-256 一致 |
| D07 | dev 后端升级 | 北京时间 23:40:27–23:40:52 执行备份、停止单个 Console 进程、目录切换和重启；未走 Console 自己的流水线，未更新 PM2 环境 |
| D08 | 升级后探活与权限 | health 200；配置端点匿名 401；缺失静态资源 404；新增 release-plan / release-verify 无凭据请求都返回 401，不能算业务校验通过 |
| D09 | 影响面核对 | PM2 的其它进程 PID/启动时间未变；前端入口及配置文件摘要未变；待审批单和挂起 run 的身份/状态摘要未变 |
| D10 | 二次稳定性核查 | 进程 online，运行 220 秒时 PID 未变、累计重启数稳定；6200 属于该 PID；数据库 schema 待执行 SQL 仍为 0；待审批单仍为 1 |
| D11 | 完整产物对账 | 本地构建与远端 live dist 的 933 个文件逐文件摘要汇总一致，不只核查了入口文件存在 |
| D12 | 线上 DB 动作静态检查 | 只读提取 16 条流水线的 230 个动作，用现有 pipeline-lint 离线检查：0 error / 43 warning，warning 全为 L6，尚未逐项认定安全 |

本轮升级会触发正常启动逻辑及已有后台任务，不能表述成“整个服务没有任何数据库写入”。准确范围是：未手工修改业务数据或配置，未执行迁移；启动前后 schema 检查都没有待执行 SQL，待审批发布状态保持不变。

## 2. 版本与产物身份

- 源码 commit：`e16185379d860ab9fa009fa64152d95eff3bee68`。
- GitHub master 核查时为合并提交 `c38423cc94021c4c15b583d53a811c5cd2de6a59`；本次构建用的是上述已合并特性提交，没有切分支或改源码。
- 压缩包 SHA-256：`c640670fd1d33c07e555bf92a50b7e26d414335e3a62502a39643046b9b02f46`。
- live dist 汇总 SHA-256：`60e833aa9dd8056f8b8befc135bf75d3cad0c7489b842682d217a210eadf96ff`，933 个文件。
- 汇总方式：递归收集相对路径及每个文件的 SHA-256，按路径 en localeCompare 排序后，对 JSON 数组再计算 SHA-256；不包含时间戳。
- 本机构建 Node v20.20.2；目标进程原有 Node v22.22.2。本轮不升级运行时或安装依赖。

## 3. 备份与应急回退

相对于 dev Console 服务目录，保留以下产物，不清理历史备份：

- `dist.bak-c1-e1618537-20261016`：停止进程前复制的旧 dist，入口摘要已核对。
- `dist.previous-c1-e1618537-20261016`：切换时移走的完整旧 dist，可用于原目录恢复。
- `dist`：本次新产物，已与本地构建做完整摘要对账。

切换过程设置失败恢复：停止同名 Console，将失败产物移入单独保留目录，将 previous 恢复为 dist，重启并探活。此次发布成功，未触发该分支；因此这里只证明“回退材料和处理路径已准备”，不算 V22 的真实业务回滚演练通过。

远端部署回执仅存私有临时位置 `/tmp/console-c1-e1618537-20261016-receipt.json`。本地原始记录位于权限 0700 的 `/tmp/web-system-console-c1-20261016/`。其中线上动作快照及详细 lint 报告只留私有临时目录，禁止提交到公开仓库。

## 4. 首轮认证阻塞（后续已解决，见 §6）

使用项目本地 MCP 配置中已有的 kedou-deploy Bearer 凭据，在内存中经 SSH 传递给 dev 本机请求；没有打印凭据、写入脚本参数或改变服务端鉴权。

| 检查 | 实际结果 | 解释 |
|---|---|---|
| 带现有凭据请求 release-plan | HTTP 401 | 未通过鉴权，不能声称 DTO 或提案逻辑通过 |
| Console 与 user-service 的内部凭据是否一致 | 一致，仅输出布尔值 | 不是两个服务内部密钥不一致造成的失败 |
| user-service 内部 keys/verify | HTTP 200，valid=false，ownerId 缺失 | 校验服务可达，但该现有凭据不被 dev 识别为有效的用户 Key；不能据此断言具体是过期、吊销还是环境不匹配 |
| 与 dev MCP 网关遗留共享密钥比较 | 不一致，仅输出布尔值 | 也不能把该现有凭据当作 dev 网关共享密钥 |

未签发、替换或吊销任何 Key，未自签 JWT，未开启 legacy 登录，也未放宽必须绑定 ownerId 的约束。

**首轮所缺条件已解决：** 后续按用户提供的安全配置目录找到 dev 专用运维 Key，核对数据库及账号归属后已可进行认证态调用，详见 §6。不再需要用户另外提供明文 Key；请勿将其发在聊天或提交仓库。

## 5. 验收状态变更

| 矩阵项 | 本轮推进 | 仍缺的部分 |
|---|---|---|
| V01 版本基线 | Console 已部署、完整产物对账、回退材料就绪 | 具体业务测试模块/版本/回滚点的盘点仍待做 |
| V02 匿名权限 | 升级后重复通过已测端点 | 全部角色与所有者矩阵未验 |
| V03 静态资源 | 升级后缺失资源仍 404 | 真实资源及浏览器关键路径未验 |
| V05 DB 动作巡检 | 16 条流水线 / 230 动作静态检查无 error | 43 条 L6 warning 尚待按实际执行上下文复核，不能全部直接豁免 |
| V06 提案 / V11 验证 | 路由和产物已就位；后续使用有效 dev Key 完成首轮只读调用，见 §6 | 目标产物检查差异及不存在模块返回 500 待处理；新发布闭环未验 |
| V07–V10、V14–V26 | 未提交真实发布或故障演练 | 待凭据、隔离测试目标和回退版本确认后继续 |

下一步：完成业务测试目标及回退版本盘点，复核实际要执行的 L6 告警 → 分别执行三类产物发布及独立 HTTP/浏览器验收 → 失败、权限、并发与回滚演练。首轮两项缺陷已按 §7 解决；生产写操作仍须单独确认窗口。

## 6. 安全配置与数据库核对：鉴权阻塞解除

本节保留首轮、修复前的结果；两项问题的最新结论见 §7。

用户指出环境配置统一保存在 `~/env_config`。本次从 `web_system/dev.env` 读取 DB 连接和 `MCP_OPS_KEY_DEV`，并用 `servers.env` 中的 dev SSH 配置连接；连接信息仅在内存中使用，不输出值。

### 数据库证据

- 安全配置所指数据库与运行中的 dev user-service 数据库一致，已核对后才查询。
- `mcp_api_keys` 仅有 SHA-256 的 `key_hash` 和脱敏前缀，没有明文 Key 列；不能从哈希恢复密钥。
- `MCP_OPS_KEY_DEV` 的哈希匹配 1 条记录：active、未过期、未吊销、未软删除，且已绑定 owner。
- 绑定账号存在且 active，属于 deploy 系统，并具有运维角色。
- 项目旧 kedou-deploy 凭据的哈希匹配 0 条记录，确认应换用安全配置中的专用 Key，而非放宽鉴权。
- 本轮没有签发/吊销 Key，没有变更账号或本地 MCP 配置；认证请求按既有逻辑可能更新 Key 的 last_used_at，不应宣称认证过程绝对零数据库写入。

### 认证态只读调用结果

| 请求 | 结果 | 判定 |
|---|---|---|
| release-plan 缺少必填字段 | HTTP 400 | 已通过鉴权并进入 DTO 校验 |
| release-verify 的 env 含非法字符 | HTTP 400 | 非法参数被拒绝 |
| admin 当前版本的 release-plan | HTTP 201，dryRun=true | 提案生成成功，但 artifact.target=fail、risk=critical，不能视为允许发布 |
| portal 当前版本的 release-plan | HTTP 201，dryRun=true | 同上；需核实产物寻址/保留契约，不先断言是代码缺陷 |
| admin / portal 当前版本的 release-verify | 各 HTTP 201，verdict=verified、expected.source=input | 当前版本指针及目录检查通过；未提供 jobId，流水线检查 skipped，不是新发布验收 |
| release-verify 查询不存在模块 | HTTP 500，预期 404 | 确认有异常语义缺陷，尚未修复；源码中 ModuleRegistryService.get 抛普通 Error，当前链路未转换成 404 |

共执行 7 次认证态请求。验证脚本退出码为 2，是不存在模块返回 500 而非预期 404 导致，不能把整轮标为通过。

只读业务调用前后，版本指针、流水线状态和审批状态汇总摘要一致；事实快照行数同为 392。未提交真实发布、未切换版本、未执行回滚。接口仍显式声明 HTTP 探测、配置/脚本 hash 等已知缺口，不能用 verified 覆盖这些缺口。

脱敏查询和调用结果保存在私有临时目录 `/tmp/web-system-console-key-audit-20261016/`，未保存密钥明文。

## 7. 两项缺陷修复与 dev 复测（2026-10-17）

### 根因与最小修复

- 目标产物误报：ArtifactStoreService.exists 原先只检查旧目录的 module/version/index.js，漏掉实际 env-dir 的环境层。dev admin、portal 的旧目录入口均不存在，但 dev/version 入口真实存在。
- 修复：exists 增加可选的环境/静态根参数，复用 entry-pointer 的 envArtifactsDir；release_plan 仅对 micro-frontend 使用该路径。旧签名保留兼容，远端静态根仍返回 unknown、不发起 SSH。仅在旧目录或其它环境存在同版本时，不允许兜底放行。
- 缺失模块 500：ModuleRegistryService.get 抛普通 Error，全局异常过滤器将其转换为 500。
- 修复：在注册表缺失出口抛 NotFoundException，保留原错误文案；真实数据库异常仍按 500 处理，不伪装成 404。没有通过吞异常或放宽鉴权解决。

### 验证证据

| 层级 | 结果 |
|---|---|
| 修复前反例 | 3 项失败：环境产物误报、旧目录误放行、缺失模块非 404；确认测试能击发问题 |
| 针对性回归 | 4 suites / 63 tests 通过；包含实际 HTTP 层的无凭据 401、模块缺失 404、数据库异常 500 |
| 完整服务回归 | 87 suites / 1026 tests 全通过；新增 14 个用例；nest build 成功 |
| dev 隔离候选探针 | 候选产物读取真实 dev 文件及 DB：admin/portal 环境入口判定 true，缺失环境 false，缺失模块状态 404；未启动另一套 Console，现网代码及 PID 未改变 |
| dev 受控后端更新 | 北京时间 00:03:29–00:03:44：备份、单进程停止/切换/重启成功；schema 待执行 SQL 为 0；前端/配置、其它进程、版本及审批状态保持不变 |
| dev 认证态复测 | 7 次请求，失败 0：两项非法参数 400，admin/portal 的 plan 各 201 且 artifact.target=pass、layout=env-dir、risk=low、blockers=0；两项 verify 为 verified；缺失模块为 404 |
| 只读业务状态对账 | API 调用前后，版本指针、run、审批摘要一致，事实快照行数均为 448；没有发起业务模块发布 |

两项 verify 是对显式输入的当前版本进行验证，并没有新发业务版本或传入新 jobId。因此不能据此关闭真实发布、故障注入、并发、回滚、浏览器或 prod 验收项；HTTP/配置/脚本 hash 等既有 knownGaps 仍保留。

### 源码、产物与回退身份

- 修复源码保存在仓库内独立工作树 `.worktrees/console-acceptance-fixes-20261016`，detached HEAD，基线 e16185379d860ab9fa009fa64152d95eff3bee68；共 7 个新增或修改的源码/测试文件。
- 未创建新分支、未提交或合入 master。本次 dev 为明确记录身份的候选版本，不是新的 master 正式交付；推广前仍需提交、评审及合入。
- 源码变更集摘要：`68de909405038be2ac065fa1afda44cc0986118f7957ddca7a30e0ffdd85ff44`；包括新测试文件，不能仅凭基线 commit 重建修复。
- 候选压缩包 SHA-256：`3b64a1197f429f14cc02379a247d0fcb8ac23031824ce10af3051ad85c482f78`，上传后已核对。
- dev Console 服务目录内保留 `dist.bak-c1-fixes-20261017` 和 `dist.previous-c1-fixes-20261017`，对应修复前版本；不删除早期备份。应急回退分支已准备，本轮未实际执行回滚演练。
- 本地私有证据位于 `/tmp/web-system-console-fixes-20261016/`，含源码文件摘要清单、红/绿测试、构建、隔离探针、部署及复测记录；远端部署回执为 `/tmp/console-c1-fixes-20261017-receipt.json`。均不包含密钥明文。

## 8. 安全边界修复与模块实测续验

2026-10-17 02:04（北京时间）已切换 dev 独立构建 checkout，部署 Console 安全修复并仅重启该进程。89 suites / 1066 tests 与 Console/MCP 构建通过；未执行现网 DDL。MCP 只替换 rollback 声明及一条既有工具元数据，未整包部署存在 24 项 schema 差异的 gateway。

admin/dev 的缺产物失败、切换到 6e7b2690、恢复 e2a2866c 三场景通过，三阶段均独立核对版本/磁盘指针与 4/4 HTTP 资源。最终 current=e2a2866c、previous=6e7b2690，保留真实回滚历史；其他指针、审批及流水线集合不变，未调用整站脚本或 prod 审批接口。

旧配置、工具元数据、MCP 声明及旧 Console dist 已完成 dev 用户目录持久备份和摘要校验。源码仍保留在独立未提交工作树。完整配置边界、回退注意事项和剩余 S1c 任务见 [收口报告](2026-10-17-console-boundaries-closeout.md)，不能把本节当作 Console 全量验收完成。

## 9. S1c 新建真实构建续验（2026-10-18）

新建 admin/dev run 已完成真实 fetch/checkout/reset/clean 和目标 commit 校验，但新编排未调用拉码后依赖准备，vite 因缺少 @web-system/types 产物失败；没有进入审批、投递或激活。运行根产物、旧备份、指针、审批及进程保持不变，活动锁已释放；并发提交返回 409。

本地已补回既有 pull.afterRun 并新增 6 项测试，全量 90 suites / 1072 tests 与 Console 构建通过；这次新补丁未部署。执行期间曾发现原 dev 凭据文件不在原路径；随后用户授权重新生成并更新数据库，现已对原 ai-ops-automation 记录完成轮换、同步本地配置并验证新旧凭据。未伪造身份或扩大权限，正式 API 通道已恢复。详情见 [S1c 构建失败与修复记录](2026-10-18-console-s1c-build-preparation.md)。
