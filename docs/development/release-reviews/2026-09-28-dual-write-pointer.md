# 发布评审：deploy 指针双写（legacy + 新模型）+ prod 站点补齐

- **日期**：2026-09-28
- **范围**：`servers/deploy-console/src/{registry,deploy,entities}/**`（含 `src/pipeline` 消费方，仅加依赖不改流程）
  + prod 数据库（新增 4 张表 + 种子数据）+ nginx（补 Host 透传）
- **关联**：PR #205（public 资源 CDN 化）、PR #207（base 段位契约统一）、任务 `raA2GB`

---

## 1. 背景与结论

`deploy_deployments`（legacy）目前承担**两个**角色，新模型只覆盖了其中一个：

| 角色 | 载体 | 现状 |
|---|---|---|
| 前端 env-dir 应用指针 | legacy + `deploy_app_env_versions` | dev 走新表，prod 因缺表走 legacy |
| 后端服务版本指针 | **仅 legacy** | 新模型无对应载体（auth/gateway/upload/system/shell） |

**结论：legacy 表不能删，改为「双写」过渡。** 前端应用写两处，后端服务只写 legacy。

## 2. 变更清单

### 2.1 代码（双写）

| 文件 | 变更 |
|---|---|
| `registry/release-registry.service.ts` | `setPointer` 写完 legacy 后调 `syncAppEnvPointer()`；新增 `appRepo`/`appVersionRepo` 注入；**失败只告警不抛出**（新表是增量真相源，不该让流水线红掉） |
| `registry/release-registry.module.ts` | 注册 `DeployAppEntity` / `DeployAppEnvVersionEntity` |
| `deploy/deploy.service.ts` | 两处微前端指针写入（`startPublishVersion`、`publishMicroFrontend`）后同步调用 `syncAppEnvPointer` |
| `entities/deploy-app-env-version.entity.ts` | 更正「替代旧 deploy_deployments」的过度表述：本表**只覆盖前端 env-dir 应用** |
| `entities/deploy-deployment.entity.ts` | 标注「本表仍是唯一后端服务指针，别当纯遗留表清理」 |

判定规则（数据驱动，无硬编码）：`deploy_apps.deploy_mode === 'env-dir'` 才双写；未登记（后端服务）或 `site-version`（shell）跳过。

### 2.2 数据（prod）

`scripts/migrations/p29-prod-new-deploy-tables.mjs`：

- 建 4 表（`deploy_sites` / `deploy_envs` / `deploy_apps` / `deploy_app_env_versions`），DDL 与 dev 实测一致，`CREATE TABLE IF NOT EXISTS` + information_schema 守卫，**幂等**；
- 种子：site `prod`→`kedouai.com`、env `prod`(isProd)、apps `admin`/`portal`(env-dir) + `shell`(site-version)、版本指针 `d9889ff`；
- `EMIT_SQL=1` 可导出纯 SQL（云数据库只能从跳板机访问时走这条路）。

磁盘：写 env-dir 入口指针 `static/modules/{admin,portal}/prod/index.js`（`System.register(['./d9889ff/index.js'])`）+ `index.css`（`@import`），版本目录用**复制**（原扁平目录保留，随时可回退）。

### 2.3 nginx（网关机 42.194.200.69）

`conf.d/default.conf` 的主站 `location /` **缺 `proxy_set_header Host`**，nginx 默认传 `$proxy_host`（= `106.52.176.246`），
gateway 按 Host 匹配 `deploy_sites` 永远落空（manifest `source: new:nosite`，byEnv 空）。已补 Host / X-Real-IP / XFF / X-Forwarded-Proto，
`nginx -t` 通过并 reload（备份 `default.conf.bak-20260928-hostheader`）。

## 3. 验证

| 项 | 结果 |
|---|---|
| 单测 | `release-registry.service.spec.ts` + `deploy.service.spec.ts` **28 passed**（含 4 条新增双写用例：env-dir 写新表 / previousVersion / 后端与 shell 不写 / 新表失败不阻断） |
| 构建 | `npm run build`（deploy-console）通过 |
| prod manifest | `source: new`、`site: prod`、`byEnv.prod` 含 admin+portal，入口 `/static/modules/<k>/prod/index.js` |
| prod 页面 | `/`、`/admin/`、`/portal/chat` 均 200；`prod/index.js` 与 `prod/d9889ff/index.js` 均 200 |
| dev | 未改动（仍 `source: new`，`byEnv.dev` 正常） |

## 4. 风险与回退

| 风险 | 处置 |
|---|---|
| 双写新表失败 | 只 `logger.warn`，legacy 已写成功 → 页面不受影响，两轨不一致可由告警发现 |
| prod 新表数据不生效 | gateway 自动回落 legacy（`new:error` / 删表即回退），页面无感 |
| nginx Host 变更影响面 | 仅影响按 Host 匹配站点的逻辑；其余依赖 Host 的只有日志，已同步补 XFF/X-Real-IP |
| 入口指针写错 | 旧扁平目录 `d9889ff` 保留未动；删掉 `prod/` 即回到 legacy 路径 |

回退步骤（prod）：① 删/改名 `static/modules/*/prod/`；② `DROP` 4 张新表；③ nginx 还原 `default.conf.bak-20260928-hostheader` 并 reload。

## 5. 遗留

- `deploy.service.ts` 另有 3 处**后端**路径的 legacy 直写（upsert at 333/754/777）——按结论后端只写 legacy，**无需**双写；但建议后续统一收敛到 `ReleaseRegistryService`。
- 停写 legacy 的前提：prod/dev 全量铺开 `deploy_sites`（已完成）+ shell 全量升级（已完成，PR #207 之后）+ 后端服务指针在新模型有载体（**未做**）。
- prod 的 `deploy_app_env_versions` 目前只有人工灌的 `d9889ff`；后续由双写自动维护。
