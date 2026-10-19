# Console 重构验收基线与矩阵（C0）

> 首轮核查日期：2026-10-16（北京时间）。状态：C0 完成；S1 首轮缺陷及安全边界修复已部署 dev，模块回滚三场景实测通过；完整构建发布等 S1c 整体验收仍未完成。
> 源码基线：e16185379d860ab9fa009fa64152d95eff3bee68；GitHub master 为 c38423cc94021c4c15b583d53a811c5cd2de6a59（PR #353 的合并提交）。
> 本文第 1–6 节保留 C0 首轮记录：当时未部署重启或写数据库。后续 dev 后端对齐及认证阻塞见 [S1 进展](2026-10-16-console-dev-alignment.md)；未连接 prod。
> 上位计划：[工程三主线任务计划](2026-10-16-three-track-delivery-plan.md)。
> 2026-10-18 最新：V07 已执行新建 admin/dev 构建，但暴露新编排漏调依赖准备钩子，构建失败、未投递/激活；本地补丁与 90 suites / 1072 tests 通过，尚未部署复测。凭据阻塞现已通过用户授权轮换解除。并发拒绝、匿名鉴权、失败不改指针/审批/运行产物已补证；详见 [S1c 续验记录](2026-10-18-console-s1c-build-preparation.md)。

> 2026-10-17 续验：构建/运行隔离和模块回滚入口修复已部署，V22 仅 admin/dev 模块路径获得真实切换与恢复证据；V07 新建 run 完整构建发布、shell、后端、浏览器及并发/取消/失败矩阵仍待验。第 4 节保留 C0 时点，最新状态见 [收口报告](2026-10-17-console-boundaries-closeout.md)。

## 1. 本轮结论

以下为 C0 时点结论；其中“dev 产物缺新能力”、后续凭据阻塞及首轮两项缺陷均已解决，不能把后续部署和限定范围实测成功视为整体验收完成。当前进度以 S1 报告 §8 和收口报告为准。

1. Console 不是“完全没验证”：自举、脚本投递、事实巡检有历史分项验收，本次本地回归也通过。
2. 不能宣布“只差补一份验收报告”：dev 当前运行目录中的编译产物缺少 release_plan / verify_release，整体验收先受版本未对齐阻塞。
3. 本地 6200 未监听不代表 dev 不可用；dev 6200 健康接口实测 200。
4. 验收范围限定本轮已有重构能力，不以 runner、自动回滚等远期目标阻塞本轮收口。

## 2. 本次实测证据

| ID | 执行动作 | 实际结果 | 可以证明 / 不能证明 |
|---|---|---|---|
| E01 | deploy-console：jest --runInBand --json | 85 suites / 1012 tests 全部通过，退出码 0，28.832s | 当前源码单测通过；不能代替真实 DB、部署及浏览器验收 |
| E02 | deploy-console：tsc --noEmit | 退出码 0 | 当前环境类型检查通过；没有生成发布产物 |
| E03 | pipeline-lint --scripts scripts/pipeline --json | 6 个脚本，0 error / 0 warning，退出码 0 | 仓库动作模板静态通过；未读取线上 DB 动作 |
| E04 | pipeline-lint --scripts scripts --json | 50 个脚本，0 error / 8 warning，退出码 0 | 与 CI 同范围静态检查通过；L6 告警未逐项豁免 |
| E05 | 本机 GET 127.0.0.1:6200/health | 连接失败，curl 退出码 7 / HTTP 000 | 本机此端口不可用；不判为 Console 业务缺陷 |
| E06 | dev GET /health | HTTP 200，application/json | dev 服务在线；不等于业务链路正常 |
| E07 | dev GET /api/config/revisions，不带登录态 | HTTP 401，application/json | 此配置端点没有匿名放行；不代表全部权限矩阵通过 |
| E08 | dev GET /assets/c0-missing-20261016.js | HTTP 404，application/json | 本次不存在的资源未回退成 200 HTML；不代表所有前端资源正常 |
| E09 | dev 现有 PM2 daemon 只读进程元数据 | deploy-console 为 online；进程启动于 2026-10-15 11:45:29（北京时间） | 进程当前在线；历史累计重启次数不据此解释成当前重启风暴 |
| E10 | dev 对 PM2 入口所在 dist 做文件及字符串核对 | fact 服务文件和 FactModule 在；release-plan / release-verify 服务文件不在；mcp.controller.js 存在但不含两条新路由 | 当前磁盘部署产物与源码能力不齐；未对内存路由或产物 commit 做完整鉴定 |

