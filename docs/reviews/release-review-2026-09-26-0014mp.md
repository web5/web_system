阻塞: 0
重要: 4

# 发布评审报告 · 0014_mp 迁移幂等改造（2026-09-26）

> 评审角色：`release-reviewer`（S8.1，独立第三方）。
> 判据源：`docs/development/release-review-checklist.md`（先读判据、后读改动；执行者自辩不作为放行依据）。
> 证据环境：本机 MySQL **8.4.0**，临时库 `rr_*`（已全部 DROP，见末尾 §7）。
> 评审对象：`git diff` 唯一改动文件 `migrations/0014_mp_account_phone_email.sql`（工作区未提交）。
> 注：`docs/development/a3-dev-sync-2026-09-26.md` 为未跟踪文件，**不在本次 diff 作用域内**，仅作为环境事实的交叉核验材料（其结论同样被我逐条复核，未直接采信）。

---

## 1 改动面

| 项 | 内容 |
|---|---|
| 文件 | `migrations/0014_mp_account_phone_email.sql`（唯一改动，+47 / −8 行） |
| 目标库 | 首行 `-- @database web_system`（由 `scripts/apply-migrations.sh:86-90` `migration_db()` 解析，且**注解优先于 `--db` 覆盖**） |
| 触发判据面 | **C 数据面**（清单 §用法 3：`scripts/migrations/*.sql` 命中）+ E3（变更后验证） |
| 执行方式 | `run_sql()` 第 181 行 `{ cat "$f"; echo 记账INSERT; } \| mysql --default-character-set=utf8mb4 "$db"`，等价于 `USE $db` 后逐条执行 |
| 意图 | 把两条裸 `ALTER` 改成 `information_schema` 守卫 + `PREPARE`；新增 `@has_users` 降级守卫；去掉 `COLLATE=utf8mb4_0900_ai_ci`；补幂等/逆操作注释 |

**先给结论式摘要**（逐条证据在 §3）：

- 本次改造**确实解决了它声称的问题**：重跑不再报 1060/1061，记账能写进去（证据 E1 第 2 次、E2）。✅
- 委托方点名的「COLLATE 去掉导致的分叉 / Illegal mix」**不成立**，实跑证据可反证（§3-F7）。
- 但改造引入了**两处静默行为**（连错库跳过、users 不存在跳过），它们都**记账=已应用**且**退出码 0、零报错**——这是本仓最高危的失败类别。升级为 2 条「重要」。
- 无阻塞项，结论 **⚠️ 有条件放行**（放行条件见 §4）。

---

## 2 盲审基线与判据对照表（读判据时形成，先于读改动）

| 判据 | 我认为的「应该是什么样」 | 本次核验口径 |
|---|---|---|
| C1 | 文件头有 `-- @database`；且**执行时真的落到那个库** | 注解有 ✅；执行时是否真的落到它 → 见 F1 |
| C2 | 重跑不炸（`CREATE ... IF NOT EXISTS` + `schema_migrations` 记账） | 记账代表「已应用」→ 是否名副其实 → 见 F2 |
| C3 | 扩展名被脚本扫描到 | `.sql` ✅（`scripts/apply-migrations.sh:152` 只扫 `*.sql`） |
| C4 | 按环境执行、`DRY_RUN=1` 先演练 | 属于执行动作，不改码；前置校验命令见 §5 |
| C5 | DB 变更前确认运行代码已同步 | 反向核验：变更后代码侧（实体）**会不会把 DB 改回去** → 见 F4 |
| C6 | 破坏性变更有回滚路径 | 本次为纯增量（ADD / CREATE），逆操作注释存在 → 通过 |
| E3 | 变更后有可执行验证动作并留证据 | 提供 §5 清单 |

---

## 3 逐条评审

### F1｜守卫用 `DATABASE()` 而非文件自声明的目标库 → 连错库时**静默错写 + 记账**，退出码 0
**判据：C1**（迁移文件声明目标库；失效即「跨库误写」） · **严重级：重要** · **是否阻塞：否（但必须限定执行通道）**

