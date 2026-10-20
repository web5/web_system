# Console 生产真实回滚与恢复演练

## 结论与授权

2026-10-20 用户明确批准 Todo/prod 维护窗口：切回真实检查点，再恢复原在运行版本，仅重启 Todo 两次，其他服务不动。演练于北京时间 14:39:00 开始，14:39:54 完成最终核验，结果为 `production-rollback-and-restore-verified`。这是操作与核验窗口，不是测得的业务中断时长。

Console 已部署合入提交 `c325ef979f1318784b2b801246853a89b232a80e`；此前完整104套测试、1269项断言及后端构建通过。本次没有升级业务代码、重新构建生产产物或执行数据库迁移。

## 执行入口与边界

服务管理页面不提供后端模块回滚按钮，现有服务端配置中也没有可用的 Console 管理员登录凭据。因此通过已授权、严格校验 known_hosts 的 SSH 运维连接，加载已部署的 `DeployModule` 及真实数据库依赖，调用 `DeployController.rollbackVersion`。两次均明确指定 `env=prod`、`moduleKey=todo-service`、完整 `to` 及 `confirm=true`。

该调用沿用真实 `rollbackUnified → rollbackVersion → applyBackendRemote → ReleaseRegistryService.setPointer` 链路、真实发布锁、真实生产激活/探活和真实云库镜像。操作人如实记录为 `maintenance:ssh-ubuntu:prod-rehearsal`，没有冒充 admin、签发令牌、修改认证配置或提取浏览器凭据。临时运维容器未执行应用初始化钩子，数据库连接明确关闭 synchronize、migrationsRun 和 dropSchema。

这次生产切换证明的是真实回滚、恢复、服务层及持久化结果；切换当时未测试 HTTP `/api/deploy/rollback-version` 的鉴权/传输层或 UI 后端回滚按钮，随后已补下述安全 HTTP 验证。没有调用废弃的整站 rollback.sh，也没有新建/复用流水线审批。该同步控制器入口不生成 deploy_tasks，标准审计如实保留两次操作，不伪造任务或审批记录。

## 两次实际切换

| 阶段 | 真实版本 | Todo PID | 完整载荷文件数 | 核验 |
| --- | --- | --- | --- | --- |
| 演练前 | `todo-service-dev/6a710686` | 2917160 | 20739 | 健康200、两库一致 |
| 回滚检查点 | `runtime-checkpoint/todo-prod-1792396360725` | 2963598 | 20675 | 实际隔离目录、完整摘要、端口归属、进程稳定、健康200、两库一致 |
| 恢复原版本 | `todo-service-dev/6a710686` | 2964670 | 20739 | 实际隔离目录、完整摘要、端口归属、进程稳定、健康200、两库一致 |

检查点载荷 SHA-256：`915929c9fb94b34432488d14f43e25e40acc749c665424d2719bc0338046b722`；Git 来源为空，未推定或补写提交。

恢复版本载荷 SHA-256：`e80955d81b6d8229d8cc52a2686b1dea3f58ebfafc50d85e2eb7756475741847`；产物 manifest 核验 Git 提交为 `6a7106863d1d18a041752cb8ae86d9239a4a2e2c`。没有改写历史版本表中的 Git 字段。

回滚审计 ID：`edf883cc-7548-45ec-b4a2-467f22e0cde8`；恢复审计 ID：`af7e100c-1d40-4585-bf9e-252284fe7e0f`，均为 `deploy.rollback-version / success`。两步各自独立读回控制台库与云库 `deploy_deployments`，不是凭审计 success 判定成功。

## 保护项与最终状态

- 生产10个服务的 `/health` 在预检、检查点、恢复后均返回200；除 Todo 外9个生产进程 PID 保持不变，dev全部进程含Console PID亦未变化。
- Todo 最终实际 `dist` 指向 `/root/web_system_runtimes/todo-service/todo-service-dev/6a710686/dist`，生产配置文件/有效配置指纹与演练前一致。未复制凭据文件，未改写环境文件。
- 最终控制台库与云库当前引用均为 `todo-service-dev/6a710686`。其他模块/环境指针、前端应用指针及版本登记记录与演练前一致。
- 发布阀门 `PROD_RUNTIME_ROLLOUT_RUN_ID` 始终为 `closed`；无活动流水线、活动部署任务或未过期残留锁。
- 所有既有流水线与审批状态保持不变，包括历史待审批单 `1790749237193-nn2w34p` / `1790749249606-mncs8f1`、已失败单 `1792410766024-cp7liak`、成功发布单 `1792411988185-xbs5fou` 及其审批。
- 既有 legacy 镜像失败可能只告警的策略没有改变；本轮两次实际读回一致不等于实现了分布式事务，也未进行镜像故障注入。

