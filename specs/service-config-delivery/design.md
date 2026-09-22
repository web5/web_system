# 服务进程配置的下发链路（配置中心 → 服务 .env）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：补齐 `specs/config-driven-deploy/design.md` 只做到一半的那条链路 —— 配置中心的第 ② 层
> **目前只注入流水线脚本变量，到不了服务进程**；本文给出可行的投递机制、密钥隔离加固与落地分期，供评审后再动代码。

> 分支：`feature/deploy-console-domain-split` ｜ 建立：2026-09-21 ｜ 首批范围：仅本地（local）

前置阅读：`specs/config-driven-deploy/design.md`（四层配置模型）、`servers/deploy-console/src/config/config.service.ts`（配置中心）、`servers/deploy-console/src/config/config-crypto.ts`（密钥加密）

---

## 0. 一页速览（新会话开工入口）

**要解决**：服务间凭据（`GATEWAY_SERVICE_KEY` 等）只能放 `.env` → 多副本、无审计、无环境分层；
配置中心有加密与审计，但**值到不了服务进程**（只到流水线脚本 env）。

**要做什么**：让配置中心成为这类配置的权威存储，由平台在**部署/重启前**把解析结果下发给服务
（写 `<svc>/.env.generated`，dotenv 加载顺序使其覆盖 `.env`）。同时**把密钥从流水线脚本 env 里摘出去**。

**不做什么**：不动 `config_items` 表结构；不做「服务启动时拉配置」（鸡生蛋 + 可用性耦合）；
不做 `CONFIG_MASTER_KEY` 多机分发（独立小设计）；P0 不改流水线 `restart` 脚本（留 P1）。

**收益的边界（先说清，避免预期错位）**：
- ✅ 拿到的是：**单一权威存储**（改一处不必逐台改 `.env`）、**密文落库 + 按环境分层**、**审计**、换机器可重放。
- ❌ 拿不到的是：**「密钥不再出现在多个地方」** —— 密钥要被 N 个使用方持有，分发不可避免；
  配置中心只是把「N 份明文散落」变成「一处加密存储 + 各自下发」。

**前置事实（开工前不必重新考古）**：

| 项 | 值 |
|---|---|
| 配置中心代码 | `servers/deploy-console/src/config/`（`config.service.ts` / `config-crypto.ts` / `config.controller.ts`） |
| 加密 | AES-256-GCM；主密钥 `CONFIG_MASTER_KEY`（**deploy-console `.env` 已配；gateway 未配**） |
| 已有密钥条目先例 | `config_items`：`local` / `ai-agent` 的 `HY3_API_KEY`、`TOKENHUB_API_KEY`（`is_secret=1`） |
| 配置中心在流水线的注入点 | `pipeline.service.ts:2054` `resolveInjectEnv()` → `:2056` `this.configs.resolve(...)`（`this.configs` 是配置中心服务，`@nestjs/config` 的 `ConfigService` 另有其名） |
| 脚本 env 的拼装 | `resolveStageVars()`（`pipeline.service.ts:302`，纯函数） |
| dotenv 入口 | `servers/gateway/src/app.module.ts:38`、`servers/deploy-console/src/app.module.ts:38`（均为 `envFilePath: [ '.env' ]`，**已是数组**） |
| 发布目录 / 服务 `.env` | `RELEASE_WORKSPACE`（默认 `~/web_system_release`）/ `servers/<dir>/.env` |
| 下发目标 | `<RELEASE_WORKSPACE>/servers/<dir>/.env.generated` |

**决策默认值（评审无异议就按此实现）**：Q1 按需下发；Q2 下发属「部署」、与「发布」解耦；
Q3 `GATEWAY_SERVICE_KEY` 与 §4.4 加固**同批**迁入；Q4 先不做小收敛，直接走 P0。

---

## 1. 背景（三处存放位置的作用域，均为实测）

