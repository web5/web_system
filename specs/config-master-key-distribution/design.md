# CONFIG_MASTER_KEY 多机分发与在线轮换 · 设计

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：`specs/service-config-delivery/design.md` 分期里的 **P2**（独立小设计）。本文只解决三件事：
> **主密钥怎么到机器 / 怎么证明一致 / 怎么轮换**。
> 不碰配置中心的数据模型（密文格式变更除外，见 Q9）。

分支：`feature/deploy-console-domain-split` ｜ 建立：2026-09-22 ｜ 状态：**待评审（tech-review）**

前置阅读：`specs/config-master-key-distribution/handoff.md`（问题与候选）、
`servers/deploy-console/src/config/config-crypto.ts`（加解密）、
`specs/service-config-delivery/design.md` §4.0 / §6 / §7（下发链路与边界）

---

## 0. 一页速览

**要解决**：主密钥 `CONFIG_MASTER_KEY` 是配置中心全部 `is_secret=1` 项的解密钥匙（AES-256-GCM），
它不能进配置中心（鸡生蛋），又必须**在共享同一个部署库的多台机器上完全一致**（不一致 = GCM 认证失败直接抛错）。
现状只有「人工往各机 `.env` 复制」，**无一致性校验、无轮换方案、错误暴露在解密那一刻**。

**决议摘要（Q1–Q6 已定，细则见 §3）**：

| 编号 | 决议 |
|---|---|
| D1 分发通道 | **机器本地密钥文件（0600）+ 启动期注入**（= 候选 A 的存储 + B 的注入）；云 KMS 留未来 |
| D2 注入物 | **注入文件路径 `CONFIG_MASTER_KEY_FILE`，值由进程从 0600 文件读**（Q7 已定：值进 env 会破 K2） |
| D3 一致性证明 | **密钥指纹**（`sha256(派生钥)[0..8]`）打进启动日志 + 独立 `verify` 脚本跨机比对 |
| D4 轮换 | **在线轮换**：密文带 `keyId` 前缀 + 双钥并行解密 + 可重入重加密；**不改 `config_items` 表结构**。分两步走：**P2a 格式迁移 → P2b 密钥轮换**（§5.3） |
| D5 权限与审计 | 轮换/重加密仅 `super_admin`（新增权限码 `config:secret:rotate`），审计只记 keyId/指纹/影响行数 |
| D6 新机上线 | `provision` 脚本（安全投递 + 指纹）+ `verify` 脚本（自检并可独立运行）+ checklist |
| D7 换库/拆域 | 短期与 dev 同库（不拆）；**换库变更指南与迁移脚本先行备好**：`domain-split-guide.md` + `scripts/master-key-domain-split.mjs`（§10） |
| D8 密文格式 | **只支持新格式 `<keyId>:iv:tag:data`，不兼容老密文**（Q9）→ 前置一次格式迁移 p26（停机窗口，§5.3 P2a） |
| D9 停机上界 | **轮换**允许秒级重启（Q10）；**格式迁移**需一次分钟级停机窗口（迁移期禁写）。集群化后该约束消失 |
| D10 执行通道 | `provision` / 轮换由 super_admin 在目标机执行，密钥经 `scp` / `read -s` 直传，**禁止 `KEY=xxx cmd` 形式**（Q11） |

**不做**：① 主密钥放进配置中心（永不做）；② 把解密能力下放给业务服务（它们继续走 `.env.generated`）；
③ 本轮引入云 KMS/SDK；④ 改 `config_items` 表结构；⑤ 按环境名分钥（理由见 §2）。

---

## 1. 现状事实（2026-09-22 已核，开工不必重新考古）