恢复后追加观察：北京时间14:40:26再次验证完整生产载荷、PID 2964670稳定及10服务健康200；14:41:08再次读回指针、历史记录、配置指纹、dev进程与closed闸门，均与完成时一致，无活动任务或残留锁。证据为 `observation-runtime.json` 和 `observation-state.json`。

## HTTP 鉴权补验与关闭

用户要求不复杂的鉴权入口验证一并补齐。新增 `servers/deploy-console/src/deploy/rollback-auth.http.spec.ts`，启动真实 Nest HTTP 服务，导入真实 `AuthModule`、Passport JWT 策略与其注册的全局守卫，使用真实全局前缀、验证管道、异常过滤器和 `DeployController`，没有替换或绕过鉴权守卫。只有回滚执行依赖和审计写入依赖被隔离，避免再次操作生产或写入真实业务数据。测试使用进程内随机测试密钥，并显式忽略环境变量和.env，不读取或使用线上JWT密钥。

19项 HTTP 用例通过：缺失/畸形/错误签名/过期令牌、refresh令牌和缺少用户名均401；四类非deploy系统声明均403，body伪造系统归属不能提权；prod缺失/false/字符串确认和缺失环境/模块均400且不触发执行或成功审计；合法prod/dev身份和兼容type缺省场景通过，执行及审计操作人只来自认证身份；执行异常保留500且不记录成功审计。

北京时间15:08:18，另在dev机以**实际已部署的编译类**启动仅监听127.0.0.1随机端口的隔离HTTP服务，重复上述19项，全部通过。此隔离服务无数据库连接，结束后已关闭；不重启现网Console，也不写配置。对真正运行的Console端口6200再发4项负向请求：缺失Bearer、畸形令牌、隔离测试密钥签名令牌、过期测试令牌，全部返回401；请求均带 `confirm=false`，即使鉴权退化也不能触发prod回滚。现网过期测试令牌同时有错误签名，不能据此宣称单独验证了现网有效签名的过期分支；该分支由隔离用例独立验证。

15:09:05，独立读回控制台/云库指针、历史发布及审批、部署任务、锁、closed闸门、Console配置指纹和全部dev进程，与演练后基线一致。没有生产再次切换、数据库业务写入或持久凭据生成。完整回归为105 suites / 1288 tests通过，Nest后端构建通过；本补充仅测试和文档，无需重新部署。

补验的明确边界：没有获取真实用户令牌或用它在现网写端点执行第三次生产切换；**真实用户有效JWT经现网回滚写端点完成生产回滚仍未验证**。此边界不与“真实生产服务层回滚已完成”和“真实HTTP鉴权隔离用例已通过”混为同一证据。当前已有真实登录UI验收、隔离HTTP正反向鉴权、现网HTTP拒绝无效凭据和生产服务层实际回滚证据；按用户要求，本轮约定范围先关闭，不为补验扩展认证或重新打开生产维护窗口。

HTTP测试证据为 `http-auth-jest.json`、`http-auth-deployed.json`、`http-auth-final-state.json`、`closeout-all-jest.json` 和 `closeout-build.log`，都在下述私有目录。可复跑代码库测试：`pnpm --dir servers/deploy-console exec jest --config jest.config.js --runInBand src/deploy/rollback-auth.http.spec.ts`。该命令仅运行隔离HTTP测试，不连接现网或读取生产凭据。

## 私有证据

完整本机证据目录：`/tmp/web-system-console-rehearsal-20261020/`。核心文件为 `acceptance.json`、`pre-action-state.json`、`baseline-runtime.json`、`rollback-action.json`、`checkpoint-runtime.json`、`checkpoint-state.json`、`restore-action.json`、`final-runtime.json`、`final-state.json`。JSON 为实际只读结果与标准控制器返回值，不包含登录令牌或环境密钥；操作记录保留在数据库标准审计中。

本记录为演练后的文档变更，不属于此前已部署的 Console 源码提交。
