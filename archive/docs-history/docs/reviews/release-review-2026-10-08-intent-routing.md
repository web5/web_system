阻塞: 0
重要: 5

# 发布评审报告：意图路由配置修复（p34 + INTENT_* 配置）

- 评审角色：`release-reviewer`（独立第三方，不执行发布、不改码、不改库）
- 评审时间：2026-10-08
- 评审对象：工作区未提交改动（分支 `docs/architecture-overview-v1`）
- 判据源：`docs/development/release-review-checklist.md`（A 运行面 / B 配置面 / C 数据面 / D 前端面 / E 特殊通道）
- 结论：**❌ 阻塞**（阻塞 3 项未清零，退回整改后再交人放行）

> 范围声明：工作区另有 `?? .codebuddy/skills/wb-auto-deliver/` 与 `?? specs/auto-deliver/`，与本次发布面无关，**不在本次评审范围**，本报告不涉及、不评审。

---

## 0. 结论摘要

| 面 | 结论 | 一句话 |
|---|---|---|
| A 运行面 | ❌ 阻塞 | dev / prod 两侧**运行的代码都还是 9-30 的旧产物**，本次改动尚未提交、尚未进入任何发布目录 |
| B 配置面 | ⚠️ 有条件 | `INTENT_MODEL` 值与注册键**逐字一致** ✅；但 dev **缺** `INTENT_FALLBACK_AGENT_ID`、prod **缺 3 项** INTENT 配置 |
| C 数据面 | ❌ 阻塞 | p34 **已落 dev**（已 SELECT 核实），但 keywords 是**整体覆盖**而非合并，且**无变更前快照**；脚本无环境护栏、不在任何自动化流程内 |
| D 前端面 | — | 本次无前端改动，不适用 |
| E 特殊通道 | ⚠️ 有条件 | 「发布成功 ≠ 服务可用」的验证动作尚未落地（§4 给出可执行命令） |

三句话版本：

1. **现在发不生效** —— 代码没提交、没构建，dev/prod 的 `dist` 都是 9-30 的；只改 `.env` 和 DB 等于改了个寂寞。
2. **prod 库是唯一不可逆动作** —— p34 会**整体替换** `translate.keywords`，而变更前快照此前没人做（本报告的 §5 已补取 prod 基线）。
3. **重启方式不能错** —— 禁 `pm2 restart --update-env`；且必须先重建 workspace 包 `@kedouai/agent-core`，否则 ai-agent 仍加载旧 dist（**无任何报错**）。

---

## 1. 改动面（本次评审覆盖）

| 文件 | 面 | 性质 |
|---|---|---|
| `servers/ai-agent/.env.example` | B 配置面 | 新增 `INTENT_ROUTING_ENABLED` / `INTENT_MODEL` / `INTENT_TIMEOUT_MS` / `INTENT_FALLBACK_AGENT_ID` 四项文档 |
| `archive/migrations/p34-agent-routing-fix.mjs` | C 数据面 | 新迁移：改 `agent_definitions` 的 3 行 model（短名→带前缀）+ translate 的 keywords |
| `servers/ai-agent/src/agent/agent-def-sync.service.ts` | A 运行面 | 新增依赖 `ClientRegistry`，新增 `assertModelRegistered()` 启动/轮询期校验 |

连带受影响（同分支一起改动，影响 A3 构建面判定）：

- `packages/agent-core/src/**`（`intent-classifier.ts` 等）—— **workspace 包，必须单独 rebuild**
- `servers/ai-agent/src/agent/agent.module.ts`（`GENERAL_AGENT_DEFINITION.model` 短名→带前缀）
- `servers/ai-agent/src/agent/intent/intent.service.ts`（默认值 1200→3000、短名→带前缀）
- `servers/ai-service/src/agent-def/agent-def.service.ts`

---

## 2. 逐条判据结论（含证据命令与输出要点）

### 2.1 B 配置面

#### B-1 `.env.example` 与 dev 实际 `.env` 是否一致 —— ⚠️ 有缺口（严重级：重要）

证据命令（dev 机，只读）：

```bash
ssh -i ~/.ssh/id_ed25519_servers ubuntu@175.27.189.123 \
  'cd /data/web_system/servers/ai-agent && grep -n "INTENT_" .env'
```

实际输出：

```
35:INTENT_ROUTING_ENABLED=true
38:INTENT_MODEL=deepseek/deepseek-v4-flash
39:INTENT_TIMEOUT_MS=3000
```

与 `.env.bak-p34-20261008211342` 的 diff（证明「只追加了两行」，`INTENT_ROUTING_ENABLED=true` 是**存量**配置，非本次引入）：

```
35a36,39
>
> # 意图路由：模型 id 必须与 ClientRegistry 注册键逐字一致（带 deepseek/ 前缀）；超时留足余量
> INTENT_MODEL=deepseek/deepseek-v4-flash
> INTENT_TIMEOUT_MS=3000
```

缺口矩阵：

| 键 | `.env.example` | dev 实际 | prod 实际 | 判定 |
|---|---|---|---|---|
| `INTENT_ROUTING_ENABLED` | `false`（示例值） | **`true`** | **`true`**（行 35） | ✅ 一致（示例值本就应与线上不同）；**整条链路在 dev/prod 均已启用** |
| `INTENT_MODEL` | `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-flash` | ❌ **缺失** | dev ✅ / prod 缺（走代码默认） |
| `INTENT_TIMEOUT_MS` | `3000` | `3000` | ❌ **缺失** | dev ✅ / prod 缺（走代码默认） |
| `INTENT_FALLBACK_AGENT_ID` | `general` | ❌ **缺失** | ❌ **缺失** | **两端都缺**，「文档写了但线上没有」 |

**反例 1（情形 → 实际 vs 期望）**：prod 上线新代码后若仍未补 `INTENT_MODEL`，则走 `intent.service.ts` 的**代码默认值**。旧代码默认值是 `deepseek-v4-flash`（短名，**未注册**，静默回退 hy3）；新代码默认值是 `deepseek/deepseek-v4-flash`。也就是说**默认值在本次改动中变了**——这正是「线上有但没入文档」的反向缺口：配置缺失时行为随代码版本漂移，排查成本极高。
**判据**：B3（关键依赖配置非缺失）。**严重级：重要。是否阻塞：否（但为 prod 放行前提）。**

**反例 2**：`INTENT_FALLBACK_AGENT_ID` 两端都未显式配置，依赖代码默认 `'general'`。当前默认值与文档一致，**暂时无害**；但 p34 同时把 `general.model` 改成了带前缀 id，一旦将来默认值调整，兜底目标会静默变化。建议显式写进两端 `.env`。
**判据**：B3。**严重级：建议。是否阻塞：否。**

#### B-2 `INTENT_MODEL` 是否与 `ClientRegistry` 注册键**逐字**一致 —— ✅ 通过

证据（`servers/ai-agent/src/agent/model-catalog.service.ts:13-22`）：

```ts
export const BUILTIN_TOKENHUB_MODELS = [
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',   // ← 逐字命中
  ...
].join(',');
```

逐字比对：`INTENT_MODEL=deepseek/deepseek-v4-flash` **==** `BUILTIN_TOKENHUB_MODELS[1]` ✅（含 `deepseek/` 前缀，字节级相同）。

补充核验：dev / prod 两端 `.env` 均**未设置** `TOKENHUB_MODELS`（`grep -n "TOKENHUB_MODELS" .env` 无输出）→ `clientRegistryProvider` 回落到 `BUILTIN_TOKENHUB_MODELS`，`deepseek/deepseek-v4-flash` **确定已注册**；而短名 `deepseek-v4-flash` **不在**注册表中（即 p34 要修的那个 bug）。
**判据**：B3。**严重级：—。是否阻塞：否。**

#### B-3 占位符密钥 / 配置源唯一性 —— ✅ 通过

- `grep -c "REPLACE_" /data/web_system/servers/ai-agent/.env` → `0`（dev 无占位符密钥）
- 配置源唯一：dotenv 按 `cwd` 加载发布目录的 `servers/ai-agent/.env`（`pm2 describe` 显示 exec cwd 正确，见 A-1）
**判据**：B4 / B5。**严重级：—。是否阻塞：否。**

#### B-4 `pm2_env` 污染现状 —— ⚠️ prod 已固化 PORT/NODE_ENV（严重级：重要）