| 项 | 值（含证据位置） |
|---|---|
| 读取位置 | `servers/deploy-console/src/config/config-crypto.ts:20-39` → `masterKey()`，**只读 `process.env.CONFIG_MASTER_KEY`**（有进程内缓存） |
| 支持形态 | base64（44 字符）/ 64 位 hex / 任意字符串（scrypt 派生 32 字节）；长度非 32 字节直接抛错 |
| 加解密调用点 | 仅 3 处：`config.service.ts:184`（`buildConfig` 解析）、`:243`（`dispatchPayload` 下发）、`:292`（`upsert` 写入加密） |
| 谁在用 | **只有 deploy-console**：唯一读写 `config_items` 的服务（其他服务靠下发 `.env.generated` 拿明文） |
| 密文形态 | `iv:authTag:ciphertext`（三段，base64），存 `config_items.value` |
| 快照也含密文 | `config.service.ts:337-341` —— `config_snapshots.payload[key].value` 存的是**密文**；`restore()`（`:348-371`）会把快照密文**原样写回** `config_items` |
| 现存储位置 | 各机 `servers/deploy-console/.env`（人工维护）。**本地已配（1 行）**，本地库为 `MYSQL_HOST=127.0.0.1:3306` |
| 启动期无自检 | 全仓无 `OnApplicationBootstrap` / `process.exit(1)` 命中 → 密钥错了要等到"某次读配置"才炸 |
| 无轮换端点 | 搜 `rotate/轮换/masterKey` 无路由命中：配置中心只有 `GET/PUT/DELETE items`、`POST snapshots`、`POST snapshots/restore`（`config.controller.ts:39/92/131/164/181`）+ `@Public` 的内部下发端点 `:62` |
| 无权限守卫 | deploy-console 无 `@RequirePermission`；`jwt.strategy.ts:63` 已把 `roles.includes('super_admin')` 映射成 `role='super_admin'`（可作守卫依据） |
| 审计可用 | `audit/audit.service.ts:85-113` `log()`（双写 `audit_logs` + JSONL）；字段 `action/env/component/status/detail/changes`，无 IP；密钥明文口径用 `SECRET_UNRECORDED`（`config-crypto.ts:12`） |
| 权限码体系 | `packages/types/src/index.ts:128` `Role`；`:143-186` `PERMISSIONS`（`<group>:<action>`）；`:188-205` `ROLE_PERMISSIONS`（`super_admin = Object.keys(PERMISSIONS)` → 加码即自动拥有） |
| 进程环境铁律 | `scripts/pipeline/restart-backend.sh:145-158`（DEPRECATED，逻辑已入库脚本）：`pm2 delete` 后 `env -i PATH HOME PORT "$PM2" start ...`；`scripts/publish-deploy-console.sh:157-160` 同思路。**不得回退到 `pm2 startOrRestart --update-env`** |
| `.env` 加载 | `servers/deploy-console/src/app.module.ts:34-41` `envFilePath: ['.env.generated', '.env']`（**数组、先命中者胜**；dotenv 不覆盖已存在的 `process.env` → 注入的 env 优先于 `.env`） |
| 无 systemd | 全仓无 `*.service` 单元文件（"systemd 注入"目前只能落在 pm2 启动脚本上） |
| 机器清单 | 无单一机器清单文档；真相源是 `scripts/.env.deploy.example`（`DEV_SERVER/PROD_SERVER/JUMP_HOST/LIGHTHOUSE_SERVER` + `*_REMOTE_DIR`）与 `docs/architecture/技术架构.md:90-115` |

---

## 2. 密钥域：密钥跟随「部署库实例」，不跟随「环境名」（Q1 决议）

这是本次设计最容易被做错的一点。`config_items` 的 `global` 作用域行**被所有 env 共用**
（`resolve()` 按 `global → env → module` 覆盖，见 `config.service.ts:194-197`、快照 `:328-334`），
所以"每个环境一把钥"会导致 `global` 行无处归属。**正确口径是按部署库实例划域**：

| 域 | 谁在读这个库 | 部署库实例 | 密钥要求 |
|---|---|---|---|
| **域 C（云）** | 堡垒机 console、dev console、未来 prod console | 云 `web_system_deploy`（`gz-cdb-8y2lp8rt...:27241`） | **这些机器必须共用同一把钥**（当前由人工复制保证，正是本设计要收口的部分） |
| **域 L（本地）** | 本地开发机 console | 本机 `127.0.0.1:3306` 的 `web_system_deploy` | 可独立一把钥（与域 C 无关；本地密文泄露影响限本地） |

推论：**上线一台新机器时，"该给它哪把钥"由它连哪个部署库决定**，而不是由它服务的 env 决定。
→ 新机流程（§5.6）第一步必须确认部署库归属，再决定密钥域。

> Q8 决议（2026-09-22）：**暂不拆**——prod console 短期与 dev 共用域 C，即域 C 一把钥。
> 未来 prod 换用独立部署库时，域 C 拆为「域 C-dev」与「域 C-prod」，各自一把钥；
> **变更步骤与脚本已先行备好**：`specs/config-master-key-distribution/domain-split-guide.md` + `scripts/master-key-domain-split.mjs`（见 §10）。

---

## 3. Q1–Q11 决议与影响

| # | 问题 | 决议 | 影响 |
|---|---|---|---|
| Q1 | 哪些机器需要 | **域 L（本地）+ 域 C（堡垒机/dev/未来 prod）**，未来新机按部署库归属入域 | 分发对象是"域"，流程按域走 |
| Q2 | 交付通道 | **先落地「密钥文件 + pm2 启动期注入」**，云 KMS/Secrets Manager 留未来（§7 P3） | 需改 `config-crypto.ts`（支持文件读）+ 改启动脚本；**不能靠 `.env`** |
| Q3 | 在线轮换 | **要**：双钥并行解密 + 存量重加密，全程无"解密失败窗口" | 密文需带 keyId（§5.3，走前缀，不改表） |
| Q4 | 操作者/审批/审计 | 仅 **`super_admin`**；新增权限码 `config:secret:rotate`；审计落 `audit_logs` | 需给 deploy-console 补权限守卫（现无）+ 轮换端点 + 审计埋点 |
| Q5 | 应急 | **先止血再轮换**（先撤销下游凭据，再换主密钥；顺序不可颠倒，理由见 §5.5） | 需要一份应急处置流程（runbook 章节） |
| Q6 | 新机上线 | **脚本自证**：`provision` 投递 + `verify` 自检（可脱离服务独立运行） | 新增 2 个脚本 + checklist |

### Q7–Q11 决议（2026-09-22 已定）

