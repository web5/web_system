阻塞: 0
重要: 1

> **复审状态**：已完成第二轮复审（见文末「复审记录（第二轮）」）。原 2 条阻塞已整改并经评审方自建临时库复跑验证通过；剩余 1 条重要项（R5 错库残留未清理）。

# 发布评审报告 · M0 修复批（2026-09-25）

> 评审角色：`release-reviewer`（独立第三方，非执行者）。判据源：`docs/development/release-review-checklist.md`（A1–E3）。
> 判断标准：**跑起来时加载的是不是它 / 配置是不是它该用的那份 / 回滚得回来吗**，不是「代码写对没写对」。
> 不采信「我本地跑过了」类自辩；下列「实测」均为评审方在本机只读查询/静态核验得到的证据，非执行者陈述。

---

## 改动面

| # | 文件 | 面 | 评审关注 |
|---|---|---|---|
| 1 | `migrations/0009_pipeline_vars_and_template_env.sql` | C 数据面 | 补 `-- @database web_system_deploy` |
| 2 | `migrations/0010_pipeline_task_states.sql` | C 数据面 | 同上；本体是非幂等 `ADD COLUMN` |
| 3 | `migrations/0014_deploy_host_scope.sql` | C 数据面 | 同上 + 注释补充 |
| 4 | `servers/deploy-console/src/services/services.service.ts:151` | 业务代码（**不在触发面**，见 §零摩擦边界） | `m.pm` → `m.pm2` |
| 5 | `scripts/pipeline/fetch-config.sh` | B 配置面 | `DEPLOY_ENV_ID ?? DEPLOY_ENV` 兼容解析 |
| 6 | `scripts/release-deploy-console.sh` | A 运行面 | `--skip-sync` → `--from-release --branch` + 分支名白名单 |

目标环境：local / dev / prod。

**关键事实（实测，本机库只读查询 + 静态核验，证据来源标注在每条里）**

- `servers/deploy-console/.env:42` → `MYSQL_DB=web_system_deploy`；`app.module.ts:54` → `synchronize: true`（**无 NODE_ENV 判定，prod 同样开启**）。
- `scripts/apply-migrations.sh:42` → `MIGRATIONS_DIR="$SCRIPT_DIR/migrations"`（仓库根）；`:89` → 无注解时回落 `web_system`；`:175` → 记账表 `schema_migrations` **建在目标库内**（即分库记账）。
- 实测 `information_schema.TABLES`：`deploy_hosts` / `deploy_pipelines` / `deploy_pipeline_runs` **只存在于 `web_system_deploy`**（`web_system` 里没有）。
- 实测 `web_system` **存在 `deploy_pipeline_vars`（0 行）** ← 错库误写的实锤（0009 的 `CREATE TABLE IF NOT EXISTS` 在默认库建成，随后 `ALTER deploy_pipeline_templates` 报 1146 中止）。
- 实测列现状（`web_system_deploy`）：`deploy_hosts.scope` ✅、`deploy_hosts.managed_by` ✅、`deploy_pipeline_runs.task_states` ✅、`deploy_pipelines.env` ✅ —— 即三张表的目标列**均已由 synchronize 建好**。
- 实测记账：`web_system_deploy.schema_migrations` = `{0014_deploy_host_scope.sql}`；`web_system.schema_migrations` = 0001–0007、0012–0014(mp)、p26、p27（**无 0009/0010/0014_deploy_host_scope**）。
- 实测回填结果：`deploy_hosts` 三行 = `local-default/local/orchestrator`、`dev-default/cloud/NULL`、`prod-default/cloud/NULL` ✅。
- 改名事实：`scripts/migrations/p9-rename-pipeline-tables.mjs:119` → `deploy_pipeline_templates` **已 RENAME 为 `deploy_pipelines`**（p9 提交于 2026-09-17，晚于 0009 的 2026-09-15）。
- `pipeline.service.ts:381` → `DEPLOY_ENV: i.env || ''`（值域 local/dev/prod）；`:591 consoleApiBase()` → `http://127.0.0.1:${port}/api`（**带 `/api` 后缀**）；`config.controller.ts:29` → `@Controller('config')` + `main.ts` `setGlobalPrefix('api')` → 真实路由 = `/api/config/internal/dispatch/:serviceKey`。
- `p25-restart-config-dispatch.mjs:57` → 已在使用 `${CONSOLE_API%/}/config/internal/dispatch/${MODULE_KEY}?envId=${DEPLOY_ENV}`（**无 `/api` 二次拼接**，正确写法）。

