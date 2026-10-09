# deploy-console 按环境分流数据源（prod 写云数据库）

> 状态：**设计待审**，未实施
> 起草：2026-10-08
> 触发事故：2026-09-30 起 dev/prod 基座资源 404 与长期回落，根因之一是「平台写 dev 本机库 / prod gateway 读云数据库」的数据源分裂，靠人工同步指针

---

## 1. 背景与根因

### 1.1 现象

`deploy_app_env_versions` 的版本指针存在两份，且**只有一份会被自动更新**：

| 库 | 位置 | 谁写 | 谁读 |
|---|---|---|---|
| dev 本机 MySQL | `127.0.0.1:3306` / `web_system_deploy` | deploy-console（自动） | dev gateway（内网） |
| 云 MySQL | `172.16.16.10:3306` / `web_system_deploy` | **人工**（2026-10-08 事故中手工补了 3 行） | prod gateway（内网） |

后果：prod 发布后指针不生效，prod gateway 读不到新版本 → 回落旧基座或 404。

### 1.2 网络根因（已实测，推翻「安全组」猜测）

| 机器 | 实例 | 地域 | 内网 IP | VPC |
|---|---|---|---|---|
| dev（console 所在） | `ins-bndv9buo` | **ap-nanjing-3** | 10.206.16.5 | `vpc-ljskd1kp` |
| prod | `ins-0vx0sxl2` | ap-guangzhou-4 | 172.16.16.2 | `vpc-hiltvaat` |
| gateway 机 | `ins-b3k2pze0` | ap-guangzhou | 172.16.16.15 | `vpc-hiltvaat` |
| 云数据库 | — | ap-guangzhou | 172.16.16.10 | `vpc-hiltvaat` |

- `dev → 172.16.16.10:3306` **BLOCKED**（跨地域 + 跨 VPC，安全组规则在跨 VPC 场景不生效）
- `prod → 172.16.16.10:3306` ✅（同 VPC 内网）
- 结论：必须走**公网**。dev 侧延迟可接受（南京→广州约 30–40ms），且只有发布写入会用到，不在请求热路径。

### 1.3 公网地址现状

`~/env_config/servers.env` 记录了历史公网地址：

```
MYSQL_PUBLIC_CONNECT=gz-mysql-r9dgnvlv.sql.tencentcdb.com:29292
```

但该域名**当前解析失败**（dev 机、prod 机、本地 Mac 均失败；dev 机 DNS 本身正常，可解析 `cloud.tencent.com`）。
判断：云数据库公网曾开启、现已关闭（关闭后域名即失效）。

**✅ 2026-10-08 已重开公网**（用户控制台操作，实例 `cdb-8y2lp8rt` / cdb347197）：

```
外网地址：gz-cdb-8y2lp8rt.sql.tencentcdb.com
外网端口：27241
白名单：175.27.189.123（dev 机公网 IP）已放行，状态正常
```

实测验证（2026-10-08）：
- TCP 27241 通；mysql 握手 + 查询 0.177s
- mysql2 连接池（connectionLimit 3，预热后）单查询稳定 **36ms**，发布写入场景完全够用
- 云库当前指针：shell@prod=b94924b3、portal/admin@prod=6e7b2690、shell@dev=8c62dd3 等 8 行（10-08 手工同步的基线）

### 1.4 AI 侧权限边界

本地有腾讯云 API 凭证（`~/env_config/tencent.env`），但 CAM 未授权：
`cdb:DescribeDBInstances`、`cvm:DescribeInstances` 均返回 `UnauthorizedOperation`。
➡️ 网络侧（开公网 / 安全组）**只能由人在控制台完成**，脚本无法代劳。

---

## 2. 目标架构

```
                 deploy-console（dev 机 · 南京 · 主现网）
                        │
        ┌───────────────┴────────────────┐
        │ dev / local                    │ prod
        ▼ 内网                            ▼ 公网 3306
  dev 本机 MySQL                    云 MySQL（广州 vpc-hiltvaat）
   127.0.0.1                         <公网域名>:<端口>
        │                                 │
   dev gateway（内网读）             prod gateway（内网读）
```

- **console 单一实例**仍在 dev 机，不引入第二套 console（避免配置两份、进一步漂移）
- dev/local 数据 → 本地库（内网，快）
- prod 数据 → 云库（公网，慢但只在发布时写）
- 两端 gateway 各自内网读，不受影响

---

## 3. 数据源模型

### 3.1 双连接

| 连接名 | 指向 | synchronize | 用途 |
|---|---|---|---|
| `default`（现有） | 本地库 `MYSQL_*` | `true`（现状，不动） | 平台全部读写主库 |
| `cloud_prod`（新增） | 云库 `DEPLOY_CLOUD_DB_*` | **必须 `false`** | 仅 prod 数据镜像写 |

⚠️ **`synchronize` 必须显式关**：console 主连接开了 `synchronize: true`（`app.module.ts:54`）。若云库连接沿用该行为，Nest 启动时会拿本地实体去 **DDL 变更云库表结构**，属于不可控变更。

### 3.2 实现方式：独立镜像写，不改现有注入

现有 39 个实体、大量 `@InjectRepository`（默认连接）。若全局改双连接，侵入面过大。

采用**追加式镜像写**：

1. 新增 `CloudDbModule`：用 `typeorm` 直接建一个 `DataSource`（非 Nest TypeORM 模块），`synchronize: false`，懒连接、失败可降级
2. 新增 `EnvSplitWriter` 服务：暴露 `mirrorPointer(env, payload)` / `mirrorConfig(table, rows)`
3. 在**既有写入成功后**追加一次镜像调用，不改动原有写入路径
4. 用原生 SQL `INSERT ... ON DUPLICATE KEY UPDATE` 做 upsert，避免两套实体注册与元数据冲突

好处：现有代码路径零改动、可灰度、可一键关闭。

---

## 4. 分流规则（双写范围）

**依据：gateway 实际会读的表**（`servers/gateway/src` 内表名引用统计）。gateway 不读的表一律不镜像。

| 类别 | 表 | 本地库 | 云库 |
|---|---|---|---|
| **版本指针（按 env 分流）** | `deploy_app_env_versions` | dev / local 写 | **prod 写** |
| legacy 指针（应急开关 `DEPLOY_LEGACY_READ` 仍会读） | `deploy_deployments` | 全量写 | prod 也写 |
| **模块元数据（镜像双写）** | `deploy_modules` | 主写 | 镜像 |
| | `deploy_apps` | 主写 | 镜像 |
| | `deploy_sites` | 主写 | 镜像 |
| | `deploy_hosts` | 主写 | 镜像 |
| | `deploy_envs` | 主写 | 镜像 |
| | `deploy_endpoints` | 主写 | 镜像 |
| | `deploy_services` | 主写 | 镜像 |
| | `deploy_service_envs` | 主写 | 镜像 |
| | `deploy_service_routes` | 主写 | 镜像 |
| | `deploy_canary_rules` | 主写 | 镜像 |
| **不镜像**（gateway 不读，仅平台内部） | `deploy_pipelines` / `deploy_pipeline_*` / `deploy_module_stage_commands` / `deploy_tasks` / `deploy_versions` / `deploy_release_events` / `deploy_approvals` / `deploy_release_locks` / `audit_logs` / `config_items` / `config_snapshots` / `notification_logs` / `system_settings` | 只本地 | — |

