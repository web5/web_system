# console 两阶段自举（不依赖部署环境）

> 2026-10-13 建立，对应设计《2026-10-10-console平台边界与配置中心设计.md》§3.6。
> 面向的使用者：**要在新机器上起 console 的人**，以及排查「console 起不来 / 配置没生效」的场景。

---

## 1. 为什么要有这一层

现状：`servers/deploy-console/.env` 里有 **30 个键**（DB 连接、Redis、JWT、各服务地址、
静态资源根、SSH 目标……）。换一台机器部署 console，就得把这份文件整个复制过去 ——
这就是「依赖部署环境」。

「不依赖部署环境」不是零配置（读配置中心要先连库、解密钥要先有主密钥，鸡生蛋躲不掉），
而是**把依赖收敛到三个键，且键名在任何环境都一样**：

| | 现状 | 自举后 |
|---|---|---|
| 部署 console 要带什么 | 整份 `.env`（30 键，含生产凭据） | 3 个键 |
| 改一个行为参数（如保留版本数） | 改 `.env` + 重启，**逐台改** | 配置中心改一次，重启即生效 |
| 密钥落在几台机器上 | 每台都有明文 | 只在配置中心（密文）+ 主密钥文件 |

---

## 2. 三个 bootstrap 键

写入 `servers/deploy-console/.env.bootstrap`（权限 `0600`），或走进程环境注入：

```bash
CONSOLE_ENV_ID=dev                                        # 我是哪个环境：local / dev / prod
CONSOLE_DB_DSN=mysql://用户:密码@127.0.0.1:3306/库名       # 连哪个库（含库/用户/密码）
CONFIG_MASTER_KEY_FILE=/etc/web-system/config-master.key  # 主密钥文件（0600）
```

这个文件由**自举代码自己读取**（`bootstrap/load.ts` 的 `loadBootstrapFile`），不依赖
Nest —— 因为 pm2 启动时 `.env` 系列文件是 Nest 的 `ConfigModule` 用 dotenv 读的，
而自举发生在 `NestFactory.create()` **之前**，此刻还没人读过它。

要点：

- **`CONSOLE_ENV_ID` 是模式开关**：给了它才进入自举模式；没给就按现状（`.env` 全量）启动。
  这样现网不需要「先改部署才能升级代码」，发布工具自身不该这么升级。
- **进程环境优先于文件**：pm2 env / systemd `EnvironmentFile` 里已有的键不会被文件覆盖
  （运维显式注入的优先级更高，否则排障时改了环境却不生效，比没有还糟）。
- **DSN 里密码含特殊字符必须 URL 编码**（`@` `:` `/` `%` 分别写作 `%40` `%3A` `%2F` `%25`）。
  否则解析会错位 —— 而错位的结果可能是连到**另一台库**，故解析器对无法解析的 DSN
  直接抛错，绝不做猜测。
- **主密钥两种形态二选一**：`CONFIG_MASTER_KEY`（env 值，过渡/本地用）或
  `CONFIG_MASTER_KEY_FILE`（文件，生产推荐）。两者同时给必须指向同一把钥，
  否则启动即 FATAL（避免「以为在用 A，实际用 B」的静默错配）。

---

## 3. 启动时序

```
阶段 0 · bootstrap      读三键（进程 env / .env.bootstrap）
                          ↓ 缺键且已声明自举 → FATAL + 可照抄的修复指引
阶段 1 · 拉配置          直连库读 config_items：
                          scope=global | env:<id> | module:<id>/deploy-console
                          → 按 module > env > global 裁决
                          → is_secret 项用主密钥解密
                          → 合并进 process.env（保护键除外）
阶段 2 · Nest 启动       ConfigModule / TypeORM 读合并后的 process.env
```

阶段 1 用 `mysql2` 原生 SQL 而不是 TypeORM 实体：此刻 Nest 还没起来，bootstrap 要的是
「最小依赖、最快失败」。连接用完即弃（Nest 起来后 TypeORM 用自己的连接池）。