---

## 逐条评审

### R1 · 0009 补头正确，但迁移本体已失效：目标表 `deploy_pipeline_templates` 已被改名 → 补头后**必失败**，且永久失败 → **阻塞**

- **反例**：运维在任一环境跑 `bash scripts/apply-migrations.sh <env>` 期望「三个迁移落到 `web_system_deploy` 且全绿」。
  实际：0009 先 `CREATE TABLE IF NOT EXISTS deploy_pipeline_vars`（成功，且该表已存在），随后 `information_schema` 判定 `deploy_pipeline_templates.env` 不存在 → 执行 `ALTER TABLE deploy_pipeline_templates`（`0009:55-58`）→ **ERROR 1146 Table 'web_system_deploy.deploy_pipeline_templates' doesn't exist** → mysql 客户端默认遇错中止 → 脚本报「应用失败」、`failed++`、**退出码 1**；且**记账 INSERT 未写入**（`:181` 的 INSERT 与文件体同一批 SQL，中止后不执行）→ 下次再跑**仍然失败**，永不自愈。
  期望：迁移要么成功要么被明确跳过，不应留下一条每次执行都红、且运维无法判断「真失败 / 可忽略」的项。
- 证据：`p9` 改名（2026-09-17）晚于 0009（2026-09-15）；本机 `information_schema.TABLES` 中三个库均无 `deploy_pipeline_templates`；实体侧模板表已改为 `@Entity('deploy_pipelines')`。
- 判据：**C1**（跨库误写——补头本身修对了这点，**本条不判 C1 失败**）+ **C2**（迁移幂等/可重跑，非幂等或失效迁移重跑即事故）。
- 严重级：**阻塞**。是否阻塞：**是**。
- 处置（三选一，均不需改业务代码）：
  1. 修正 0009：把 `deploy_pipeline_templates` 改为 `deploy_pipelines`（`env` 列已存在，且 0009 自身有 information_schema 守卫 → 修正后幂等通过）；
  2. 若确认该迁移已被 synchronize 完全覆盖 → **手工记账跳过**（命令见「发布后验证清单」§3）；
  3. 本次发布**不执行** `apply-migrations.sh`（deploy-console 全环境 synchronize=true，迁移对它本就是冗余的）。

### R2 · 0010 非幂等 `ADD COLUMN`，而 `synchronize: true` 无条件开启 → 已启动过新代码的库**必 duplicate column** → **阻塞**

- **反例**：prod 控制台重启到含 `taskStates` 实体的版本后（synchronize 自动加列），运维再跑 `apply-migrations.sh prod` 期望幂等跳过。
  实际：`0010:9` 是裸 `ALTER TABLE deploy_pipeline_runs ADD COLUMN task_states json NULL`，**无 information_schema 守卫** → **ERROR 1060 Duplicate column name 'task_states'** → 同上中止、不记账、**每次跑都红**。
  期望：加列类迁移必须先查 `information_schema` 再 `PREPARE`（0009/0014 已这么做，0010 没做）。
- 环境差异（重要）：local/dev/prod 行为**不一致**——已重启到新代码的库（列已存在）必失败；尚未重启的库（列不存在）**会成功并记账**。同一个迁移在不同环境结果相反，正是 C4 要求「按环境执行 + DRY_RUN 先演练」的原因。
- 证据：实测 `web_system_deploy.deploy_pipeline_runs.task_states` 已存在；`app.module.ts:54` `synchronize: true` 无环境判定；`deploy-pipeline.entity.ts:168 taskStates`。
- 判据：**C2**（迁移幂等）。
- 严重级：**阻塞**。是否阻塞：**是**。
- 处置：① 给 0010 补 information_schema 守卫（与 0009/0014 同款）后再执行；或 ② 按环境核实列已存在 → 手工记账跳过（见清单 §3）；或 ③ 本次不跑迁移。

### R3 · 0010 无反向迁移、无回滚路径 → **重要**

- **反例**：0010 在某环境执行成功后发现 `task_states` 列类型/语义不合预期，期望有回滚动作。
  实际：文件内无回滚段（0009 有 `-- 4) 回滚` 段，0010 没有），`migrations/` 下也无对应的 `0010_*.down.sql`。
  期望：任何落库变更都要能反向走回去（至少给出 DROP 语句）。