| # | 问题 | 决议 | 影响 |
|---|---|---|---|
| **Q7** | 注入密钥**值**还是**路径** | **注入路径**（`CONFIG_MASTER_KEY_FILE`），值由代码从 0600 文件读 | 保住 K2（值不进 `pm2_env`/`dump.pm2`/`ps e`）；`config-crypto.ts` 增文件读分支 |
| **Q8** | prod console 部署库归属 | **短期同库不拆**（域 C 一把钥）；未来换库按 §10 指南拆域 | 本轮分发对象不变；换库指南 + `master-key-domain-split.mjs` **先行备好**（不待到时再设计） |
| **Q9** | 是否兼容老密文（3 段） | **不兼容**：应用只认 `<keyId>:iv:tag:data`；老密文由**一次性迁移**（p26）改写 | **新增 P2a 批次**（停机窗口 + 影子表备份 + 校验 + 回退）；`decryptSecret` 遇 3 段直接抛"需先迁移" |
| **Q10** | 是否允许秒级重启 | **允许**（"在线"= 无解密失败窗口、可中断重入，非零停机）；集群化后约束消失 | 轮换每步可重启；P2a 迁移仍需一次分钟级停机（格式不能并存，见 §5.3） |
| **Q11** | `provision` 执行者与通道 | **super_admin 在目标机执行**，密钥经 `scp` / `read -s` 直传，禁止 `KEY=xxx cmd` | 脚本入参只收**文件路径**；密钥值只经 stdin/文件流动 |

---

## 4. 分发方案对比（结论：A + B 组合）

| 方案 | 做法 | 结论 |
|---|---|---|
| A 密钥文件 + 权限收口 | `/etc/web-system/config-master.key`（0600，属主=pm2 启动用户） | ✅ **采纳为存储真相源**：不进 git/镜像/进程列表；`chmod` 即权限边界；变更走文件系统可审计 |
| B 部署时注入环境 | 启动脚本读密钥再注入 pm2 env | ⚠️ **采纳其"注入"形态，但注入物改为文件路径**（Q7）：直接注入值会与 K2 冲突，也与"进程环境只保留 PATH/HOME/PORT"铁律打架 |
| C 云 KMS / Secrets Manager | SDK 拉取 | ❌ 本轮不做（引入 SDK + 云权限 + 调用链依赖 + 本地开发回退路径），列 P3 |
| D 维持人工 `.env` + 自检 | 不搬存储，只补启动自检与 checklist | ⚠️ **只采纳其"启动自检"这一半**（K3 的核心收益），存储仍迁到文件 |

---

## 5. 方案细则

### 5.1 分发（P0）

**文件与权限**

| 项 | 约定 |
|---|---|
| 路径 | `/etc/web-system/config-master.key`（可用 env 覆盖，见下） |
| 权限 | `0600`，属主 = **pm2 启动用户**（本地为当前用户；服务器为 root） |
| 内容 | 单行原始密钥（支持 `config-crypto.ts` 现有三形态；建议 64 位 hex，避免 base64 的 `+ / =` 在脚本里转义踩坑） |
| 备份 | 同目录 `config-master.key.bak-<ts>`（0600，保留 2 份）—— 轮换与误覆盖的回退保障 |
| 禁止 | 不进 git（`.gitignore` 已覆盖 `.env` 一族，需确认 `.key` 也在内）、不进镜像层、**不写进 `.env`**、不进 shell 历史 |

**注入方式**（写进 `scripts/publish-deploy-console.sh` 与流水线 restart 脚本的 `env -i` 行）

```bash
CONFIG_MASTER_KEY_FILE="${CONFIG_MASTER_KEY_FILE:-/etc/web-system/config-master.key}" \
env -i PATH="$PATH" HOME="$HOME" PORT="$PORT" CONFIG_MASTER_KEY_FILE="$CONFIG_MASTER_KEY_FILE" \
  "$PM2" start dist/main.js --name "$NAME" --cwd "$SVC_DIR"
```

- 与铁律一致：仍然 `env -i` 白名单，只多放行**一个路径变量**；
- `app.module.ts:34-41` 的 dotenv **不覆盖已有 `process.env`** → 过渡期"注入 + `.env` 并存"时以注入为准，可平滑切换；
- 过渡顺序：先加注入并确认自检通过 → 再把各机 `.env` 里的 `CONFIG_MASTER_KEY` 行注释掉 → 最后删除（回退 = 反向操作）。

**代码侧（`config-crypto.ts`，约 20 行）**

- `masterKey()` 取值优先级：`CONFIG_MASTER_KEY`（env 值）→ `CONFIG_MASTER_KEY_FILE`（读文件，`trim()` 后按现有规则派生）→ 都没有则抛错（错误文案要带**修复指引**：路径 + 值班流程，满足 K3）；
- 两者同时存在且派生出的 32 字节不一致 → **启动即报错**（防"以为在用一个钥，其实用另一个"）；
- 值来源（env / file / 路径）在启动日志打一行，值本身永不打。

### 5.2 一致性证明（P0）

**① 启动自检**（新增 `servers/deploy-console/src/config/config-self-check.service.ts`，`OnApplicationBootstrap`）