- 反例（已实跑，脚本 `wrong_db.sh`）：
  - **情形**：手工执行时会话连到的不是目标库（`rr_wrong`，空库），而文件自身写着 `-- @database web_system`。
  - **实际**：`SET @db := DATABASE()` 取到的是**会话当前库**，不是注解值 → `@has_users=0` → 两条 ALTER 守卫全部降级成 `SELECT 1` → `CREATE TABLE email_verification_codes` 在**错误库**里建成 → 记账 INSERT 也写进**错误库** → **exit 0，零 ERROR 输出**。
  - **期望**：要么落到注解指定的库，要么报错中止（不该「干了等于没干」还不吭声）。
  - 实测数据：`rr_wrong.users=0 / evc=1 / 记账=1`；真正目标库 `rr_right.uk_users_phone=0 / merged_to=0` **一行未改**。
- 补充（`--db` 覆盖）：`migration_db()` 第 88-89 行是**注解优先**（`[ -n "$db" ] && echo "$db" || echo "${OVERRIDE_DB:-$DEFAULT_DB}"`），所以 `--db xxx` **对本文件无效**，走 `apply-migrations.sh` 时目标库恒为 `web_system`。**这条如果能被证明生效，F1 在受管通道内不会发生。**
- 为什么仍评「重要」而不是「建议」：本文件**历史上就是手工执行的**（`a3-dev-sync-2026-09-26.md` §4.2 记录 dev 是手工跑的），「手工执行」是**已被演示的操作模式**，不是假想；而失败是**零报错**的——正是清单 A1 备注点名的「无任何报错、必须逐条验」那一类。
- 为什么不算「阻塞」：在受管通道（`apply-migrations.sh`）内不可触发；且错误库的记账不会污染目标库，`web_system.schema_migrations` 保持干净 → 后续正确执行仍会真正应用。**可自愈**，故不阻塞。
- 处置建议（择一）：① 本文件只允许经 `apply-migrations.sh` 执行，并把该约束写进变更说明；或 ② 把 `SET @db := DATABASE();` 改为 `SET @db := 'web_system';`（与注解同名），并把第 51 行改成 `CREATE TABLE IF NOT EXISTS \`web_system\`.\`email_verification_codes\``，这样手工执行时要么写对库，要么报 1049/1046 红着停，而不是静默。

### F2｜`@has_users=0` 时**什么都没做，却照常记账** → 静默假成功
**判据：C2**（记账是幂等机制的一半；记了「已应用」就必须真的应用了） · **严重级：重要** · **是否阻塞：否**

- 反例（已实跑，`run.sh` E3）：
  - **情形**：目标库尚未初始化 `users` 表时就跑本文件。
  - **实际**：两条 ALTER 被守卫降级 → `users` 依然无 `uk_users_phone`、无 `merged_to` → 但 `CREATE TABLE` 照做、`email_verification_codes` 建了、**记账写入 1 行**、exit 0。
  - **期望**：既然核心 DDL 未执行，就不该记成「已应用」，或应显式报错中止。
  - 实测：`users表存在=0 / evc表存在=1 / 记账=1`，全程无 WARN/ERROR。
- 后果链（为什么这条有 teeth）：一旦记账=applied，再跑 `apply-migrations.sh` 第 176-179 行会**永久跳过**本文件。而运行代码明确依赖这两项：`servers/auth-service/src/account/account.service.ts:218` `SELECT id, mp_openid, merged_to FROM users`、`:258` `UPDATE users SET merged_to = ?, status='inactive' ...`。届时是运行时抛 `Unknown column 'merged_to'`（1054），且**已无自动补救通道**——只能人工 `DELETE FROM schema_migrations WHERE name='0014_mp_account_phone_email.sql'`。
- 为什么不算「阻塞」：现实触发需 `users` 在跑本文件时不存在。而 fresh 库走受管脚本时 `0007_baseline_tables.sql:436` 会先建 `users`（文件名序 0007 < 0014），守卫取到 1。**仅手工单文件执行 / 基线越界场景下可触发**。
- 处置建议：`@has_users=0` 时不要降级成 `SELECT 1`，改为显式失败（`SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0014: users 表不存在，请确认目标库是否正确'`），让它在错误的库 / 未初始化的库上**红着停**而不是绿着走。