| 存放位置 | 能到达 | 到得了「服务进程」吗 |
|---|---|---|
| 服务 `.env` | 该服务进程（dotenv） | ✅ |
| 配置中心 `config_items` | **只注入流水线脚本 env**（`resolveStageVars`） | ❌ |
| 流水线局部变量 `deploy_pipeline_vars` | **只注入该流水线脚本 env**（`PipelineVarService.resolve`） | ❌ |

即：目前只有 `.env` 能被服务进程读到。而 `.env` 的问题是**多副本 + 无审计 + 无环境分层**。

### 1.1 触发本次讨论的具体案例

控制台在「部署」后要通知 gateway 清版本缓存（`specs/app-artifact-env-dir/design.md` §4.2），
需要一把 `GATEWAY_SERVICE_KEY`：**console 与 gateway 两边都要有**，现在各写一份 `.env`。
换机器 / 重建发布目录时漏配任一，就退化成「最多 10s 才生效」（日志有告警，不致命但隐蔽）。

## 2. 设计原则：什么配置该放哪（划界判据）

判据只有一条：**这份配置能不能「反依赖平台」**。

| 类别 | 例子 | 归属 | 理由 |
|---|---|---|---|
| 引导凭据 | `CONFIG_MASTER_KEY`、拉配置用的 `INTERNAL_API_KEY` | **`.env`** | 鸡生蛋：读配置中心本身要先有它 |
| 基础设施连接 | `MYSQL_*` / `REDIS_*` | **`.env`** | 启动必需；平台自己也在连同一库，让它下发易成单点 |
| 业务 / 服务间凭据 | `GATEWAY_SERVICE_KEY`、`HY3_API_KEY` | **配置中心（加密）→ 下发** | 需要按环境分层、需要审计、需要单一副本 |
| 部署 / 路径类 | `DEPLOY_ROOT`、`ARTIFACT_SUBPATH` | **配置中心（明文）→ 脚本注入**（已实现） | 不涉进程 env |

> 结论：**密钥类配置进配置中心的价值成立** —— 它已有加密落库（AES-256-GCM）、掩码回显、审计不记明文、
> 配置快照随版本回滚；缺的只是「送到进程」这一步。

## 3. 候选方案

| | **B（推荐）部署时下发** | A 进程启动时拉取 | C 维持 `.env` + 启动自检 |
|---|---|---|---|
| 做法 | 平台/脚本把 `resolve(envId, 服务)` 的结果写入 `<svc>/.env.generated`，dotenv 加载顺序让它覆盖 `.env` | 服务启动时调平台内部接口拉配置，内存覆盖 | 不动存储，只把「缺键」的告警做显眼 |
| 与现有约定 | ✅ 与 dotenv 一致；不改读取逻辑 | ❌ 服务启动依赖 console 可用（可用性耦合） | ✅ 零改动 |
| 鸡生蛋 | 不涉及（下发由平台主动推） | ❌ 拉取本身要凭据 | — |
| 环境分层 | ✅ 下发时按 envId 解析 | ✅ | ❌（多副本仍按环境各写一份） |
| 审计 / 回退 | ✅ 落盘可查、删文件即回退 | ⚠️ 内存态难审计 | ❌ |
| 生效时机 | 需重启服务（可接受，重启本就是部署动作） | 启动即生效 | — |
| 解决「多副本漂移」 | ✅ 单一权威源 | ✅ | ❌ |

**推荐 B**：它把「配置中心是权威源」落到实处，同时不引入任何启动期依赖。

## 4. B 的设计细节

### 4.0 先分清两类消费方（决定「要不要下发」）

| 消费方 | 取值方式 | 理由 |
|---|---|---|
| **配置中心宿主**（deploy-console 自身，如它当客户端调 gateway） | **直接查配置中心**：`resolveForProcess(envId, 'deploy-console')` | 它本就持有 `CONFIG_MASTER_KEY`，随时可解密 → **零文件、零重启** |
| **其他服务**（gateway / 业务服务） | **下发**：写 `.env.generated` + 重启该服务 | 它们的进程读不到配置中心 |