> 说明：流水线模板、动作脚本、流水线变量**不在双写范围**——gateway 不读它们。此前观察到的「云库 vars 94 vs 本地 119」漂移**不影响 prod 运行**，无需处理。

---

## 5. 改造点清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `servers/deploy-console/.env` | 新增 `DEPLOY_CLOUD_DB_HOST/PORT/USER/PASSWORD/NAME`（公网域名:端口） |
| 2 | `src/cloud-db/cloud-db.module.ts`（新增） | 建独立 `DataSource`，`synchronize:false`，`connectTimeout` 调大（公网握手慢） |
| 3 | `src/cloud-db/env-split-writer.service.ts`（新增） | 镜像写：`mirrorPointer()` + `mirrorRows(table, rows)`，原生 SQL upsert |
| 4 | `src/registry/release-registry.service.ts` | `setPointer` / `syncAppEnvPointer` 成功后调用镜像；**改失败语义**（见 §6） |
| 5 | `src/deploy/deploy.service.ts` | 双写处（`:102`、`:960` 附近）接入同一镜像逻辑 |
| 6 | `src/module-registry/module-registry.service.ts` | modules / apps 保存后镜像 |
| 7 | `src/server/server.service.ts`、`src/envs/envs.service.ts`、`src/target/*`、`src/canary/canary.service.ts` | 对应表保存后镜像（按 §4 清单） |
| 8 | `src/app.module.ts` | 引入 `CloudDbModule` |
| 9 | `scripts/`（新增或并入 pipeline-lint） | 一致性检查：比对本地库与云库 prod 指针是否一致 |

配置项（全部可关）：

```env
DEPLOY_CLOUD_DB_ENABLED=true      # 总开关，false 即回到人工同步现状
DEPLOY_CLOUD_DB_STRICT=true       # prod 写失败是否让任务失败（默认 true，见 §6）
```

---

## 6. 失败语义（P0，必须改）

现状 `syncAppEnvPointer`（`release-registry.service.ts`）的注释明确写着：

> **失败只告警不抛出**：写失败不该让整条流水线红掉

在单库时代这是合理的止损；**分流后这个语义是事故放大器**——本地库写成功、云库写失败 → 流水线显示成功、prod 实际没切换，与本次事故形态完全一致。

改为：

| 场景 | 行为 |
|---|---|
| env = prod，云库写失败 | **抛出** → 任务置 `failed`，UI 明确提示「prod 指针未生效，prod 仍运行旧版本」 |
| env = dev / local | 不涉及云库，行为不变 |
| 镜像写（配置表）失败 | 告警 + 计入审计，不阻断（配置漂移不直接影响线上运行） |
| **legacy `deploy_deployments` 写失败** | 告警 + 不阻断（gateway 默认不读它，只在 `DEPLOY_LEGACY_READ=1` 应急时才读；让它成为发布阻塞项只会制造噪音） |
| `DEPLOY_CLOUD_DB_STRICT=false` | 回退到告警语义（仅应急，不推荐长期开启） |

⚠️ **实现补充（2026-10-08 实测）**：异常必须用 `HttpException`（`ServiceUnavailableException`）而非裸 `Error`。
全局异常过滤器会把非 `HttpException` 的消息统一替换成「服务器内部错误」，
运维将看不到「prod 没切」这个关键事实，与设计意图相悖。

---

## 7. 迁移步骤

| 阶段 | 动作 | 依赖 |
|---|---|---|
| M0 | ~~控制台开启云数据库公网，记录域名:端口；白名单放行 `175.27.189.123/32`~~ **✅ 完成（2026-10-08）**：`gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`，白名单已放行。遗留：**建议给 dev 机绑 EIP**（普通公网 IP 变配/重建后会失效） | 人工 |
| M1 | ~~dev 机验证连通~~ **✅ 完成（2026-10-08）**：TCP 通、mysql 握手 0.177s、池化查询稳定 36ms | M0 |
| M2 | 落 §5 的 #1–#5（指针分流是核心价值，先上） | M1 | **✅ 完成（2026-10-08）**，见 §12 实施记录 |
| M3 | ~~基线同步~~ **✅ 完成（2026-10-08）**：实测 §4 的 **10 张配置表两库已完全一致**（逐行内容 diff = 0，无需灌入）；仅 legacy `deploy_deployments` 落后（云库 7 行旧口径 / 本地 23 行），已备份后从本地 REPLACE 补齐，prod 行校验一致。详见 §13 | M1 |
| M4 | ~~配置镜像双写~~ **✅ 完成（2026-10-08）**：30 个写入点接入 `mirrorRow` / `deleteMirror`，含唯一键选型与 Module 接线修复，见 §14 | M2 |
| M5 | ~~两库一致性检查~~ **✅ 完成（2026-10-08）**：`scripts/check-cloud-db-consistency.sh`，正反验证通过；**不做 CI 门禁**（runner 不在白名单），属运维巡检 | M4 |

---

## 8. 验证方案

| 用例 | 操作 | 期望 |
|---|---|---|
| 正向 dev | 跑一次 dev 发布 | 本地库指针更新；云库 prod 行不变；页面资源 200 |
| 正向 prod | 跑一次 prod 发布 | 云库 `deploy_app_env_versions` prod 行更新；prod 页面引用新版本且 200 |
| **反向（关键）** | 临时断开公网（安全组摘规则或 `iptables` 封 3306 出口）后跑 prod 发布 | **任务 failed**，明确提示未生效；prod 仍运行旧版本且页面正常 |
| 一致性 | 跑 #9 检查脚本 | 两库 prod 指针一致、无告警 |
| 回退 | `DEPLOY_CLOUD_DB_ENABLED=false` 重启 console | 回到人工同步现状，dev 发布不受影响 |

---

## 9. 回退路径

- 一键：`DEPLOY_CLOUD_DB_ENABLED=false` + 重启 deploy-console → 关闭全部镜像写，行为等同现状
- 数据无破坏：镜像写只做 upsert，不删数据；云库连接 `synchronize:false`，不产生 DDL
- 网络侧回退：关闭公网地址即可，prod gateway 走内网不受影响

---