- 判据：**C6**（破坏性变更有回滚路径）。
- 严重级：**重要**。是否阻塞：否（ADD COLUMN 属加性变更，可逆操作明确）。
- 逆操作（执行前先备份）：`mysqldump <凭据> web_system_deploy deploy_pipeline_runs > /tmp/runs.bak.sql`；回滚 `ALTER TABLE deploy_pipeline_runs DROP COLUMN task_states;`

### R4 · `fetch-config.sh` URL 拼出 `/api/api/...`：一旦挂载到流水线必 404 → 激活休眠 bug → **重要**

- **反例**：F5（`fetch-config.sh` 挂到 restart 动作之前，`docs/development/master-todo-2026-09-25.md:68` 待办）上线后跑一次「重启型发布」，期望拉到配置并落 `.env.generated`。
  实际：`CONSOLE_API` = `http://127.0.0.1:6200/api`（`pipeline.service.ts:591`），脚本 `fetch-config.sh:41` 拼成 `${CONSOLE_API}/api/config/internal/dispatch/...` = **`/api/api/config/internal/dispatch/...`** → 404 → `case "*")` → `die "拉取失败：HTTP 404"` → **exit 1** → 按 `specs/service-config-delivery` 的 fail-fast 语义「不落地、不重启」→ **重启型发布会红**。
  期望：与已上线脚本一致（`p25` 用 `${CONSOLE_API%/}/config/...`）。
- 为什么现在才成为问题：改动前脚本因 `DEPLOY_ENV_ID` 未被注入而**恒 skip（exit 0）**，这条坏 URL 一直休眠；本次修复「恒 skip」= **激活了它**。
- 判据：**B3**（关键依赖配置非缺失/不正确——URL 错等于配置下发链路不可用）。
- 严重级：**重要**。是否阻塞：否（本次未挂载，不会触发），但**列为放行前置条件：挂载 F5 前必须先修 URL**。
- 处置：`URL="${CONSOLE_API%/}/config/internal/dispatch/..."`（或先 `CONSOLE_API="${CONSOLE_API%/api}"`）。

### R5 · 错库残留 `web_system.deploy_pipeline_vars`（0 行）需清理 → **重要**

- **反例**：补头后目标库正确了，期望「错库污染已消除」。
  实际：实测 `web_system.deploy_pipeline_vars` 存在（0 行），是 0009 在无注解时期部分执行留下的跨库垃圾表；`web_system` 里永远不会有人读它（deploy-console 连 `web_system_deploy`），属于静默污染，下一次审计还会把它当成「deploy 表怎么会在 web_system」的疑点。
  期望：错库误写留下的痕迹被显式处置（清理或登记）。
- 判据：**C1**（未声明目标库 → 跨库误写；修复后残留未处置）。
- 严重级：**重要**。是否阻塞：否（0 行、无引用、无读取方）。
- 处置：`mysqldump web_system deploy_pipeline_vars > /tmp/pvars.bak.sql` 后 `DROP TABLE web_system.deploy_pipeline_vars;`（**按环境各自核实行数后再动**）。

### R6 · 0014 新增注释「执行报错 + 记账成功」与实现不符，会误导修账路径 → **重要**

- **反例**：运维按 0014 头注释（`:14-15`）判断「虽然报错但已记账，后续再也补不上，必须手工修记账」，于是去手工改账。
  实际：`apply-migrations.sh:181` 把「文件体 + `INSERT INTO schema_migrations`」放进**同一批** SQL 交给 mysql；mysql 客户端在批量模式下**遇错即中止**（未加 `--force`），报错时 INSERT **不会执行** → 记账**没有**写入。实测也印证：`web_system` 的 `schema_migrations` 里没有 0014_deploy_host_scope，`web_system_deploy` 里有（说明它是以正确库成功执行/记账的，不是「报错但记账」）。
  期望：注释与实现一致，否则运维按错的模型去修账（可能误用 `--baseline-through` 造成不可逆跳过）。
- 判据：**C2**（记账语义；错账/误账会永久跳过）。
- 严重级：**重要**。是否阻塞：否（不影响运行，只影响人工处置判断）。
- 处置：把该注释改为「mysql 遇错即中止 → 不会记账；若曾以错库执行成功（如 0009 的 CREATE TABLE 部分），需按环境核实后手工修账」。

### R7 · 0014 本体：补头 ✅、幂等 ✅、记账 ✅ —— 通过

