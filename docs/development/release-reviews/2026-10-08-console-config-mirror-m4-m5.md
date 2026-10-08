# 发布评审：deploy-console 配置镜像双写（M4）+ 两库一致性检查（M5）

- 日期：2026-10-08
- 分支：`feat/console-config-mirror-m4-m5`
- 设计：`specs/deploy-console-env-datasource/design.md` §4 / §6 / §14
- 发布方式：`scripts/publish-deploy-console.sh --env dev`（console 不走流水线，E1 约束）

## 1. 改动范围

| 类别 | 内容 | 风险 |
|---|---|---|
| 新增能力 | `EnvSplitWriterService`：`mirrorRow` / `mirrorEntities` / `deleteMirror` / `flush`，内建异步队列 + 同键去重 | 中 |
| 接入点（5 service / 30 处） | `services.service.ts`(13)、`envs.service.ts`(7)、`apps.service.ts`(4)、`hosts.service.ts`(3)、`canary.service.ts`(3) | 中 |
| Module 接线 | `services/envs/apps/hosts/canary.module.ts` 引入 `CloudDbModule` | 低（不接则启动崩） |
| 单测 | `cloud-db-wiring.spec.ts`（新增 11 项）+ writer 新增 10 项 | 低 |
| 运维脚本 | `scripts/check-cloud-db-consistency.sh`（新增，可执行位） | 低（只读） |
| 文档 | design.md §7 / §13 遗留 / §14 | 低 |

## 2. 失败语义（design §6）

| 场景 | 行为 |
|---|---|
| 配置表镜像写失败 | **告警不阻断**（配置漂移不直接影响线上运行） |
| 业务的本地库写失败 | 行为不变（镜像只在本地写成功后追加） |
| 未命中白名单的表 | 跳过并记录 |
| 缺唯一键的行 | 跳过并告警（无法 upsert） |
| `DEPLOY_CLOUD_DB_ENABLED=false` | 全部 skipped，等同改造前，零开销 |

## 3. 发布前检查

| # | 检查项 | 结果 |
|---|---|---|
| 1 | `tsc --noEmit` | ✅ EXIT=0 |
| 2 | 全量单测（jest） | ✅ 51 suites / 558 tests passed（+21 新增） |
| 3 | Module 接线回归测试 | ✅ 8 个模块全部 import CloudDbModule |
| 4 | 是否已再加入点后同步登记 wire list | ✅ `cloud-db-wiring.spec.ts` 内 WIRED_MODULES |
| 5 | 是否涉生产表结构变更 | ❌ 无 DDL；镜像写走原生 upsert，`synchronize:false` |
| 6 | 是否需要数据迁移 | ⚠️ 需要一次基线补齐（见 §5） |

## 4. 发布后验证（必须全过）

| # | 用例 | 期望 | 实测 |
|---|---|---|---|
| 1 | `/console/` + `/api/apps` | 200 / 401 | ✅ |
| 2 | `/api/health/cloud-db` | ok | ✅ ok 37ms |
| 3 | pm2 restarts 稳定（无崩溃循环） | 不增长 | ✅ |
| 4 | **正向**：console 改一条配置（如新建灰度规则） | 云库同表出现同一行 | 待发后验 |
| 5 | **正向**：console 删一条配置 | 云库对应行消失（删除补偿生效） | 待发后验 |
| 6 | **反向**：dev 环境的配置改动 | 云库**不应**变化（dev 数据留本地） | 待发后验 |
| 7 | M5 巡检 | 12/12 一致 | ✅ 已验证（改坏→DIFF→还原→全绿） |

## 5. 基线补齐（发布前已完成）

- `deploy_deployments`：7 → 23 行（备份 `deploy_deployments-cloud-20261008-190158.sql`）
- `deploy_app_env_versions`：REPLACE 补齐（备份 `deploy_app_env_versions-cloud-20261008-200140.sql`）
- 现两侧 12/12 一致

## 6. 回退

| 级别 | 动作 |
|---|---|
| 一键关闭 | 远端 `.env` 设 `DEPLOY_CLOUD_DB_ENABLED=false` + `pm2 restart deploy-console`（回到人工同步现状） |
| 数据回退 | `mysql -h <云库> -P 27241 -u root web_system_deploy < /data/backup/deploy_app_env_versions-cloud-20261008-200140.sql` |
| 代码回退 | 远端保留 `dist.bak-<ts>`；`publish-deploy-console.sh` 失败也会自动回滚 |

## 7. 遗留 / 后续

- dev 机建议绑 **EIP**：现在用普通公网 IP，变配/重建会让云库白名单失效 → prod 发布静默失败
- M5 建议加 cron 每日巡检（`--quiet`），发现 DIFF 时告警
- `deploy_service_routes` 的唯一键含可空 `env_id`，只能按 uuid 幂等；若将来该表频繁删建，需重新评估删除补偿