## 10. 风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 公网可用性：prod 发布依赖外网，云库公网入口抖动会导致发布失败 | P0 | 严格失败语义（§6）+ 发布前连通性预检，失败早暴露而非静默 |
| R2 | dev 机公网 IP 变化导致白名单失效 | P0 | **给 dev 机绑弹性公网 IP**；否则 IP 变更后发布静默失败 |
| R3 | 云库连接 `synchronize` 误开 → DDL 变更生产表 | P0 | 显式 `synchronize:false`，并在启动时断言 |
| R4 | 公网延迟 / 链路中断导致发布任务长时间卡住 | P1 | ⚠️ 实测驱动 `connectTimeout` 在「SYN 无响应」场景**不生效**（单次 connect 挂 31s）。已加**应用层硬超时** `DEPLOY_CLOUD_DB_QUERY_TIMEOUT`（默认 8s）+ 重试 1 次，最坏 ~17s 收敛 |
| R5 | 两库静默不一致 | P1 | M5 一致性检查；考虑接入 pipeline-lint 或定时巡检 |
| R6 | 公网传输凭据与数据 | P1 | 云数据库公网建议开 SSL；凭据只存 `.env`（600），不进仓库 |

---

## 11. 未决问题

1. 云数据库公网是否开启 SSL、console 侧是否需要配置 `ssl` 连接参数——公网已开通（`gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`），SSL 决策仍待定（开更安全，连接配置略复杂）
2. ~~`deploy_deployments`（legacy 指针）是否纳入镜像~~ → **已纳入**（M2 实施），失败不阻断
3. 是否把「两库一致性检查」接入既有 `pipeline-lint`（L 规则）——倾向接入，待本次稳定后做（M5）

---

## 12. 实施记录（M2，2026-10-08）

### 落地范围（§5 的 #1–#5 + #8）

| # | 落地情况 |
|---|---|
| 1 `.env` | 远端 `servers/deploy-console/.env` 加 `DEPLOY_CLOUD_DB_*`（7 项，600 权限）；仓库侧写进 `.env.example` 留空占位 |
| 2 `CloudDbModule` | `src/cloud-db/cloud-db.service.ts`：独立 `DataSource`，`synchronize:false` + `entities:[]`，懒连接、可重试、应用层硬超时 |
| 3 `EnvSplitWriterService` | `mirrorPointer` / `mirrorLegacyPointer` / `mirrorRows`（M4 备用），原生 SQL upsert，白名单校验 |
| 4 `release-registry` | 本地写成功后才镜像；本地失败不镜像；prod 镜像失败抛出 |
| 5 `deploy.service` | 两处 legacy 指针写入后镜像（不阻断） |
| 8 `app.module` | `ReleaseRegistryModule` / `DeployModule` / `HealthModule` 引入 `CloudDbModule` |

附带：新增 `GET /api/health/cloud-db` 探活（发布前预检，响应不回显公网地址）。

### 验证证据

| 用例 | 结果 |
|---|---|
| 探活 | `{"status":"ok","enabled":true,"latencyMs":192}`（池化后稳定 ~36ms） |
| 正向 prod | 同值推指针 → 云库 `shell@prod` 的 `deployed_by`/`task_id`/`deployed_at` 同步更新 |
| 正向 dev | 推 dev 指针 → 本地库更新、云库 `shell@dev` **未动**（证明 dev 不镜像） |
| legacy | 云库 `deploy_deployments` prod 行同步更新 |
| **反向** | `iptables` 阻断 27241 后推 prod 指针 → **HTTP 503** + 「prod 指针未生效…prod 仍运行旧版本」，**9s 快速失败** |
| 回退 | `DEPLOY_CLOUD_DB_ENABLED=false` 即恢复人工同步现状（未触发，保留为应急开关） |

### 发布方式

`scripts/publish-deploy-console.sh --env dev`（console 不走流水线，E1 约束）。
失败自动回滚，远端产物保留 `dist.bak-*`。PR #247（已挂 auto-merge / merge commit）。

### 偏离说明

- legacy 镜像**不阻断**发布（§6 表已补充）：它不是 gateway 默认读取源。
- 异常类型用 `HttpException`：否则提示被全局过滤器脱敏成「服务器内部错误」。
- 错误信息中的公网 IP/域名一律脱敏为 `<云库地址>`。

### 遗留（M3–M5）

- ~~M3 基线同步~~ **✅ 完成（2026-10-08）**，见 §13
- ~~M4 配置镜像双写~~ **✅ 完成（2026-10-08）**，见 §14
- ~~M5 一致性检查~~ **✅ 完成（2026-10-08）**；建议给 dev 机加 cron 每日巡检（`--quiet`）
- 运维项：dev 机绑 EIP（白名单长期隐患）、云库公网是否开 SSL

---

## 13. M3 实施记录（2026-10-08）

### 结论先说：原计划要灌的 10 张配置表，**一行都不用灌**

M3 立项时的判断是「云库配置落后」（源于早期观察到 `deploy_pipelines.vars` 云库 94 vs 本地 119）。
实施前做了一次逐行内容比对（两库都 `SELECT *` 全列排序后 diff），实测结果：

| 表 | LOCAL | CLOUD | 内容差异行数 |
|---|---|---|---|
| `deploy_modules` | 16 | 16 | **0** |
| `deploy_apps` | 4 | 4 | **0** |
| `deploy_sites` | 3 | 3 | **0** |
| `deploy_hosts` | 3 | 3 | **0** |
| `deploy_envs` | 3 | 3 | **0** |
| `deploy_endpoints` | 361 | 361 | **0** |
| `deploy_services` | 13 | 13 | **0** |
| `deploy_service_envs` | 32 | 32 | **0** |
| `deploy_service_routes` | 3 | 3 | **0** |
| `deploy_canary_rules` | 4 | 4 | **0** |

→ **§4 清单里 gateway 真正会读的 10 张配置表，两库早已逐字节一致**。
当初看到的 `vars 94 vs 119` 属于 `deploy_pipelines` —— 该表本就在「不镜像」范围内（gateway 不读），
**不构成 prod 运行风险**。M3 的立项前提被推翻，工作量从「12 表全量灌入」收敛成「补一张 legacy 表」。

> 教训：漂移清单要按「谁在读」过滤后再下结论。之前把「两库差异」直接等同于「云库落后且危险」，属于把噪音当风险。

### 实际做了什么

| 表 | 处理 | 理由 |
|---|---|---|
| `deploy_app_env_versions` | **不动** | 校验发现 **prod 行 `current_version` 完全一致**（shell=b94924b3 / portal=admin=6e7b2690）。dev/local 行虽有差异（云库残留 9/28 旧口径如 `admin-dev/cdb055bc`），但 prod gateway 只读自己 env 的行 → 对 prod 零影响。为避免任何「把云库正确值回写成本地值」的风险，本次不覆盖 |
| `deploy_deployments`（legacy） | **本地 → 云库 REPLACE 补齐**（7 → 23 行） | 该表是 `DEPLOY_LEGACY_READ=1` 时的应急读取源。云库原 7 行是旧口径（`gateway-dev/7a6be04` 这类扁平格式），且缺 16 行（含 portal/admin/mcp-gateway/content-hub/user-service/todo-service 等 prod 行）→ 一旦启用应急开关，prod 会读到残缺且过期的指针。M2 上线后该表已能自动镜像（shell@prod 行已随本次验证更新），这次只是把历史补齐 |