### F3（合并回答：委托方问题 4 与 6）｜前置条件缺失时是**响亮失败**，不是静默失败——可接受，但都不写入 SQL
**判据：C4（前置按环境先验）+ E3（变更后验证）** · **严重级：建议** · **是否阻塞：否**

- 反例 A —— `users` 无 `phone` 列（实跑 E4）：
  - **实际**：第 32 行 `ERROR 1072 (42000) at line 32: Key column 'phone' doesn't exist in table` → 整批中止 → `记账=0`、`email_verification_codes` 未建、exit 1。**期望**：同上（响亮失败即可接受）。
- 反例 B —— 存在重复手机号（实跑 E5）：
  - **实际**：第 32 行 `ERROR 1062 (23000): Duplicate entry '13800000009' for key 'users.uk_users_phone'` → 整批中止 → `记账=0`、后续两句未执行、exit 1。**期望**：同上。
- 结论：两者的**失败形态是健康的**——因为记账 INSERT 被拼在文件**末尾**（脚本第 181 行），任何中途失败都意味着「未记账」→ 下次跑会从头重试 → 而两条 ALTER 幂等守卫会正确跳过已成功的部分。**没有半写状态**。
- 因此「是否在 SQL 里加预检+友好错误」属于**体验项，不是安全项**：不加也能炸得出来。若要加，建议在 `ADD UNIQUE KEY` 前加一段 `information_schema` 预检并用 `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT` 输出「存在重复手机号：N 个」。
- 注意 `phone` 列存在的**先验假象不要当真**：它在 `0007_baseline_tables.sql:440` 与 `packages/shared/src/entities/user.entity.ts:44` 里都有定义，但**这不等同于目标库里真的有**（prod 上新增列是走手工 DDL 的，见实体第 92-93 行注释）。执行前必须实测，命令见 §5-C。

### F4｜变更会被 TypeORM synchronize **反向吃掉**：`merged_to` 不在任何实体里
**判据：C5**（DB 绑定与代码侧的先后/一致性；此处为反向不同步） · **严重级：重要** · **是否阻塞：否**

- 事实核验：`packages/shared/src/entities/user.entity.ts` 全篇**没有** `mergedTo`；`servers/user-service/src/app.module.ts:49` 的手写清单用的正是这个 `User`；而 `account.service.ts:218/258` 是用**裸 SQL** 读写 `merged_to` 的。`uk_users_phone` 同理，实体里只有 `@Column({length:20, nullable:true}) phone`，无该索引定义。
- 反例：
  - **情形**：任何一个 `synchronize` 为真的服务实例（判定式均为 `NODE_ENV !== 'production'`，见 `user-service/app.module.ts:60/78`、`auth-service/app.module.ts:59/69/87`、`gateway/app.module.ts:63`）连到该库并启动。
  - **实际**：TypeORM 按实体元数据对齐 schema → 会发出 `ALTER TABLE users DROP COLUMN merged_to`（DB 有、元数据没有）并可能删掉 `uk_users_phone`；本迁移改造成幂等后，下次跑又会把它加回来 → **来回抖动**。
  - **期望**：迁移加出来的东西应该留得住。
- dev 已确认 `NODE_ENV=production`（`a3-dev-sync-2026-09-26.md` §4.2），所以 dev 安全；**本地开发机 / 任何非 production 实例指向同一库时会中招**。
- 处置：发布前置核查（§5-D）必须确认所有指向该库的服务 `synchronize=false`；长期应把 `mergedTo` 补进共享实体，否则「表里有一列，代码说不认识」的口子会一直在。

### F5（回应委托方问题 3）｜dev 已执行未记账 → **正常跑即可，不需要 `--baseline-through`**；但冷跑全脚本另有雷
**判据：C2（记账）/ C4（按环境执行）** · **严重级：重要** · **是否阻塞：否**