- 反例（不存在）：补头后重复执行 → `scope`/`managed_by` 已在 → information_schema 守卫命中 → `SELECT 1` → 幂等通过 ✅；`web_system_deploy.schema_migrations` 已有 `0014_deploy_host_scope.sql` → 直接跳过 ✅。
- 判据：**C1 / C2 / C4** 均满足。严重级：通过。是否阻塞：否。

### R8 · `DEPLOY_ENV` 与 `DEPLOY_ENV_ID` 语义核实：**等价**，兼容回退安全 → 通过（非阻塞）

- 核实结论：`pipeline.service.ts:381` 注入 `DEPLOY_ENV = i.env`（local/dev/prod）；dispatch 接口的 `envId` 用于匹配 `config_items.envId`，单测取值 `'local'`/`'dev'`（`config.controller.spec.ts:79`）；gateway 侧 `DEPLOY_ENV_ID` 取值同样是 `local|dev|prod`（`version.controller.ts:40`、`.env.example:60`）；且已上线脚本 `p25:57` 用的就是 `?envId=${DEPLOY_ENV}`。
  → **两者是同一个值域（环境名），不存在「环境名 vs 环境 ID」的语义错位**，不是阻塞项。
- 判据：**B3**（关键依赖配置取值正确）。严重级：通过。是否阻塞：否。
- 附带风险（见 R10）。

### R9 · `release-deploy-console.sh` 改用 `--from-release`：修复正确，且确为 local 限定 → 通过（A1/A2/E1 满足）

- 反例（已修）`：publish-deploy-console.sh:62` 未知参数 → `exit 2` → 原 `--skip-sync` 链路恒断。
  修复后：`--from-release` 是受支持参数 ✅；release 脚本不传 `--env` → `publish:54` 默认 `local` → `publish:66 FROM_RELEASE_ALLOWED=1` ✅（`publish:97` 明确 `--env dev|prod` 禁止 `--from-release`）→ **local 限定成立**。
- 构建位置：`publish:164-171` 用 `${RELEASE_DIR}/node_modules/.bin/nest build` + `vite build`，**在发布目录就地构建**；`publish:281` `--from-release` 时跳过 dist 复制 → **A1 满足**（构建发生在发布目录，不是工作区）；release 脚本先 `fetch + merge --ff-only`（`:88-89`）→ **A2 满足**；`ecosystem.config.cjs:31` 已登记 `web-deploy-console` → **A5 满足**；publish 用 `env -i` 干净 env + `pm2 delete` + `pm2 start`（`:304/:341-344`）→ **B1 满足**；发布后有 `/console/` + `/api/apps` 探活 + 崩溃循环检测 → **E3 满足**；deploy-console 不走平台流水线 → **E1 满足**。
- 判据：**A1 / A2 / A5 / B1 / E1 / E3**。严重级：通过。是否阻塞：否。

### R10 · 依赖优先级 `DEPLOY_ENV_ID` 优先于 `DEPLOY_ENV`，前者不受保护键约束 → **建议**

- 反例：将来配置中心/模板级变量里出现 `DEPLOY_ENV_ID`（gateway 的 `.env` 里就有这个键），它在 `PROTECTED_STAGE_KEYS`（`pipeline.service.ts:284`）与 `RESERVED_LOCAL_KEYS`（`config.service.ts:49`）**都不在名单里** → 会被注入脚本 env → `fetch-config.sh:33` 优先采信它 → 可能用**另一个环境**的 envId 去拉配置（例如流水线跑 local 却拉到 dev 的配置并落盘）。
- 判据：**B5**（配置源唯一）。严重级：**建议**。是否阻塞：否。
- 处置：把优先级反过来（以 `DEPLOY_ENV` 为准），或把 `DEPLOY_ENV_ID` 加入保留/保护键名单。

### R11 · release 与 publish 两处 git 同步职责重复 → **建议**

- 反例：release 脚本已 `fetch + merge --ff-only`（`:88-89`）并打印 `commit=${NEW}`；publish `--from-release` **又做一遍**（`publish:151-163`）。两次之间若有人 push，publish 会再快进一次 → **实际构建的 commit ≠ 脚本宣告的 `NEW`**，排障时按 NEW 去对代码会对不上。同步本身 ff-only、幂等，**不冲突**。
- 判据：**A2**（发布目录 git HEAD 与预期分支一致）。严重级：**建议**。是否阻塞：否。
- 处置：publish 的重复同步可用 `--skip-build`（跳过同步）——但那会连构建一起跳掉，故建议改为「release 同步后把 HEAD 传给 publish 校验」，或接受现状并在日志里以 publish 内实际 HEAD 为准。