> ⚠️ 这是一个必须避开的坑：若让控制台也走「下发」路径，它会给自己写 `.env.generated` 然后**重启自己** ——
> 而 deploy-console 的传统发布/重启是**自杀式中断**的（它不走流水线，见 `docs/development/local-release-runbook.md`）。
> 所以控制台自身一律「直接查」，不下发。

### 4.1 目标文件与优先级

```
servers/<dir>/.env          ← 引导键 + 基础设施键（人工维护，权威）
servers/<dir>/.env.generated ← 平台下发（自动生成，0600，文件头写来源与时间）
```

`ConfigModule.envFilePath` 改为数组，**下发文件在前**（Nest 语义：先出现者优先）：

```ts
envFilePath: [resolve(__dirname, '../.env.generated'), resolve(__dirname, '../.env')],
```

- 只改一行（gateway 与 deploy-console 各一行），**读取逻辑零改动**。
- 删除 `.env.generated` 即完全回到现状 —— 天然回退开关。

### 4.2 下发内容与过滤

```
下发内容 = ConfigService.resolve(envId, serviceKey)   // global → env → module 覆盖
         − RESERVED_LOCAL_KEYS                        // 引导/基础设施键永不下发
```

- `RESERVED_LOCAL_KEYS`：`CONFIG_MASTER_KEY`、`MYSQL_*`、以及 `PATH/HOME/PM2_*` 等平台注入键。
- **只写配置中心里存在的键**（不全量覆盖 `.env`），避免「下发文件悄悄改掉了人工配的东西」。
- 文件头带注释标明每个键的来源作用域（`global` / `env:<id>` / `module:<env>/<mod>`）—— 排障时一眼看清「这个值从哪来」。

### 4.3 触发时机

1. **控制台「部署 / 重启服务」动作**（首选）：`DeployService` 在下发路径上先落 `.env.generated`，再重启 —— 顺序保证「重启即读到新值」。
2. 流水线 `restart` 脚本（第二步）：脚本已有 `CONSOLE_API` / `CONSOLE_TOKEN`，可 `curl` 一个「取配置内容」的接口再写入文件。
   注意脚本化后要保留 fail-fast：写文件失败 → 不重启（避免「以为换了配置其实没换」）。

### 4.4 必做的加固：密钥不得注入流水线脚本 env

现状 `resolveStageVars` 把配置中心的值**全量注入脚本环境**（只排除 `PROTECTED_STAGE_KEYS`）：

```356:363:servers/deploy-console/src/pipeline/pipeline.service.ts
  if (i.configInject !== false) {
    for (const [k, v] of Object.entries(cfg)) {
      if (PROTECTED_STAGE_KEYS.includes(k)) continue;
      base[k] = v;
    }
  }
```

一旦密钥进配置中心，**每个发布脚本的 env 里都会有它**。所以必须同批做：给配置中心加一个
「按用途解析」的入口，脚本注入路径**排除 `is_secret=1`**：

```ts
// ConfigService 新增（或给 resolve 加 options）
resolveForScripts(envId, moduleKey): ResolvedConfig   // 跳过 isSecret
resolveForProcess(envId, moduleKey): ResolvedConfig   // 含明文密钥（供 4.2 下发）
```

> 这条不加，等于把「存在一个加密表里」换成「散落在每次执行的脚本环境里」，是净负收益。

## 5. 接口与数据变更

| 项 | 变更 |
|---|---|
| `config_items` | 无（已有 `is_secret` / `scope` / `env_id` / `module_key`） |
| `ConfigService` | 新增 `resolveForScripts()` / `resolveForProcess()`；`resolve()` 保留兼容 |
| `PipelineService.resolveStageVars` | 改用 `resolveForScripts()`（密钥不入脚本 env） |
| 新接口 | `GET /api/config/internal/dispatch/:serviceKey?envId=` → `200` 返回可下发的 env 正文（`text/plain`）、`204` 表示无 `module` 级条目（按需跳过）、`401` 鉴权失败；内部鉴权 `x-internal-key`（脚本侧 = `CONSOLE_TOKEN`），供流水线动作脚本落盘 |
| 下发实现 | 平台侧写文件（0600）+ 备份上一版为 `.env.generated.bak-<ts>`（保留最近 3 份） |
| `app.module.ts`（gateway / deploy-console） | `envFilePath` 数组加一项 |