- 本文件的路径我已实跑复现（`run.sh` E2）：按 `a3-dev-sync-2026-09-26.md` §4.2 的描述搭一个「dev 现状」库（已有 `uk_users_phone` + `merged_to` + `email_verification_codes`，`schema_migrations` 无记录）→ 跑新版 → **exit 0、无 ERROR、记账写 1 行、三项状态不变**。**幂等守卫有效，这条路径是安全的。**
- **不要给本文件做 baseline**：它现在幂等，走「正常执行 → 记账」比 baseline 更优（baseline 连「执行」这一步都不做，一旦记账时点错就会永久漏执行，且没有任何自动校验会提醒你）。
- **但真正的雷在「冷跑全脚本」**：`apply-migrations.sh` 会遍历 `migrations/*.sql` **全部文件**（第 152 行），不只这一份。其中非幂等的老迁移实测为：`0001_standardize_business_tables.sql`（206 行、**31 条 ALTER、0 处 IF NOT EXISTS**）、`0002_*.sql`（6 条 ALTER）、`0011_conversation_source.sql`（2 条 ALTER、0 处 IF NOT EXISTS）。dev 若从未走过该脚本，直接 `./apply-migrations.sh dev` 会**从头重放这些**并大面积报错（脚本不中断，末尾退出 1，记账半残）。
- **附带陷阱**：`--baseline-through` 的边界判定是**纯字符串比较**（第 167 行 `[ "$name" \< "$BASELINE_THROUGH" ]`），且**按文件各自的注解库记账**。例如填 `--baseline-through 0013_music_agent_binding.sql`，会顺带把 `0008_knowledge_tables.sql`（→`web_system_knowledge`）、`0009_pipeline_vars_and_template_env.sql`（→`web_system_deploy`）、`0010_pipeline_task_states.sql`（→`web_system_deploy`）**一并标成已应用且不执行**——**跨库连带影响**（波及另外两个库）。
- **记错账不可逆吗？**→ **账本身可逆**：`schema_migrations` 只是一张以 `name` 为主键的表，写错了可以 `DELETE FROM schema_migrations WHERE name='...'`，下一跑会重新执行（脚本里没有任何 DELETE 保护或回退工具，属**纯人工操作**）。**真正不可逆的是「不知道」**：被误标「已应用」的历史迁移此后**永不再被检出**，缺失要到运行时才以「表不存在 / 列不存在」的形式爆出来，排查成本极高。
- 处置建议：dev 首次接入时，先用 `--baseline-through 0007_baseline_tables.sql`（`0007` 本身是全 `CREATE TABLE IF NOT EXISTS`，idempotent，要不要基线都不影响；真正需要拦的是 0001/0002/0011），并**逐个核对已基线清单里的每一项在 dev 上确实已生效**；随后让 0014 走**正常执行**（不 baseline）。

### F6｜历史迁移编号重复（0006 / 0010 / 0014 各两份）
**判据：无（清单未覆盖）** · **严重级：建议 · 无判据，属个人偏好，可驳回**

- 事实：`0006_dict_tables.sql` 与 `0006_rename_mini_contract_to_kedou_ai_minigram.sql`、`0010_conversation_intent_routing.sql` 与 `0010_pipeline_task_states.sql`、`0014_deploy_host_scope.sql` 与本次 `0014_mp_account_phone_email.sql` 编号重复。
- 本次两份 0014 目标库不同（`web_system_deploy` vs `web_system`），执行顺序按字符串序固定（`0014_deploy...` < `0014_mp...`），**当前无功能影响**；但 `--baseline-through` 用字符串比较，编号重复会让「基线边界」的语义变模糊（F5 的雷会被放大）。列在此处仅作遗留登记，不作为放行条件。

### F7（回应委托方问题 2，重点核实项）｜「COLLATE 去掉 → 分叉 → Illegal mix」**不成立**；但注释里的技术断言是错的
**判据：无（未构成 C 面失败）** · **严重级：建议 · 无判据，属个人偏好，可驳回**

- 实跑反证（本机 MySQL 8.4）：

  | 库定义 | 建表写法 | 实际落到的 table_collation |
  |---|---|---|
  | `rr_dbA` `COLLATE=utf8mb4_unicode_ci` | **`DEFAULT CHARSET=utf8mb4`（无 COLLATE）** | **`utf8mb4_0900_ai_ci`** |
  | `rr_e7` `COLLATE=utf8mb4_0900_ai_ci` | 同上 | `utf8mb4_0900_ai_ci` |
  | `rr_dbA` `COLLATE=utf8mb4_unicode_ci` | `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`（旧写法） | `utf8mb4_0900_ai_ci` |

  → **写 `DEFAULT CHARSET=utf8mb4` 落的是「该字符集的默认排序规则」（MySQL 8 上恒为 `utf8mb4_0900_ai_ci`），不是注释里写的「库默认排序规则」。**