```bash
# dev（pm2 id 28）
pm2 env 28 | grep -E "^PORT|^NODE_ENV|^INTENT_"
# → 无输出：dev pm2_env 未固化 PORT / NODE_ENV / INTENT_*

# prod（pm2 id 8）
pm2 env 8 | grep -E "^PORT|^NODE_ENV|^INTENT_"
# → PORT: 6010
# → NODE_ENV: production
```

- dev：**干净**，未固化任何相关变量。
- prod：`pm2_env` 里**已固化** `PORT=6010` / `NODE_ENV=production`。当前值与期望一致（无害），但它意味着：**今后改 `.env` 里的 PORT/NODE_ENV 将不会生效**，且一旦有人用 `--update-env` 重启，这两个值会被继续传播。
- 两端 `INTENT_*` 均未固化 → 新代码上线后 dotenv 能正常注入（进程 env 里没有则 dotenv 不冲突）。
**判据**：B1。**严重级：重要（并入 §2.3-A 重启方式）。是否阻塞：否。**

---

### 2.2 C 数据面（p34）

#### C-1 幂等性 —— ✅ model 部分幂等，⚠️ keywords 部分**不合并**（严重级：阻塞）

脚本生成的 SQL（`p34-agent-routing-fix.mjs`，可用 `EMIT_SQL=1 node ...` 直接打印）：

```sql
UPDATE `agent_definitions` SET `model` = 'deepseek/deepseek-v4-flash'
  WHERE `id` = 'deploy'        AND `model` = 'deepseek-v4-flash';   -- 同 general / web-system-dev
UPDATE `agent_definitions` SET `keywords` = '["翻译","译成","翻成","英文怎么说","英语怎么说","英文怎么讲","英语怎么讲","中文怎么说","日语怎么说","韩语怎么说","用英语","用英文","润色","translation"]'
  WHERE `id` = 'translate' AND (`keywords` IS NULL OR JSON_VALID(`keywords`) = 0 OR JSON_SEARCH(...) IS NULL OR ...);
```

- **model 步：幂等 ✅ 且不覆盖运营自定义值 ✅** —— `AND model = 'deepseek-v4-flash'` 把改写范围**严格限定在确实是短名**的行；运营若已改成别的 id（`hy3` / `deepseek/deepseek-v4-pro` …）**不会被碰**。重复执行 affectedRows=0 → 跳过。
- **keywords 步：幂等 ✅ 但会丢数据 ❌** —— 它是**整体 `SET` 成硬编码 14 词数组**，不是「缺什么补什么」。WHERE 只判断「是否缺 6 个新词」，一旦命中就**整列替换**。

**反例（情形 → 实际 vs 期望）**：若运营曾在后台给 `translate` 加过自定义关键词（如「同传」「本地化」），执行 p34 后这些词**被静默丢弃**；期望是「只补齐缺失词、保留自定义词」。
**加重情节**：脚本注释明确写了 `agent_definition_versions` 是历史快照、**刻意不回写**；而实测该表对 `translate` **无任何历史行**（dev / prod 两侧 `SELECT ... FROM agent_definition_versions WHERE id='translate'` 均返回空）→ **变更前值无处可恢复**。
**判据**：C6（破坏性变更有回滚路径）。**严重级：阻塞。是否阻塞：是（见 §4-Z3）。**

#### C-2 dev 库当前实际值（已 SELECT 核实，非采信陈述）

```bash
ssh -i ~/.ssh/id_ed25519_servers ubuntu@175.27.189.123 'bash -s' <<'EOF'
export MYSQL_PWD='<dev DB 密码>'
mysql -h 127.0.0.1 -P 3306 -u root -D web_system \
  -e 'SELECT id, model, JSON_LENGTH(keywords) kw FROM agent_definitions ORDER BY id;'
EOF
```

实际输出（`updated_at` 统一为 `2026-10-08 21:13:49`，即 p34 落库时间）：

| id | model | keywords 数 |
|---|---|---|
| bianbian | `hy3` | 18 |
| contract-risk | `hy3` | 10 |
| **deploy** | `deepseek/deepseek-v4-flash` ✅ | 8 |
| **general** | `deepseek/deepseek-v4-flash` ✅ | 0（`[]`） |
| study-assistant | `hy3` | 6 |
| **translate** | `hy3`（p34 不改此项） | **14** ✅ |
| **web-system-dev** | `deepseek/deepseek-v4-flash` ✅ | 8 |

`translate.keywords` 实际值：

```
["翻译","译成","翻成","英文怎么说","英语怎么说","英文怎么讲","英语怎么讲","中文怎么说","日语怎么说","韩语怎么说","用英语","用英文","润色","translation"]
```

→ **结论：p34 在 dev 已确实执行**（与用户陈述一致，独立核实通过）。3 行 model 已改、translate keywords 已补齐到 14 词。

⚠️ **dev 的 translate.keywords 变更前值未取快照** —— 无法证明「无自定义词被覆盖」。标注：**未验证**。

#### C-3 prod 库基线值（回滚基线，已 SELECT 核实）

```bash
ssh -i ~/.ssh/id_ed25519_servers root@106.52.176.246 'bash -s' <<'EOF'
export MYSQL_PWD='<prod DB 密码>'
mysql -h 172.16.16.10 -P 3306 -u root -D web_system \
  -e 'SELECT id, model, JSON_LENGTH(keywords) kw, updated_at FROM agent_definitions ORDER BY id;'
EOF
```

实际输出（`updated_at` 全部为 `2026-09-28`，**确认 prod 未执行任何变更**）：

| id | model（**prod 基线**） | keywords 数 |
|---|---|---|
| bianbian | `hy3` | 18 |
| contract-risk | `hy3` | 10 |
| **deploy** | `deepseek-v4-flash`（短名） | 8 |
| **general** | `deepseek-v4-flash`（短名） | 0（`[]`） |
| study-assistant | `hy3` | 6 |
| **translate** | `hy3` | **7** |
| **web-system-dev** | `deepseek-v4-flash`（短名） | 8 |

prod `translate.keywords` 基线（7 词，**务必记录**）：

```
["翻译","译成","翻成","英文怎么说","用英语","润色","translation"]
```

`deploy` / `web-system-dev` 的 keywords（8 词）p34 不改动，无需基线：

```
deploy:        ["发布","上线","灰度","回滚","流水线","部署","deploy","rollback"]
web-system-dev:["web_system","仓库","架构","接口","这张表","服务怎么","研发规范","源码"]
```

#### C-4 「迁移必须声明目标库」—— 结论以**仓库事实**为准（严重级：阻塞，但判据口径需修正）

判据 C1 写「文件头须有 `-- @database <db>` 注解」。核仓库实际做法：

```bash
ls archive/migrations/ | sed 's/.*\.//' | sort | uniq -c   # →  32 mjs / 4 sql / 1 md
grep -rl "@database" archive/migrations/ | wc -l            # →  1
grep -rn "@database" archive/migrations/                    # →  p26-glossary-user-memory-tables.sql:1: -- @database web_system
```

**事实：36 个迁移里只有 1 个（且是 .sql）带该注解；32 个 .mjs 全部不写。**
→ **结论：C1 的注解形式在本仓事实上只对 `.sql` 生效，`.mjs` 普遍不遵守。p34 作为 `.mjs` 未写注解，与既有做法一致，不能以此单独立判「不合格」。**

但 C1 的**意图**（执行前必须明确目标库）仍然成立，且 p34 在这里**更危险**：

```js
const consoleEnv = loadConsoleEnv();   // 读 servers/deploy-console/.env 的 DB_HOST/DB_USER/...
const cfg = { host: process.env.DB_HOST || consoleEnv.DB_HOST, ... };
```

- 未显式传 `DB_*` 时，目标库**隐式取自 `servers/deploy-console/.env`**。本机该文件不存在（`grep -n "^DB_" servers/deploy-console/.env` 无输出）→ 连不上就报错，连上了也不确定是 dev 还是 prod。
- **p34 没有任何环境参数**（对比 `scripts/apply-migrations.sh local|dev|prod`），prod 库是内网 `172.16.16.10`，与 deploy-console 的库**未必同源** → **跨库误写风险真实存在**。
**判据**：C1（意图层面）+ C4（按环境执行）。**严重级：阻塞。是否阻塞：是（见 §4-Z2）。**