### 执行与回退

- 备份：`/data/backup/deploy_deployments-cloud-20261008-190158.sql`（云库侧，dev 机）
- 同步：`mysqldump --replace --no-create-info` 管道导入（REPLACE = delete+insert，云库无外键，无级联风险）
- 回退：`mysql -h <云库域名> -P 27241 -u root web_system_deploy < /data/backup/deploy_deployments-cloud-20261008-190158.sql`
- 验证：行数 7 → 23；**9 条 prod 行 `current_version` 与本地完全一致**（含 shell=b94924b3）

### 顺带发现（P2）

同值幂等推进时，本地库因 `unchanged` 跳过写入、云库仍被镜像 → 两库 `deployed_by` / `deployed_at` 会漂移。
`current_version` 始终一致，不影响 gateway 读取，只影响审计字段。纳入 M5 一致性检查的比对范围时
应**忽略 `deployed_by` / `deployed_at`，只比对版本列**，否则会持续误报。

---

## 14. M4 / M5 实施记录（2026-10-08）

### M4 配置镜像双写

**规模**：5 个 service、**30 个写入点**（services 13 / envs 7 / apps 4 / hosts 3 / canary 3），
其中 **24 处增改 + 6 处物理删除**。`deploy_modules` 在 src 内零写入点（全部只读）→ 未插桩。

**为什么不用 TypeORM Subscriber 自动捕获**（这是本方案最大的一次路线权衡）：

| 候选 | 判定 |
|---|---|
| TypeORM `EntitySubscriber` 自动镜像 | ❌ 不选。`repo.delete()` / 批量删**不触发** RemoveEvent，而 6 处删除里有 5 处正是这种 bulk delete；`afterUpdate` 的 entity 在 partial update 下还可能为空 |
| 显式插桩 + 统一 helper | ✅ 选中。确定性强、可测、不强依赖 TypeORM 内部实现；遗漏风险交给 M5 巡检兜底 |

> 两者其实互补：插桩负责「写得准」，M5 负责「没漏写」。这也是 M5 必须存在的原因之一。

**异步队列 + 去重**（`EnvSplitWriterService` 内建）：
- 业务写路径**永不 await** 云库写 —— 配置镜像失败不阻断（§6）
- 同一个「表 + 唯一键」在一个事件循环内的多次写合并为最后一次（后覆盖前）
- `flush()` 仅供测试 / 退出前使用

**唯一键选择（最容易出错的一处）**：优先用实体上的**业务唯一键**，不用 uuid 主键 ——
主键是本地生成的，删了再建 uuid 会变，云库就会「老行 + 新行」并存。两个例外：

- `deploy_service_routes`：唯一键 `(service_key, env_id, path_prefix)`，但 **`env_id` 可为 NULL**，
  而 MySQL 唯一索引把 NULL 视为互不相等 → 用复合键 upsert 永远命中不了「全环境默认」那行，会插重复行。
  故退回 uuid 主键 + `deleteMirror()` 删除补偿。
- `deploy_canary_rules`：实体上 `env_id + module_key` 只是普通索引（允许同模块多条规则），没有可用业务唯一键。

**三个必踩的坑（都已修）**：
1. **列名必须 camelCase → snake_case**：主连接配了 `SnakeNamingStrategy`，而镜像写用的是原生 SQL
2. **json 列必须 `JSON.stringify`**：`deploy_canary_rules.match_rule` 等，mysql2 不接受 JS 对象
3. **⚠️ Module 接线遗漏**：给 service 注入新依赖后，**spec 全绿也可能生产启动就崩** ——
   `@Module({imports})` 没包含 `CloudDbModule` 是编译期看不出来的，只在 Nest 容器启动时才炸。
   本次 5 个 module 全部漏接（全绿测试完全发现不了），已逐个补齐并新增
   `cloud-db-wiring.spec.ts` 做回归防护（断言「注入了 writer 的 module 必须 import CloudDbModule」）。

### M5 一致性检查

`scripts/check-cloud-db-consistency.sh`：比对 12 张表，忽略 `task_id / deployed_by / deployed_at / created_at / updated_at`
（这些是「谁在何时由哪个任务改的」追溯字段，天然漂移；gateway 只读版本列，纳入比对只会长期误报），
指针表额外排除 uuid 主键 `id`（同业务行两库 id 天然不同，否则 100% 误报）。

支持 `--env dev` 远端巡检 / `--quiet`（cron）/ `--json`（机器消费），exit 1 = 不一致。

**⚠️ 不做 CI 门禁**：GitHub Actions runner 不在云库公网白名单里，连不上。
它是**运维巡检工具**（建议 dev 机 cron 每日跑），不是 CI 检查项。

**正反验证**：正常态 12/12 一致；人为把云库 `deploy_hosts.managed_by` 改坏 → 立即报 DIFF + exit 1 → 还原后回全绿。

### 本次同时完成的基线补齐

M3 收尾时保守起见没动 `deploy_app_env_versions`（prod 行版本号已一致）。M4 上线后维护lify自动化，
这里补一次基线让巡检从干净状态起步：备份 `deploy_app_env_versions-cloud-20261008-200140.sql` 后 REPLACE 补齐，
现 12/12 全一致。

## 15. 磁盘入口指针落点按环境分流（诊断 #3，2026-10-09）

### 事实（实测，非推断）

| 环境 | gateway 静态根 | 所在机器 | console 原落点 |
|---|---|---|---|
| dev | `/data/web_system/servers/gateway/public`（`STATIC_ROOT=./public`） | console 本机（南京 175.27.189.123） | 同一路径 ✅ |
| prod | `/data/web_system_static/public`（进程 env `STATIC_PUBLIC_ROOT`） | prod 机（广州 106.52.176.246） | **dev 机 `/data/web_system/...`** ❌ |

证据：prod gateway 进程 environ 里 `STATIC_PUBLIC_ROOT=/data/web_system_static/public`；
`curl 127.0.0.1:6000/static/modules/portal/prod/index.js` 返回的内容与
`/data/web_system_static/public/static/modules/portal/prod/index.js` 逐字节一致。

### 根因

console 把「磁盘入口指针」一律写到 `RELEASE_WORKSPACE` 下的 `servers/gateway/public`
（即 console 本机），而**静态根所在的机器是环境的属性，不是 console 的属性**：

1. **落点错** —— prod 切换写到 dev 机，线上读 prod 外置静态根 →
   磁盘指针与 DB 指针长期撕裂（实测：DB=6e7b2690 / prod 磁盘=69d9e5f9）
2. **校验走错机器** —— `hasEnvVersion` 在 console 本机校验 prod 产物，
   本机 `portal/prod/` 只有 `cdb055bc` → 切不回只在 prod 机上存在的版本（E2E 已复现，2026-10-08）

### 方案：落点是环境的一等属性

配置驱动，未配置时与修复前**逐字节一致**：