- 由此推翻前提：① dev 的表是**执行时就已去掉 COLLATE** 建的（见 `a3-dev-sync-2026-09-26.md` §4.2 / I-3），并不是「旧版显式 0900 建的」；② 即便它是旧版显式 0900 建的，新版在 MySQL 8 上产出的**同样是 0900**。二者**完全一致，不存在新旧分叉**。
- 代码侧再确认一遍「Illegal mix」是否会真爆：全仓检索 `email_verification_codes` 的宿主只有 `servers/user-service/src/email/email.service.ts`，其全部查询只在本表（`findOne({where:{email:to}})` / `count`），**没有任何跨表 JOIN 或与 `users.email` 的 WHERE 等值比较**；`auth-service/src/account/account.service.ts:162 / :210` 只查 `users` 单表，且值走 TypeORM 参数绑定（参数为 coercible、**强制力高于列**），比较时列的排序规则占优，**不会触发 1267 Illegal mix**。
  - 附注（非本次引入）：`users` 本身是 `utf8mb4_unicode_ci`（`0007_baseline_tables.sql:458`），与 `email_verification_codes` 的 `0900_ai_ci` **确实不同**。今天没有跨表比较所以不爆，但**日后谁写 `JOIN ... ON users.email = evc.email` 就会当场 1267**。这是本就该知道的存量事实，建议写进该表的表注释或实体里。
- 本文件第 49-50 行注释**断言错误**（写「改用库默认排序规则」，实测不是）+ 引用的「项目规则 8.3」**在仓库里检索不到出处**（`docs/`、`specs/` 均无），而 `0007`(27 处) / `0008`(3) / `0009`(1) / `0012`(2) 仍在显式写 `COLLATE=utf8mb4_unicode_ci`（该值 5.7/8.0 通用，不影响兼容性）。建议把注释改成事实描述：「不写 COLLATE 时取字符集默认排序规则，MySQL 8 为 utf8mb4_0900_ai_ci，受 `default_collation_for_utf8mb4` 影响」。

### F8｜「兼容 5.7」的说法与 PREPARE 方案自相矛盾
**判据：无** · **严重级：建议 · 无判据，属个人偏好，可驳回**

- 实跑：`PREPARE stmt FROM 'ALTER TABLE ...'` 在 **MySQL 8.4 通过**（`t1_prepare.sql`：`PREPARE ALTER 结果: OK`）；MySQL 8.0 手册「SQL Syntax Permitted in Prepared Statements」清单**明确含 `ALTER TABLE`**。
- 但 MySQL 5.7 手册该页已下线，我**未能从官方文档确认 5.7 是否支持 `PREPARE ALTER TABLE`**（存疑）。也就是说：**本文件为了「5.7 不认 0900」而去掉 COLLATE，却同时引入了 PREPARE——若真存在 5.7 目标环境，很可能先在 PREPARE 这一步挂掉。** 两个目标互相抵消，建议把话说清楚二选一：要么明确「只支持 MySQL 8」并把 COLLATE 显式写回来以锁定结果；要么真要保证 5.7，就别用 PREPARE。
- 另注：`DEFAULT CHARSET=utf8mb4`（不写 COLLATE）的结果依赖**服务器变量** `default_collation_for_utf8mb4`（本机 8.4 实测存在，默认 `utf8mb4_0900_ai_ci`，**可改**）。去掉 COLLATE 等于把结果从「文件里写死」改成「由 server 变量 + 大版本决定」——这是它引入的确定性损失，也是我把它列为观察项的原因。

### F9｜C6 回滚性：通过（不计数）
**判据：C6** · **严重级：通过（不计数）**