- 动作：`SELECT ... WHERE is_secret=1 AND enabled=1 LIMIT 1` → `decryptSecret()`；
- 成功：`log` 一行 `[config] 主密钥就绪 fp=<指纹> source=<env|file> active=<keyId> ring=[k1,k2] 抽样可解=1/1`；
- **失败分类**（关键，避免把 DB 抖动当密钥错误）：
  - GCM 认证失败 / 格式非法 → **`process.exit(1)`** 并输出「主密钥与本库不匹配」+ 修复步骤（K3）；
  - 库不可达/无表 → 保持现有启动行为（不 exit），仅告警；
- 库里尚无 `is_secret` 行 → pass，日志注明「无密钥项可抽检」；
- 与 pm2 的交互：`exit(1)` 后 pm2 会尝试重启，连续失败达上限后置为 `errored` 停止刷屏；发布流水线的 `verify` 阶段会因探活失败把该次发布标红 —— 即"启动即失败"会**向上暴露为发布失败**，不会静默。日志首行放 `FATAL` 便于 grep 与告警。

**② 独立验证脚本** `scripts/verify-config-master-key.mjs`（K1/K6 的自证工具，**不依赖服务进程**）

| 步骤 | 输出 |
|---|---|
| 解析密钥来源（env / 文件 / 默认路径），派生密钥 | `source`、**指纹** |
| 连部署库（读 `servers/deploy-console/.env` 的 `MYSQL_*`，键名兼容） | 库实例（脱敏） |
| 扫描 `config_items.value` 的 keyId 分布 + **老格式计数**（Q9 后老格式应恒为 0） | `k1: 3 / k2: 5 / 老格式(须迁移): 0` |
| 逐 keyId 试解一条样本；扫最近 N 条 `config_snapshots.payload` 同样试解 | 每个 keyId 可解/不可解 |
| 退出码 | `0` 全绿；`2` 有不可解密文；`3` 密钥缺失/格式非法 |

**③ 跨机一致性**：各机启动日志的指纹一致 = 域内一致。比对方式：`ssh-jump` 后 grep 日志，
或在 `verify` 脚本加 `--peers` 参数（P1，可选）。

### 5.3 在线轮换（P2，Q3）

**密文格式（Q9 已定）：只认新格式 `<keyId>:iv:authTag:ciphertext`，不兼容老密文。**

| 项 | 约定 |
|---|---|
| 写入 | `encryptSecret()` 恒输出 4 段（段首 = active keyId） |
| 读取 | `decryptSecret()` **只接受 4 段**；3 段老密文直接抛 `密文格式已升级，请先执行 p26 迁移脚本`（不静默、不猜钥、不回落默认钥） |
| 定位 | 查"哪些行还用旧钥"：`WHERE value LIKE 'k1:%'`；快照查同名字段（自描述，无需加列） |
| 为什么不用加列 | 除"不改数据模型"外还有一条实测理由：deploy-console 的 TypeORM 是 `synchronize: true`（`app.module.ts:53-56`），**加列会直接改真库表结构**，风险与不可控性都高 |
| 代价 | 必须有一次**一次性格式迁移**（P2a），迁移期间**停写**（分钟级窗口） |

**P2a 格式迁移（停机窗口，`scripts/migrations/p26-master-key-format-migrate.mjs`）**

| 步 | 动作 | 校验 |
|---|---|---|
| M1 | `pm2 stop web-deploy-console` —— 它是**唯一写入方**，停了才无并发写 | 6200 不再监听 |
| M2 | 备份：`config_items` / `config_snapshots` 各建影子表 `<表>_bak_p26_<ts>` | 两表行数与源表一致 |
| M3 | 逐行「用当前主钥解密老密文 → 按新格式重加密（keyId 显式传入，如 `k1`）」写回；`config_snapshots.payload` 逐条同样处理 | `is_secret=1` 行 100% 匹配 `^[A-Za-z0-9_]+:`；已迁移（4 段）的行跳过（幂等） |
| M4 | 部署"只认新格式"的代码（同批含 P2b 密钥环）→ `pm2 start` | 启动自检通过（§5.2）+ `verify` 退出码 0 |
| M5 | 失败回退：`ROLLBACK=1` 从影子表恢复两表 + 回退代码版本 → 起旧代码 | 自检通过 |

> **为什么必须停机**：Q9 选了"不兼容"之后，**同一时刻只能存在一种格式**（旧代码读不了新格式，新代码读不了老格式）。
> 若不停写，迁移期间 console 的 `upsert` 会把老格式写回去，迁移永远追不上。
> Q10 的"秒级重启"是**轮换**的上界；P2a 的分钟级窗口是**格式迁移**的上界，两者不冲突。

**P2b 密钥环（两个变量，值或路径二选一，与主钥同规则）**

| 变量 | 含义 |
|---|---|
| `CONFIG_MASTER_KEY` / `CONFIG_MASTER_KEY_FILE` | **active 密钥**（新写入用它加密），带 `CONFIG_ACTIVE_KEY_ID`（默认 `k2` 这类短标识） |
| `CONFIG_MASTER_KEY_OLD` / `CONFIG_MASTER_KEY_OLD_FILE` | **旧钥集合**（JSON `{"k1":"<raw>"}`），仅供解密 |

**P2b 轮换步骤（每步可独立回退）**

