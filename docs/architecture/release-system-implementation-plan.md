# 发布系统改造实施方案（P0 + P1）

> 关联设计：`release-system-design.md`（总设计）
> 本方案：实施级蓝图，含具体文件/函数/SQL + 测试用例，供「测试先行 → 自动交付」执行。
> 基线：`7b61e3d`

---

## 0. 上下文确认（关键事实）

- `deploy-console` TypeORM `synchronize: true` + entity glob（`app.module.ts`），**新增 entity 自动建表**。
- `gateway` 显式 entities 数组；P1 两张新表**仅 deploy-console 消费**，gateway 不改。
- `deploy-console` 无测试基础设施 → 需引入 jest。
- 数据库 `web_system_deploy`；本机 mysql 客户端：`/Users/geekwen/local/mysql-8.4.0-macos14-arm64/bin/mysql`（后续脚本用 `$MYSQL` 代指）。
- 现有重复数据：`deploy_deployments` dev 下 admin 4 条、portal 24 条（均 a1f5301）。

---

## 1. 测试基础设施（先行搭建）

### 1.1 引入 jest

`servers/deploy-console/package.json` 增加：

```jsonc
"scripts": { "test": "jest", "test:watch": "jest --watch" },
"devDependencies": {
  "jest": "^29",
  "ts-jest": "^29",
  "@types/jest": "^29",
  "@nestjs/testing": "^10"
}
```

新增 `servers/deploy-console/jest.config.js`（ts-jest，testRegex `*.spec.ts`）。

### 1.2 测试分层

| 层 | 手段 | 覆盖 |
|---|---|---|
| 单元测试 | jest + `@nestjs/testing`，mock TypeORM Repository | service 层逻辑（upsert、命名、路由 CRUD） |
| 集成测试 | 脚本 + 真实 MySQL（`web_system_deploy`） | 唯一约束、数据迁移、entity 建表 |

> 集成测试用独立脚本（`scripts/_test-*.mjs`），不依赖 jest（真实 DB 断言，跑完清理），与之前 CDP 验证同一风格。

---

## 2. P0 实施方案（数据一致性 + 命名统一）

### P0-1 `deploy_deployments` 加唯一约束

**文件**：`scripts/migrations/p0-dedupe-deployments.sql`（新增）+ 集成测试脚本

```sql
-- 1) 去重：每组 (env_id, module_key) 保留 deployed_at 最新一条
DELETE t1 FROM deploy_deployments t1
JOIN deploy_deployments t2
  ON t1.env_id = t2.env_id AND t1.module_key = t2.module_key
 AND (t1.deployed_at < t2.deployed_at OR (t1.deployed_at = t2.deployed_at AND t1.id > t2.id));

-- 2) 加唯一约束
ALTER TABLE deploy_deployments ADD UNIQUE KEY uk_env_module (env_id, module_key);
```

**验证**：迁移后 `SELECT env_id, module_key, COUNT(*) c FROM deploy_deployments GROUP BY 1,2 HAVING c>1` 返回空；再插入重复会报 duplicate key。

### P0-2 `recordDeployment` 改原子 upsert

**文件**：`servers/deploy-console/src/deploy/deploy.service.ts` 的 `recordDeployment()`

当前逻辑 `findOne → save`（并发/历史重复根因），改为 TypeORM `upsert`：

```ts
await this.deploymentRepo.upsert(
  {
    envId: task.env,
    moduleKey: task.component,
    currentVersion: task.tag!,
    status: 'deployed',
    deployedAt: new Date(),
    deployedBy: task.operator,
    taskId: task.id,
  },
  ['envId', 'moduleKey'],   // 冲突键（对应唯一约束）
);
```

> 依赖 P0-1 的唯一约束先落地，`upsert` 的 conflict target 才有效。

### P0-3 `component` 命名统一（去 `mf:` 前缀）

**文件**：
- `servers/deploy-console/src/deploy/deploy.service.ts` `publishModule()`：`v.component = 'mf:' + moduleKey` → `v.component = moduleKey`
- `servers/deploy-console/src/deploy/deploy.controller.ts` `publishModule()`：audit log 的 `component: 'mf:' + body.moduleKey` → `body.moduleKey`