dev 探测经既有 SSH 身份执行，BatchMode=yes、StrictHostKeyChecking=yes；只连接既有主机。读取 PM2 前确认 rpc.sock 存在，未为核查启动 daemon。未读取或输出环境变量、令牌和配置密文。

原始结果仅在本机临时目录 `/tmp/web-system-console-c0-20261016/`，不会随仓库提交：jest.json、jest.log、typecheck.log、pipeline-lint.json、pipeline-lint-all.json、dev-readonly.log、dev-runtime-baseline.log、dev-feature-confirmation.log。临时文件可能被系统清理；本表保留本次脱敏结果，不能当作未来仍在线的证明。

## 3. 范围基线

| 能力域 | 当前代码依据 | 本轮应验什么 | 已有证据与缺口 |
|---|---|---|---|
| 配置与自举 | src/bootstrap、src/config、main.ts | 自举顺序、保护键、配置解密、配置错误降级及鉴权 | 历史自举 dev 五项通过；当前配置态未重新读取 |
| 流水线与脚本边界 | src/pipeline、src/pipeline-orchestration、scripts/pipeline | 构建、环境分流、上传、清理、失败终止 | 单测及模板静态通过；线上 DB 动作未巡检 |
| 短期运行凭据 | src/common/run-token、internal-guard | 作用域、过期、跨 run 拒绝及日志脱敏 | 当前单测通过；真实 run 生命周期待验证 |
| 寻址与投递 | src/target、src/hosts、src/remote | 主机管理真相源、目标环境、静态根、投递一致性 | 历史 dev 临时根投递通过；实际版本发布待复验 |
| 产物与版本 | src/artifact、src/registry、src/apps | 前端 env 目录及指针，后端版本记录，shell 专属入口 | 当前单测通过；三类产物实发及版本账本对账待验 |
| 审批、锁与审计 | src/approval、src/release-lock、src/audit、src/mcp | 所有者边界、审批后恢复、并发互斥、审计身份 | 当前单测通过；集成行为待验 |
| 发布前后验证 | src/release-plan、src/release-verify | 只读提案、现采事实、unknown/skipped、真实 HTTP 补证 | 当前单测通过；dev dist 缺新能力，暂不能整体验收 |
| 事实巡检 | src/fact | 指针/产物/进程/端口事实、新鲜度及漂移 | 历史首跑验收；当前 dist 有 FactModule，业务采集未重新触发 |
| 回滚与保留清理 | src/registry、src/apps、src/reconcile、src/remote | 可用回退点、版本恢复、受保护版本不删除 | 当前单测通过；隔离目标真实演练待验 |
| Console 前端 | apps/deploy-console | 页面资源、环境切换、审批操作及任务日志 | 缺失资源 404 已探测；登录与浏览器全链路未验 |

以上 src 均指 servers/deploy-console/src。代码存在不是部署证据；历史报告不是当前状态证据。

### 不在本轮强制范围

- deploy-runner 拉模式、签名任务信封、prod 入站 SSH 部署通道下线。
- 全面 Policy Engine、自动发布后回滚、告警驱动 Agent 自治。
- 尚未落地的完整强制 planId 提交语义、独立 MCP 工具扩展。
- 全量 legacy 表退役；现有 ReleaseRegistry 仍有双写及后端 legacy 指针语义，不能按旧任务表直接 DROP。