| 步 | 动作 | 预期 | 回退 |
|---|---|---|---|
| S1 | 生成新钥：`scripts/rotate-master-key.sh --gen`（输出 keyId + 密钥**一次**、指纹） | 得到 `k2` | 丢弃即可 |
| S2 | 分发 `k2` 到域内每台机：写 `config-master.key.bak-<ts>` 后替换 active、把 `k1` 放入 OLD，重启 console | 各机日志 `ring=[k1,k2]`，`verify` 两把钥都能解 | 恢复 `.bak` + 重启 |
| S3 | 确认全机就绪后，**切换 active=k2**（新写入走 k2） | 新建/修改密钥项成功后 `value` 以 `k2:` 开头 | `CONFIG_ACTIVE_KEY_ID` 改回 `k1` |
| S4 | 存量重加密：`POST /api/config/secrets/reencrypt`（super_admin + 审计）—— 遍历 `is_secret=1` 且非 `k2:` 前缀的行 → 解出用 k2 重加密；**逐条提交、幂等（已是 k2 的跳过）、可中断重跑**；同一动作处理 `config_snapshots.payload` 内密文 | 返回 `{items: n, snapshots: m}`，审计落一条 | 无需回退（双钥并存，未处理的仍可解） |
| S5 | 验证：`verify` 报告 `k1` 计数 = 0（**含快照**） | 退出码 0 | 重跑 S4 |
| S6 | 下线 `k1`：从 OLD 移除，重启各机 | `verify` 仍 0 | 把 `k1` 放回 OLD |

**三条硬性约束（实现时必须遵守）**

1. **密钥变更只在重启后生效**：`config-crypto.ts` 有进程内 key 缓存（`cachedKey`），改文件/env 后必须重启进程（S2/S3/S6 已含重启）—— 不要以为"改文件就生效"，否则演练会得出错误结论。
2. **重加密与并发写入存在竞态（会丢用户更新）**：重加密是 read-modify-write；若期间有人 `upsert` 同一个键，可能把**旧值**用新钥写回。对策：逐条用 **compare-and-set** 更新（`UPDATE config_items SET value=<新密文> WHERE id=? AND value=<读到的旧密文>`），未命中即跳过并计数；响应与审计里写明"跳过 N 条（期间被修改）"。
3. **S3 的「全机就绪」必须可证**：切换 active 前，各机 `verify` 输出必须一致（全部 `active=k2`、`ring=[k1,k2]`），否则会出现"部分机器仍在写 k1"的混合状态，重加密永远收敛不了。

**必须记住的两个坑**

1. **快照必须一起重加密**：`restore()`（`config.service.ts:348-371`）把快照密文**原样写回** `config_items` —— 若快照残留 `k1` 密文而 `k1` 已下线，**回滚动作会写入不可解数据**，故障延后到下次回滚才爆。故 S5 必须检查快照，S6 之前完成。
2. **重加密不能走 `upsert()`**：`upsert` 会重置 `updatedBy/description/enabled` 并触发唯一键查找，语义不对；应新增专用的 `reencryptSecrets()`（只改 `value` 一个字段）。

### 5.4 权限与审计（Q4）

- **权限码**：在 `packages/types/src/index.ts` 的 `PERMISSIONS` 增加 `config` 组 → `config:secret:rotate`（`super_admin` 因 `ROLE_PERMISSIONS = Object.keys(PERMISSIONS)` **自动拥有**，无需改映射）；
- **守卫**：deploy-console 现无权限守卫 → 新增最小实现的 `@RequireSuperAdmin()`（依据 `jwt.strategy.ts:63` 已映射的 `role`），**只挂轮换/重加密端点**；现有配置读写端点不动（避免扩大改动面）；
- **审计**（`AuditService.log()`）：`action=config.secret.rotate` / `config.secret.reencrypt`；
  `detail` 只允许：`keyId`、**指纹**、受影响 `items/snapshots` 行数、来源 IP（若后续补字段）；
  **绝不记密钥值与任何明文**（沿用 `SECRET_UNRECORDED` 口径）；
- **前端**：`apps/deploy-console` 目前无权限控制（未找到 `hasPermission`/`v-permission`）→ P2 内先按 `role === 'super_admin'` 隐藏入口，不引入权限码体系。

### 5.5 应急：先止血再轮换（Q5）

> **核心认知**：主密钥泄露 ≠ 只泄露一个密码 —— 它等于**库里所有 `is_secret` 项的明文都泄露**（含 `HY3_API_KEY`、`TOKENHUB_API_KEY`、`GATEWAY_SERVICE_KEY` 等）。
> 因此"只换主密钥"是**假止血**（换个钥匙壳，泄露的凭据仍有效）。

| 阶段 | 动作 |
|---|---|
| ① 止血（分钟级） | 停扩散：轮换/吊销**所有被加密的下游凭据本身**（第三方控制台重置）、限制 console 访问来源、检查 `audit_logs` 找异常读取/发布、必要时暂停发布 |
| ② 换壳（小时级） | 按 §5.3 执行完整轮换（S1–S6），确保 `k1` 密文清零 |
| ③ 收尾 | `verify` 全绿 + 抽查下游服务连通性（下发文件里的新凭据生效）+ 复盘时间线 |
| 前置准备（平时就做） | 本流程写入 runbook；泄密判据与通知对象明确到人；`config_snapshots` 保留策略与 S4 的重加密动作演练过至少一次 |