## 6. 安全与回退

| 风险 | 对策 |
|---|---|
| 明文落盘 | 文件 0600；发布目录本身不进 git；文件内容不进日志/审计（审计只记「下发了哪些键 + hash」） |
| 下发把服务搞挂 | 只写「配置中心存在的键」；保留上一版备份；写文件失败不重启 |
| 平台不可用 | 下发是「推送」不是「拉取」→ 服务启动零依赖；平台挂掉只是配置不更新 |
| 需要回退 | 删 `.env.generated` + 重启（等于回到纯 `.env`） |
| 主密钥分发 | `CONFIG_MASTER_KEY` 仍在各服务 `.env`（鸡生蛋）——**多机分发不在本设计范围**，需单独明确（建议由部署机密钥文件/环境注入，不要塞进配置中心） |

## 7. 分期

| 阶段 | 内容 | 回退 |
|---|---|---|
| **P0** | ① `resolveForScripts/ForProcess` 拆分 + 脚本注入排除密钥；② `envFilePath` 加下发文件；③ 平台侧下发实现 + 部署动作接线；④ `GATEWAY_SERVICE_KEY` 迁到配置中心（module，isSecret） | 删 `.env.generated`；`PIPELINE_CONFIG_INJECT=false` 可整体关脚本注入 |
| **P1（已实施）** | 流水线 `restart` 动作（DB 脚本）接入下发：`curl` 内部接口 → 写 `.env.generated` → **失败即中止发布**；**仅 `DEPLOY_ENV=local` 生效**（首批范围只到本地，dev/prod 脚本行为不变）。落地：`scripts/migrations/p25-restart-config-dispatch.mjs` + `config.controller.ts` 的 `internal/dispatch` | `ROLLBACK=1 node scripts/migrations/p25-restart-config-dispatch.mjs`（按标记删段，恢复原文） |
| **P2** | `CONFIG_MASTER_KEY` 的多机分发方案（独立小设计） | — |

## 8. 验收判据（本地）

| # | 判据 | 验证方式 |
|---|---|---|
| V1 | 下发后重启读到新值；不重启仍旧值 | 配置中心改值 → 下发给 gateway → 重启 → 内部端点鉴权通过；不重启时仍 403（旧值） |
| V2 | 删除下发文件即回退 | 删 `.env.generated` → 重启 → 行为回到 `.env` 的值 |
| V3 | 密钥不出现在脚本 env | 发布脚本里 dump 一份 env，看不到 `GATEWAY_SERVICE_KEY` / `HY3_API_KEY` |
| V4 | 密文落库、掩码回显 | 直查 `config_items.value` 非明文；控制台列表显示 `••••••••`；审计无明文 |
| V5 | 环境隔离 | 同一服务在 `local` / `dev` 下发到不同值，互不影响 |

## 9. 待确认项

| # | 问题 | 建议 |
|---|---|---|
| Q1 | 下发给哪些服务：全部有 `config_items` 的服务，还是仅声明需要的 | 建议「按需」——服务在配置中心有 module 级条目才下发，避免无谓落盘 |
| Q2 | 下发时机是否与「发布」解耦 | 建议**解耦**：下发属于「部署」；发布只跑构建与投递 |
| Q3 | 是否现在就把 `GATEWAY_SERVICE_KEY` 迁进去 | 可以，但**必须与 4.4 加固同批**，否则密钥会先进脚本 env |
| Q4 | 短期过渡（不想立刻做 P0） | 可先做「小收敛」：gateway 的内部端点鉴权**也接受 `INTERNAL_API_KEY`**（控制台已持有），撤掉专有的 `GATEWAY_SERVICE_KEY` —— 只改 gateway 一行 env + 一行校验，不新增需要维护的密钥 |

---

## 10. 实现落位（文件级）