| 配置项 | 含义 |
|---|---|
| `STATIC_PUBLIC_ROOT_<ENV>` | 该环境的 gateway 静态根（目标机绝对路径） |
| `STATIC_SSH_TARGET_<ENV>` | 静态根所在机器（`user@host`）；不配 = console 本机 |
| `STATIC_PUBLIC_ROOT` | 全局兜底（不区分环境） |
| （都不配） | `<RELEASE_WORKSPACE>/servers/gateway/public` |

实现：

- `apps/static-target.ts`：解析纯函数（env → 配置键归一化 `staging-1` → `STAGING_1`、尾斜杠归一）
- `apps/env-artifact.service.ts`：产物读写的**唯一入口**，本机走 fs / 远端走 ssh
  - 远端脚本 base64 传递（避免本地 shell + 远端 shell 多层引号转义）
  - 失败语义：读类（列版本 / 读指针）降级空值 + 告警；**校验失败抛错**
    （不能让「没校验」伪装成「校验通过」）
  - 远端写指针：一次 ssh 完成「备份 → 写 js → 有 css 才写 css」
- `entry-pointer.ts` 路径语义由「发布目录」改为「**静态根**」
- `apps.service`：校验 / 列版本 / 读指针 / 写指针全部改走落点服务，报错文案带落点

### 线上配置（dev console `.env`）

```
STATIC_PUBLIC_ROOT_PROD=/data/web_system_static/public
STATIC_SSH_TARGET_PROD=root@106.52.176.246
```

### 验证

- 单测：全量 593 passed；apps 域 36 项（新增落点解析 9 + 远端命令 9 + switchVersion 2）
- E2E：内部接口 `POST /internal/release/pointer` 对 `portal@prod` 做
  「切到 cdb055bc → 切回 6e7b2690」，校验与写盘都在 prod 外置静态根上完成

### 遗留

- 远端操作走 ssh 同步等待（15s 超时），在列版本接口上有网络耗时；后续如需可做缓存
- prod 磁盘指针与 DB 指针的历史撕裂需人工核对一次（本次修复只保证**后续**写入一致）

---

## 16. 二线可靠性（2026-10-09）：远程超时 / pm2 失败语义 / 锁下沉 / 启动对账 / 一致性巡检

对应诊断 #11 #4 #6 #12 #13。一线（#1/#2/#3/#5）解决的是「写错地方、写不到」，
这一批解决的是**「写对了，但你不知道它其实没生效」**——半成功、静默挂起、无人回收。

### 16.1 #11 远程执行必须有硬超时

| 位置 | 修复前 | 修复后 |
|---|---|---|
| `deploy.service.ts#sshRun` | `client.exec` 无超时 | 默认 10min（`SSH_EXEC_TIMEOUT_MS`），到期发信号 + 断连 |
| `deploy.service.ts#sshUpload` | sftp 无超时 | 默认 15min（`SSH_UPLOAD_TIMEOUT_MS`） |
| `deploy.service.ts#listReleases` | 自管 client，无超时 | 复用 `sshRun`，顺带拿到超时与退出码检查 |
| `remote-delivery.service.ts#uploadDist` | 三次 `exec` 均未传 `timeoutMs`（**0 = 不超时**） | tar 5min / scp 15min / ssh 10min（`REMOTE_DELIVERY_*_TIMEOUT_MS`） |

`ssh2` 的 `readyTimeout` 只管**建连**；命令开始执行后没有任何上限，远端卡住时
发布 HTTP 永久挂起，且**锁一直握着**——该模块 30 分钟内谁也发不了。超时后主动
`signal('KILL')` + `stream.close()`，避免留下孤儿进程（历史教训：6200 端口被孤儿进程占死）。

### 16.2 #4 pm2 失败不能再伪装成成功

- **远端**：`(${pm2Chain}) || echo "[warn] ..."` → 失败改 `exit 90`；调用方按退出码区分：
  - `90`（产物已换、进程没起来）→ **保留现场不回滚 dist**，抛出并给出手工修复命令
  - 其他 → 回滚 dist 后抛错（保持"未部署"）
- **本地**：`restartPm2` 全部候选失败从 `logger.warn` 改为**抛错**（终态 failed + 手工命令）

判据：半成功是最难排查的一类状态——产物已换、进程跑旧代码、任务显示绿灯。

### 16.3 #6 发布锁下沉 + CAS

`ReleaseLockService` 此前只被流水线使用，**非流水线入口全裸奔**（UI 切换/回滚/部署、
内部脚本接口），连点两次即交叉覆盖，`previous_version` 被写成错值 → **回滚目标丢失**。

- `SetPointerInput.lock?: { owner, ttlMs }` —— 传了才申请锁；流水线**不传**（它自带跨阶段锁）
- `ReleaseLockService.acquireEx()` 新增 `newly`：
  - `newly=true`（无锁 / 抢占过期锁）→ 写完释放
  - `newly=false`（**重入**自己已持有的锁）→ **不释放**（否则把外层流水线还在用的锁删了）
- 冲突 → `409 ConflictException`（带持有者与到期时间）
- `expectedFrom`（CAS）：期望的变更前版本与实读不符即 409，挡住「页面显示 v1、实际已是 v2」

owner 约定（排障时一眼看出谁在发）：`ui:<人>` / `script:<operator>` / `deploy:<模块>` / `publish:<模块>`。

### 16.4 #12 启动对账 + 强制解锁

`status='running'` 此前**没有任何回收路径**：发布中重启 console → 任务永久转圈 +
该模块 30 分钟不可发布（锁只能等 TTL）。

新增 `reconcile` 模块：
- `StartupReconcileService`（`onApplicationBootstrap`）：超期 running → `failed`（附原因，不静默删）；
  过期锁 → 清理（**未过期的不动**，那可能是真在跑的发布）。阈值 `DEPLOY_TASK_STALE_MS` 默认 60min
- `DELETE /api/reconcile/locks/:moduleKey/:env`：强制解锁，**强制留审计**
- `GET /api/reconcile/locks`：看当前谁在发
- `POST /api/reconcile/run`：手动对账

对账失败绝不冒泡到启动流程（catch + error 日志）。

### 16.5 #13 两库一致性定时巡检

`check-cloud-db-consistency.sh` 能发现漂移，但**没人定时跑它**（全仓无 cron）。

`ConsistencyWatchService`：定时比对**指针表** prod 行（`deploy_app_env_versions` /
`deploy_deployments`）——那是 gateway 的读取源，漂移 = 线上跑的不是你以为的版本。
- 不引 `@nestjs/schedule`：一个 `setInterval` 足够，不为一个定时任务加依赖
- `CONSISTENCY_CHECK_INTERVAL_MS`（默认 6h，**0 = 关闭**）、`CONSISTENCY_CHECK_FIRST_DELAY_MS`（默认 60s）
- 只比对指针表；配置表仍由 M5 脚本按需巡检（行多、不直接影响线上加载）
- 忽略 `id / task_id / deployed_by / deployed_at / created_at / updated_at`（与 M5 脚本一致）
- 结果可被 `GET /api/reconcile/consistency?run=1` 取回；漂移时 `logger.error` 留痕