### R12 · `--from-release` 路径跳过 `vue-tsc`，且不会重建 `packages/*` → **建议**

- 反例：发布目录的 `packages/*/dist` 是**构建产物且被 `.gitignore` 忽略**（`.gitignore:7`）；`apps/deploy-console` 依赖 `@web-system/ui`、`servers/deploy-console` 依赖 `@web-system/shared`，二者 `main` 均指向 `dist/index.js`，只能靠 `tsc` 产出，`prepare/prebuild` 钩子**不存在**。
  `--from-release` 只跑 `nest build` + `vite build`（`publish:167-171`），**不重建 packages** → 若发布目录里 packages dist 陈旧，产物会**静默用旧包**（典型 A3 症状：常量/权限码改了不生效且无报错）；另外前端 `npm run build` = `vue-tsc --noEmit && vite build`（`apps/deploy-console/package.json:8`），该路径**跳过了类型检查**。
  本次改动不涉及 `packages/*` → 风险未兑现。
- 判据：**A3**（workspace 包走完整 build 脚本）。严重级：**建议**。是否阻塞：否。
- 处置：涉及 packages 改动时，先cd 发布目录跑 `pnpm -r --filter "./packages/**" build` 再发布；发布后核对前端入口 hash 变化（清单 §6）。

### R13 · 分支名白名单可能误伤合法分支名 → **建议**

- 反例：`release-deploy-console.sh:57-61` 只允许 `[A-Za-z0-9._/-]`。git 合法分支名可含 `@`、`+`、中文、空格 → 这类分支会被拒（exit 1），而它是被 `eval` 拼进命令行的参数，防注入的收益是实打实的。
- 判据：**A2**（分支一致性，类比）。严重级：**建议**。是否阻塞：否。

### R14 · `services.service.ts:151`（`m.pm` → `m.pm2`）：**不在本次触发面**，仅附注 → **建议**

- 作用域判定：清单 §用法 3 的触发面为 `scripts/migrations/*.sql`、`servers/*/.env`、`ecosystem.config.cjs`、`scripts/pipeline/**`、发布相关脚本；§零摩擦边界明确「业务代码改动走各自评审」→ 本条**不在发布评审触发面内**，不据此判阻塞。
- 附注事实（对「加载的是不是它」有影响，故记录）：`DeployModuleEntity` 只有 `pm2?: string`（`deploy-module.entity.ts:41`），**没有 `pm`** → HEAD 的 `m.pm` 是 **TS2339**，`nest build` 必失败 → **改动前 deploy-console 根本构建不出产物**（即运行中的 dist 必是更旧来源）。改动后实测 `npx tsc --noEmit -p tsconfig.json` → **EXIT=0** ✅。
- 判据：**A3**（类比：构建能否产出）。严重级：**建议**（作为修复已验证通过）。是否阻塞：否。

---

## 结论（第二轮复审后 · 最终）

**⚠️ 有条件放行**

第二轮复审后：**阻塞 0 / 重要 1**。原 R1、R2 两条阻塞已整改并经评审方独立复跑验证（自建临时库，四场景覆盖），不再阻塞；原不再需要「手工记账跳过」这类绕行处置——`apply-migrations.sh` 现在可以按环境直接执行（幂等已验证）。

剩余放行前置条件：

1. **（R5，未整改，重要）** 清理错库残留 `web_system.deploy_pipeline_vars`（先 `mysqldump` 备份；实测 0 行）。这是 C1 跨库误写留下的痕迹，虽无人读取、不影响运行，但会持续误导后续审计（「deploy 表为什么在业务库」）。可与发布并行处理，不阻断发布动作本身。
2. **（流程性，C4）** 执行迁移时按环境 `DRY_RUN=1` 先演练、确认三个文件目标库均为 `web_system_deploy`；**不得**用 `--baseline-through` 批量基线（记账一旦记错**不可逆**，后续永久跳过）。
3. **（C6）** dev/prod 首次执行 `0014` 前先 `mysqldump` 单表快照（其 `UPDATE deploy_hosts` 是覆盖型写入、文件内无反向 SQL，本轮未整改，属既有缺口）。
4. **（R9/R12）** 发布后按验证清单 §5/§6 确认 6200 上跑的确实是发布目录新产物。
5. **（R4）** `fetch-config.sh` 已修，但**挂载**到流水线 restart（F5）时按清单 §7 冒烟一次再放行该挂载动作。

