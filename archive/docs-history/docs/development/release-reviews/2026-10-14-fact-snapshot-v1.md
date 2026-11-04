# 发布/数据 + 新增接口评审：环境事实巡检 v1（fact_snapshots）

> 评审对象：`servers/deploy-console` 新增「事实层采集」——定时把**线上真实态**采回来，与**期望态**比对出漂移。
> 对应设计：《console 建设方案》P0-6（环境事实巡检 v1）、《平台边界与配置中心设计》§3.8（Fact 层与配置中心联动）。
> 触发门：**数据门**（新增实体/表）+ **新增对外接口门**（新增 `fact.controller.ts`）。
> 基线：`origin/master @ 52ee198c`。

```
阻塞: 0
重要: 2
```

---

## 0. 设计概述

### 0.1 要解决的问题

今天"线上到底是什么"没有任何机制主动回答。三个已发生的事故是同一类：

| 事故 | 期望（DB/文档说） | 实际（线上） | 为什么没人发现 |
|---|---|---|---|
| prod 双树 | `/data/web_system` 是发布树 | pm2 跑的是 `/data/web_system_git` | 没有采集，只能 SSH 人工看 |
| 静态根落点 | 指针写到 console 本机静态根 | prod 读的是外置根 | 落点是环境属性，没人核对 |
| 0013 迁移 | 迁移已执行 | 实际空跑 | 迁移表 ≠ 真实 schema |

**补文档解决不了**（文档会再漂移），只有采集 + 比对能解决。

### 0.2 v1 范围（明确不做）

| 做 | 不做（理由） |
|---|---|
| 4 类事实：`version` / `dir` / `process` / `port` | 配置 hash（v1.1：目标机服务目录映射尚无真相源，不猜路径） |
| 落 `deploy_fact_snapshots` + 漂移比对 | UI 面板（与 P1-11 DORA 面板一起做） |
| 定时采集 + 手动触发 API | 自动修复（设计约定：采集只读、漂移只告警） |
| 漂移打 ERROR 日志 | 接入通知通道（v1.1，先避免刷屏） |

### 0.3 采集通道（复用既有真相源，不新增第二套）

| 通道 | 判据 | 实现 |
|---|---|---|
| **本机** | `resolveStaticTarget().sshTarget === null` | 直接 `node:fs` 读（dev 静态根就在 console 机） |
| **远端** | 需要 SSH | `SshExecService.run(env, cmd)` —— 目标机解析的**唯一入口**（主机管理 → 服务器管理 → 报错） |

静态根走既有 `apps/static-target.ts` 的 `resolveStaticTarget()` / `envArtifactsRel()`，
**不重新推导路径**（诊断 #15：路径推导已经收敛过一次，不能再发散出第四份）。

### 0.4 只读约束（这是本改动最大的风险面）

事实采集要往**目标机**执行命令，而 prod 上「console 直连 SSH」是已知债。因此：

1. **命令白名单**：只允许 `cat` / `ls` / `md5sum` / `stat` / `test` / `readlink` / `pm2 jlist` / `ss -ltn` 开头；
2. **危险字符拒绝**：出现 `;` `&&` `||` 反引号 `$()` `>` `<` `rm` `mv` `chmod` `kill` 一律抛错（纯函数 + 单测锁）；
3. **管道只允许 `| wc -l`**；
4. **`pm2 jlist` 只取 5 个字段**（name / pid / status / cwd / restarts），**不落 `pm2_env` 的变量** —— 那里面可能有 DB 密码，落库 = 密钥入库事故；
5. 输出统一过 `redactSecrets()`（诊断 #8 既有实现）。

> 反例：`pm2 jlist` 全量落库 → 实际把 `MYSQL_PASSWORD` 写进 `deploy_fact_snapshots.detail`
> → 期望：只存 5 个安全字段。**判据 code-C1（日志/响应泄露敏感值）｜严重级：阻塞** → 本设计已规避。

### 0.5 表结构 `deploy_fact_snapshots`

一行 = 一个「事实」（不是一行一次采集，便于按对象下钻与保留历史）：