#### C-5 迁移在应用流程覆盖范围内 —— ❌ 不在（严重级：阻塞）

```bash
grep -n "MIGRATIONS_DIR=\|\*.sql" scripts/apply-migrations.sh
# 42:MIGRATIONS_DIR="$SCRIPT_DIR/migrations"      ← 根目录 migrations/，不是 archive/migrations/
# 152:for f in "$MIGRATIONS_DIR"/*.sql; do        ← 只扫 *.sql
ls migrations | wc -l    # → 18（全是 .sql）
```

**事实：`scripts/apply-migrations.sh` 扫的是根目录 `migrations/*.sql`（18 个），既不扫 `archive/migrations/`，也不扫 `.mjs`。**
→ p34 **完全不在自动化流程内**，无 `schema_migrations` 记账（dev / prod 两侧 `schema_migrations` 均无 p34 记录，已核实），全靠人工 `node archive/migrations/p34-...mjs` + 手传 `DB_*` 环境变量。
**判据**：C3。**严重级：阻塞。是否阻塞：是（与 Z2 同源，合并处理）。**

#### C-6 DB 绑定 vs 代码同步顺序（C5 判据）—— ❌ 当前顺序反了（严重级：阻塞）

dev 侧证据（发布目录 vs DB）：

```bash
ssh ... ubuntu@175.27.189.123 'bash -s' <<'EOF'
git -C /data/web_system log --oneline -1                 # → 40582f61（master）
cd /data/web_system/servers/ai-agent
grep -n "INTENT_MODEL\|INTENT_TIMEOUT_MS" dist/agent/intent/intent.service.js
# → 31: this.modelId = this.config.get('INTENT_MODEL', 'deepseek-v4-flash');    ← 旧默认值
# → 32: ... 'INTENT_TIMEOUT_MS', '1200' ...                                      ← 旧默认值
grep -c "未注册，运行期会静默回退" dist/agent/agent-def-sync.service.js          # → 0（新校验不存在）
ls -la dist/agent/intent/intent.service.js                # → Sep 30 13:24
ls -la /data/web_system/packages/agent-core/dist/core/intent-classifier.js  # → Sep 30 12:21
EOF
```

**事实：dev 已改 DB（10-08 21:13）+ 已改 `.env`（10-08 21:13），但 `dist` 是 9-30 的旧产物、新校验不存在、分支还在 `master`（本次改动在 `docs/architecture-overview-v1` 且未提交）。**

**为什么 dev 目前没炸**：dev `.env` 未设 `TOKENHUB_MODELS` → `ClientRegistry` 用 `BUILTIN_TOKENHUB_MODELS` 注册，其中**包含** `deepseek/deepseek-v4-flash`。p34 把 model 改成带前缀后，旧代码也认得这个 id → **偶然安全，不是设计安全**。若哪天字典/环境把注册键换成别的清单，DB 里的值立刻变成「未注册 → 静默回退 hy3」，且**无任何报错**。
**判据**：C5（DB 绑定晚于代码同步）+ A2。**严重级：阻塞。是否阻塞：是（见 §4-Z1）。**

---

### 2.3 A 运行面

#### A-1 / A-2 改的东西真的会被加载吗 —— ❌ 现在不会（严重级：阻塞）

| 项 | dev | prod |
|---|---|---|
| pm2 进程名 | `ai-agent`（id 28，pid 2587169） | `ai-agent`（id 8，pid 2635603） |
| `script path` | `/data/web_system/servers/ai-agent/dist/main.js` | `/data/web_system_git/servers/ai-agent/dist/main.js` |
| `exec cwd` | `/data/web_system/servers/ai-agent` | `/data/web_system_git` |
| 发布目录 git HEAD | `40582f61`（branch `master`） | `b94924b3`（branch `master`） |
| dist 构建时间 | Sep 30 13:24（旧） | 未取（内容为旧，见下） |
| 是否含本次代码 | ❌ 否（新校验 grep=0，默认值仍短名/1200） | ❌ 否（`dist/agent/intent/intent.service.js:31` 仍 `deepseek-v4-flash`） |

```bash
# prod 侧反证
grep -n "deepseek-v4-flash" /data/web_system_git/servers/ai-agent/dist/agent/intent/intent.service.js
# → 31: this.modelId = this.config.get('INTENT_MODEL', 'deepseek-v4-flash');
```

→ **本次改动在 `docs/architecture-overview-v1` 分支且未提交 → 没有任何发布目录拿到它 → 现在执行任何发布动作都不生效。**
**判据**：A1 / A2。**严重级：阻塞。是否阻塞：是（见 §4-Z1）。**

#### A-3 workspace 包 `@kedouai/agent-core` 必须重建 —— ⚠️（严重级：重要）

```bash
# prod 实际解析路径
cd /data/web_system_git/servers/ai-agent && node -e "console.log(require.resolve('@kedouai/agent-core'))"
# → /data/web_system_git/packages/agent-core/dist/index.js
# dev 同理 → /data/web_system/packages/agent-core/dist/index.js
```

- ai-agent 通过 workspace symlink 引用该包（`servers/ai-agent/node_modules/@kedouai/agent-core -> ../../../../packages/agent-core`），运行期加载的是 `packages/agent-core/dist/index.js`。
- 本次改了 `packages/agent-core/src/**`（`intent-classifier.ts` 等）→ **不重建该包，`classifier` 的新 warn / 新逻辑不会生效**，且**无任何报错**（ai-agent 照常起来，行为还是旧的）。
- 构建方式核对（`packages/agent-core/package.json`）：`"build": "tsc -p tsconfig.build.json"`，`tsconfig.json` 的 `module: "commonjs"`、**单产物**，不存在「只更新 ESM、后端 require 的 cjs 仍是旧的」那种 A3 经典陷阱。因此**跑包自己的 build 脚本即足够**：

```bash
cd <发布目录> && pnpm --filter @kedouai/agent-core build
# 校验：ls -la packages/agent-core/dist/index.js（mtime 应为本次构建时间）
```

- ⚠️ 发布手册 `docs/development/local-release-runbook.md:263` 记录 ai-agent 已注册 build hook，但**未确认该 hook 是否包含 workspace 包构建**；runbook:209 要求「先构建 workspace 依赖包，再逐服务 nest build」。执行前必须确认发布动作含 `agent-core` 构建步骤。
**判据**：A3。**严重级：重要。是否阻塞：否（但为放行前提）。**

#### A-4 端口占用者 == pm2 当前进程 —— ✅ 通过（两端）

```bash
# dev
lsof -ti tcp:6010     # → 2587169
pm2 jlist | ... pid   # → 2587169   ✅ 一致

# prod
lsof -ti tcp:6010     # → 2635603
pm2 jlist | ... pid   # → 2635603   ✅ 一致
```
**判据**：A4。**严重级：—。是否阻塞：否。**

#### A-5 服务已在 `ecosystem.config.cjs` 登记 —— ❌ 名字对不上（严重级：重要）

```bash
grep -n "name: '" ecosystem.config.cjs
# → web-gateway / web-auth / web-user / web-ai / web-ai-agent / web-system / web-todo /
#   web-mcp-gateway / web-content-hub / web-upload / web-deploy-console / web-knowledge
```

但 dev / prod 的 pm2 里跑的是**裸名**：`ai-agent` / `ai-service` / `gateway` / ……（`pm2 list` 已核实，**无 `web-ai-agent`**）。

**反例（情形 → 实际 vs 期望）**：按手册执行 `pm2 start ecosystem.config.cjs --only web-ai-agent`，期望「重启现有 ai-agent」；实际是**新建一个名为 web-ai-agent 的进程**，与现存 `ai-agent` 抢 6010 → EADDRINUSE 崩溃 或 变成不被纳管的孤儿进程（runbook §4.6 有同类事故记录）。
→ **重启必须按 pm2 里的实际进程名 `ai-agent` 操作，不能按 ecosystem 里的名字。**
**判据**：A5。**严重级：重要。是否阻塞：否（但为放行前提）。**

#### A-6 【评审重点 6】`agent-def-sync` 新增构造参数是否引入启动期依赖 —— ✅ 无风险（已静态核实）

新参数：`private readonly clientRegistry: ClientRegistry`（`agent-def-sync.service.ts:59`）。

静态证据：