**回滚性**：本批改动**无不可逆部分**——迁移头/脚本/字段读取全部可回退（git revert 即可）。唯一需人工处置的是①错库残留表（DROP 前先 dump）②`schema_migrations` 记账（INSERT 可 DELETE 撤销，但 `--baseline-through` 批量基线**不可逆**，执行前先留档）。

---

## 发布后验证清单（可执行命令）

> dev/prod 凭据走目标机 `.env`（`apply-migrations.sh` 自动取）；local 用 `servers/deploy-console/.env` 的 `MYSQL_*`。

**1）目标库演练（C4，三环境各跑一次，只看不落库）**
```bash
DRY_RUN=1 bash scripts/apply-migrations.sh local
DRY_RUN=1 bash scripts/apply-migrations.sh dev
DRY_RUN=1 bash scripts/apply-migrations.sh prod
# 期望：0009/0010/0014 三行 → 库 web_system_deploy（不是 web_system）
```

**2）目标表归属复核（期望 deploy_* 只在 web_system_deploy）**
```bash
mysql --defaults-extra-file=<cnf> -N -e \
 "SELECT table_schema,table_name FROM information_schema.TABLES
  WHERE table_name IN ('deploy_hosts','deploy_pipelines','deploy_pipeline_runs','deploy_pipeline_vars','deploy_pipeline_templates');"
```

**3）记账与列现状（决定「跑」还是「记账跳过」）**
```bash
mysql ... -N -e "SELECT name FROM web_system_deploy.schema_migrations ORDER BY name;"
mysql ... -N -e "SELECT table_name,column_name FROM information_schema.COLUMNS
  WHERE table_schema='web_system_deploy' AND (
    (table_name='deploy_hosts'          AND column_name IN ('scope','managed_by'))
 OR (table_name='deploy_pipeline_runs'  AND column_name='task_states')
 OR (table_name='deploy_pipelines'      AND column_name='env'));"

# 列已存在 → 手工记账跳过（不要硬跑，0010 会 1060）：
mysql ... web_system_deploy -e "INSERT INTO schema_migrations(name) VALUES
  ('0009_pipeline_vars_and_template_env.sql'),('0010_pipeline_task_states.sql')
  ON DUPLICATE KEY UPDATE applied_at=applied_at;"
# 记账前先留档：SELECT * FROM web_system_deploy.schema_migrations;
```

**4）错库残留核实与清理（R5）**
```bash
mysql ... -N -e "SELECT COUNT(*) FROM web_system.deploy_pipeline_vars;"   # 期望 0
mysqldump ... web_system deploy_pipeline_vars > /tmp/pvars.bak.sql
mysql ... -e "DROP TABLE web_system.deploy_pipeline_vars;"
```

**5）deploy-console 发布链路（A1/A2/E3）**
```bash
DRY_RUN=1 bash scripts/release-deploy-console.sh --branch <分支>   # 期望出现 --from-release --branch
bash scripts/release-deploy-console.sh --branch <分支>
git -C "$HOME/web_system_release" log --oneline -1                 # A2：HEAD == 目标分支
pm2 describe web-deploy-console | grep -E "script path|exec cwd"   # A1：指向发布目录
lsof -tiTCP:6200 -sTCP:LISTEN | xargs -I{} sh -c 'echo listen={}' # A4：== pm2 pid
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6200/console/   # 期望 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6200/api/apps   # 期望 200|401
```

**6）A3：产物确实换了（前端入口 hash + packages 陈旧检查）**
```bash
grep -oE 'index-[^"]*\.js' "$HOME/web_system_release/apps/deploy-console/dist/index.html" | head -1
ls -l "$HOME/web_system_release/packages/shared/dist/index.js" "$HOME/web_system_release/packages/ui/dist/index.js"
# 若 packages 源码有改动而 dist 时间戳未更新 → 先在发布目录跑：pnpm -r --filter "./packages/**" build
```