| # | 文件 / 锚点 | 改什么 | 验证 |
|---|---|---|---|
| 1 | `servers/deploy-console/src/config/config.service.ts` | 新增常量 `RESERVED_LOCAL_KEYS`（`CONFIG_MASTER_KEY`、`MYSQL_*`、`PM2_*` 等）；新增 `resolveForScripts(envId, moduleKey)`（= 现有 `resolve` 但**过滤 `isSecret`**）；新增 `resolveForProcess(envId, serviceKey)`（语义化命名，含明文）；新增 `dispatchPayload(envId, serviceKey)` → `{ key, value, scope }[]`（带来源作用域，供下发文件写注释） | 单测：`is_secret` 项只出现在 `resolveForProcess`，`resolveForScripts` 里没有 |
| 2 | `pipeline.service.ts:2056`（`resolveInjectEnv`） | `this.configs.resolve(...)` → `this.configs.resolveForScripts(...)`；`:2059` 的日志补一句「已排除 N 个密钥项」 | 发布脚本里 dump env，看不到 `HY3_API_KEY` |
| 3 | `servers/deploy-console/src/deploy/deploy.service.ts` | 新增 `writeGeneratedEnv(envId, moduleKey)`：`dispatchPayload` → 渲染 `<RELEASE_WORKSPACE>/servers/<dir>/.env.generated`（0600；头部注释写生成时间 + 每个键的来源）→ 备份上一版为 `.env.generated.bak-<ts>`（留 3 份）；挂到「部署/重启服务」路径，**下发失败不重启** | §11 |
| 4 | `servers/deploy-console/src/config/config.controller.ts` | `@Public()` + `x-internal-key`（`common/internal-key.ts`）的 `GET internal/dispatch/:serviceKey?envId=`：`200` 纯文本 env 正文 / `204` 无 module 级条目 / `401` 鉴权失败 | `curl` 校验 401/400/204/200 |
| 5 | `servers/gateway/src/app.module.ts:38-40` | `envFilePath: [ path.resolve(__dirname, '../.env.generated'), path.resolve(__dirname, '../.env') ]`（**下发文件在前**） | V1 / V2 |
| 6 | `servers/deploy-console/src/app.module.ts:38` | 同上（为了后续给控制台下发别的配置；P0 可先不改） | 同上 |
| 7 | 配置中心数据（`config_items`） | `GATEWAY_SERVICE_KEY` 按**消费方各配一条 `module` 作用域条目**：`local/deploy-console` 与 `local/gateway`（值相同），`is_secret=1` | 列表页显示掩码；`resolveForProcess` 拿到明文 |

> 第 7 条为什么**不用 `global`**：global 会被下发给**所有**服务，等于把只该给两方的密钥铺到每个服务的
> `.env` 里。`module`（按服务）+ 「按需下发」才是一致的。控制台那条它自己「直接查」，不下发。

**落地状态（P0 + P1 已实施，锚点）**：

| 条 | 落地位置 |
|---|---|
| 1 | `config/config.service.ts`：`RESERVED_LOCAL_KEYS` / `isReservedLocalKey()` / `resolveForScripts()` / `resolveForScriptsDetailed()` / `resolveForProcess()` / `dispatchPayload()` / `hasModuleScope()` / `renderGeneratedEnvFile()` / `escapeEnvValue()` |
| 2 | `pipeline/pipeline.service.ts` `resolveInjectEnv()`（改用 `resolveForScriptsDetailed()`，日志含「已排除 N 个密钥项」） |
| 3 | `deploy/deploy.service.ts` `writeGeneratedEnv()` + `backupGeneratedEnv()`，接线在 `applyBackendVersion()`（先下发、后落地/重启） |
| 4 | `config/config.controller.ts` 的 `GET internal/dispatch/:serviceKey?envId=`（鉴权实现抽到 `common/internal-key.ts`，与 `internal/release` 共用） |
| 5 / 6 | `gateway/src/app.module.ts`、`deploy-console/src/app.module.ts` 的 `envFilePath`（下发文件在前） |
| 7 | `config_items` 已建 `local/deploy-console` 与 `local/gateway` 两条 `module` 级 `GATEWAY_SERVICE_KEY`（`is_secret=1`，密文落库）；控制台侧 `gatewayServiceKey()` 先查配置中心、取不到回落 `.env`，gateway 侧靠下发得到 |
| P1 | 11 个后端模板的 `restart`（后端）动作脚本由 `scripts/migrations/p25-restart-config-dispatch.mjs` 插入「配置下发段」（仅 `DEPLOY_ENV=local`，`200` 落盘 / `204` 跳过 / 其它 fail-fast 不落地不重启） |

