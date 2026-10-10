# migrations（deploy-console 库）

## 当前决策：**不引入 migrations 体系**（方案 A，2026-10-09 定）

理由（详见 `config/db-synchronize.ts` 顶部注释）：

- deploy-console **只在 dev 机运行**（prod 无该进程），作用对象是 dev 运维库，可重建
- 云库（prod 指针读源）由 `CloudDbService` 单独建连接，那里**本来就是** `synchronize: false`
- 当前库结构就是 synchronize 建出来的，补 baseline 迁移的风险大于收益

所以本目录**刻意没有迁移文件**。`app.module.ts` 里的 `migrations` 接线保留，
但 `migrationsRun: false` —— 那是给将来预留的通道，**不是待办事项**。

## 什么时候要改成方案 B

出现任一情况：

1. console 要连生产库 / 不可重建的库
2. dev 库的表结构变更需要可追溯（现在只能翻提交历史）
3. 需要跨环境一致地升级表结构

## 方案 B 的收紧步骤

1. 设 `DB_SYNCHRONIZE=false`（先把自动 DDL 关掉）
2. `typeorm migration:generate` 生成 baseline（拿当前 synchronize 出的结构做基线）
3. **人工校验生成的 SQL** —— 重点看有没有 DROP、类型收窄
4. 按需放开 `migrationsRun`

## 手工 SQL 脚本在哪

本目录仍然**不放文件**。需要手工执行的 SQL 放在 `servers/deploy-console/scripts/*.sql`
（幂等，`information_schema` 判断 + `IF NOT EXISTS`），当前有：

| 脚本 | 用途 | 什么时候跑 |
|---|---|---|
| `config-center-base.sql` | 配置中心底座：加 layer/值类型等列、建 `config_revisions` / `config_deliveries`，并**回填存量行的 layer** | §1 结构部分仅在 `DB_SYNCHRONIZE=false` 时需要；**§2 layer 回填任何环境都要跑一次** |

> 为什么回填必须在脚本里：`layer` 列以默认值 `'app'` 加进去，而存量行混着 `MYSQL_*` 等
> 永不可下发的键（判据见 `src/config/config.service.ts` 的 `isRowDeliverable`）。
> `synchronize` 只会加列，不会帮你分类历史数据。

## ⚠️ 别和仓库根的 `migrations/` 混淆

仓库根 `migrations/` 是**另一回事**：那 7 个手写 SQL 是业务库用的
（生产库 `synchronize:false`，需手动执行），与本目录无关。