另修：`mirrorLegacyPointer` 的返回值此前**被直接丢弃**，现检查 `outcome === 'failed'` 并 error 留痕
（不阻断——gateway 默认不读本表，但应急开关 `DEPLOY_LEGACY_READ=1` 时它就是读取源）。

### 16.6 配置项汇总（均为可选，缺省零变化）

```
SSH_EXEC_TIMEOUT_MS=600000
SSH_UPLOAD_TIMEOUT_MS=900000
REMOTE_DELIVERY_TAR_TIMEOUT_MS=300000
REMOTE_DELIVERY_SCP_TIMEOUT_MS=900000
REMOTE_DELIVERY_SSH_TIMEOUT_MS=600000
DEPLOY_TASK_STALE_MS=3600000
CONSISTENCY_CHECK_INTERVAL_MS=21600000   # 0 = 关闭
CONSISTENCY_CHECK_FIRST_DELAY_MS=60000
```

### 16.7 遗留

- 定时巡检只覆盖指针表；配置表漂移仍靠人工跑 M5 脚本
- 强制解锁是危险操作，目前只留审计、无二次确认（前端可加）
- 僵尸任务回收只看 `deploy_tasks`；流水线实例（`deploy_pipelines`）的同类状态未纳入

## 17. 三线治理（2026-10-09）：凭据脱敏 / 内部接口审计限流 / 产物清理 / lint L8-L9 / ssh 真相源

一线（#1/#2/#3/#5）解决「写错地方、写不到」，二线（#11/#4/#6/#12/#13）解决
「写对了但你不知道它没生效」。这一批解决的是**长期 hygiene**：凭据会泄露、
操作无留痕、产物只增不减、脚本侧无门禁、同一个真相源有多份实现。

### 17.1 #8 日志统一脱敏

`INTERNAL_API_KEY` 被注入为脚本变量 `CONSOLE_TOKEN`，脚本里一句 `set -x` 就会把
`+ curl -H "x-internal-key: <真实 key>"` 回显到 stderr；此前 `shell-runner` 把
stdout/stderr **原样**落库（`deploy_tasks.logs`）并在 UI 展示 —— 一次误开即永久泄露。

新增 `common/redact.ts`（纯函数 + 可注入 env，便于单测）：

| 层 | 判据 | 说明 |
|---|---|---|
| 已知值 | 进程内敏感 env 的**值**整体替换 | 最可靠，无正则误伤；长值优先匹配避免前缀截断 |
| 名称兜底 | `KEY=value` / JSON 字段 / `-H "x-internal-key: …"` / `Bearer …` | 覆盖「值来自别处」 |
| URL userinfo | `mysql://root:pw@host` | 只换密码，保留 host 便于排障 |

两条刻意的取舍：
- **短值（<6 字符）不脱敏** —— 否则 `PORT=0`、`KEEP_VERSIONS=5` 全被抹掉，日志没法排障
- **默认层级不脱敏 IP/端口** —— 脚本日志里满是 `curl http://127.0.0.1:6200`，
  一刀切等于把排障最需要的信息删掉。只有明确出站的消息（云库连接错误）才走
  `redactSecretsAndAddress`

落点：`shell-runner` 的日志推送、`deploy.service` 的远端回显与异常消息。
`env-split-writer` 原有的 `redactEndpoint` 改为委托（占位符沿用 `<云库地址>` 措辞）。

### 17.2 #7 内部接口审计 + 限流

`/api/internal/release/*` 与 `/api/config/internal/*` 是 `@Public()` + 单一静态 key：
持有它就**能把 prod 任意模块切成任意版本**，且此前**零留痕**。

新增 `InternalGuardService`（做成模块而非纯函数，因为**限流器必须持有进程内状态**
才能跨请求计数，每次 new 等于没限流），四件事：鉴权（复用 `assertInternalKey`）→
来源白名单 → 限流（按「来源 IP × 动作」滑动窗口，默认 120/分钟）→ 审计（成功失败都留痕）。

审计写失败**只 error 不阻断**：审计是留痕设施，它挂了不该让发布发不出去，
但必须有日志可查，避免「审计静默失效」变成新的盲区。

> 实测踩坑（已修 + 回归测试）：`INTERNAL_IP_ALLOWLIST` 为空时，`''.split(',')` 得到
> `['']`，而 `normalizeIp('')` 返回 `'unknown'`（审计占位值）被 `filter(Boolean)` 保留
> ⇒ 白名单**默认启用**且只允许 `unknown` ⇒ 所有内部接口 403。空串必须先短路。

### 17.3 #9 env-dir 产物清理（比诊断更严重）

`listL1` 旧判定「一级目录含 index.js = 版本」，而 env-dir 布局是
`modules/<key>/<env>/index.js`（**入口指针**）+ `modules/<key>/<env>/<commit>/index.js`
⇒ env 层被误判成版本，两个后果：

1. 它的 L2 commit 目录**永远扫不到** ⇒ 永不清理、无限增长
2. 更危险：env 层 mtime 超龄且不在 keep 内时走 legacy 分支 `rmSync(<base>/<env>)`
   —— **连指针带所有版本整个删掉**，线上直接白屏

新判定：**有「含 index.js 的子目录」⇒ 该层是命名空间/env 层**（一条规则同时覆盖
流水线命名空间与 env-dir，不需要引入 deployMode）。另外补两条保护：
- 指针当前指向的版本自动受保护（它是线上正在服务的版本，调用方传的 protected 未必覆盖）
- 版本清空后 env 层保留（指针不能丢），只有**无 index.js 的空目录**才移除

### 17.4 #10 远端产物保留（#9 的远端版）

关键认识：**prod 的产物根本不在 console 本机**（静态根外置在 prod 机），
所以上一节的本地清理在 prod 上**从来没发生过** —— 远端才是主战场。

新增 `RemoteArtifactCleanupService`：scan（只读）→ `planRetain`（纯函数，与本地同一套
语义）→ 执行。**默认只观测**（`REMOTE_CLEANUP_ENABLED=false`）：远端 `rm -rf` 是高危操作，
先把「有多少个版本、会删哪些」报出来，人工确认后再开。

删除前两道闸（这是最后一道防线，宁可少删也不错删）：
- `isSafeVersionName`：只放行 commit 哈希（7-40 位 hex）与 `vX.Y.Z`；
  `..`、绝对路径、`dist`、`a/b` 一律拦下
- 远端命令里再判一次 `'<name>' != dist`

`cleanup.executor` 的 remote 分支从「静默跳过」改为扫描并回报（此前注释写
「由目标环境自己的发布平台负责」，但实测目标机并没有另一套 console，无人清理）。

### 17.5 #14 pipeline-lint L8 / L9

