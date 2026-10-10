# 配置中心（deploy-console）运维说明

> 2026-10-10 建立，对应设计文档：`docs/architecture` 之外的
> 《2026-10-10-console平台边界与配置中心设计.md》P0-1/2/3。
> 面向的使用者：**往配置中心里写东西的人**（你自己 / AI 会话 / 将来的同事），以及排查"配置为什么没生效"的场景。

---

## 1. 两个维度：作用域（谁优先）× 层（谁消费）

### 1.1 作用域 scope —— 决定"覆盖谁"

`global` → `env` → `module`，**后者覆盖前者**。这是既有能力，没有变化。

查询某个「环境 × 服务」实际生效值时，三层的行都会被拉出来按优先级合并。

### 1.2 层 layer —— 决定"能不能下发"（2026-10-10 新增）

| 层 | 语义 | 能否写进服务的 `.env.generated` |
|---|---|---|
| `bootstrap` | 引导键：DB / Redis / 主密钥来源 | ❌ 永不（鸡生蛋：读配置中心之前它就得在） |
| `infra` | 基础设施：端口 / 路径 / 主机 / TTL | ✅ |
| `app` | 应用业务配置与密钥（**默认层**） | ✅ |
| `platform` | 平台自身行为（`PLATFORM_*`） | ❌ 由 console 进程内读取 |

**新加配置时的默认选择：不用管 layer**（默认 `app` 即可）。只有在两种情况下要显式改：

1. 这个值是 DB / Redis / 主密钥一类"连配置中心之前就要有"的 → `bootstrap`；
2. 这个值是调平台自己行为的（`PLATFORM_*`）→ `platform`。

> ⚠️ 存量数据：新库/Gateway

### 1.3 为什么既有 layer 又保留硬编码名单

`config.service.ts` 里 `RESERVED_LOCAL_KEYS` 这个名单**没有删**，它是兜底：
万一某行的 `layer` 没回填（历史数据、手工 INSERT 忘写），`isRowDeliverable()` 仍会按名单拦住，
不会把 `MYSQL_PASSWORD` 写进服务 `.env.generated`。

**layer 负责向前扩展**（新能力不用改代码），**名单负责向后兜底**（历史数据安全）。两者并存是刻意的。

---

## 2. 新落地的三张表的分工

| 表 | 粒度 | 回答什么问题 |
|---|---|---|
| `config_items`（既有） | 当前值 | 现在生效的是什么 |
| `config_snapshots`（既有） | 发布版本 | 某个版本发布时配置长什么样 |
| `config_revisions`（新增） | **每次保存** | 这个值什么时候被谁改过 / 改之前是多少 / 能不能退回某一次 |
| `config_deliveries`（新增） | **每次下发** | 发给了谁、发了多少个键、目标机实际有没有落对 |

`revisions` 与 `snapshots` 不可互相替代：一个是键值流水，一个是版本切片。

---

## 3. 新增接口

### 管理接口（控制台 JWT）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/config/revisions?scope&envId&moduleKey&key&limit` | 变更历史，**只回指纹不回值** |
| POST | `/api/config/rollback` `{revisionId}` | 单键回滚到某次变更 |
| GET | `/api/config/deliveries?envId&moduleKey&limit` | 下发记录 + 目标机回执 + 漂移标记 |

### 内部接口（`x-internal-key`，供脚本/目标机）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/config/internal/dispatch/:serviceKey?envId=&runId=` | 取 `.env.generated`（**现在会落下发记录**） |
| POST | `/api/config/internal/report` `{envId, moduleKey, contentHash}` | 目标机上报实际 hash → 算 drift |

**下发记录的关键细节**：返回 `204`（没有 module 级条目 / 没有可下发键）**也会记一笔**，
`result='empty'`。否则"配了却没生效"这类故障依然无证可查。

---

## 4. 值类型与校验（写值时即时报错）

新增配置时可指定 `valueType`（`string` / `number` / `bool` / `json` / `port` / `path`）
和 `validators`（`{ pattern?, enum?, min?, max? }`）。写库时就校验，不合法直接 400。

建议至少给这两类键设类型：

| 键 | 建议 | 理由 |
|---|---|---|
| `PORT` 及一切端口 | `port` | 超过 65535 或写成中文可以在下发前拦住 |
| 各种开关（`*_ENABLED`） | `bool` | 避免 `yes` / `on` / `1` 三种写法混着用 |

**不要**给还不确定的键乱加 `validators`：配了但值不符合 → 以后每次改值都会被卡住。

---

## 5. 变更历史里密钥是怎么处理的

- 非密钥：`before_value` / `after_value` 存**明文**（与列表页口径一致）；
- 密钥：存的是 `config_items.value` 里的**密文**（`iv:tag:data`），回滚时原样写回，
  **全程不需要解密**，明文零暴露面；
- 两种情况下 `*_fingerprint` 口径一致（都对待存的那个值做 sha256 前 12 位），所以可以安全地做 diff 提示。

---

## 6. 部署后要做的事

1. 发布 deploy-console（dev 的 `DB_SYNCHRONIZE=true`，新表新列会**自动建**）；
2. 跑一次 layer 回填（这一步 synchronize 不会替你做）：
   ```bash
   mysql -uroot -p web_system_deploy \
     < servers/deploy-console/scripts/config-center-base.sql
   ```
3. 用脚本末尾注释里的自检 SQL 确认返回 0 行；
4. 验证：改一个已有配置 → `GET /api/config/revisions` 能看到一条记录。

---

## 7. 已知边界（这一批**故意没做**的）

| 没做 | 原因 |
|---|---|
| 主密钥轮换（虽有 `key_version` 字段） | 需要先有按代次重加密的脚本，单独立项 |
| prod 密钥变更审批 | 要复用 approval 模块，与流水线的审批语义先对齐 |
| `config_read_audit`（密钥读审计） | 优先级低于前两项 |
| 目标机自动上报（漂移巡检） | 需要一个常驻采集点（runner），属于 P1 范围 |
| `apply_mode=immediate` 热更新 | 当前**所有配置仍是重启生效**，该字段仅占位 |