## 4. dev 验收用例矩阵

状态只认“本次通过 / 待验证 / 阻塞 / 不适用（说明原因）”。下表写的是运行态验收，单测已通过不能自动填成集成通过。

| ID | 场景与入口 | 验收判据 | 环境与副作用 | 当前状态 |
|---|---|---|---|---|
| V01 | 版本与配置基线 | 记录 Console 源码、构建产物、进程、目标模块和回退点；不能只记 git HEAD | dev，只读 | 阻塞：新验证能力未随 dist 就位；配置/模块基线待补 |
| V02 | 健康与匿名权限 | health 200；配置端点匿名 401；无 token 不获得配置 | dev，只读 | 本次通过 E06/E07，仅限已测端点 |
| V03 | Console 静态资源 | 不存在资源 404；真实 JS MIME 正确；页面无 chunk 加载失败 | dev，只读 | 缺失资源分项通过 E08，其余待验证 |
| V04 | 自举与保护配置 | 合法配置可启动；保护键不可覆盖；错误不泄密；能回退 | dev，配置/重启，先备份 | 待验证；复用历史报告设计，不直接复制结论 |
| V05 | 线上 DB 动作巡检 | 当前编排 kind、环境条件、变量、bash 语法及 SSH 边界通过 | dev，只读 DB | 待验证；本地 E03/E04 不覆盖 |
| V06 | release_plan | 返回提案与缺口；成功和失败分支均不写部署状态 | dev，只读业务动作 | 阻塞：dist 缺服务与路由 |
| V07 | 前端模块真实发布 | 从真实构建到目标 env/version 目录，指针、账本与 manifest 一致 | dev，受控写入 | 待验证；选定 portal 或 admin 及回退版本后执行 |
| V08 | 前端浏览器消费 | 入口、CSS、动态 chunk 可加载；关键页面无 pageerror | dev，只读页面 | 待验证；依赖 V07 |
| V09 | shell 发布 | 按实际 shell 专属契约检查 index.html/入口与基座可加载；不套用微前端目录规则 | dev，受控写入 | 待验证；先确定发布入口及恢复方法 |
| V10 | 后端真实发布 | 产物投递、依赖、实际 cwd、重启、端口及业务响应与目标版本一致 | dev，受控写入 | 待验证；选择可回退服务，禁止盲选 Console 自身 |
| V11 | verify_release | 传明确目标 versionTag/jobId，现采版本与产物，结果可信且不落巡检表 | dev，只读业务动作 | 阻塞：dist 缺服务与路由；依赖对应发布 |
| V12 | 独立 HTTP 验证 | 服务端口可用但业务错误时不能报整体验收成功；前端资源确实可消费 | dev，正常探测；异常仅隔离目标 | 待验证；verify_release 当前不覆盖 HTTP |
| V13 | 环境隔离 | dev 发布只改 dev 目标，prod 指针与版本不变；环境条件互斥 | dev 写入、prod 仅事前事后只读 | 待验证；prod 访问未建立时明确无法证明 |
| V14 | 构建失败 | 停在失败步骤，不上传、不切指针、不误写成功版本 | dev，隔离测试编排 | 待验证 |
| V15 | 缺产物/错误版本 | 明确拒绝，现有可用版本不改变 | dev，隔离测试目标 | 待验证 |
| V16 | 主机/配置缺失与投递失败 | 明确指出缺失项，不猜目标，不在本地误执行远端清理 | dev，隔离测试目标 | 待验证 |
| V17 | 运行凭据生命周期 | 正常 run 可调用；过期/跨 run/错误作用域拒绝；不泄露长期密钥 | dev，隔离 run | 待验证 |
| V18 | 审批与所有者 | 审批恢复正确 run；非所有者无权查改取消；拒绝后不继续执行 | dev，测试账号及 run | 待验证 |
| V19 | 同模块同环境并发 | 互斥行为符合现有契约，失败或取消后释放锁 | dev，隔离目标并发 run | 待验证 |
| V20 | 重复请求 | 不产生不受控重复发布；若接口未承诺幂等则记录缺口，不能假定支持 | dev，隔离目标 | 待验证 |
| V21 | 取消及恢复 | 停止后不继续投递/切指针；后续正常发布不受僵尸 run/锁阻塞 | dev，隔离目标 | 待验证 |
| V22 | 故障后版本回退 | 从已发布新版本切回明确旧版本；账本、产物、指针和实际响应一致 | dev，受控写入 | 待验证；前端/后端分别证明适用路径 |
| V23 | 保留清理 | 只清目标环境可清版本；当前及回退点保留；缺保护名单时不删 | dev，临时根/隔离版本 | 待验证；禁止在线真实根做破坏性探测 |
| V24 | 巡检与漂移 | 新鲜事实可区分 ok/drift/missing/unknown/error/skipped | dev，隔离漂移；触发采集会写快照 | 待验证；本轮未触发采集 |
| V25 | 审计与脱敏 | 提案、执行、审批、取消、回滚的操作者和 run 可追踪；日志不含凭据 | dev，关联上述操作 | 待验证 |
| V26 | 演练恢复 | 恢复测试配置、编排和版本；无遗留测试任务/锁/凭据 | dev，受控恢复 | 待验证；作为整体验收出口条件 |