| 列 | 说明 |
|---|---|
| `batch_id` | 一次采集批次（uuid），同批次可一起看 |
| `env_id` / `kind` / `target_key` | 环境 / 事实类型 / 对象（模块 key 或服务 key） |
| `host` | 实际采集的主机（本机写 `local`） |
| `expected` / `actual` | 期望态 vs 真实态（都是字符串，便于直接对账） |
| `status` | `ok` / `drift` / `missing` / `unknown` / `error` / `skipped`（`skipped` 含"对**这个对象**不适用"之意，见 §验收-0 的 `shell` 案例） |
| `detail` | JSON，只放**已脱敏的安全字段**（进程状态、文件数等） |
| `collected_at` | 采集时间 |

索引：`(env_id, kind, target_key)`、`(batch_id)`、`(env_id, status)`。

### 0.6 开关（全部可回落，默认不打扰）

| 键 | 默认 | 说明 |
|---|---|---|
| `FACT_SNAPSHOT_ENABLED` | `true` | 总开关 |
| `FACT_SNAPSHOT_INTERVAL_MS` | 6h | `0` = 关闭定时（仍可手动触发） |
| `FACT_SNAPSHOT_ENVS` | `dev` | 逗号分隔；**prod 需显式加入**（首个版本先 dev 跑通） |
| `FACT_SNAPSHOT_FIRST_DELAY_MS` | 60s | 启动后首次延迟 |

### 0.7 API（3 读 1 触发）

| 接口 | 用途 |
|---|---|
| `GET /api/fact/snapshots?env&kind&limit` | 最近快照（默认最近一批） |
| `GET /api/fact/drift?env` | 漂移清单（最近一批 status=drift/missing/error） |
| `POST /api/fact/collect` | 手动触发一次采集（带并发保护） |

---

## A. 运行面（release）

| # | 判据 | 结论 | 依据 |
|---|---|---|---|
| A1 | 构建发生在发布目录 | ✅ 不涉及 | console 自身不走流水线，**走独立手工发布**（E1）：构建 → scp dist → `pm2 restart` |
| A2 | 发布目录 git HEAD 一致 | ✅ 不涉及 | 同上 |
| A3 | workspace 包走完整 build | ✅ | 本改动只在 `servers/deploy-console`，不碰 `packages/*`；仍按 `npm run build` 出 dist |
| A4 | 端口占用者 == pm2 进程 | ✅ 不涉及 | 不改端口、不新增进程 |
| A5 | 服务已在 ecosystem 登记 | ✅ 不涉及 | 复用既有 `deploy-console` 进程（6200） |

## B. 配置面（release）

| # | 判据 | 结论 | 依据 |
|---|---|---|---|
| B1 | 不用 `pm2 restart --update-env` | ✅ | 部署手法固定为 `pm2 restart deploy-console`（ubuntu 身份） |
| B2 | 跨服务密钥一致 | ✅ 不涉及 | 不新增密钥 |
| B3 | 关键依赖配置非缺失 | ✅ | 4 个新开关**全部有默认值**，缺失 = 默认行为（enabled / 6h / dev / 60s） |
| B4 | 占位符密钥未被误判有效 | ✅ 不涉及 | 无密钥 |
| B5 | `.env` 是唯一配置源 | ✅ | 新键走 `ConfigService`，同步写入 `.env.example` |

> 反例：新增开关**无默认值**且代码按「取不到就跳过采集」处理 → 实际静默不采、没人知道。
> 期望：取不到 = 用默认值并打一条启动日志。**判据 B3｜严重级：重要（已按此实现）**

## C. 数据面（release）— 本次主风险面

| # | 判据 | 结论 | 依据 |
|---|---|---|---|
| C1 | 迁移文件声明目标库 | ✅ 不涉及 | **不写迁移文件**：console 本机库由 `resolveSynchronize()` 自动建表（dev 回环库默认开），远端/生产库自动拒绝（诊断 #19 既有决策器） |
| C2 | 迁移幂等 | ✅ | 实体建表由 TypeORM synchronize 处理，幂等 |
| C3 | 迁移在应用流程覆盖范围内 | ✅ | 同上，不新增 `.sql`/`.mjs` 迁移，不受 `apply-migrations.sh` 扫描范围影响 |
| C4 | 按环境执行 | ✅ 不涉及 | 只有 dev 的 console 进程会建表 |
| C5 | DB 绑定晚于代码同步 | ✅ | 先发代码（新表随启动建），再开开关采集；**先关开关=零影响** |
| C6 | 破坏性变更有回滚路径 | ✅ | 只**新增**一张表，不改既有表结构。回滚 = `FACT_SNAPSHOT_ENABLED=false` + 可选 DROP 新表（无其他表依赖它） |