- 本次为**纯增量**（`ADD UNIQUE KEY` / `ADD COLUMN` / `CREATE TABLE`），无 DROP/TRUNCATE/UPDATE，不构成破坏性变更。
- 第 66-69 行已给出逐项逆操作，并注明「需回滚时先 dump 备份」。`CREATE TABLE IF NOT EXISTS` 也不会改存量表结构（已由 E2 验证：dev 现状库跑完，`evc.collation` 保持 `utf8mb4_0900_ai_ci`、`users.collation` 保持 `utf8mb4_unicode_ci` 不变）。
- 遗留登记（回应委托方问题 5）：**无需为本文件单独登记遗留项**——因为新旧写法的产物在 MySQL 8 上完全一致（F7 表）。但需要登记的是另一件：**`users`(unicode_ci) 与 `email_verification_codes`(0900_ai_ci) 的排序规则不一致是存量事实**，不是本次改动造成，建议另开条目。

---

## 4 结论

> **⚠️ 有条件放行**

无阻塞项。改造达成其声称的幂等目标（E1 二次执行 / E2 dev 现状复现均 exit 0 且记账正确），去掉 COLLATE 亦未造成排序规则分叉（F7 实跑反证）。放行的前提是**下面 5 条在执行前逐一落实**——它们都不是改代码，而是把范围和通道钉死：

1. **执行通道**：只允许 `scripts/apply-migrations.sh <env>` 执行本文件；**禁止**手工 `mysql < file` / `source`（否则触发 F1 / F2 的静默假成功）。
2. **目标环境 mysql 版本必须是 8.x**（8.4 实测可用；若为 5.7，F8 的 PREPARE 风险未排除）。
3. **执行前置校验**（目标机）：`users` 表存在、`phone` 列存在、重复手机号条数 = 0、MySQL 版本 —— 命令见 §5-C。
4. **所有指向该库的 user-service / auth-service 实例必须 `synchronize=false`**（`NODE_ENV=production`），否则 F4 会把 `merged_to` / `uk_users_phone` 反向删掉。
5. **dev 接入路线**：`--baseline-through` 边界选 `0007_baseline_tables.sql`，且逐个核对清单为真生效；**本文件走正常执行，不做 baseline**。

---

## 5 发布后验证清单（可执行命令）

### A. 执行前 · 演练（判据 C4）
```bash
DRY_RUN=1 ./scripts/apply-migrations.sh dev
DRY_RUN=1 ./scripts/apply-migrations.sh dev --baseline-through 0007_baseline_tables.sql
# 期望：0014 出现在「将应用」清单里，且指向库 web_system
```

### B. 执行（判据 C4 / C2）
```bash
# dev 首次接入：先基线 0007（只记账不执行），再正常跑
./scripts/apply-migrations.sh dev --baseline-through 0007_baseline_tables.sql
./scripts/apply-migrations.sh dev
# 期望末尾：应用 N 个 / 基线记账 M 个 / 跳过 K 个 / 失败 0 个
./scripts/apply-migrations.sh dev      # 立刻再跑一次
# 期望：「跳过（已应用）: 0014_mp_account_phone_email.sql → web_system」
```

### C. 目标库前置校验（判据 C4 / E3，执行前必跑）
```sql
SELECT VERSION() AS mysql_version;                                  -- 期望 >= 8.0
SELECT @@default_collation_for_utf8mb4;                             -- 期望 utf8mb4_0900_ai_ci
SELECT COUNT(*) AS has_users FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users';              -- 期望 1
SELECT COUNT(*) AS has_phone FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='phone';  -- 期望 1
SELECT phone, COUNT(*) c, GROUP_CONCAT(id) FROM users
 WHERE phone IS NOT NULL AND phone<>'' GROUP BY phone HAVING c>1;   -- 期望 0 行
```

### D. synchronize 反向吞噬防护（判据 C5，执行前必验）
```bash
# 指向该库的所有服务都必须是 production
ssh <target> "grep -h '^NODE_ENV=' /data/web_system/servers/{user-service,auth-service,gateway}/.env"
# 期望：全部 NODE_ENV=production（否则 TypeORM synchronize 会 DROP merged_to）
```