### 5.6 新机器上线（Q6）

**两个脚本 + 一份 checklist，机器自己证明配置正确。**

| 工具 | 作用 |
|---|---|
| `scripts/provision-master-key.sh --domain L\|C [--key-file <路径>]` | super_admin 在目标机执行（Q11）：从同域既有机器安全取钥（`scp` 直传 / `read -s` 手输，**入参只收文件路径**），落 0600 + 备份，打印**指纹**；参数化路径便于本地演练 |
| `scripts/verify-config-master-key.mjs`（§5.2） | 独立自检：来源、指纹、keyId 分布、config_items 与 snapshots 抽样解密；退出码可进 CI/脚本 |
| checklist | 见下表 |

| # | 步骤 | 通过判据 | 失败处置 |
|---|---|---|---|
| 1 | 确认部署库归属（域 L / 域 C） | `servers/deploy-console/.env` 的 `MYSQL_HOST` 指向预期实例 | 停：先定域 |
| 2 | `provision-master-key.sh` 投递密钥 | 文件 0600、属主=pm2 用户；**指纹 = 同域既有机器** | 重投；不一致则**不要启动** |
| 3 | `verify-config-master-key.mjs` | 退出码 0（抽样全可解） | 有不可解密文 → 域选错/钥过期 |
| 4 | 启动 console | 启动日志出现自检通过 + 指纹 | exit(1) 会自证（K3），按提示修复 |
| 5 | 删除该机 `.env` 里的 `CONFIG_MASTER_KEY` 行 | 重启后自检仍通过 | 恢复 `.env` 行（过渡回退） |
| 6 | 回退路径确认 | `.bak-<ts>` 存在 + 恢复后自检通过 | — |

---

### 5.7 反例与「必然失败」清单（设计已规避，实现时勿回退）

| # | 反例 | 为什么一定会翻车 | 规避（本文位置） |
|---|---|---|---|
| 1 | 把密钥**值**注入进程 env 图省事 | 值落 `pm2_env`/`dump.pm2`，`ps e` 可读 → K2 判据直接不成立 | D2 + Q7（注入路径、代码读文件） |
| 2 | 泄露后**只换主密钥**、不换下游凭据 | 泄露的本质是库里所有明文凭据都已外泄，换壳无效 | §5.5 阶段① |
| 3 | 只重加密 `config_items`、漏掉 `config_snapshots.payload` | 快照密文被 `restore()` 原样写回 → 下次回滚写入不可解数据，故障延后引爆 | §5.3 坑 1 + S4/S5 |
| 4 | 重加密用 `upsert()` 走一遍 | 重置 `updatedBy/description/enabled`，且与并发写入竞态丢更新 | §5.3 坑 2 + 硬性约束 2 |
| 5 | 改完密钥文件未重启就宣称完成 | 进程内 key 缓存不失效 → 表现"改了不生效" | §5.3 硬性约束 1 |
| 6 | 用"库内没有 k1 密文"倒推"旧钥已失效" | 没数据 ≠ 不可解，判据不可测 | §6 K4 负向验证 |

## 6. 验收判据（K1–K5 细化）

| # | 判据（来自 handoff） | 验证动作 | 通过口径 |
|---|---|---|---|
| K1 | 新机器一次到位 | 在一台**新机器**按 §5.6 顺序执行 | 第 3、4 步均通过，全程无人工试错 |
| K2 | 密钥不出现在 git / 命令历史 / 进程命令行 / 日志 / 镜像层 | `git log -S` 搜索；`ps eww` 看进程 env；`pm2 describe` / `~/.pm2/dump.pm2`；`pm2 logs` grep 值；镜像层（Dockerfile 未含密钥） | 五处均无明文；env 里只有**文件路径** |
| K3 | 不一致时启动即失败且提示可执行修复 | 故意改错密钥后重启 console | 进程退出（非运行中报错），日志给出「主密钥与本库不匹配」+ 修复命令 |
| K4 | 轮换后全部密文可解、旧钥失效后不可解 | ① 本地按 S1–S6 演练，`verify` 检查 `config_items` **与** `config_snapshots`；② 负向验证**必须人工构造一条旧钥密文**（S5 后库内已无 `k1` 密文可测，不能靠"没数据"倒推通过） | ① 重加密后全绿（`k1` 计数=0）；② 移除 `k1` 后该构造行解密**抛错**、且 `verify` 退出码 2 |
| K5 | 任一步可回退 | 每步中断一次并回退 | 双钥并存期（S2–S5）任意点中断，服务**仍可解密运行**；口径 = "可运行可解"，**不要求**密文回到 `k1`（已用 `k2` 加密的数据保留 `k2`），回退 = 把 active/`ring` 调回可用组合 |
| **K6（Q9 新增）** | 格式迁移一次性且无残留 | 在域 L 跑 `DRY_RUN=1` 看清单 → 全量执行 p26 → 迁移后 `verify`；再验 `ROLLBACK=1` | 迁移后 `老格式计数=0`（含快照）；应用只认新格式且全库可解；回退能完整恢复两表 |