本地实测（2026-09-22）：`POST /api/internal/gateway/reload` 的 V1 / V2 通过（下发值 201、`.env` 旧值 403；删下发文件即回退）；
正式发布（流水线 `jobId 1790003565095-xbgvrqq`）日志出现 `[config] 注入 1 项配置（强制覆盖），已排除 1 个密钥项`（V3）；
`restart` 动作脚本用引擎注入的变量手工执行通过：`[restart] 配置已下发: …/.env.generated` → 落地 → `pm2` 重建 → 端口 6000 健康；
错 `CONSOLE_TOKEN` 时退出码 1 且未落地未重启；`DEPLOY_ENV=dev` 时跳过下发。

## 11. 复现与验证命令（本地）

```bash
# ① 单测（配置中心）
cd servers/deploy-console && npx jest src/config/

# ② 下发 + 重启 gateway 后验证读到新值（V1）
KEY=$(grep '^GATEWAY_SERVICE_KEY=' ~/web_system_release/servers/deploy-console/.env | cut -d= -f2-)
curl -s -X POST http://localhost:6000/api/internal/gateway/reload -H "x-service-key: $KEY"   # 期望 200
# 改配置中心值（不改 .env）→ 下发 → 重启 gateway → 再请求：
#   新值 200 / 旧值 403    ← 证明「重启即读到下发值」

# ③ 回退（V2）：删下发文件 → 重启 → 行为回到 .env 的值
rm -f ~/web_system_release/servers/gateway/.env.generated

# ④ 密钥不进脚本 env（V3）：发布脚本里插入一行 dump，检查输出里没有密钥键
#    注意用 ASCII 输出（console 的 bash 是单字节 locale，$VAR 后紧跟中文会被并入变量名）

# ⑤ 密文落库（V4）
node -e "…SELECT key,is_secret,LEFT(value,24) FROM config_items…"   # 值应为 iv:tag:data 形态，非明文
```

**重启 gateway 的正确姿势**（不要用 `pm2 restart --update-env`，会把执行会话变量固化进 pm2_env）：

```bash
lsof -ti tcp:6000 | xargs -r kill -9
pm2 delete web-gateway
cd ~/web_system_release && env -i PATH="$PATH" HOME="$HOME" pm2 start ecosystem.config.cjs --only web-gateway
pm2 save
# 核对：lsof -ti tcp:6000 的 pid == pm2 里 web-gateway 的 pid
```

## 12. 既有约定与坑（改动前必读）

| 约定 | 说明 |
|---|---|
| 进程环境只保留 `PATH/HOME/PORT` | 平台刻意剥离（防 `pm2 --update-env` 把执行会话变量固化进 `pm2_env`）→ 配置必须走 `.env` 文件，别想着注入 pm2 env |
| 配置中心条目**全量注入脚本 env** | 这是 §4.4 要加固的点；改完必须验证密钥不再出现在脚本 env |
| `PROTECTED_STAGE_KEYS` | 平台语义真相源键（`DEPLOY_ENV`/`MODULE_KEY`/`COMMIT_ID`…），配置中心不得覆盖；新增过滤时不要动这个名单的含义 |
| 控制台自身**不走流水线重启** | 自杀式中断；所以 §4.0 把控制台划为「直接查、不下发」 |
| 发布目录与工作区是两份 | 下发/重启都作用于 `RELEASE_WORKSPACE`（`~/web_system_release`），不是工作区 |
| 中文字符与 bash 单字节 locale | console 执行脚本时 `$VAR` 后紧跟中文会被并入变量名，脚本输出一律用 ASCII |