**7）fetch-config 冒烟（R4，挂载 F5 前必做）**
```bash
CONSOLE_API=http://127.0.0.1:6200/api CONSOLE_TOKEN=<INTERNAL_API_KEY> DEPLOY_ENV=local \
RELEASE_DIR="$HOME/web_system_release" MODULE_KEY=gateway \
DRY_RUN=1 bash scripts/pipeline/fetch-config.sh
# 看打印出的 URL：出现 /api/api/ 即为 R4 缺陷，挂载前必须修
curl -s -o /dev/null -w '%{http_code}\n' -H "x-internal-key: <INTERNAL_API_KEY>" \
  "http://127.0.0.1:6200/api/config/internal/dispatch/gateway?envId=local"   # 期望 200|204
```

**8）构建可用性（R14）**
```bash
cd servers/deploy-console && npx tsc --noEmit -p tsconfig.json   # 期望 EXIT=0
```

---

## 无判据项（个人偏好，可驳回）

1. **（无判据）** 建议给 `migrations/` 加 CI 机检：无 `-- @database` 头的文件直接拦（C1 目前靠人工注释约定，0009/0010/0014 就是漏网的三个）。清单里 C1 只给了「怎么验」，没给「强制」，故属偏好。
2. **（无判据）** 建议给 `migrations/` 加编号唯一性检查：当前存在两组重号（`0010_conversation_intent_routing.sql` / `0010_pipeline_task_states.sql`，`0014_deploy_host_scope.sql` / `0014_mp_account_phone_email.sql`）。排序与记账按文件名全字符串比较，目前不冲突，但 `--baseline-through` 的「≤」语义会被重号放大误伤范围。
3. **（无判据）** 建议 `apply-migrations.sh` 在迁移失败时把「未记账」显式打印出来（当前只打印「应用失败」，运维无法区分「失败且未记账（可重试）」与「部分成功」）。
4. **（无判据，已知缺口）** `scripts/migrations/**`（26 个 `.mjs` + 3 个 `.sql`）不在 `apply-migrations.sh` 扫描范围（该脚本只扫根 `migrations/*.sql`）→ 这几份变更的执行/记账完全靠人工，无账本。属既有缺口，不在本次评审范围。
5. **（无判据）** `migrations/0002_upload_gateway_admin_tables.sql` 跨库混合（`web_system` 与 `web_system_deploy` 表同文件），单靠 `@database` 头修不了，需拆文件 —— `docs/development/dev-prod-release-plan-2026-09-25.md:117` 已记，此处仅同步提示。
6. **（无判据）** `servers/deploy-console/src/services/services.service.ts` 属业务代码，按清单 §零摩擦边界不在发布评审触发面，本报告的 R14 只是附注，不构成放行/阻塞依据。

---

## 复审记录（第二轮）

**复审方式**：不采信执行者自述。评审方**自建临时库**（`ws_mig_a` / `ws_mig_b` / `ws_mig_c` / `ws_mig_d`）复跑迁移文件本体，验证完已全部 `DROP`（复跑后 `SHOW DATABASES LIKE 'ws_mig%'` 为空）。

```bash
M="/Users/geekwen/local/mysql-8.4.0-macos14-arm64/bin/mysql"
# 场景A（列/表均已存在，等价 local、dev） 场景B（表在列缺，等价未 synchronize 的 prod）
# 场景C（目标表完全不存在）               场景D（新旧表名同时存在）
"$M" -h 127.0.0.1 -P 3306 -uroot -p"$P" <db> < migrations/0009_pipeline_vars_and_template_env.sql; echo $?
```

### 逐条处置结论