| 规则 | 判据 | 防什么 |
|---|---|---|
| **L8**（error） | env-dir 应用（portal/admin）dev/prod 投递路径必须含 `${DEPLOY_ENV}` | L7 只管 site-version；env-dir 用扁平口径会落到 `modules/<key>/<commit>/`，与磁盘指针错位 → 发布成功但页面 404（诊断 #3 的类型） |
| **L9**（error） | 调 `$CONSOLE_API` 的 curl 必须带 `-f`（或显式查 HTTP 码） | curl 默认 4xx/5xx 也返回 0 ⇒ 接口拒绝（产物不存在 / 并发锁 409 / 鉴权失败）时脚本照样往下走 |

实现细节：L9 先把以 `\` 结尾的续行合并成**逻辑行**再判（curl 常写成每个 `-H` 一行，
只看物理行会漏判）；L8 先剥掉注释行再取路径（否则脚本注释里画布局的
`static/modules/<key>/<envId>/<commit>/` 会被当成真实路径误报 —— 实测命中过）。

现网实测：230 个动作，**0 error / 43 warning**（warning 全是既有的 L6 提示）。
L8/L9 均已用离线用例验证「坏写法命中、正确写法不误报」。

### 17.6 #15 ssh 真相源收敛（部分）

「环境 → 目标机 + 私钥」的解析此前在本仓有三份（deploy / monitor，新增能力还会抄
第四份）。收敛为 `SshExecService.resolve`（唯一实现 + 统一硬超时 + 输出脱敏），
`DeployService.getSshConfig` 改为委托（行为不变）。

额外收益（#15 的核心要求）：**回落必须告警** —— 环境未在「主机管理」登记而回落到
服务器管理默认机时，现在会 warn，不再静默用默认机。

### 17.7 配置项汇总（均为可选，缺省零变化）

```
INTERNAL_RATE_LIMIT_PER_MIN=120   # 0 = 关闭限流
INTERNAL_IP_ALLOWLIST=            # 空 = 不限制来源；逗号分隔，支持 ::1 / ::ffff: 写法
REMOTE_CLEANUP_ENABLED=false      # true 才真正执行远端删除（默认只观测）
SSH_EXEC_TIMEOUT_MS=600000        # SshExecService 的远程执行超时
```

### 17.8 遗留

- `monitor.service` 仍有自己的 `getSshConfig`（未收敛到 `SshExecService`）
- `remote-delivery` 的 `REMOTE_MODULES_ROOT` 仍是硬编码，未并入「环境 × 应用」推导
- 后端 `servers/<dir>/<commit>/` 的远端保留未做（dist 就在旁边，误删风险更高，需单独验证）
- 定时巡检只覆盖指针表；产物清理目前靠流水线 cleanup 步骤触发，非定时

---

## 18. 流水线锁与指针层锁必须同源（2026-10-09 回归修复）

### 18.1 现象

dev 发布 portal 时，前面的「拉取代码 / 构建 / 投递产物 / 写版本」全部成功，
唯独最后一步「激活指针 · 写入口指针」恒失败：

```
[activate] 激活失败：http://127.0.0.1:6200/api/internal/release/pointer（指针未切换，页面仍是旧版本）
```

### 18.2 根因：两把锁不同源，流水线被自己拒绝

| 锁 | 持有者 | owner |
|---|---|---|
| 流水线自持锁 | `pipeline.service.ts` acquire | **run id**（如 `1791531699962-3dznagn`） |
| 指针层锁（#6 下沉） | `switchVersion` → `setAppEnvPointer` | `ui:<operator>`（如 `ui:pipeline-script`） |

发布节点的激活脚本调 `internal/release/pointer` 时，指针层按 operator 派生出
`ui:pipeline-script`，**与流水线那把锁不是同一个 owner** → `acquireEx` 判定为并发 → 409
→ 脚本 `exit 1`。即：**流水线被自己持有的锁挡在门外**。

这是 #6「锁下沉」的副作用：下沉本身是对的（UI/脚本入口此前裸奔），
但漏了「流水线自己已经持锁」这条路径。

### 18.3 修法：run id 显式透传，同 owner 即重入

1. `resolveStageVars` 注入 `RUN_ID`（= run id），并列入 `PROTECTED_STAGE_KEYS`
2. `internal/release/pointer` 接受 `lockOwner`（兼容 `runId` 字段），原样透传给
   **两条分支**：env-dir 走 `switchVersion`、后端走 `registry.setPointer`
3. `AppsService.resolveLockOwner()`：显式 lockOwner 优先，缺省才用 `ui:<operator>`；
   legacy 分支同理（缺省 `script:<operator>`）
4. 动作脚本 curl body 增加 `"lockOwner":"${RUN_ID}"` —— **两类脚本都要改**：
   env-dir 的「激活指针 · 写入口指针」与后端的「pointer · 切版本指针（远端）」

> ⚠️ 第一批只覆盖了 env-dir 分支，漏了后端那条；后端发布 deploy-console 时同样 409 失败。
> **同一个根因有两条路径**——改这类「入口」代码时必须按分支逐条核对，不能改完一条就收工。

`acquireEx` 原本就支持「同 owner 重入」（`newly=false` 不释放外层锁），
因此透传后激活步骤走的是重入分支，不再冲突。

### 18.4 两个必须记住的细节

- **`PROTECTED_STAGE_KEYS` 只拦配置中心，不拦流水线变量**。
  `RUN_ID` 属平台身份类变量（与 `CONSOLE_TOKEN` 同类），被模板变量覆盖会导致
  「锁 owner 错位」这类完全指不到根因的失败，故在合并流水线变量后再单独拦一次。
- **动作脚本的变量门禁会拦住未声明变量**。必须先发布注入 `RUN_ID` 的代码，
  再打脚本补丁，否则保存动作时报「引用了未声明变量 RUN_ID」（实测确实拦住了）。

### 18.5 回归验证

- 单测：默认 `ui:` 前缀 / 显式 owner 透传 / 回滚补偿沿用同一 owner / RUN_ID 注入与防覆盖
- E2E：重跑一条 dev 发布，「激活指针」步骤 succeeded，指针与两库一致

### 18.6 加一个平台注入变量，要同步三处（第三处就是这次漏的）

1. `resolveStageVars` 的 `base`（真正注入）
2. `pipeline-orchestration/script-vars.ts` 的 `PLATFORM_VARS`（服务端保存门禁）
3. `scripts/pipeline-lint.mjs` 的同名集合（CLI 全量体检）

只改 1 不改 2/3 → 保存动作脚本时被拒「引用了未声明变量 RUN_ID」（实测命中）。
现已加测试兜住：服务端集合与 CLI 集合**双向比对**必须一致，
且 `resolveStageVars` 注入的每个键都必须在白名单内 —— 下次漏改任意一处即红。

---

## 19. 四线：gateway 通知下沉 / synchronize 可配 / 监控收敛 / 远端根可配（2026-10-09）

### 19.1 #16 gateway 缓存通知必须跟得住「改指针」这件事

`notifyGatewayRefreshCache` 此前**只存在于 `DeployService` 内部**，于是只有「走 deploy.service
的那条发布路径」会通知；UI 切换/回滚、`internal/release/pointer` 这些同样改指针的入口全都不通知。
表现是「发布成功了，页面最多 10s 后才变」，且不同入口行为不一致、极难定位。

抽成 `common/gateway-cache.service.ts` 后由各入口各自调用（env-dir 的 `switchVersion`、
后端 legacy 的 `internal/release/pointer`、deploy.service 原有的），地址与凭据按环境取
（`GATEWAY_INTERNAL_URL_<ENV>` → 通用值；发 prod 不能去刷 dev 的 gateway）。

**失败语义：只告警不抛错** —— 指针已写成功，通知失败最多是缓存晚 10s 失效，
绝不能把一次成功的发布判成失败（两条入口都补了 try/catch，并有测试锁住）。

### 19.2 #19 synchronize 不再硬编码（先证实风险等级，再动手）

动手前先核实了两个事实，避免凭印象定级：

- deploy-console **只在 dev 机运行**（prod 无该进程），作用对象是 dev 运维库
- 云库（prod 指针读源）由 `CloudDbService` 单独建连接，**已经是** `synchronize: false`

所以真实风险不是「改坏生产表」，而是「哪天把 console 指向别的库就自动 DDL」+「dev 表结构变更不可追溯」。
取舍：**不引入 migrations 体系**（库本是 synchronize 建出来的，补 baseline 风险大于收益），
改为「默认保持现状 + 环境变量关掉 + 远端库自动拒绝」：

| 优先级 | 条件 | 结果 |
|---|---|---|
| 1 | `DB_SYNCHRONIZE` 显式指定 | 听它的 |
| 2 | `NODE_ENV=production` | 关 |
| 3 | `MYSQL_HOST` 非回环地址 | 关（远端库禁止自动 DDL） |
| 4 | 其余 | 开（保持 dev 现状） |

启动时把定夺结果打进日志（不靠读代码才知道开关状态）；`migrations` 目录先备好，将来收紧可无缝接上。

### 19.3 遗留①：监控不再自带一份 ssh2（诊断 #15 收尾）

`monitor.service` 里有一整套 ssh2 副本（连接/超时/退出码/错误各写一遍），与发布侧长期双份维护。
现统一走 `SshExecService`（新增 `configForHost` + `execOn`），顺带拿到发布侧已有的输出脱敏。

保留两点监控特有语义，**没有为了收敛而改变行为**：

- 默认超时 10s（探活要快，不能用发布侧的分钟级默认）
- `allowNonZeroExit`：命令输出要直接展示给人看（如 pm2 报「服务不存在」），非零退出也返回输出

### 19.4 遗留②：`REMOTE_MODULES_ROOT` 不再写死

原常量 `/data/web_system/servers/gateway/public/static/modules` 只适用于「与控制台同机同布局」
的环境；prod 的静态根是 `/data/web_system_static/public`。改为按环境取值：
`REMOTE_MODULES_ROOT_<ENV>` → `STATIC_PUBLIC_ROOT_<ENV>` + `/static/modules` → 旧常量（回落不变）。

⚠️ 两个布局别混用：静态根下是 `static/modules`，**发布目录内**才是
`servers/gateway/public/static/modules`（`STATIC_MODULES_REL`）。第一版就混了，被测试抓到。

另注：env-dir 的产物投递现由 `EnvArtifactService`（#3）接管，本方法的远端分支属遗留路径
（当前流水线的「投递产物」是脚本动作，不走它），故只做取值可配、不动结构。

---

## 20. 五线：数据保留 / 回滚入口统一 / 幂等 / 后端远端保留 / 清理定时化（2026-10-09）

### 20.1 #18 数据保留（默认只观测）

`deploy_tasks`（含 logs JSON）/ `deploy_versions` / `audit_logs` 此前**零保留策略**。
新建 `reconcile/retention.service.ts`，与 #10 同款保守形态：

- **默认只观测**：`RETENTION_ENABLED≠true` 时只统计「会删多少」，一条不删（删数据不可逆，先看数字）
- **配置显式但非法 → 跳过**：`RETENTION_KEEP_DAYS=0` 不能静默回落 90 天（运维以为设了 0 天实际跑 90 天，
  预期与实际长期不符且无人发现）—— 宁可不跑并报错
- **指针指向的版本永不清**：`deploy_versions` 是回滚菜单的数据源，删掉当前/上一版本 = 入口少一项
- **只删终态任务**：`running/pending` 可能是活的（启动对账还要回收它们）

### 20.2 #17 回滚入口统一（修掉一个真隐患）

两个入口各自查「上一版本」：env-dir 读指针表 `previous_version`，后端读 `deploy_versions` 历史。
更严重的是：**后端入口不判 `deployMode`** —— 从部署页回滚一个微前端模块会走
「版本目录落地 dist + pm2 重启」，对微前端完全不适用。

- `registry.resolveRollbackTarget()` 成为唯一取法：**显式 > 指针表 previous_version > 历史表**
- `DeployService.rollbackUnified()` 按形态分派：env-dir → 切指针；后端 → 落地 + 重启
- `apps.service.rollback` 也走同一取法（顺带获得历史表回落，此前指针表没行就直接报错）

### 20.3 #20 内部接口幂等

`InternalGuardService.run()` 支持 `Idempotency-Key`：同 `action+key` 复用首次结果。
存 Promise 而非结果（脚本重试可能是并发的）；**只缓存成功**（失败必须可重试，否则一次抖动永久卡住）；
不带该头则完全不启用（既有脚本零变化）。

### 20.4 遗留③ 后端远端产物保留

#10 只覆盖了前端（`<静态根>/static/modules/<key>/<env>/<commit>`）。后端在
`<workspace>/servers/<dir>/<commit>` 同样堆积。抽出 `cleanupDir()` 两种布局共用，
后端额外把 **`dist` 加入保护名单**（它正在跑，被删就是线上事故）。

### 20.5 遗留④ 清理定时化

`RemoteCleanupWatchService`：定时跑，目标取自**指针表里出现过的「应用 × 环境」**
（没发过版的组合远端压根没目录，扫了是空跑）。
默认关闭（`REMOTE_CLEANUP_INTERVAL_MS` 不配即 0）—— 定时 + 删除默认开 = 无人值守删线上文件。

### 20.6 运维动作（更正此前判断）

- `deploy_hosts` **其实是登记好的**（dev-default / prod-default / local-default 三台，
  `deploy_service_envs` 32 行全部有 host_name），`SshExecService` 回落告警 **0 次** ——
  此前「表为空、都在走回落」的判断是错的，已更正
- 云库 `deploy_app_env_versions` 清理了 **5 行非 prod 陈旧行**（portal/admin/shell 的 dev、local，
  均为 9 月遗留；prod 三行保留且正确）