- `servers/ai-agent/src/agent/agent.module.ts:82-101`：`{ provide: ClientRegistry, useFactory: (configService) => {...}, inject: [ConfigService] }` —— **同 module 内已提供**。
- `agent.module.ts:204`：`exports: [... ClientRegistry ...]`。
- `AgentDefSyncService` 与 `ClientRegistry` 同在 `AgentModule` 的 `providers`（`AgentModule` 构造函数已注入 `agentDefSync`）。
- 依赖链最短：`ClientRegistry ← ConfigService`（根模块全局），**无回环**。
- 类型侧：`ClientRegistry` 自 `@kedouai/agent-core` 导出（`packages/agent-core/src/registry/client.registry.ts:7`），新增调用的 `listModels()` 确实存在（同文件，返回 `{id, displayName, available}[]`），`agent-def-sync.service.ts` 只取 `.map(m => m.id)` ✅。
- 单测已跟进：`agent-def-sync.service.spec.ts:3` 已 `import { ClientRegistry }`、`:39` 已构造 mock。

**结论：Nest DI 解析顺序失败风险 = 无**（同一 module 内 useFactory 提供，无循环依赖，无 forwardRef 需求）。
**验证方法（待执行，重启后）**：启动日志必须**出现** Module 初始化完成行且**不出现** `Nest can't resolve dependencies of the AgentDefSyncService`；随后 30s 内出现 `Agent「<id>」的 model 未注册…`（若 DB 仍是短名）。

```bash
pm2 logs ai-agent --lines 200 --nostream | grep -iE "can't resolve|Nest application successfully started|Mapped \{|未注册"
```

**判据**：无独立编号（A 运行面，参照 A3 构建/启动）。**严重级：建议（无判据编号，属工程判断）。是否阻塞：否。**

---

### 2.4 D 前端面

本次改动**不涉及**前端产物 / 微前端版本指针 / CDN 依赖 → D1–D4 **不适用**。
（注：`node_modules/@kedouai` 是后端 workspace 包，与 D4 的「CDN 共享依赖产物」不是同一回事。）

---

### 2.5 E 特殊通道

| # | 判据 | 结论 |
|---|---|---|
| E1 | deploy-console 自身不走流水线 | **不适用**（本次不涉及 deploy-console） |
| E2 | 后端发布确实重启（模块类型字段已写入） | **未验证**（未查 DB 的模块类型字段；发布时由流水线 `restart` 守卫负责） |
| E3 | 变更后有验证动作 | ❌ **尚未落地** → §4 给出可执行命令与预期输出。严重级：重要 |
| E4 | PR 已挂自动合入（merge commit） | **不适用/待办**：本次改动**未提交、无 PR**，先提交并开 PR 后再适用 |

---

### 2.6 【评审重点 4】「发布成功 ≠ 服务可用」的探活/冒烟证据

三项证据，按「从弱到强」排列，**上线后必须至少拿到第 2、3 项**：

**① 进程存活 + 端口自洽（最弱，只证明没崩）**

```bash
pm2 list | grep ai-agent                      # 期望：online，restarts 不增长
lsof -ti tcp:6010                             # 期望：== pm2 jlist 里 ai-agent 的 pid（A4）
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6010/health   # 期望 200（若无 /health 端点则用下一条）
```
⚠️ `pm2 list` 显示 online **不等于**服务可用——runbook §4.6 明确记录过「online 但占端口的是孤儿进程」。

**② 配置真的被加载了（关键，防「改了不生效」）**

```bash
pm2 logs ai-agent --lines 300 --nostream | grep -E "意图路由|未注册|意图分类"
```

- **期望出现**：`意图路由: (auto) → translate (via=rule conf=0.9 switched=false)` 之类（`agent.controller.ts:219-220` 的格式是
  `意图路由: ${dto.agentId ?? '(auto)'} → ${resolvedAgentId} (via=${intent.via} conf=${intent.confidence} switched=${intent.switched})`）。
- **必须**：`via=rule`（关键词命中，0ms）而不是 `via=fallback`。
- **必须不出现**：`模型 deepseek-v4-flash 未注册，回退到默认模型（hy3）`（短名回退 = 配置没生效/DB 没改）。

**③ 分类器 L4 兜底与注册校验的告警面（证明新代码在场）**

新代码才有这三条（`packages/agent-core/src/core/intent-classifier.ts:223/228/233`）：

```
意图分类返回空内容（多为思考 token 占满输出预算）→ 兜底 <fallbackAgentId>；model=<id> maxTokens=<n>
意图分类输出不可解析（agentId 不在白名单内？）→ 兜底 <fallbackAgentId>: <raw 前 120 字>
意图分类调用失败（超时 / 网络 / 模型不可用）→ 兜底 <fallbackAgentId>: <msg>
```

以及 `agent-def-sync` 新增的 error（`agent-def-sync.service.ts:131-134`）：

```
Agent「<id>」的 model 未注册，运行期会静默回退 hy3：model=<id>；已注册=[...]
```

**判读规则**：

- 重启后 30s 内（`agent-def-sync` 轮询周期）**若 DB 还是短名**，应看到这条 error → 证明新代码**已加载**；
- **执行 p34 后**该 error 应**消失**（`warnedModels` 会自动移出）→ 证明 p34 **已生效**；
- ⚠️ 该 error 每个 `agentId:model` **每个进程只打一次**（`warnedModels` Set）→ **冒烟必须在重启后的首个 30s 窗口内看**，事后 `grep` 可能扑空。

**④ 端到端冒烟（最强，用本次事故的原输入）**

```bash
# 对 ai-agent 主对话接口发「先完成，再完美 英语怎么说」（原文事故输入）
# 期望：意图路由 → translate，via=rule（关键词命中），conf 高，不再 fallback 到 general
pm2 logs ai-agent --nostream --lines 50 | grep "意图路由"
# 期望出现：意图路由: (auto) → translate (via=rule conf=... switched=...)
# 期望不出现：意图路由: (auto) → general (via=fallback conf=0.3 ...)
```

**判据**：E3。**严重级：重要。是否阻塞：否（但为放行前提）。**

---

## 3. dev / prod 差异矩阵

| 项 | dev（175.27.189.123） | prod（106.52.176.246） | 差异判定 |
|---|---|---|---|
| 发布目录 | `/data/web_system`（branch `master`，HEAD `40582f61`） | `/data/web_system_git`（branch `master`，HEAD `b94924b3`）<br>另有陈旧副本 `/data/web_system`（HEAD `8280bc7`，其 `servers/ai-agent/.env` **不存在**） | ⚠️ **目录名不同 + prod 有双份**，极易改错 |
| 代码 | ❌ 未含本次改动（dist 9-30） | ❌ 未含本次改动（dist 默认值为短名） | 两端都待同步 |
| `INTENT_ROUTING_ENABLED` | `true`（存量） | `true`（存量） | ✅ 一致；**整条链路两端均已启用** |
| `INTENT_MODEL` | ✅ `deepseek/deepseek-v4-flash` | ❌ **缺失**（走代码默认） | **prod 待补** |
| `INTENT_TIMEOUT_MS` | ✅ `3000` | ❌ **缺失**（走代码默认） | **prod 待补** |
| `INTENT_FALLBACK_AGENT_ID` | ❌ 缺失 | ❌ 缺失 | **两端都待补**（当前无害） |
| `.env` 备份 | ✅ 有 `.env.bak-p34-20261008211342` | ❌ 未见备份 | **prod 执行前必须先备份** |
| DB `agent_definitions` | ✅ **p34 已执行**（10-08 21:13） | ❌ 未执行（基线见 §2.2-C-3） | **prod 待执行** |
| `schema_migrations` 记账 | ❌ 无 p34 记录 | ❌ 无 p34 记录 | 一致（.mjs 不进流程） |
| pm2 进程名 | `ai-agent`（id 28） | `ai-agent`（id 8） | ✅ 一致；但与 `ecosystem.config.cjs` 的 `web-ai-agent` **不一致** |
| `pm2_env` 固化 | 干净 | `PORT=6010` / `NODE_ENV=production` 已固化 | ⚠️ prod 改 PORT/NODE_ENV 不生效 |
| agent-core 解析路径 | `/data/web_system/packages/agent-core/dist/index.js` | `/data/web_system_git/packages/agent-core/dist/index.js` | ⚠️ 两端都需重建 |