**存量迁移**（集成脚本）：

```sql
UPDATE deploy_versions SET component = REPLACE(component, 'mf:', '') WHERE component LIKE 'mf:%';
```

### P0-4 版本号统一 commit

**文件**：`servers/deploy-console/src/deploy/deploy.service.ts`

- `startDeploy()` 的 `generateVersionTag()` 从 `YYYYMMDD-HHMMSS-<commit>` 改为纯 `<commit>`（与 `publishModule` 一致）。
- 删除 `generateVersionTag` 中时间戳拼接逻辑，直接返回 `execSync('git rev-parse --short HEAD')`。

---

## 3. P1 实施方案（后端 serverName 服务器组 + 环境服务路由）

### P1-1 新增两张 entity（自动建表）

**文件**：
- `servers/deploy-console/src/entities/deploy-server.entity.ts`
- `servers/deploy-console/src/entities/deploy-env-service-route.entity.ts`

```ts
// deploy-server.entity.ts
@Entity('deploy_servers')
export class DeployServerEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 64 }) @Index() serverName: string;   // 组名，多台共享
  @Column({ length: 128 }) host: string;
  @Column({ length: 64 }) sshUser: string;
  @Column({ length: 255, nullable: true }) sshKeyPath?: string;
  @Column({ length: 255 }) remoteDir: string;
  @Column({ datetime, precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' }) createdAt: Date;
  @Unique(['serverName', 'host'])   // 同组同主机唯一
}
```

```ts
// deploy-env-service-route.entity.ts
@Entity('deploy_env_service_routes')
export class DeployEnvServiceRouteEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 32 }) @Index() envId: string;        // 前端环境
  @Column({ length: 64 }) @Index() serviceName: string;  // = deploy_modules.key
  @Column({ length: 64 }) serverName: string;            // 目标服务器组
  @Column({ int, nullable: true }) port?: number;
  @Column({ datetime, precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' }) createdAt: Date;
  @Unique(['envId', 'serviceName'])   // 每环境每服务一条路由
}
```

> `synchronize: true` 自动建表；注意 `SnakeNamingStrategy` 会把驼峰转下划线（`serverName → server_name`），与设计文档一致。

### P1-2 `deploy_environments` 下沉 host/ssh

**文件**：`servers/deploy-console/src/entities/deploy-environment.entity.ts`

移除 `host/sshUser/sshKeyPath/remoteDir` 四个字段，保留 `id/name/publicUrl/ports/builtin`。

**数据迁移**（集成脚本，幂等）：

```
对每个 environment：
  若无该 env 的默认 serverName（命名约定 `<env>-default`），
    在 deploy_servers 插入一条 { serverName: '<env>-default', host: 旧host, ... }
  对每个 backend 模块，若无路由，插入 deploy_env_service_routes
    { envId, serviceName: moduleKey, serverName: '<env>-default' }
```

> 过渡：`deploy.service.ts` 的 `buildEnvVars()` / `getSshConfig()` 读 environment 的 host/ssh 需改为**读 `deploy_servers` + 路由**。

### P1-3 服务器与路由 CRUD

**文件**（新增）：
- `servers/deploy-console/src/server/server.service.ts` + `server.controller.ts` + `server.module.ts`
- `servers/deploy-console/src/server/route.service.ts`（并入或独立）

**接口**（对齐设计 §8）：
- `GET /api/servers?serverName=` / `POST /api/servers` / `DELETE /api/servers/:id`
- `GET /api/env-service-routes?env=` / `POST /api/env-service-routes` / `DELETE /api/env-service-routes/:id`

DTO 追加 `ServerDto`、`EnvServiceRouteDto` 到 `common/dto.ts`。

### P1-4 `deploy.sh` 按环境服务路由分发

**文件**：`scripts/deploy.sh` 的 `deploy_backend_git`