> 反例（若走另一条路）：为"规范"手写 `migrations/00xx-fact.sql` → 实际 console 从没跑过迁移目录，
> 表建不出来、采集每轮 error，而**日志只说"采集失败"看不出是表不存在**。
> 期望：跟随既有 synchronize 决策。**判据 C1/C3｜严重级：重要（已按此实现）**

## D. 前端面（release）

| # | 判据 | 结论 |
|---|---|---|
| D1–D4 | 微前端三步 / 版本表 / 缓存 / cdn 产物 | ✅ 全部不涉及（不改前端、不切版本、不动 cdn） |

## E. 特殊通道（release）

| # | 判据 | 结论 | 依据 |
|---|---|---|---|
| E1 | console 自身不走流水线 | ✅ | 手工 dist 替换 + `pm2 restart` |
| E2 | 后端发布确实重启 | ✅ 不涉及 | 本次只发 console 自身 |
| E3 | 变更后有验证动作 | ✅ | 验收：重启后 `/health` 200；`POST /api/fact/collect` 手动跑一次，落表行数 > 0 且 dev 三条（portal/admin/shell）能给出 ok/drift 结论 |
| E4 | PR 挂自动合入（merge commit） | ✅ | 提交后 `gh pr merge --auto --merge`，挂上后转做别的、收尾再对账 |

## 新增接口门（code）

| # | 判据 | 结论 | 依据 |
|---|---|---|---|
| A1 | 入参有校验 | ✅ | `env` / `kind` 走 DTO + class-validator；`limit` 数字范围约束 |
| A2 | 鉴权齐 | ✅ | 与既有 `monitor` controller 一致：`@ApiBearerAuth()` + 既有权限装饰器，不新造 |
| A3 | 数据归属校验（越权） | ✅ | 接口**不按用户取数据**：查的是环境级事实，无"他人资源"概念；唯一写操作 `collect` 是运维动作、走审计 |
| A4 | 新接口已登记契约 | ⚠️ 见「重要 #2」 | 属**内部运维面**接口（与 `monitor` 同类），同族接口既有做法未单独登记 api-design；按 F1 一致性沿用，不另开契约面 |
| B1 | 不吞异常 | ✅ | 采集失败落 `status='error'` + `detail.reason`，**不静默**；service 层 catch 明确降级为 error 行 |
| B2 | 错误码有语义 | ✅ | 环境未登记 → 400；并发采集 → 409；其余走既有异常过滤器 |
| B3 | 失败路径有测试 | ✅ | 命令被拒 / SSH 超时 / 期望态缺失 三条反例均有单测 |
| C1 | 日志不打敏感字段 | ✅ | 见 §0.4-4/5：`pm2 jlist` 只取 5 字段 + `redactSecrets()` |
| C2 | 外部输入不进 SQL 拼接 | ✅ | 全部走 TypeORM repository，无裸 SQL |
| C3 | 内部接口有内部鉴权 | ✅ 不涉及 | 3 个接口都走常规 JWT + 权限码，不是内部裸接口 |
| D1 | 关键写操作有日志/审计 | ✅ | `POST /api/fact/collect` 属运维动作 → 写审计（对齐 `monitor` 的重启审计做法） |
| D2 | 外部调用失败有可定位信息 | ✅ | detail 里带命令 tag、主机、失败原因片段 |
| E1 | 多步写在事务内 | ✅ 不涉及 | 采集是**批量 insert**，非业务多步写；用 `save(rows)` 一次落，失败整批记 error |
| E2 | 可重入性 | ✅ | 定时与手动共用同一 `collect()`；同 env **in-flight 保护**，重复触发返回 409 而非并发采两轮 |
| E3 | 定时器有释放路径 | ✅ | `OnModuleDestroy` 清 `setInterval`/`setTimeout` + `unref()`（照 `ConsistencyWatchService` 既有模式） |
| F1 | 命名分层与既有一致 | ✅ | 新目录 `src/fact/`，实体放 `src/entities/`，与 `reconcile/`、`monitor/` 同构 |
| F2 | 未引入第二套做法 | ✅ | 定时复用 `ConsistencyWatchService` 模式（不引 `@nestjs/schedule`，其注释已说明为何）；SSH 复用 `SshExecService`；静态根复用 `static-target.ts` |
| F3 | 无跨层调用 | ✅ | controller → service → repository，controller 不直连 repo |

