# 模块域归属与部署方式（运维知识库）

> 建立：2026-09-20 ｜ 性质：**开发 / 维护 / 运营层面的知识**，与系统架构和功能无关
> 相关：`docs/development/local-dev-guide.md §3.2`、`local-release-runbook.md`

---

## 0. 先说边界

- **流水线（发布）**：只负责**构建并发布代码** —— 拉码 → 构建 → 投递产物 → 写版本记录
- **部署（生效）**：让产物真正生效，由**对应域的接口**完成（应用切指针 / 服务重启 + 探活）
- **系统不做"域归属"判断**：哪个模块是应用、哪个是服务，是**静态事实**，维护在本文件；
  流水线按**脚本 / 配置**决定部署动作，代码里不写 if/else 分流

> 历史教训：曾把「按 `moduleType` 判断前后端」写进流水线，
> 而 `moduleType` 从未写入流水线实体 → 后端服务永远被判成应用、部署静默跳过。
> 这类判断不该进系统，应由配置/脚本显式表达。

---

## 1. 应用域（`deploy_apps`）—— 部署 = 切入口指针

| key | kind | deployMode | 仓库目录 | 生效方式 |
|---|---|---|---|---|
| `admin` | micro-frontend | `env-dir` | `apps/admin` | 切 `<key>/<envId>/index.js` 指针 |
| `portal` | micro-frontend | `env-dir` | `apps/portal` | 同上 |
| `shell` | shell | `site-version` | `apps/shell` | 基座，按站点 + 版本加载 |
| `mini-contract` | mini-app | `site-version` | `apps/mini-contract` | 同上 |

- `env-dir`：产物目录 `<key>/<envId>/<版本>/`，入口指针固定不含版本 → 切版本只改磁盘指针
- `site-version`：基座类，按站点 + 版本目录（不参与环境切换）

**接口**：`POST /api/apps/:key/switch` `{ envId, version }`（另有 `/rollback`）

### 1.1 基座（shell）构建动作约定 —— 换环境重踩点

基座按**版本目录**加载：产物投 `static/modules/shell/<pipelineKey>/<commit>/`，指针值就是
`<pipelineKey>/<commit>`（gateway `resolveShellHtmlFile()` 按指针拼路径读 index.html）。
因此它的 build 动作必须满足两条，缺一即「构建过了但页面不对」：

| 必须 | 原因 | 缺失症状 |
|---|---|---|
| `cd "$RELEASE_DIR/apps/$MODULE_DIR"` | 平台默认 cwd 是发布目录根，而基座入口是 `apps/shell/index.html` | `Could not resolve entry module "index.html"`（构建直接失败） |
| `RELEASE_TAG="$COMMIT_ID"`（完整引用，如 `shell-dev/7787826`） | `apps/shell/vite.config.ts` 用 `releaseTag` 决定 vite `base` | base 回落 `/shell/`（覆盖式发布时代的旧目录）→ 产物内资源路径与投递目录不一致 |

env-dir 类（admin / portal）**不需要**这条：它们的 base 由 `scripts/vite-micro-frontend.mjs`
的 `resolveMfBase()` 统一处理，且入口指针固定不含版本。

---

## 2. 服务域（`deploy_services`）—— 部署 = 重启 + 探活

| key | kind | pm2 进程名 | 发布通道 |
|---|---|---|---|
| `gateway` | nest | `web-gateway` | managed |
| `auth-service` | nest | `web-auth` | managed |
| `user-service` | nest | `web-user` | managed |
| `system-service` | nest | `web-system` | managed |
| `ai-service` | nest | `web-ai` | managed |
| `ai-agent` | nest | `web-ai-agent` | managed |
| `mcp-gateway` | mcp | `web-mcp-gateway` | managed |
| `content-hub` | nest | `web-content-hub` | managed |
| `upload-service` | nest | `web-upload` | managed |
| `todo-service` | nest | `web-todo` | managed |
| `knowledge-service` | nest | `web-knowledge` | managed |
| `deploy-console` | nest | `web-deploy-console` | **legacy**（传统发布，不走流水线） |

