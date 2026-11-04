# 发布评审报告 · console 两阶段自举（2026-10-13）

```
阻塞: 0
重要: 1
```

> 触发面：`servers/deploy-console/.env.example`（环境配置）+ 启动链路（`main.ts`）
> 判据源：`docs/development/release-review-checklist.md`
> 目标：把 console 的部署依赖从「整份 30 键 `.env`」收敛到「3 个 bootstrap 键」

---

## 变更内容

| 项 | 值 |
|---|---|
| 发布目录 | 无（不投应用产物、不改版本表；console 自身走独立链路，dev 已部署并完成演练） |
| 代码改动 | 新增 `src/bootstrap/load.ts`；`main.ts` 改为先自举再动态加载 `AppModule` |
| 配置改动 | `servers/deploy-console/.env.example` 顶部新增 `CONSOLE_ENV_ID` / `CONSOLE_DB_DSN` 说明（主密钥沿用下方既有段落） |
| 是否启停服务 | **是**（dev 已重启若干次做演练；prod 未动） |
| 是否动 DB | **否**（阶段 1 只读 `config_items`，无迁移、无写入） |

---

## 逐条评审

### 适用项

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| E1 | deploy-console 自身不走流水线 | ✅ 不涉及 | 与既有惯例一致：console 部署走独立链路（本机构建 + scp + `pm2 restart`），不自杀式走流水线 |
| E3 | 变更后有验证动作、留证据 | ✅ | 单测 19 例（见下）+ dev 三键起服务验收 5 项全 PASS（见「验证证据」） |
| E4 | PR 挂自动合入 | 🔄 提交后执行 | CI 全绿后自动 merge |
| B3 | 关键依赖配置非缺失 | ✅ | **三重缺省**：① 不填 `CONSOLE_ENV_ID` = 完全不启用（现状模式）；② 库连不上 → 只告警并按现有 env 继续；③ 个别密钥解不开 → 跳过该键并点名。任一路径都不会「起不来」 |
| B5 | 服务自身 `.env` 是唯一配置源 | ⚠️ 有意识放宽 | 本次的**目的**就是引入第二个源（配置中心）。收窄条件见下「重要项」 |

### 不适用项（附理由）

| 段 | 不适用理由 |
|---|---|
| 数据迁移 / 结构变更 | 无迁移脚本，阶段 1 只做 `SELECT` |
| 前端 / UI | 纯后端启动链路，无界面改动（`Design: pass`） |
| 对外接口契约 | 无接口增删；`process.env` 是内部实现，对下游透明 |

---

## 重要项（1）：B5 的放宽边界

引入「配置中心作为第二个配置源」是本次目标，但**不是所有键都能被它覆盖**。三道闸：

1. **`layer='bootstrap'` 的键不参与合并** —— 数据层语义：连配置中心之前它就得在；
2. **代码硬保护名单**（`PROTECTED_ENV_KEYS`）：`DB_*` / `MYSQL_*` / `REDIS_URL` /
   `DB_SYNCHRONIZE` / 三键本身 —— 数据是可编辑的，一条误配（`DB_HOST` 落在 `app` 层）
   就能把发布系统连到别的库；`layer` 表达**意图**，名单是**兜底**；
3. **console 绝不给自己写 `.env.generated`** —— 落盘会触发发布钩子 → 重启自己 →
   又落盘，自杀式循环。只做进程内合并。

命中保护时启动日志会点名，不做静默忽略。

---

## 其它值得记录的取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| 模式切换 | **渐进**（不声明 `CONSOLE_ENV_ID` 就按现状跑） | 现网 `.env` 没有这个键；若缺失即 FATAL，等于要求「先改部署才能升级代码」—— 发布工具自身不该这么升级 |
| 已声明却给不全 | **FATAL** | 半自举比不自举更危险：看似去中心化，实际还是硬编码 |
| 阶段 1 的 DB 客户端 | `mysql2` 原生 SQL，不用 TypeORM 实体 | 此刻 Nest 未起，bootstrap 要「最小依赖、最快失败」；连接用完即弃 |
| DSN 解析 | 只认 `mysql://`，其它 driver 明确抛错 | 解析错一个字符就会连到别的库，这种错必须当场炸，不能猜 |
| `.env.bootstrap` 的读取 | 自举代码自己 `fs` 读 | pm2 启动时 `.env` 系列是 Nest 的 ConfigModule 读的，而自举在它**之前** —— 不自己读，「写三行就能起」就是假的 |
| `AppModule` 的 import | 改为动态 `await import()` | `@Module` 装饰器与 TypeORM 配置在 import 期读 env；静态 import 会让它们读到「还没合并配置中心」的旧值。这不是风格偏好，是顺序依赖 |