### 3.1 哪些键不会被覆盖（硬保护）

配置中心是**人类可编辑的数据**，一条误配（`DB_HOST` 落在 `app` 层）就能把发布系统连到
别的库 —— 而 console 是发布工具，连错库等于发布系统失联。所以除数据层的
`layer='bootstrap'` 之外，代码里还有一份硬保护名单：

```
CONSOLE_ENV_ID / CONSOLE_DB_DSN / CONFIG_MASTER_KEY(_FILE)
DB_TYPE / DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE
MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB
REDIS_URL
DB_SYNCHRONIZE
```

`DB_SYNCHRONIZE` 在名单里是因为它是「TypeORM 自动改表」开关 —— 一旦被误开，console
启动就会去改线上表结构，属于宁可麻烦也不可自动化的一类。

命中保护时启动日志会点名：`以下键属基础设施/自举键，已忽略配置中心的同名条目`。
`layer` 表达**意图**，名单是**兜底**，两者缺一不可。

### 3.2 console 为什么绝不给自己写 `.env.generated`

落盘会触发发布钩子 → console 重启自己 → 又落盘，自杀式循环。所以走 **M2 进程内合并**：
写 `process.env`，不落任何文件。

---

## 4. 失败分档（可用性优先于新鲜度）

| 情形 | 行为 | 理由 |
|---|---|---|
| 已声明 `CONSOLE_ENV_ID` 但缺另外两键 | **FATAL**（exit 1 + 指引） | 半自举比不自举更危险：看似去中心化，实际还是硬编码 |
| 库连不上 / 查询失败 | 只告警，按现有 env 继续 | DB 抖动不该让发布系统起不来 |
| 个别密钥解不开 | 只告警，跳过该键 | 一次误操作不该让整个 console 不可用 |
| 未声明 `CONSOLE_ENV_ID` | 按现状启动 + WARN | 渐进切换，等运维补三键后自动生效 |

---

## 5. 切换步骤（dev/prod 均适用）

```bash
# 1) 备份现状（切换失败要能一键回退）
cp servers/deploy-console/.env servers/deploy-console/.env.bak-$(date +%Y%m%d%H%M)

# 2) 建 bootstrap 文件（密码里的特殊字符记得 URL 编码）
cat > servers/deploy-console/.env.bootstrap <<'EOF'
CONSOLE_ENV_ID=dev
CONSOLE_DB_DSN=mysql://用户:密码@127.0.0.1:3306/库名
CONFIG_MASTER_KEY_FILE=/etc/web-system/config-master.key
EOF
chmod 0600 servers/deploy-console/.env.bootstrap

# 3) 把 .env 里除保护键以外的键，逐个在配置中心登记（这一步决定"少带多少东西"）
#    页面：配置中心 → 环境 dev → 模块 deploy-console

# 4) 重启并看日志
pm2 restart deploy-console && pm2 logs deploy-console --lines 60 | grep Bootstrap
#    期望看到：bootstrap 完成 env=dev 条目=N 生效=M 保护跳过=K 主密钥=file fp=xxxxxxxx

# 5) 验收：把 .env 里已登记的那些键注释掉 → 再重启 → 行为不变
```

**回滚**：删掉 `CONSOLE_ENV_ID`（或整个 `.env.bootstrap`）→ 重启 → 回到现状模式。
代码无需回滚，无需改库。

---

## 6. 已知边界

1. **只支持 `mysql://`**。dev/prod 都是 MySQL；将来要接 PostgreSQL 需扩展 `parseConsoleDsn`
   与阶段 1 的驱动分派（目前其它 driver 明确抛错，不静默失败）。
2. **撤销/热更新不在这一层**。本文件只负责「启动时把配置读对」；运行期的热更新与
   凭据生命周期见 `pipeline-run-token.md`。
3. **多实例部署时**：每个实例启动时各拉一次，配置中心短暂不可达会退化为「用现有 env」，
   表现为各实例配置不一致 —— 与既有行为一致，不因本改动变差。