---

## 验收记录（dev，2026-10-14）

### 部署与首跑

- 构建 → scp dist → `pm2 restart deploy-console`（ubuntu 身份）→ `/health` 200
- `deploy_fact_snapshots` 由 synchronize 自动建立（与 **C1 判据**一致，未写迁移文件是对的）
- 启动后 60s 首定时自动跑完一轮，**30 项**：

| kind | 结果 |
|---|---|
| `dir` | 3 ok（portal 37 / admin 36 / shell 4 条目） |
| `version` | 2 ok（portal `f77577ef`、admin `e2a2866c` 与平台登记一致）+ 1 `skipped`（shell） |
| `process` | 12 ok（与 `deploy_service_envs` 的 12 个 active 服务逐一对齐） |
| `port` | 12 ok（6000/6001/6002/6003/6004/6005/6006/6007/6008/6010/6011/6200 均在监听） |

> dev 的 `deploy_service_envs.pm2_name` **全为空**，采集按 `service_key` 回落匹配成功。
> 若某环境两者命名不一致，会以 `missing` 立即暴露 —— 这正是想要的行为：
> 不是去改注册表迎合实现，而是**让不一致变得可见**。

### 首跑就抓到的口径问题（已修）

首版把 `cat index.js` 失败一律记 `error`，于是 dev 上 `shell` 报：

```
ERROR [FactCollectService] 事实巡检发现 1 项需关注（env=dev，host=local）：
version[shell] error: 期望=a82270f9 实际=-
```

人工核实后的**真相**：

- `static/modules/shell/dev/index.js` 确实不存在（portal / admin 都有）；
- 但 `shell/dev/a82270f9/` 里有 `index.html + assets + version.json`，共 4 个条目；
- 即 shell 是 **index.html 入口型产物**，压根不走 SystemJS 版本指针 —— 平台从未也无需为它写 `index.js`。

**这不是漂移。** 若按"缺指针"长期告警，就是一条**永久假告警**：
告警清单里躺一条永远不变的红，运维会被训练成"忽略它"，真漂移也随之失效。

修法：**不放松判据**，而是把「指针是否适用」本身采成一个事实。

| `cat index.js` 结果 | 判定 | 理由 |
|---|---|---|
| 成功 | `ok` / `drift` | 正常比对 |
| ENOENT + 版本目录里有 `index.html` | `skipped` | 入口型产物，不适用指针校验；目录完整性由 `dir` 事实覆盖 |
| ENOENT + 无 `index.html` | `missing` | 真的缺指针 |
| ENOENT + 形态探测自身失败 | `missing`（保守） | 不能确认它没缺，就不该说它没问题 |
| 非 ENOENT（超时 / 权限 / 命令被拒） | `error` | 采集机制故障，不放行成业务结论 |

复验：`skipped` 落库后，本轮日志由 ERROR 变为 **`事实巡检通过（env=dev，30 项一致）`**
—— 假告警消失，真信号完好。新增 4 条单测锁住上述分支。

---

## 重要项（不阻塞，需记入后续）

1. **重要 #1（C1/C3）**：本改动依赖 `synchronize` 建表。若将来把 console 迁到版本化 migration（P2-15），
   `deploy_fact_snapshots` 必须**第一个补基线迁移**，否则新环境（无 dev 库历史）启动即采不动。
   触发条件明确、无当前风险 → 不阻塞。
2. **重要 #2（code-A4）**：3 个 fact 接口未单独登记 `specs/<svc>/api-design.md`。
   同族运维接口（`monitor`、`reconcile`）既有做法一致 → 按 F1 一致性沿用；若契约面后续收紧运维接口，需补登记。

## 建议（无判据，属个人偏好）

- 采集结果可考虑按 `batch_id` 保留 N 批、定期清理（现无清理，表会稳定增长）。
- prod 接入建议与 S3 runner 拉模式一起评估：runner 在目标机本地采集，可彻底不需要 SSH 只读通道。