| 原编号 | 事项 | 处置结论 | 复验证据（实际输出要点） |
|---|---|---|---|
| **R1**（阻塞，C1+C2） | 0009 硬写已改名的 `deploy_pipeline_templates` → 必 1146 | **已整改 → 解除阻塞** | 改为 `information_schema.TABLES` 动态选表（`deploy_pipelines` 优先）。场景B/C/D 三场景 `EXIT=0`；场景C（无任何表）输出四行 `1`（整段降级 `SELECT 1`）；场景D（新旧表名同在）`env` 列落在 `deploy_pipelines` ✅ 新名优先生效 |
| **R2**（阻塞，C2） | 0010 裸 ALTER → 已 synchronize 的库必 1060 | **已整改 → 解除阻塞** | 改为 `information_schema.COLUMNS` 守卫 + `PREPARE`。场景A（列已存在）首次+重复执行均 `EXIT=0`（无 1060）；场景B（列缺失）`EXIT=0` 且实测 `deploy_pipeline_runs.task_states json` **真正被加上**，二次执行仍 `EXIT=0` |
| **R3**（重要，C6） | 0010 无反向迁移/回滚路径 | **已整改** | 文件末补 `-- 逆操作：ALTER TABLE deploy_pipeline_runs DROP COLUMN task_states;`（含先 dump 提示） |
| **R4**（重要，B3） | `fetch-config.sh` 拼出 `/api/api/...` → 挂载即 404 fail-fast | **已整改** | `URL="${CONSOLE_API%/}/config/internal/dispatch/..."`。`DRY_RUN=1` 实测打印：`http://127.0.0.1:6200/api/config/internal/dispatch/gateway?envId=local`（**单 `/api`**，与已上线 p25 一致）；`CONSOLE_API` 带尾斜杠时同样正确；`bash -n` 通过 |
| **R5**（重要，C1） | 错库残留 `web_system.deploy_pipeline_vars` 需清理 | **未整改（仍为重要）** | 复审实测：`SELECT table_schema,table_name FROM information_schema.TABLES WHERE table_name='deploy_pipeline_vars'` → 仍返回 `web_system`（以及 `web_system_deploy`、`web_system_deploy_shadow`）。错库空表还在 |
| **R6**（重要，C2） | 0014 注释「报错 + 记账成功」与实现不符 | **已整改** | 注释改为「mysql 批量模式遇错即中止 → 报错时记账 INSERT 也不会执行」，并加了「不要用 `--baseline-through` 批量基线（记错不可逆）」的处置指引 |
| **R10**（建议→已整改，B5） | `DEPLOY_ENV_ID` 优先不受保护键约束 | **已整改** | `DEPLOY_ENV_ID_EFF="${DEPLOY_ENV:-${DEPLOY_ENV_ID:-}}"`（`DEPLOY_ENV` 优先）。`DRY_RUN=1` 实测：只给 `DEPLOY_ENV=local` → `envId=local`；只给 `DEPLOY_ENV_ID=dev` → `envId=dev`（回退仍可用） |
| R7 / R8 / R9 | 0014 本体、语义等价、`--from-release` 链路 | 维持「通过」 | 本轮未改动，结论不变 |
| R11 / R12 / R13 / R14 | 双 git 同步、packages 不重建、白名单、services.service.ts | 维持「建议」 | 本轮未改动，结论不变 |

### 复审中新发现（新增，均非阻塞）

- **N1（建议，C2 一致性）**：`0010` 现在守住了「列是否存在」，但**没守「表是否存在」**。场景C（库中无 `deploy_pipeline_runs`）实测仍报 `ERROR 1146 at line 20: Table 'ws_mig_c.deploy_pipeline_runs' doesn't exist`，`EXIT=1`。`0014` 同样（无 `deploy_hosts` 时 `ERROR 1146 at line 41`，`EXIT=1`，且其末尾 `UPDATE deploy_hosts` 无守卫）。
  **不阻塞**的理由：`deploy_pipeline_runs` / `deploy_hosts` 是 deploy-console 核心表，`synchronize: true` 在控制台首次启动即建表，local/dev/prod 三环境均不存在「表缺失」场景（本次 DRY_RUN 与实测均确认表存在）。建议后续与 0009 的降级策略对齐（表不存在时整段 `SELECT 1`）。
- **N2（重要，C6，既有缺口）**：`0014` 的 `UPDATE deploy_hosts SET scope=..., managed_by=...` 是**覆盖型写入**且文件内无反向 SQL，原样保留。dev/prod 首次执行前必须单表快照（已列入放行前置条件 3）。
- **N3（提示）**：复审未对真实 `web_system_deploy` 执行 `apply-migrations.sh`（评审方不执行发布动作）。DRY_RUN 复核结果符合预期：`0009/0010/0014_deploy_host_scope → 库 web_system_deploy`，`0010_conversation_intent_routing/0014_mp_account_phone_email → 库 web_system`。结合场景A（= local/dev 实际状态）`EXIT=0`，本地真实执行不会再红；**但实际执行与记账仍由运维按环境完成**（记账一旦写入不可逆，务必不用 `--baseline-through`）。

### 是否仍存在放行前置条件

**是**（详见更新后的「结论」）。共 5 条，其中只有 **R5（清理错库残留空表）** 是实质遗留项，其余为流程性约束（DRY_RUN 演练 / 不用批量基线 / 0014 执行前快照 / 发布后验产物 / fetch-config 挂载前冒烟）。

**最终三态：⚠️ 有条件放行**（阻塞 0 / 重要 1）。
