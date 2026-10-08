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
| `DEPLOY_CLOUD_DB_STRICT=false` | 回退到告警语义（仅应急，不推荐长期开启） |

---

## 7. 迁移步骤

| 阶段 | 动作 | 依赖 |
|---|---|---|
| M0 | ~~控制台开启云数据库公网，记录域名:端口；白名单放行 `175.27.189.123/32`~~ **✅ 完成（2026-10-08）**：`gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`，白名单已放行。遗留：**建议给 dev 机绑 EIP**（普通公网 IP 变配/重建后会失效） | 人工 |
| M1 | ~~dev 机验证连通~~ **✅ 完成（2026-10-08）**：TCP 通、mysql 握手 0.177s、池化查询稳定 36ms | M0 |
| M2 | 落 §5 的 #1–#5（指针分流是核心价值，先上） | M1 |
| M3 | 基线同步：把本地库 §4 的 12 张表全量灌入云库（当前云库配置落后，如 vars/modules） | M1 |
| M4 | 落 §5 的 #6–#8（配置镜像双写） | M2 |
| M5 | 落 #9 一致性检查 | M4 |

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
| R4 | 公网延迟导致发布任务超时 | P1 | `connectTimeout` / `acquireTimeout` 调大；镜像写加独立超时与重试 |
| R5 | 两库静默不一致 | P1 | M5 一致性检查；考虑接入 pipeline-lint 或定时巡检 |
| R6 | 公网传输凭据与数据 | P1 | 云数据库公网建议开 SSL；凭据只存 `.env`（600），不进仓库 |

---

## 11. 未决问题

1. 云数据库公网是否开启 SSL、console 侧是否需要配置 `ssl` 连接参数——公网已开通（`gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`），SSL 决策仍待定（开更安全，连接配置略复杂）
2. `deploy_deployments`（legacy 指针）是否纳入镜像：当前 gateway 已停用 legacy 读取源，仅 `DEPLOY_LEGACY_READ=1` 应急时会读。倾向**纳入**（成本低、排障有价值），待确认
3. 是否把「两库一致性检查」接入既有 `pipeline-lint`（L 规则）——倾向接入，待本次稳定后做