### prod 上线的正确顺序与风险

**推荐顺序（代码先行，DB 后行）：**

1. 提交改动 → 开 PR → 挂 `gh pr merge --auto --merge`（E4）→ 合入 `master`
2. **prod 发布目录** `/data/web_system_git`：`git fetch && git checkout master && git reset --hard origin/master`
3. **先构建 workspace 包**：`pnpm --filter @kedouai/agent-core build`（**漏了就静默不生效**）
4. 再构建服务：`cd servers/ai-agent && npx nest build`
5. 补 `.env`：追加 `INTENT_MODEL` / `INTENT_TIMEOUT_MS` / `INTENT_FALLBACK_AGENT_ID`（**先 `cp .env .env.bak-p34-<ts>`**）
6. 干净重启：`pm2 delete ai-agent` → 确认 6010 无占用 → 干净 env `start` → `pm2 save`（见 §4-Y2）
7. **验代码生效**：`pm2 logs ai-agent | grep "未注册"` 应看到 `Agent「deploy」的 model 未注册… model=deepseek-v4-flash`（此时 DB 还是短名，出现即证明新代码在场）
8. **再执行 p34**（此时才有意义）：`EMIT_SQL=1` 先导出 → 人工确认 SQL → 显式传 `DB_HOST=172.16.16.10 DB_NAME=web_system` 执行
9. **验 DB 生效**：首 30s 窗口内 `未注册` error 消失；端到端冒烟 `via=rule → translate`

**为什么不反过来（先 DB 后代码）**：
- 先执行 p34 也能工作（带前缀 id 在 `BUILTIN_TOKENHUB_MODELS` 里已注册），**但**你会失去第 7 步这个「新代码是否在场」的免费探针；而且一旦新代码发布失败/回滚，DB 已改、代码未改的组合在别的注册键下就会静默回退 hy3。
- **风险点**：第 7、9 步之间 prod 上的 `deploy` / `general` / `web-system-dev` 三个 agent 会**持续使用 hy3**（短名未注册），表现为「能用但慢且贵」。这是 p34 之前就存在的既有状态，不是本次引入的回退，但**必须缩短这个窗口**。

---

## 4. 阻塞项与放行条件

> CI R14 语义：`阻塞: N>0` 即不放行。

### Z1 ❌ 阻塞 —— 代码未提交、未同步到任何发布目录（A1 / A2 / C5）

- **事实**：本次改动在 `docs/architecture-overview-v1` 分支且**未提交**；dev HEAD `40582f61`、prod HEAD `b94924b3`，两端 `dist` 均为旧产物（dev 9-30；prod `intent.service.js:31` 默认值仍为短名）。dev 侧 DB + `.env` 已改而代码未改，**当前是「数据先行」状态**。
- **风险**：现在执行任何「发布」都不生效，且**无任何报错**（`pm2 list` 仍 online）。dev 当前不出故障纯属 `BUILTIN_TOKENHUB_MODELS` 恰好包含带前缀 id 的**偶然安全**。
- **放行条件**：① 改动已合入 `master`；② `git -C <发布目录> log --oneline -1` 显示预期 commit；③ 发布目录 `dist` 里 `grep "INTENT_MODEL" servers/ai-agent/dist/agent/intent/intent.service.js` 显示默认值 `deepseek/deepseek-v4-flash`（带斜杠）；④ `grep -c "未注册，运行期会静默回退" dist/agent/agent-def-sync.service.js` ≥ 1。

### Z2 ❌ 阻塞 —— p34 无环境护栏、不在任何自动化流程内（C1 意图 / C3 / C4）

- **事实**：`scripts/apply-migrations.sh` 只扫根目录 `migrations/*.sql`（18 个），**不扫 `archive/migrations/`、不扫 `.mjs`**；p34 未写 `-- @database`（但与 32 个既有 `.mjs` 做法一致，非单独违规）；缺省目标库隐式取自 `servers/deploy-console/.env`（本机该文件无 `DB_*`），无任何 `local|dev|prod` 环境参数。
- **风险**：人工执行时一旦 `DB_HOST` 传错/未传 → **写到错误库**，且 `schema_migrations` 不记账 → 无法追溯。
- **放行条件**（任一）：
  - (a) 执行时**显式**传全部 `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME`，且执行前先跑 `DRY_RUN=1` 或 `EMIT_SQL=1` 打印 SQL 人工确认；**或**
  - (b) 给 p34 补 `-- @database web_system` 注解（对齐 C1 字面要求）+ 在脚本头注释里写死「prod 库 = 172.16.16.10」；**或**
  - (c) 把 `archive/migrations/*.mjs` 纳入某个可编排流程（改动 `apply-migrations.sh` 或另建入口）——**此项属流程改造，不建议夹带在本次发布里**，建议单独开 issue。

### Z3 ❌ 阻塞 —— p34 的 keywords 是整体覆盖、变更前无快照（C6）

- **事实**：`SET keywords = '<硬编码 14 词>'` 只判断「缺词」就**整列替换**；`agent_definition_versions` 对 `translate` **无任何历史行**（dev / prod 均已核实）；dev 已执行且**未取变更前快照**。
- **风险**：运营自定义关键词被静默丢弃且**不可恢复**（该表刻意不回写历史）。
- **放行条件**：
  - ① prod 执行前先做行级快照（SQL 见 §5.1）；
  - ② 执行前人工确认 `translate.keywords` 当前值**不含** 14 词之外的自定义词（prod 当前实测为 7 词、全在 14 词内 ✅）；
  - ③ dev 侧无法补取变更前快照 → **标注为未验证**，若 dev 曾有过自定义词则已丢失，需在 admin 后台人工复核。

### Y1 重要 —— prod `.env` 缺 3 项 INTENT 配置（B3）

- prod 缺 `INTENT_MODEL` / `INTENT_TIMEOUT_MS` / `INTENT_FALLBACK_AGENT_ID`；dev 缺 `INTENT_FALLBACK_AGENT_ID`。
- 由于**代码默认值在本次改动中变了**（`deepseek-v4-flash` → `deepseek/deepseek-v4-flash`，`1200` → `3000`），配置缺失会导致行为随代码版本漂移。
- 放行前必须补齐，并**先备份 `.env`**。

### Y2 重要 —— 重启方式 + workspace 包重建（B1 / A3）

**禁止**：`pm2 restart --update-env`（把执行会话变量固化进 `pm2_env`，dotenv 不覆盖已存在的 `process.env` → 服务用错误来源的配置；runbook §3 / §4.3 有历史事故）。
**另外**：`ecosystem.config.cjs` 里叫 `web-ai-agent`，但 pm2 里跑的是 `ai-agent`，**不能按 ecosystem 名字重启**（A5）。

正确姿势（**待执行的验证命令**，本次评审未执行）：

```bash
# 1) 确认端口占用者 == pm2 pid
lsof -ti tcp:6010
pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).find(x=>x.name==="ai-agent");console.log(a.pid)})'

# 2) 干净删除（prod 用 id 8 / dev 用 28，或统一按名字）
pm2 delete ai-agent
lsof -ti tcp:6010        # 期望：无输出（旧进程真退出，防孤儿进程）

# 3) 干净环境启动（清掉会话里可能存在的 PORT / NODE_ENV / INTENT_*）
cd /data/web_system_git   # prod 发布目录；dev 为 /data/web_system
env -u PORT -u NODE_ENV -u INTENT_MODEL -u INTENT_TIMEOUT_MS -u INTENT_ROUTING_ENABLED \
  pm2 start servers/ai-agent/dist/main.js --name ai-agent \
  --cwd /data/web_system_git/servers/ai-agent
pm2 save

# 4) 复核
pm2 env 8 | grep -E "^PORT|^NODE_ENV|^INTENT_"   # 期望：不出现被固化的自定义值
```

**必须先做**：`pnpm --filter @kedouai/agent-core build`（否则 ai-agent 仍加载 `packages/agent-core/dist` 的 9-30 旧产物，**无报错**）。

### Y3 重要 —— 缺上线后探活/冒烟证据（E3）

见 §2.6，四项证据，至少拿到 ②③。

### Y4 重要 —— 进程名与 `ecosystem.config.cjs` 登记名不一致（A5）

