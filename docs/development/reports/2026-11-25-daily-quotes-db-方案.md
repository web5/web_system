# 2026-11-25 · NCE 每日美句冻结池改数据库存储（治本实施）方案

> 任务 s27 · rd-engineer · 用户 2026-11-25 明确拍板：**替代原方案 C（import JSON 进 dist）**，改为数据库存储。
> 基线：`origin/master = 08c2ebd7af570878f790a7f41de5eff37a9237b2`；实施 worktree：`web_system-dqdb`（长期保留）。
> 本文件同时是 dev-process-gate 的**流程凭证**（docs/development/reports/*.md）。

## 0. 问题与不变量

- 根因：`servers/content-hub/data/daily-quotes.json` 只在源码仓；发布 runtime 只保留 `dist/node_modules/package.json`（`backend-runtime.ts` 显式删 `data/`），`loadDailyQuotesPool()` 懒加载 `readFileSync` → ENOENT → controller 无 try/catch → 500。手工补文件只是止血。
- 硬约束：① 136 条逐字来自冻结资产（sha256 `6f5fe566dc9191d0dfae0d0211f8132b9492681b514ee4d7f58a9d2676fd0756`），零编造/零运行时生成/零 LLM；② HTTP 契约 `{code:0,data:{version,count,items},message:'ok'}` 与 `?version` 非法忽略行为不变；③ 小程序/admin/发布流水线本轮零改动；④ 不改本地午夜 UTC 口径；⑤ 不新建独立库（与 `nce_lessons` 同库 `web_system`）；⑥ 本轮不发布、不 ssh 写远端、不合并。

## 1. 架构与数据流（九子项 2.1）

```
GET /api/content-admin/nce/daily-quotes
  → gateway pathRewrite → content-hub NceController.dailyQuotes(version?)
  → DailyQuoteService.getPool()
      ├─ 内存缓存命中 → 直接返回（后续请求不查库）
      └─ 未命中 → Repository<DailyQuoteEntity>.find(pool_version=1, ordinal ASC)
            ├─ 校验通过 → 组装 {version,count,items} 并写入内存缓存 → 返回
            └─ 校验失败 / DB 抛错 → 抛错 → Nest 500（快速失败，绝不静默返回空池）
```

- DB 故障判据：**有缓存→用缓存（stale-while-error，冻结数据不会变，无过期概念）；无缓存→快速失败返回 5xx**。判据由 spec 覆盖。
- 并发：首次加载用 in-flight Promise 去重，避免同瞬间多请求打库。
- `daily-quotes.data.ts` 退化为纯类型/冻结常量载体（无 fs、无资产路径），彻底消除 runtime 文件依赖；资产 JSON 仍留在源码仓作为 seed 唯一真源与测试对照物。

## 2. 页面清单（2.2）

无新增页面/菜单。admin 只读查看 UI 属另一任务，本轮不碰。

## 3. 接口清单（2.3）

| 方法 | 路径 | 入参 | 出参 | 鉴权 |
|---|---|---|---|---|
| GET | `/api/content-admin/nce/daily-quotes` | `?version`（可选，非法值忽略不 500） | `{code:0,data:{version:1,count:136,items},message:'ok'}` | 无（沿用公开只读通道） |

无写接口；无新增 HTTP 端点。

## 4. 数据结构（2.4）

新表 `daily_quotes`（MySQL，`web_system` 业务库，与 `nce_lessons` 同库）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | INT UNSIGNED AUTO_INCREMENT | 主键 |
| `pool_version` | INT UNSIGNED NOT NULL DEFAULT 1 | 冻结池版本 |
| `ordinal` | INT UNSIGNED NOT NULL | 资产 `items[]` 原序 1..136 |
| `cn` / `en` | VARCHAR(512) NOT NULL | 冻结中英文逐字 |
| `source_book` | VARCHAR(16) NOT NULL | 恒 NCE2 |
| `source_lesson_id` | INT UNSIGNED NOT NULL | 课号 |
| `source_title` | VARCHAR(255) NOT NULL | 英文标题 |
| `source_line_index` | INT UNSIGNED NOT NULL | 行号 |
| `created_at` / `updated_at` | DATETIME(3) NOT NULL | 与实体 precision:3 对齐 |

索引：`UNIQUE (pool_version, ordinal)`（幂等 upsert 键 + 顺序唯一）、`UNIQUE (pool_version, source_lesson_id, source_line_index)`（身份键防漂移）。
DDL 必须显式进发布清单：新增 `migrations/0029_daily_quotes.sql`（`CREATE TABLE IF NOT EXISTS`，`-- @database web_system`）。TypeORM `synchronize` 不依赖：prod 关着也要靠 migration；dev 白名单主库即使开 synchronize 也不应以新表为唯一依赖（先 migration，后启动服务）。

## 5. 配置清单（2.5）

沿用 `DB_TYPE/DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE`，未新增任何配置项；网关路由沿用；无凭证改动。`resolveDbTarget` 白名单守卫不改，`synchronize` 语义不改（2026-10-26 事故不再犯）。

## 6. 依赖系统（2.6）

| 依赖 | 强度 | 缺失后果 | 处置 |
|---|---|---|---|
| `web_system` 业务库（与 nce_lessons 同库） | 强 | 无缓存时接口 5xx（明确定义） | migration + seed 先行；有缓存时降级读缓存 |
| 源码仓冻结资产 | 仅 seed/测试期强 | seed 无法执行（明确报错） | runtime 零依赖，发布包不需要它 |

## 7. 初始化数据 / 种子（2.7）

- `scripts/seed-daily-quotes.mjs`：读仓库资产 → 校验文件 sha256 精确等于 `6f5fe566…` + `version=1` + `count=136` + 每条形状/身份键 → 事务内清理非冻结行 → 按 `(pool_version, ordinal)` upsert 136 条 → 写后回读校验 count/逐字一致。任一校验失败非零退出，不写半套数据。
- 幂等：重复执行不重复插、不漂移；开发/测试环境每次发布前按需重跑，prod 由运维显式执行。
- dev/prod 执行顺序（本轮不执行，仅写入 runbook）：
  1. 备份：`mysqldump … web_system daily_quotes > …`（表不存在时跳过）；
  2. DDL：`./scripts/apply-migrations.sh dev|prod`（默认 `web_system`，或 `mysql … web_system < migrations/0029_daily_quotes.sql`）；
  3. Seed：在目标机带 `DB_*` 环境执行 `node scripts/seed-daily-quotes.mjs`（脚本用 mysql2，凭据从 env 读，不打印）；
  4. 验证：seed 自校验通过 + `SELECT COUNT(*) FROM daily_quotes WHERE pool_version=1` = 136 + 接口返回 `count=136` 且 sha 对照通过。
- 回滚：drop 新表（或保留空表）+ 代码回滚到上一 commit；接口随即回到文件加载路径（发布包需临时补 data/ 止血），故建议回滚与代码同步进行。

## 8. 权限模型（2.8）

无新增权限项；沿用公开只读。

## 9. 验证门（V1..Vn）与验收

- V1 冻结一致：spec 读仓库资产（相对路径）校验 sha256 + 136 条；service 返回的 items 与资产逐字深相等（含 source 四字段）。
- V2 契约不变：controller 返回 `{code:0,data,message:'ok'}`；`?version=1` / `not-an-int` / `-3` 恒返回同池、不 500。
- V3 缓存与性能：首次查库一次，第二次零查询；并发首次请求只查一次。
- V4 DB 故障：无缓存时 service reject（→5xx，不静默空池）；有缓存时 DB 报错仍返回缓存池。
- V5 形状防漂移：count≠136、ordinal 缺号、source 非法、version 混杂均可被 service 拒绝（spec 参数化）。
- V6 幂等 seed：脚本内校验 sha/count/内容；重复运行 upsert 不重复插（事务 + 唯一键）；用 dry-run 输出可审计。
- V7 静态纪律：无本机绝对路径硬编码（spec/脚本）；不改小程序/UI/发布流水线；`git status` 仅预期文件。
- V8 全绿：content-hub Jest 全量 + tsc --noEmit + PR 创建成功（本轮不合并/不发布）。
- V9 变异红绿：故意改坏一处判据（如把 `count !== 136` 改成 `count < 136`），确认对应 spec 变红，恢复后绿；证据写回执。

## 10. 追溯矩阵

| 需求/不变量 | 设计 | 改动 | 用例 | 发布 |
|---|---|---|---|---|
| 冻结 136 条逐字 | §1/§7 | entity + seed + migration | V1/V5/V6 | seed 后校验（本轮不执行） |
| 接口契约不变 | §3 | controller 注入 service | V2 | 发布前探针（后续） |
| 性能/DB 故障定义 | §1 | service 缓存/in-flight | V3/V4 | 运行期观察 |
| runtime 零文件依赖 | §1/§4 | daily-quotes.data.ts 去 fs | V1/V7 | 本轮不发布 |
| 不碰小程序/UI/流水线 | §2/§7 | 改动清单外零触碰 | V7 | — |

## 11. 风险与回滚

- ⚠️ migration/seed 本轮不执行（不 ssh 写远端）：上线前必须按 §7 顺序在 dev/prod 显式执行，否则新代码查到空表 → 接口 5xx（不会静默空池）。
- ⚠️ 若 DB_TYPE=postgres，本轮 SQL 为 MySQL 语法（与仓库既有 migration 先例一致），postgres 环境需另行适配。
- ⚠️ 缓存无失效机制：冻结数据本就不变；若将来需要换池，必须走「新 version + migration/seed + 重启」流程，不可热改 DB 期待立即生效。
- 回滚：代码 revert + （可选）DROP TABLE `daily_quotes`；无需回滚前端/小程序。