本地演练命令（拟定）：
1. `node scripts/verify-config-master-key.mjs`（域 L 基线，**要求 `老格式计数≥1`**，否则迁移脚本没东西可检）
2. `DRY_RUN=1 node scripts/migrations/p26-master-key-format-migrate.mjs` → 全量执行 → 再 `verify`（`老格式计数=0`）
3. `node scripts/master-key-domain-split.mjs --dry-run`（域拆分脚本的空转自检）
通过后再到堡垒机执行域 C。

---

## 7. 分期

| 期 | 内容 | 回退 |
|---|---|---|
| **P0 分发落地** | ① `config-crypto.ts` 支持 `CONFIG_MASTER_KEY_FILE`（+ 双源不一致即报错）；② 启动自检服务（含 `exit(1)` 与错误分类）；③ 启动脚本注入路径变量（`publish-deploy-console.sh` + 流水线 restart 脚本）；④ `scripts/verify-config-master-key.mjs`；⑤ `.env.example` / runbook 更新 | 恢复 `.env` 里的 `CONFIG_MASTER_KEY` 行 + 删注入变量（代码改动向后兼容，不删也不影响） |
| **P1 流程固化** | ① `provision-master-key.sh` + checklist 落 runbook；② 跨机指纹比对（可选 `--peers`）；③ 堡垒机实测 K1–K3 | 脚本删除即可，无运行时耦合 |
| **P2a 格式迁移（Q9，一次性）** | ① `scripts/migrations/p26-master-key-format-migrate.mjs`（影子表备份 + 幂等 + `DRY_RUN=1` + `ROLLBACK=1`）；② `encrypt/decrypt` 切"只认新格式"；③ 域 L 演练 K6 → 域 C 执行 | `ROLLBACK=1` 恢复影子表 + 回退代码版本（**格式不能长期双活，回退须在同一停机窗口内完成**） |
| **P2b 在线轮换** | ① 密钥环（`CONFIG_ACTIVE_KEY_ID` + `*_OLD`）；② `reencryptSecrets()` + `POST /api/config/secrets/reencrypt`（含快照，compare-and-set）；③ `@RequireSuperAdmin()` + `config:secret:rotate`；④ 审计埋点；⑤ 域 L 完整演练 K4/K5 | 双钥并行期可随时停；回退 = active/`ring` 调回可用组合（密文保留现状） |
| **P3 换库/拆域（已备好，按需触发）** | 文档 `specs/config-master-key-distribution/domain-split-guide.md` + 脚本 `scripts/master-key-domain-split.mjs` **本轮先交付**，待 prod 换库时执行；其后才是云 KMS/Secrets Manager、systemd `LoadCredential=`、按环境分钥 | 脚本默认 `--dry-run`，写入前备份目标库，`--apply` 才动数据;目标库可从影子表恢复 |
| **P4 未来（不在本轮）** | 云 KMS/Secrets Manager；迁 systemd 时用 `LoadCredential=`（凭据进 `/run/credentials/<unit>/`，**天然不进 env**，比 `EnvironmentFile` 更安全）；按环境分钥（前置：先定义 `global` 行的归属） | — |

> 依赖顺序：**P0 → P1**（文件与注入通道）→ **P2a**（格式统一，一次性停机）→ **P2b**（密钥环才有意义）。
> P0/P1 不动密文格式，可在 P2a 之前独立上线；**P2a 必须先于 P2b**（轮换的重加密依赖新格式，混做则回退不清）。
> P3 的文档与脚本与上述批次**无运行时耦合**，可独立评审/联调（只读源库 + 默认 dry-run）。

---

## 8. 影响清单