`ecosystem.config.cjs` 登记 `web-ai-agent`，pm2 实际 `ai-agent`。按前者重启会新建进程抢 6010。
建议（不阻塞）：要么统一进程名，要么在 ecosystem 里加 `ai-agent` 条目——**属流程改造，不建议夹带在本次发布**。

### Y5 重要 —— prod 双目录陷阱（A1 / A2）

`/data/web_system`（HEAD `8280bc7` "prod baseline (eval only)"，陈旧，**其 `servers/ai-agent/.env` 不存在**）与 `/data/web_system_git`（真实运行目录，HEAD `b94924b3`）。
**改 `.env` / 构建 / 重启一律只在 `/data/web_system_git`**。评审过程中我第一次就误查了陈旧目录，已纠正——这是最容易踩的坑。

---

## 5. 回滚方案

### 5.1 执行前快照（prod，**必须先做**）

```sql
CREATE TABLE IF NOT EXISTS agent_definitions_bak_p34_20261008 AS
  SELECT * FROM agent_definitions;
```

### 5.2 prod 回滚 SQL（基线值来自 §2.2-C-3 实测）

```sql
-- 1) 回滚 model：仅当确实是 p34 改成的带前缀值时才回滚（幂等）
UPDATE `agent_definitions`
   SET `model` = 'deepseek-v4-flash'
 WHERE `id` IN ('deploy','general','web-system-dev')
   AND `model` = 'deepseek/deepseek-v4-flash';

-- 2) 回滚 translate.keywords：prod 基线（7 词，2026-10-08 实测）
UPDATE `agent_definitions`
   SET `keywords` = '["翻译","译成","翻成","英文怎么说","用英语","润色","translation"]'
 WHERE `id` = 'translate';
```

校验：

```sql
SELECT id, model, JSON_LENGTH(keywords) FROM agent_definitions ORDER BY id;
-- 期望：deploy/general/web-system-dev = deepseek-v4-flash；translate = 7
```

### 5.3 dev 回滚 SQL —— ⚠️ **未验证**

dev 侧 `translate.keywords` 的**变更前值未取快照**，`agent_definition_versions` 无历史行 → **无法证明 7 词就是 dev 的原值**。若 dev 曾有自定义词，回滚到 7 词会造成**二次数据丢失**。

```sql
-- 仅作参考，执行前必须先人工确认 dev 的原值
UPDATE `agent_definitions`
   SET `keywords` = '["翻译","译成","翻成","英文怎么说","用英语","润色","translation"]'
 WHERE `id` = 'translate';
```

### 5.4 配置回滚

```bash
# dev（有备份）
cp /data/web_system/servers/ai-agent/.env.bak-p34-20261008211342 \
   /data/web_system/servers/ai-agent/.env

# prod（无备份！执行前必须自建）
cp /data/web_system_git/servers/ai-agent/.env \
   /data/web_system_git/servers/ai-agent/.env.bak-p34-$(date +%Y%m%d%H%M%S)
# 回滚：删掉追加的 INTENT_MODEL / INTENT_TIMEOUT_MS 两行
```

改完 `.env` 后**必须 `pm2 delete` + 干净 `start`**，`pm2 restart` 不会重注入新 env（runbook §3）。

### 5.5 代码回滚

发布目录 `git reset --hard <上一个 commit>` → 重建 `agent-core` → 重建 `ai-agent` → 干净重启。
⚠️ 若 DB 已改而代码回滚：带前缀 model 在 `BUILTIN_TOKENHUB_MODELS` 中已注册 → **功能不受影响**，可只回滚代码、保留 DB（推荐）。

---

## 6. 评审局限（诚实标注）

1. **未执行任何发布/重启/改库动作** —— 本报告全部结论来自只读操作（`git diff`、读文件、`pm2 list/describe/env/logs`、`mysql SELECT`、`lsof`）。§4-Y2 的重启命令、§2.6 的冒烟命令均为**待执行**，尚未产生实际输出。
2. **未验证**：prod `dist` 的构建时间未取（仅凭 `intent.service.js` 内容判定为旧产物）；prod `.env` 的备份此前不存在（本次评审未创建）；dev `translate.keywords` 变更前值（无快照，不可恢复）；E2 后端发布的模块类型字段未查。
3. **功能正确性不在本次范围** —— 本角色只判「能不能上线」，不判「功能对不对」（那是 `test-verification`）。p34 修复后意图分类的准确率、`via=rule` 命中率等业务效果**未评估**。
4. **未做构建验证** —— 未在本地跑 `nest build` / 单测，代码能否编译通过**未验证**；静态核实了 `ClientRegistry.listModels()` 存在且类型匹配，但实际编译结果以 CI 为准。
5. **单点取数** —— dev / prod 库各 SELECT 一次（2026-10-08），此后若有并发变更本报告基线即失效；执行 p34 前务必重跑 §2.2-C-3 的 SELECT 复核。
6. **环境凭证由用户提供，未做有效性之外的校验**；报告内一律不落密码明文。

---

## 7. 回流

- → `rd-execute`：Z1（提交 + 合入 master + 触发构建）、Z2（p34 补环境护栏或明确执行口径）、Z3（keywords 改「缺失补齐」而非整体覆盖 + 补 dev 快照说明）
- → `rd-plan`：Z3 的迁移语义（合并 vs 覆盖）需明确需求口径；Z2 的「`archive/migrations/*.mjs` 是否纳入流程」需单独排期
- → 运维/发布执行方：Y1（补 prod `.env`）、Y2（delete+start + 重建 agent-core）、Y3（冒烟证据）、Y5（认准 `/data/web_system_git`）

---

## 6. 复审记录（2026-10-08 整改后）

- 复审角色：`release-reviewer`（独立第三方，本轮仅做只读核验）
- 复审时间：2026-10-08（整改后）
- 复审对象：`archive/migrations/p34-agent-routing-fix.mjs`（重写版）+ 契约评审提出的 R1 / R2 补强
- 核验方式：**自跑命令取数**，不采信整改方陈述。动作集 = `DRY_RUN=1` 跑脚本 / 读源码 / `git status`；**未连库、未重启、未改库、未 commit**
- 复审结论：**阻塞 0**（原 Z1 重分类为「上线待办」，Z2 / Z3 关闭），**重要 5**（Y1–Y5 全部转为上线待办，性质是待执行动作而非缺陷）

### 6.0 复审结论总表

| 项 | 原判定 | 整改 | 复审结论 |
|---|---|---|---|
| Z1 代码未提交/未同步 | ❌ 阻塞 | 无（流程状态，非缺陷） | 🔁 **转为「上线待办（提交后由 A 面证据闭环）」**，见 §6.1 |
| Z2 无环境护栏 / 不在流程内 | ❌ 阻塞 | 直连强制 `DB_HOST`+`DB_NAME`，守卫前置到 `createConnection` 之前 | ✅ **关闭**（残留 2 条建议，见 §6.2） |
| Z3 keywords 整体覆盖 / 无快照 | ❌ 阻塞 | `mergeKeywords()` 合并语义 + `/tmp` dump + 库内备份表 + 头部回滚 SQL | ✅ **关闭**，见 §6.3 |
| R1 keywords 列存在性前置校验（契约复审新增） | 新增 | `assertKeywordsColumn()` 列缺失 → 跳过 keywords、仅修 model | ✅ **达成**（含 1 条 fail-open 残留，建议级） |
| R2 备份表前置到所有 UPDATE 之前（契约复审新增） | 新增 | 在线 L256 / 离线首行输出；`CREATE TABLE` 置于事务之外 | ✅ **达成**（DDL 隐式提交坑**未踩**，已核实） |

### 6.1 Z1 重分类 —— 从「阻塞」改为「上线待办（提交后由 A 面证据闭环）」

**为什么不再是阻塞**：Z1 的事实（改动未提交、dev/prod 的 `dist` 均为 9-30 旧产物）是**待执行动作**，不是代码缺陷——整改无法「修掉」它，只能被执行掉。判据 C1 的 `阻塞` 语义用于「代码/配置有错、上线即炸」，不适用于「还没做」。保留为阻塞会让报告永远无法清零。

**当前事实（本轮实测，非采信）**：

```bash
git branch --show-current
# → docs/ops-a1-eip-route     ⚠️ 与任务单所述 docs/architecture-overview-v1 不一致（分支被切换过）

git status --short -- archive/migrations servers/ai-agent packages/agent-core
# → 11 个 ` M`（含 intent.service.ts / agent-def-sync.service.ts / agent.module.ts /
#    intent-classifier.ts / .env.example …）+ 1 个 `??`（p34-agent-routing-fix.mjs）
```