## 5. 风险、缺口与下一步

| 编号 | 问题/缺口 | 处置 |
|---|---|---|
| G01 | dev 部署产物缺 release_plan / verify_release，源码单测通过不等于环境已上线 | 下一步先确认当前部署路径、备份与回退点，受控部署基线版本，再重启并复查路由/产物；未完成前不跑完整发布前后闭环 |
| G02 | 无当前线上编排及目标模块配置快照，源码/构建/进程版本未完全对齐 | 做脱敏只读盘点，线上动作快照只留私有位置；记录明确测试目标和版本 |
| G03 | 全 scripts 8 条 L6 warning | 涉及 check-cloud-db-consistency.sh、deploy-dev.sh、deploy.sh、dev-e2e-start.sh；未逐项审阅，不直接定为误报或阻塞；使用相关入口前核清危险命令上下文 |
| G04 | 验证工具不含真实 HTTP，缺证据时可能只给 unknown/degraded | 验收强制指定目标版本，另做 HTTP/浏览器检查；禁止用“当前指针验证当前指针”证明刚才发对了版本 |
| G05 | 旧说明混有已过时的启动开关、表结构与 synchronize 断言 | 以当前 db-synchronize 决策代码及实际配置为准；不要照旧 HANDOFF 开关重启或 DROP 表 |
| G06 | scripts/_test-p0.mjs / _test-p1.mjs 会对真实库 INSERT/DELETE，并断言历史固定行数 | 本轮未执行；不得作为无副作用巡检复用，先为隔离测试目标确认适用性 |
| G07 | prod 未核查、未演练 | 单列生产适用性检查；写操作须另行确认窗口；不宣称全环境验收完成 |

下一项执行顺序：G01 的部署前只读盘点与回退准备 → 对齐 dev 运行版本 → V01/V05/V06 → 三类真实发布及独立验证 → 失败/权限/并发/回滚演练 → 报告与环境恢复。若发布入口本身未证实安全，不为验证发布入口直接重发 Console。

## 6. 可复跑的本地命令

以下从仓库根执行，不连接生产或改数据库：

```sh
(cd servers/deploy-console && ../../node_modules/.bin/jest --runInBand)
(cd servers/deploy-console && ../../node_modules/.bin/tsc --noEmit)
node scripts/pipeline-lint.mjs --scripts scripts/pipeline --json
node scripts/pipeline-lint.mjs --scripts scripts --json
```

测试可能创建临时本地资源；bootstrap 测试含本机拒绝连接反例，不应解读为完全无网络 I/O。真实环境命令不在公开文档中写入主机、账号或凭据。