### E. 发布后 · 结构与记账核验（判据 E3 / C2）
```sql
SELECT COUNT(*) AS uk      FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uk_users_phone';   -- =1
SELECT COUNT(*) AS col     FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='merged_to';       -- =1
SELECT table_collation FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='email_verification_codes';                -- utf8mb4_0900_ai_ci
SELECT name, applied_at FROM schema_migrations WHERE name='0014_mp_account_phone_email.sql';  -- 1 行
SELECT name, applied_at FROM schema_migrations WHERE name='0014_deploy_host_scope.sql';       -- 应为空（不同库）
```

### F. 发布后 · 链路冒烟（判据 E3）
```bash
# user-service 验证码表可用（防 EmailVerificationCodeEntity 漏登记 → EntityMetadataNotFoundError 重现）
ssh <target> "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6002/health"   # 200
# 合并路径会真读写 merged_to —— 强烈建议真跑一次：
#   小程序端：用一个已存在手机号的小号做「绑定/登录」，触发 confirmMerge 合并分支
#   期望：无 Unknown column 'merged_to' in 'field list'（1054）
```

### G. 回滚（判据 C6，需要时）
```sql
-- 先备份
ALTER TABLE `users` DROP INDEX `uk_users_phone`;
ALTER TABLE `users` DROP COLUMN `merged_to`;
DROP TABLE IF EXISTS `email_verification_codes`;
DELETE FROM schema_migrations WHERE name='0014_mp_account_phone_email.sql';  -- 让它可被重跑
```

---

## 6 无判据项（个人偏好，可驳回）

1. **F6 迁移编号重复**（0006 / 0010 / 0014 各两份）——无判据；当前目标库不同、顺序固定，无功能影响，但会放大 F5 的基线边界语义模糊。
2. **F7 注释的技术断言写错**（写成「改用库默认排序规则」，实测是字符集默认排序规则）+ 引用的「项目规则 8.3」仓库内查不到出处——无判据，属文档准确性。
3. **F8 兼容 5.7 与 PREPARE 自相矛盾**——无判据；建议二选一向说清楚，或干脆把 `COLLATE=utf8mb4_0900_ai_ci` 写回来锁定结果，避免被 `default_collation_for_utf8mb4` 变量影响。
4. **建议给 `ADD UNIQUE KEY` 加 SQL 内预检 + `SIGNAL` 友好错误**（当前仅为文件顶部注释）——无判据；失败已是响亮的（1062 且无半写），属体验优化。
5. **建议补 `phone` 列存在的守卫**（当前只守 `users` 表存在，没守列存在）——无判据；缺失时是 1072 响亮失败，且 `phone` 在实体与 0007 里均有定义。
6. **建议把 `mergedTo` 补进 `packages/shared/src/entities/user.entity.ts`**——无判据；解决「表里有一列、代码说不认识」的长期不一致。
7. **建议登记遗留项：`users`(unicode_ci) 与 `email_verification_codes`(0900_ai_ci) 排序规则不一致**——无判据；今日无跨表比较不爆，日后写 JOIN 会 1267。

---

## 7 评审过程的清理说明

本机 MySQL 8.4 上为取证建过以下临时库，报告落盘前已全部销毁：
`rr_dbA` `rr_dbB` `rr_prep` `rr_e1` `rr_e2` `rr_e3` `rr_e4` `rr_e5` `rr_e7` `rr_right` `rr_wrong`

```bash
MYSQL_PWD='KedouLocal@2026' /Users/geekwen/local/mysql-8.4.0-macos14-arm64/bin/mysql -h127.0.0.1 -P3306 -uroot \
  -e "DROP DATABASE IF EXISTS rr_dbA; DROP DATABASE IF EXISTS rr_dbB; DROP DATABASE IF EXISTS rr_prep; \
      DROP DATABASE IF EXISTS rr_e1; DROP DATABASE IF EXISTS rr_e2; DROP DATABASE IF EXISTS rr_e3; \
      DROP DATABASE IF EXISTS rr_e4; DROP DATABASE IF EXISTS rr_e5; DROP DATABASE IF EXISTS rr_e7; \
      DROP DATABASE IF EXISTS rr_right; DROP DATABASE IF EXISTS rr_wrong;"
rm -rf /tmp/rr0014
```

---

> 本报告只做评审，不改码、不执行发布。报告 EOF