`SERVER` 单变量 → 支持多服务器。deploy-console `executeDeployScript` 注入目标服务器列表（`DEPLOY_SERVERS` JSON），deploy.sh 遍历逐台执行 `git reset --hard + tsc + pm2 restart`。

---

## 4. 测试用例（先行）

### 4.1 P0 单元测试（jest，mock Repository）

| 用例 | 输入 | 预期 |
|---|---|---|
| `recordDeployment` 首次插入 | 无现有行 | 调 `upsert`，写入 1 条 |
| `recordDeployment` 重复部署 | 已有同 (env,module) 行 | 调 `upsert`，不产生重复（mock 断言 upsert 被调 1 次，conflict target = ['envId','moduleKey']） |
| `publishModule` 写 version | 发布 micro-frontend | `component === moduleKey`（无 `mf:` 前缀） |
| `generateVersionTag` | 任意 | 返回 7 位 commit（正则 `^[0-9a-f]{7}$`），不含时间戳 |

### 4.2 P0 集成测试（脚本 + 真实 DB）

| 用例 | 步骤 | 预期 |
|---|---|---|
| 唯一约束生效 | 迁移后 INSERT 重复 (env,module) | 报 duplicate key |
| 去重彻底 | 迁移后查重复组 | 空 |
| component 迁移 | 执行 UPDATE | `deploy_versions` 无 `mf:%` 前缀 |

### 4.3 P1 单元测试（jest）

| 用例 | 输入 | 预期 |
|---|---|---|
| 路由解析 | `route(env, service)` 存在 | 返回 serverName |
| 路由解析缺失 | 无路由 | 回退默认 serverName |
| 服务器组展开 | `servers(serverName)` | 返回该组多台服务器列表 |

### 4.4 P1 集成测试（脚本 + 真实 DB）

| 用例 | 步骤 | 预期 |
|---|---|---|
| 自动建表 | 启动 deploy-console（synchronize） | `deploy_servers` / `deploy_env_service_routes` 表存在，字段含 `server_name` |
| 环境下沉迁移 | 跑迁移脚本 | 每个环境有 `<env>-default` server + 各 backend 默认路由 |
| 路由 CRUD | POST 路由 → GET → DELETE | 增删查一致 |

---

## 5. 交付顺序与验收

1. **P0**（低风险）：P0-1 SQL → P0-2 upsert → P0-3 命名 → P0-4 版本号。**验收**：重复数据清零、唯一约束生效、`deploy_versions` 无 `mf:`、版本号纯 commit。
2. **P1**（结构改）：P1-1 entity → P1-2 下沉+迁移 → P1-3 CRUD → P1-4 deploy.sh。**验收**：两张表建好、迁移幂等、路由 CRUD 通、后端可多服务器分发。

> 每步「先写测试用例 → 实现 → 跑测试 → 通过才进下一步」。测试基础设施（§1）为 P0 前的前置步骤。

---

## 附录：改动文件清单

| 阶段 | 文件 | 操作 |
|---|---|---|
| 测试基建 | `servers/deploy-console/package.json` / `jest.config.js` | 改/新增 |
| P0 | `scripts/migrations/p0-dedupe-deployments.sql` | 新增 |
| P0 | `servers/deploy-console/src/deploy/deploy.service.ts` | 改（upsert + 命名 + 版本号） |
| P0 | `servers/deploy-console/src/deploy/deploy.controller.ts` | 改（audit 命名） |
| P1 | `servers/deploy-console/src/entities/deploy-server.entity.ts` | 新增 |
| P1 | `servers/deploy-console/src/entities/deploy-env-service-route.entity.ts` | 新增 |
| P1 | `servers/deploy-console/src/entities/deploy-environment.entity.ts` | 改（下沉） |
| P1 | `servers/deploy-console/src/server/*` | 新增 |
| P1 | `servers/deploy-console/src/common/dto.ts` | 改（加 DTO） |
| P1 | `servers/deploy-console/src/app.module.ts` | 改（注册模块） |
| P1 | `scripts/deploy.sh` | 改（多服务器分发） |