→ **改动仍未提交**（` M` = 未 staged，`??` = 未跟踪）。分支名是什么不影响结论：**Z1 只与「未 commit」有关，与分支名无关**。

**放行条件（重写）**：Z1 不再作为评审阻塞项，改为「提交 → 发布 → 用下列 A 面证据自证」的待办链。**「已发布」≠「已生效」**，必须拿到下面 4 类证据：

**① 发布目录 commit 到位**

```bash
# dev: /data/web_system   prod: /data/web_system_git
git -C /data/web_system_git log --oneline -1     # 期望：本次改动合入后的 commit，不再是 b94924b3
git -C /data/web_system_git status --short | head  # 期望：干净
```

**② dist 里的默认值已变更（证明构建产物是新的，不是「代码在但没 build」）**

```bash
cd /data/web_system_git/servers/ai-agent
grep -n "INTENT_MODEL\|INTENT_TIMEOUT_MS" dist/agent/intent/intent.service.js
# 期望（本次改动后的源码默认值，见 src/agent/intent/intent.service.ts:50-52）：
#   this.modelId   = ... 'INTENT_MODEL', 'deepseek/deepseek-v4-flash'   ← 必须带 deepseek/ 斜杠
#   this.timeoutMs = ... 'INTENT_TIMEOUT_MS', '3000'                    ← 必须是 3000，不是 1200
# 反例：仍为 'deepseek-v4-flash' / '1200' → 旧产物，构建没生效（无任何报错）

ls -la dist/agent/intent/intent.service.js   # 期望 mtime 为本次构建时间，不是 Sep 30
ls -la /data/web_system_git/packages/agent-core/dist/index.js  # 期望 mtime 为本次构建时间（A3）
node -e "console.log(require.resolve('@kedouai/agent-core'))"
# 期望：/data/web_system_git/packages/agent-core/dist/index.js（确认加载的是发布目录的包）
```

**③ dist 里有新校验字样（证明 agent-def-sync 的新代码在场）**

```bash
grep -c "未注册，运行期会静默回退 hy3" dist/agent/agent-def-sync.service.js   # 期望 ≥ 1
# 源码出处：src/agent/agent-def-sync.service.ts:138
#   `Agent「${def.id}」的 model 未注册，运行期会静默回退 hy3：model=${model}；已注册=[...]`
# 反例：= 0 → 新代码没进 dist（与报告 §4-Z1 原判据一致）
```

**④ 日志出现 `意图路由: ... (via=rule ...)`（证明运行期真的走了新逻辑）**

```bash
pm2 logs ai-agent --lines 300 --nostream | grep "意图路由"
# 日志格式（src/agent/agent.controller.ts:219-221）：
#   意图路由: (auto) → translate (via=rule conf=0.9 switched=false)
# 期望：via=rule（关键词命中，0ms）；禁止出现 via=fallback conf=0.3

# 新代码在场探针（重启后首 30s 窗口内，warnedModels 每个 agentId:model 只打一次）：
pm2 logs ai-agent --lines 200 --nostream | grep "未注册"
# p34 执行前：期望出现 Agent「deploy」的 model 未注册…model=deepseek-v4-flash（证明新代码已加载）
# p34 执行后：期望该 error 消失（证明 p34 已生效）
```

**prod 回滚基线继续有效**（沿用 §2.2-C-3 于 2026-10-08 实测取证，本轮未重跑 SELECT，基线内容不变）：`deploy` / `general` / `web-system-dev` 的 `model = deepseek-v4-flash`（短名）；`translate.keywords = ["翻译","译成","翻成","英文怎么说","用英语","润色","translation"]`（7 词）。⚠️ 若距取证时间较久，执行 p34 前请重跑该 SELECT 复核（原报告 §6-5 的单点取数局限仍然成立）。

### 6.2 Z2 —— 环境护栏：整改达标 ✅ 关闭（附 2 条残留建议）

**整改内容**：直连模式强制 `DB_HOST` + `DB_NAME`，缺失即 `exit 2`，守卫位于 `createConnection` 之前。

**验证证据（自跑）**：

```bash
env -u DB_HOST -u DB_NAME node archive/migrations/p34-agent-routing-fix.mjs
# → exit=2
#   ✗ 拒绝执行：直连模式必须显式传入 DB_HOST 与 DB_NAME
#     示例：DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... node p34...
#     本机无法直连内网库时改用 EMIT_SQL=1 导出 SQL。

env -u DB_NAME DB_HOST=127.0.0.1 node archive/migrations/p34-agent-routing-fix.mjs
# → exit=2（只给 DB_HOST 同样拒绝）
```

守卫位置核实：`p34-agent-routing-fix.mjs:222`（守卫 / `process.exit(2)`）在 `:242`（`mysql2.createConnection(cfg)`）**之前** ✅ —— 两条命令的 stderr 均未出现 `:243` 才会打印的 `→ 目标库 <user>@<host>:<port>/<db>`，证明**连都还没连就退出了**，不是「连上再拒」。

**离线模式同语义**：`DRY_RUN=1 CURRENT_KEYWORDS=... node p34...` 走同一个 `buildKeywordStep()`（`:313`），与直连共用 `mergeKeywords()` ✅。

**是否足以消除「跨库误写」风险 —— 结论：足以关闭阻塞，但未 100% 消除。**

- ✅ 消除了原报告最危险的那一条：目标库**不再隐式取自 `servers/deploy-console/.env`**（本机该文件无 `DB_*` → 曾经是「连不上就报错，连上了也不知道是 dev 还是 prod」）。现在不显式给就根本不跑。
- ⚠️ 残留 1：**只校验「有没有」，不校验「对不对」**。`DB_HOST=172.16.16.10 DB_NAME=web_system` 与 `DB_HOST=<别的机器> DB_NAME=<别的库>` 都会被接受，脚本照写。
- ⚠️ 残留 2：**离线（EMIT_SQL）模式没有任何目标库绑定**。导出的 SQL 里没有 `USE` / 库名限定，落到哪个库完全由执行端 `mysql` 的默认库决定（stderr 只写了一句「目标库请在执行端显式指定」）。

**推荐补强（按仓库既有做法，不引入 `-- @database` 注解）**：

仓库事实复核（本轮实测）：`archive/migrations/` 下 **32 个 `.mjs`**，其中 **24 个**已有 `DRY_RUN` 门闩、**11 个**已有备份语义、**9 个**读 `DB_HOST`、**7 个**读 `DB_NAME`、**4 个**用 `APPLY` 二次确认门闩；而写 `-- @database` 的**只有 1 个且是 `.sql`**（`p26-glossary-user-memory-tables.sql`）。→ p34 现在的护栏**已强于多数既有 `.mjs`**，不应对它单独立 C1 注解判据。

建议按既有做法补这三项（**均为上线待办/建议级，不阻塞**）：

1. **写前回显目标库指纹**（对齐 16 个既有 `.mjs` 打印「目标…」的做法）：直连模式在 `beginTransaction` 前 `SELECT DATABASE(), @@hostname, @@port` 并打印，让执行者肉眼确认一次；离线模式在 stdout 首行输出注释 `-- 目标库: <DB_NAME>（执行端务必 mysql -D <DB_NAME> < p34.sql）`。
2. **`APPLY=1` 二次门闩**：仓库里已有 4 个 `.mjs` 用 `APPLY` 作为「确认后才写」的门闩，p34 对齐即可（默认 `DRY_RUN` 式只读，给 `APPLY=1` 才真写）。
3. **执行后补记账**：p34 不在 `apply-migrations.sh` 流程内（该脚本只扫根目录 `migrations/*.sql`，已核实），建议脚本打印一行 `INSERT INTO schema_migrations ...`，由执行人手工补记，保证可追溯。

### 6.3 Z3 —— keywords 合并语义 + 快照：整改达标 ✅ 关闭

**验证证据 1：合并语义保留现有顺序与自定义词（自跑）**

```bash
DRY_RUN=1 CURRENT_KEYWORDS='["翻译","同传","英文怎么说","西班牙语怎么说"]' \
  node archive/migrations/p34-agent-routing-fix.mjs
```

实际输出（stdout 第 4 行）：