**接口**：`POST /api/services/:key/deploy` `{ envId }`（重启进程 + 探活；未配目标主机会 fail-fast）
—— **2026-09-21 起不再是发布必需路径**，仅作应急/回滚手段（见 §2.1）。

### 2.1 后端「发布即生效」：restart / verify 是 action（2026-09-21 起）

后端服务的 restart / verify **不由平台代码实现**，而是发布节点里的两个 **DB action 脚本**
（`deploy_pipeline_actions`，每次提交流水线时快照执行）：

```
发布 / local（task）
  ├─ 发布（投递产物 → servers/<dir>/<pipelineKey>/<commit>/）
  ├─ write-version · 写版本记录
  ├─ restart · 落地并重启（版本目录 → dist + 依赖校验 fail-fast + pm2 干净重启）
  └─ verify · 部署验证（pm2 online → 端口 TCP →（MCP 相关）AI 链路 → 通过后切指针）
```

- **「验证不通过 ⇒ 指针不前进」**：restart 失败即终止（后续动作不执行），旧版本继续对外服务；
  verify 全通过后才调 `POST /api/internal/release/pointer` 切指针。
- 因此流水线跑完即生效，**不需要**再去控制台点「服务详情 → 部署」。
- `deploy-console` 自身不在其中（走传统发布；在流水线里重启自己会自杀式中断）。

---

## 3. 在流水线里接部署（脚本示例）

部署不是流水线内置动作，而是在**流水线脚本**里显式调用接口：

```bash
# 应用（前端）：切指针
curl -sS -X POST http://127.0.0.1:6200/api/apps/admin/switch \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"envId\":\"local\",\"version\":\"${COMMIT_ID##*/}\"}"

# 服务（后端）：重启 + 探活
curl -sS -X POST http://127.0.0.1:6200/api/services/gateway/deploy \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"envId":"local"}'
```

也可在控制台操作：「应用 → 环境 → 切换版本」「服务 → 部署」。

### 3.1 动作脚本两条硬约定（本次踩坑固化）

1. **必须自己 `cd`**：动作进程的 cwd 是**发布目录根**，不会自动进模块目录。
   症状：前端 `Could not resolve entry module "index.html"`；后端 `TS5058: The specified path does not exist: 'tsconfig.json'`。
2. **`$VAR` 后不要紧跟非 ASCII 字符**：console 执行脚本的 bash 处于**单字节 locale**，
   多字节字符会被并入变量名 —— 症状 `NAME\xef: unbound variable`（脚本明明跑成功了却 exit 1）。
   一律写 `${VAR}（中文…）`，或让变量后面接 ASCII / 空格。

平台注入给动作脚本的变量：`RELEASE_DIR` / `MODULE_KEY` / `MODULE_DIR` / `MODULE_TYPE` / `COMMIT_ID`
/ `DEPLOY_ENV` / `BRANCH` / `PM2_NAME` / `PM2_SCRIPT` / `PM2_CWD` / `PORT` / `PUBLIC_PATH` / `BUILD_OUTPUT_DIR`
/ `CONSOLE_API` / `CONSOLE_TOKEN`（后两者供脚本 curl 调平台内部接口：`/api/internal/release/{versions,pointer}`，
`x-internal-key` 鉴权）。

> **平台不再分发脚本**（2026-09-21）：`WS_PLATFORM_SCRIPTS_DIR`、`step-scripts.ts`、
> `PlatformScriptSeedService` 与 `pipeline/scripts/*`（含 `git-step.sh`、`write-version.mjs`）均已删除
> —— 动作脚本存在 DB、由运维在页面维护；**新环境的初始脚本用
> `scripts/migrations/p21-pipeline-node-scripts.sql` 预置**（幂等：空值才填 + 存量 write-version 迁移）。
> 脚本需要平台能力时一律 **curl 调平台接口**（`/api/internal/release/*`），不再调用平台分发的文件。

---

## 4. 维护约定

1. **新增模块**（应用或服务）时，同步更新本文件的对应表格
2. 表格是**给人看的知识**；系统真相源仍是 `deploy_apps` / `deploy_services` 两张表
   —— 两边不一致时以表为准，并回来修正本文件
3. 不要把域归属判断写进代码；需要分流就在流水线脚本 / 模板配置里显式表达