| # | 文件 | 改什么 | 风险 |
|---|---|---|---|
| 1 | `servers/deploy-console/src/config/config-crypto.ts` | 取值加 `CONFIG_MASTER_KEY_FILE`；P2a 切"只认新格式"（拒 3 段）；P2b 加密钥环 | **不兼容老密文（Q9）→ 未跑 p26 迁移就上线会启动自检失败**，必须与 M1–M4 同窗口操作 |
| 2 | `servers/deploy-console/src/config/config.service.ts` | 新增 `reencryptSecrets()`（不走 `upsert`，compare-and-set）；P2b 重加密快照 `payload` | 快照漏改 → `restore()` 写入不可解数据（故障延后） |
| 3 | 新增 `config-self-check.service.ts` + `config.module.ts` 注册 | 启动自检（`exit(1)` / 错误分类） | 误 exit 会打断发布 → 必须区分"密钥错"与"DB 不可达" |
| 4 | `servers/deploy-console/src/config/config.controller.ts` | 新增 `POST /secrets/reencrypt`（及可选 rotate 编排） | 漏挂权限守卫 = 越权重加密 |
| 5 | `packages/types/src/index.ts` | `PERMISSIONS` 增 `config:secret:rotate` | 低（超管自动拥有）；注意前端打包需重建 |
| 6 | `scripts/publish-deploy-console.sh` + 流水线 restart 脚本（DB `deploy_pipeline_step_commands`） | `env -i` 白名单放行 `CONFIG_MASTER_KEY_FILE` | 与"只保留 PATH/HOME/PORT"铁律的**显式例外**，需在 runbook 写明理由 |
| 7 | `servers/deploy-console/.env` / `.env.example` / 各服务器 | 迁移密钥到文件；`.env.example` 换键名 | 过渡期双源并存 → 必须验证"注入优先"（dotenv 不覆盖） |
| 8 | 新增 `scripts/verify-config-master-key.mjs`、`scripts/provision-master-key.sh`、`scripts/rotate-master-key.sh` | 自检 / 投递 / 轮换工具 | 脚本不得接受"密钥作为命令行参数"（会进历史） |
| 8b | 新增 `scripts/migrations/p26-master-key-format-migrate.mjs`（P2a） | 老密文 → 新格式，一次迁移；影子表备份 + 幂等 + `ROLLBACK=1` + `DRY_RUN=1` | 唯一写入方停掉才执行；漏掉快照 `payload` 则回滚炸（§5.3） |
| 8c | 新增 `scripts/master-key-domain-split.mjs`（P3，本轮交付） | 换库/拆域：跨库读-解-用新钥重加密-写 + 目标库备份 + `--dry-run` 默认 | 目标库被覆盖前必须备份；默认**不删源行**（`--prune-src` 显式才删） |
| 9 | `docs/development/local-release-runbook.md` + 新 runbook 章节 | 分发/轮换/应急处置流程 | 文档不落 → 应急时会临场发明流程 |
| 10 | 密钥文件的属主与 pm2 进程用户 | 若 pm2 以 **root** 运行，则 0600 root 文件**无法阻止该进程改写主密钥** —— "能改钥 = 能解密"权限等价 | 需明确：分发/轮换脚本走**独立权限通道**执行；能写密钥文件的身份 ≈ 能读全部密钥（Q11 一并确认） |
| 11 | `audit_logs` 无 IP 字段 | 轮换审计只能记到"谁（user）"，记不到"从哪来" | 本轮接受；若要 IP 需改表，另开批次 |
| 12 | P2a 影子表 `<表>_bak_p26_<ts>` | 备份表长期堆积（`config_items` 小、`config_snapshots` 的 `payload` 是 JSON 可能不小） | 迁移验证通过后保留 1 份、其余清理；清理动作写进 runbook |

---

## 9. 决议状态（Q1–Q11 已全部定稿）

| # | 状态 |
|---|---|
| Q1 | ✅ 域 L + 域 C（按部署库划域，§2） |
| Q2 | ✅ 密钥文件 + 启动期注入文件路径（§5.1） |
| Q3 | ✅ 要在线轮换（P2b，§5.3） |
| Q4 | ✅ 仅 `super_admin` + 审计（§5.4） |
| Q5 | ✅ 先止血再轮换（§5.5） |
| Q6 | ✅ 脚本自证 + checklist（§5.6） |
| Q7 | ✅ 注入路径（Q7 决议，§3） |
| Q8 | ✅ 短期同库不拆；换库指南 + 脚本已交付（§10） |
| Q9 | ✅ 不兼容老密文 → 新增 P2a 格式迁移（§5.3） |
| Q10 | ✅ 允许秒级重启；格式迁移另需分钟级窗口（§3、§5.3） |
| Q11 | ✅ super_admin 执行 + `scp`/`read -s`（§3、§5.6） |

**剩余待办（实现阶段，不再是设计待确认）**：① 按 §7 分期从 P0 开工；② 每批开工前更新 `handoff.md` §2 现状事实；
③ P2a 上线前把 §5.3 的 M1–M5 写进 runbook（含停机窗口通知）；④ P3 脚本上生产前在域 L 用复制库演练一遍。

---

## 10. 未来换库 / 拆域（Q8）

场景：prod 从"与 dev 共用云部署库"切到**独立部署库实例**（或本地库迁到新机）。此时**密钥域随库变化**：
新库 = 新域 = 一把新钥，旧域的密文不能直接搬（跨域解密失败）。

**本轮交付**（不等到换库时再设计）：

| 交付物 | 内容 |
|---|---|
| `specs/config-master-key-distribution/domain-split-guide.md` | 换库/拆域完整指南：触发判据、两种情形（空库新建 / dump 复制）、步骤、校验、回退、脚本用法 |
| `scripts/master-key-domain-split.mjs` | 迁移助手：跨库读密文 → 用源域钥解密 → 用目标域钥重加密（keyId 换新）→ 写目标库；**默认 `--dry-run`**，`--apply` 才写，写前备份目标库，默认**不删源行** |

**要点（详见指南）**：

1. **空库新建是首选**：新库无密文时，直接在控制台重新录入密钥项（用新钥加密），**不需要迁移脚本** —— 脚本只服务"从旧库 dump 复制"的情形；
2. **`global` 作用域行必须一起迁**：它被所有 env 共用，漏迁会导致新库解析缺项（`resolve()` 的 global 层为空）；
3. **快照一起迁**：`config_snapshots.payload` 内密文同样换钥，否则新库首次回滚即炸；
4. **机器侧同步**：新库对应的机器（含未来 prod console）用 `provision-master-key.sh --domain <新域>` 投递新钥；**旧域钥不得留在新域机器上**；
5. **验证**：新域机器上 `verify-config-master-key.mjs` 退出码 0，且**指纹与旧域不同**（不同则证明两域密钥确实分离）。