```sql
UPDATE `agent_definitions` SET `keywords` = '["翻译","同传","英文怎么说","西班牙语怎么说","译成","翻成","英语怎么说","英文怎么讲","英语怎么讲","中文怎么说","日语怎么说","韩语怎么说","用英语","用英文","润色","translation"]'
  WHERE `id` = 'translate' AND (JSON_SEARCH(`keywords`,'one','译成') IS NULL OR ... );
```

stderr：`-- 步骤：translate.keywords（合并：新增 12 词，保留原 4 词）`

→ **原 4 词顺序完整保留在最前**（`翻译` / `同传` / `英文怎么说` / `西班牙语怎么说`），两个运营自定义词（`同传`、`西班牙语怎么说`）**未丢失**，缺失的 12 词追加到末尾。WHERE 只判「缺词」→ 幂等 ✅。原报告 §4-Z3 的「运营自定义词被静默丢弃」反例**已消除**。

**验证证据 2：已齐备时 no-op（自跑）**

```bash
DRY_RUN=1 CURRENT_KEYWORDS='["翻译","译成","翻成","英文怎么说","英语怎么说","英文怎么讲","英语怎么讲","中文怎么说","日语怎么说","韩语怎么说","用英语","用英文","润色","translation"]' \
  node archive/migrations/p34-agent-routing-fix.mjs
```

→ stdout **只有 3 条 model UPDATE，无 keywords UPDATE**；stderr：`-- translate.keywords 已齐备，无需改动` ✅

**验证证据 3：三重快照**

| 手段 | 位置 | 是否在 UPDATE 之前 |
|---|---|---|
| `/tmp/p34-agent-defs-backup-<ts>.json`（JSON dump） | `:210-218` `dumpBackup()`，调用点 `:249` | ✅ 是 |
| 库内备份表 `agent_definitions_bak_p34_20261008` | `:256` | ✅ 是（见 §6.4-R2） |
| 头部可执行回滚 SQL（含用备份表回写 keywords 的写法） | `:34-42` 文件头注释 | ✅ 是（且明确写「勿硬编码，否则会丢运营自定义词」） |

**验证证据 4：未提供 `CURRENT_KEYWORDS` 时的退化路径有护栏（自跑）**

```bash
DRY_RUN=1 node archive/migrations/p34-agent-routing-fix.mjs
# stderr: -- 步骤：translate.keywords（整列覆盖·未知当前值）
#         ⚠️ 未提供 CURRENT_KEYWORDS，keywords 走整列覆盖——已前置建备份表，但运营自定义词仍可能丢失。
#         推荐做法：CURRENT_KEYWORDS=$(mysql -N -e "SELECT keywords FROM agent_definitions WHERE id='translate'") EMIT_SQL=1 node p34...
```

→ 退化路径**仍然存在但已显式告警 + 强制前置备份表**，并给出正确用法。prod 执行时按推荐做法传 `CURRENT_KEYWORDS` 即可完全避开。

→ **Z3 关闭**。dev 侧「变更前值未取快照」的既成事实无法补取（原报告 §6-3 局限），但后续再执行不再有此问题。

### 6.4 R1 / R2 补强核验（契约复审新增项）

#### R2 —— 备份表前置 + 事务边界 ✅ 达成，DDL 隐式提交坑**未踩**

| 检查点 | 核实结果 |
|---|---|
| 离线模式备份表排在所有 UPDATE 之前 | ✅ 实测：两次 `DRY_RUN` 的 stdout **第 1 行**就是 `CREATE TABLE IF NOT EXISTS agent_definitions_bak_p34_20261008 AS SELECT * FROM agent_definitions;`（`:318-321`，在 for 循环输出 model UPDATE 之前） |
| 在线模式备份表排在所有 UPDATE 之前 | ✅ `:256` 执行 `CREATE TABLE`，`:271` 才 `beginTransaction()`，UPDATE 在 `:279` |
| `CREATE TABLE ... AS SELECT` 是否被放进事务（DDL 隐式提交坑） | ✅ **没有踩坑**：`CREATE TABLE` 在 `:256`，事务从 `:271` 开始 → DDL 在事务**之外**；事务内只有 3 条 model UPDATE + 1 条 keywords UPDATE，全部是可回滚的 DML |
| 事务失败路径 | ✅ `:291-296` `catch` → `rollback()` → `end()` → `exit(1)`，杜绝「model 改了 keywords 没改」的部分生效 |

**残留（建议级，不阻塞）**：离线模式 `if (!kw.noop)` 才输出备份表（`:318`）→ 当 keywords 已齐备（noop）时，导出的 SQL 里**没有备份表**，只有 3 条 model UPDATE。此时若 model 仍是短名，则 model 改动无库内备份。
影响面评估：prod 当前 `translate.keywords` = 7 词（缺 7 词）→ **首次执行必然非 noop，备份表会出现**，实际风险 ≈ 0。建议后续把备份表输出改为无条件（与在线模式一致）。

#### R1 —— `assertKeywordsColumn()` 前置校验 ✅ 达成（含 1 条 fail-open 残留）

- 位置核实：`:260` 调用，`:271` 才 `beginTransaction()` → 校验在**所有 UPDATE 之前** ✅，命中时 `:265` 截断 steps 为「仅 model」，`:262` 打印 `⚠️ agent_definitions 无 keywords 列（疑似未跑 p32）→ 跳过 keywords 步骤，仅修 model` ✅
- 语义核实：查 `information_schema.COLUMNS` 用 `cfg.database` 限定（`:163-167`）✅
- **残留（建议级）**：fail-open —— 若 `DB_NAME` 传错 / 无 information_schema 权限导致查询返回空，会被判定为「无 keywords 列」而**静默降级为只改 model**。真实影响有限（DB_NAME 错时后续 UPDATE 会直接报 1146 失败），但建议把「查不到列」与「列确实不存在」区分开（例如再查一次 `SHOW TABLES LIKE 'agent_definitions'`，表都不存在就直接 exit 2）。

### 6.5 复审后的完整「重要」清单（5 项，全部为上线待办）

Y1–Y5 的**内容未变**（见 §4），性质重述为**待执行动作**：

| # | 项 | 归属 | 何时做 |
|---|---|---|---|
| Y1 | prod `.env` 缺 `INTENT_MODEL` / `INTENT_TIMEOUT_MS` / `INTENT_FALLBACK_AGENT_ID` | 发布执行方 | 重启前（先 `cp .env .env.bak-p34-<ts>`） |
| Y2 | 重启方式（禁 `pm2 restart --update-env`；`pm2 delete` + 干净 `start`）+ 必先 `pnpm --filter @kedouai/agent-core build` | 发布执行方 | 构建后 |
| Y3 | 上线后探活/冒烟证据（§2.6 的 ②③） | 发布执行方 | 重启后 + p34 后 |
| Y4 | pm2 进程名 `ai-agent` ≠ `ecosystem.config.cjs` 的 `web-ai-agent` | 流程改造（不夹带本次发布） | 单独排期 |
| Y5 | prod 双目录陷阱（只认 `/data/web_system_git`） | 发布执行方 | 全程 |

### 6.6 本轮复审局限（诚实标注）

1. **未连库**：本轮全部结论来自 `DRY_RUN=1` 离线跑 + 读源码 + 读报告。**未重跑** dev / prod 的 `SELECT` → prod 基线沿用 §2.2-C-3（2026-10-08 取证），未做二次校验。
2. **未验证在线模式真实执行**：`DB_HOST/DB_NAME` 守卫只验到「拒绝执行」这一侧；事务提交/回滚的**实际行为**未在真实库上演过（无库可连、也不允许改库）。结论基于代码路径静态核实 + 事务边界核实。
3. **未做构建验证**：未跑 `nest build` / 单测，`dist` 能否产出 §6.1 期望的字样**未验证**（源码侧已确认串存在）。
4. **分支名不一致未追查**：实测 `docs/ops-a1-eip-route` ≠ 任务单所述 `docs/architecture-overview-v1`；因 Z1 与分支名无关（只与未 commit 有关），未进一步追查，执行前请自行确认改动在哪条分支上。
5. **残留项均为建议级**：§6.2 的 3 条补强建议、§6.4-R2 的 noop 无备份表、§6.4-R1 的 fail-open —— 均**不阻塞**本次发布，列入后续待办。