---

## 验证证据

| 项 | 结果 |
|---|---|
| 单测（新增） | `src/bootstrap/load.spec.ts` **19 例**：DSN 解析 4 / 模式判定 2 / 文件加载 2 / 作用域裁决与硬保护 5 / 进程 env 合并 1 / 指引文案 1 / 启动失败分档 4（含主密钥同源的正反两条反例） |
| 单测（全量） | deploy-console 全量绿（见 CI「改动包 build/test」） |
| 类型检查 | `tsc --noEmit` 无错 |
| 关键反例 | ① 非 mysql DSN / 缺库名 → 抛错；② `DB_HOST` 落在 app 层 → 被保护名单拦下；③ 换主密钥后密文解不开 → 点名跳过而非启动失败；④ 库连不上 → 告警并按现有 env 继续 |

### dev 验收（已执行，结果全 PASS）

时间：2026-10-13 20:22–20:27（UTC+8）· 机器：dev 175.27.189.123 · 全程有备份与还原路径。

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 现状模式回归（不设 `CONSOLE_ENV_ID`） | ✅ | 启动日志仅 `WARN 未设置 CONSOLE_ENV_ID —— 按现状模式启动`；`/health` 200、`/api/config/revisions` 401（需登录）、静态 key 打 `internal/dispatch` 200 —— 与改造前逐项一致 |
| 2 | 三键模式起服务 | ✅ | 搬迁 18 键进配置中心后 `.env` 仅剩 13 个保护键（原 31）；启动日志 `bootstrap 完成 env=dev 条目=20 生效=19 保护跳过=0 bootstrap层跳过=0 主密钥=file fp=b4ac6aab`；`/health` 200 |
| 3 | 三键模式端到端鉴权 | ✅ | `.env` 里**已删除** `INTERNAL_API_KEY`，用原值打 `internal/dispatch` 仍 200（证明密钥确实来自配置中心解密）；错误 key 401；需登录端点仍 401 —— 自举没有顺手放宽任何鉴权 |
| 4 | 硬保护反例（蓄意误配 `DB_HOST=127.0.0.2`，app 层） | ✅ | 日志 `保护跳过=1` + `WARN 以下键属基础设施/自举键，已忽略配置中心的同名条目：DB_HOST`；服务仍连原库并正常启动（保护失效的话会连 127.0.0.2 起不来） |
| 5 | 回滚 | ✅ | `restore` 删除演练配置 19 行、还原 `.env`（31 键）、删除 `.env.bootstrap`；重启后回到现状模式，`/health` 200、`dispatch` 200 |

### 演练抓到的一个真 bug（已在本次修掉）

**现象**：第 2 项第一次跑，服务起不来 ——
`ERROR [Bootstrap] bootstrap 键缺失：CONFIG_MASTER_KEY / CONFIG_MASTER_KEY_FILE`。

**根因**：启动期校验只看 `env` 变量，而运行期解密走 `config-crypto` 的 `masterKey()`，
后者除变量外还认一个默认文件（`/etc/web-system/config-master.key`）。dev 的 `.env` 里
`CONFIG_MASTER_KEY` 是空值、也没写 `*_FILE` —— 密钥一直在默认文件里，运行期能用，
启动期却判定缺失并 FATAL。**同源校验写成了"看起来同源"**。

**修法**：校验改为直接调 `masterKeyFingerprint()`（运行期同一套解析）；同时新增
`alignBootstrapKeysToProcess()` —— 因为 `masterKey()` 只读 `process.env`，而
`runBootstrap(env)` 允许传入任意 env（测试 / 未来的调用方），不对齐就会换个地方
再犯同一类错位。生产链路 `main.ts` 传的就是 `process.env`，该函数为空操作。

**教训**：这类"启动期判可用性"的代码，判定函数必须与运行期**同一个入口**，
不能照着运行期的逻辑另写一份简化版 —— 简化掉的那一支往往正是生产在用的那一支。
已用测试锁住（主密钥可用时不报缺失 / 缺主密钥时 FATAL，两条反例并存）。

---

## 回滚

删除 `CONSOLE_ENV_ID`（或整个 `.env.bootstrap`）→ 重启 → 回到现状模式。
**无需回滚代码、无需改库、无需改脚本。**
