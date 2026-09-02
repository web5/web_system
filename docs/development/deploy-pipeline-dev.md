# 发布流水线 · 发布 MCP · 发布 Agent 开发指南

> 品牌说明：本文所述平台产品名为 **Beehive（智能研发平台）**；文中 `deploy-console` 为**内部技术代号**（目录/进程/路由/端口），产品名与内部代号边界、迁移任务清单见 [beehive-brand.md](./beehive-brand.md)。

> 目标：把「构建 → 拷贝 → 更新版本表 → 清缓存」四步固化为发布流水线，通过**唯一 MCP 端点（mcp-gateway）**对外暴露，并新增**发布部署 Agent**，使本地发布可以在页面或 CLI 里对话完成。

## 一、范围与约束

| 项 | 结论 |
|---|---|
| 覆盖模块 | 前端/微前端（`admin`、`portal`）+ 后端服务（`todo-service` 等，pm2 管理）。`mcp-admin` 已合入 admin；mini-app 不纳入 |
| **发布语义** | **git 拉取**：发布目录（`~/web_system_release`）从远程仓库按「分支 + commit」拉取代码构建部署，**不基于当前工作区**。本地验证 = 工作区 commit&push → 发布目录拉取对应分支 → 部署 |
| 前端发布 | 拉取 → `vite build --mode mf` → 产物投递发布目录 gateway public → 切指针 → manifest 验证 |
| 后端发布 | 拉取 → `nest build` → `pm2 restart <服务>`（pm2 已指向发布目录）→ 服务在线验证 |
| 灰度 | 纳入（gateway `resolveCanary` 已启用，只需写 `deploy_canary_rules`） |
| 通知 | 仅控制台 + 审计日志，不做企微/邮件 |
| 版本保留 | 最近 **5** 个版本（被灰度规则引用的版本不清理） |
| MCP 端点 | **唯一**：mcp-gateway `:6006`，不新增第二个 MCP server |
| MCP 鉴权（内层） | **每用户 API Key 透传**，审计精确到 `ownerId` |
| 长任务语义 | **T3 混合**：按工具声明 `waitTimeoutSec` 决定同步等待 / 异步返回 jobId |
| 任务索引 | mcp-gateway 建 `mcp_jobs` 表（jobId → moduleKey 路由） |
| 验证环境 | 本地 `https://local.kedouai.com` + 本地 MySQL（`web_system_deploy`） + 发布目录 `~/web_system_release` |

## 二、架构总览

```
┌─ 调用层 ───────────────────────────────────────────────┐
│ AI 客户端(CodeBuddy)  │ 发布 Agent（页面/CLI）          │
│ jobId + get_job_status │ agent-core + withLongRunning   │
└──────────┬───────────────────────┬─────────────────────┘
           │ /mcp/deploy           │ /mcp/tools/call
┌──────────┴───────────────────────┴─────────────────────┐
│ mcp-gateway :6006（唯一端点，无状态）                    │
│  · 任务型工具：submit → jobId                           │
│  · 通用工具：get_job_status / cancel_job                │
│  · mcp_jobs 索引表（路由用，非状态存储）                 │
│  · 凭证透传：客户端 Bearer → X-Mcp-Key → ownerId        │
└──────────┬─────────────────────────────────────────────┘
           │ HTTP：submit / status / cancel
┌──────────┴─────────────────────────────────────────────┐
│ 执行层（状态归各自，不双写）                             │
│  deploy-console :6200 → deploy_pipelines（九阶段流水线）  │
│  发布目录 ~/web_system_release：git 拉取 + 构建 + 运行     │
│  未来：ai-service agent_run（runId 即 jobId）           │
└────────────────────────────────────────────────────────┘
```

**关键取舍：任务状态不下沉到 mcp-gateway。** 后端各自已有存储，mcp-gateway 只维护轻索引表做 jobId 路由，避免两套状态机同步问题。`mcp_jobs` 保留是出于**可迁移/可维护**考虑（能独立追踪任务归属、做超时清理与审计）。

## 三、MCP 工具清单（code_key = `deploy`）

| 工具 | 类型 | 说明 |
|---|---|---|
| `publish_pipeline` | **任务型** | 提交发布流水线（env + moduleKey + branch + commitId + mode） |
| `get_job_status` | 通用 | 按 jobId 查状态/进度/日志/结果 |
| `cancel_job` | 通用 | 取消运行中的任务（幂等） |
| `publish_version` | 同步 | 发布指定版本（秒级切换指针，不重新构建） |
| `rollback` | 同步 | 回滚到指定版本 |
| `promote_release` | 同步 | 灰度转全量 |
| `list_modules` | 同步 | 可发布模块清单 |
| `get_current_versions` | 同步 | 某环境各模块当前版本 |
| `list_releases` | 同步 | 版本历史（回滚候选） |

任务型工具声明（`mcp-core` 扩展）：

```ts
interface HttpJobToolDef {
  name: string; description: string;
  submit: { method; path; params };   // 提交，响应提取 jobId（默认 resultPath='jobId'）
  status: { method; path };           // 查询，path 支持 {jobId}
  cancel?: { method; path };
  poll?: { intervalMs?: number; maxWaitMs?: number };
  waitTimeoutSec?: number;            // >0 → 同步等待到终态；未配 → 立即返回 jobId
  longRunning?: boolean;              // 供 agent-core 识别
}
```

## 三-b、发布脚本 Hook（开发者可自定义各阶段）

> 前后端发布本质都是 shell 脚本。每个模块的每个流水线阶段可配置一个自定义脚本，开发者自行决定"怎么构建、怎么部署"。

**模型**：`deploy_module_hooks` 表（module_key + stage + script + enabled + updated_by），DB 为真相源。

**阶段**：`check / pull / build / upload / restart / verify / cleanup`（version/pointer 固定由流水线执行）。

**执行语义**：
- 某阶段配置了脚本 → 执行脚本（`bash <file>`），跳过流水线内置逻辑；未配置 → 用内置逻辑
- `check` 阶段例外：先执行内置安全校验（模块类型/prod 分支约束），再执行自定义脚本（作为附加校验）
- 每次执行时从 DB 读脚本并覆盖落盘到发布目录 `hooks/<moduleKey>/<stage>.sh`（执行载体），**修改后下一次发布立即用新脚本**
- 脚本可用环境变量：`DEPLOY_ENV / MODULE_KEY / BRANCH / COMMIT_ID / RELEASE_DIR / STAGE / MODULE_TYPE / MODULE_DIR / PM2_NAME`
- 输出流式进流水线日志；退出码非 0 → 该阶段失败、中断发布

**接口**（仅控制台 JWT，不暴露 MCP）：
- `GET /modules/:key/hooks` 各阶段状态（含未配置标记）
- `GET /modules/:key/hooks/:stage` 单阶段脚本
- `PUT /modules/:key/hooks/:stage` 保存（保存前强制 `bash -n` 语法校验）
- `DELETE /modules/:key/hooks/:stage` 删除（恢复内置逻辑）
- `POST /modules/:key/hooks/:stage/validate` 仅语法校验
- `GET /modules/hooks/templates?type=frontend|backend` 默认脚本模板

**页面**：模块详情 → 「发布脚本」tab：阶段菜单 + shell 编辑器 + 插入模板 / 语法校验 / 保存 / 恢复默认。

> **注意（2026-09-02 更新）**：本节的 `deploy_module_hooks` 机制与 `deploy_modules.buildCmd` 字段
> **均已废弃，合并为单一真相源** `deploy_module_stage_commands`（每模块每阶段一条 shell 命令）。
>
> 阶段语义按「是否有合理内置默认」分级：
> - `build`：**必须配置命令**，未配置即终止发布，不回退任何内置硬编码；
> - `check` / `pull` / `upload` / `restart` / `verify` / `cleanup`：可选覆盖，未配置用流水线内置逻辑；
> - `version` / `pointer`：发布语义真相源，固定由流水线执行，不可配置。
>
> 权威定义见 `specs/release-platform/design.md`（历史问题复盘：两套互斥机制 + 文档矛盾 + 发布核心从未评审）。

## 四、发布流水线（deploy-console）

### 4.1 阶段

| # | 阶段 | 说明 |
|---|---|---|
| 1 | `check` | 校验模块存在且为 micro-frontend；prod 校验 master 分支 |
| 2 | `build` | `vite build --mode mf`，`RELEASE_TAG=<commit>` |
| 3 | `upload` | 产物拷到 `servers/gateway/public/static/modules/<module>/<version>/` |
| 4 | `version` | 写 `deploy_versions`（**库：web_system_deploy**） |
| 5 | `pointer` | upsert `deploy_deployments` 的 `current_version` |
| 6 | `verify` | 等 gateway TTL 10s → `curl /__manifest__` 断言版本已更新 |
| 7 | `cleanup` | 保留最近 5 个版本目录，清理更旧的（被灰度引用的跳过） |

> 阶段 4/5/6 是把历史上「版本表写错库」「忘了等 TTL」两个坑固化进代码的部分，**不可省略**。

### 4.2 灰度

- 灰度发布：产物照常发，**不切 stable 指针**，改为写 `deploy_canary_rules`（`user-list` / `percent` / `header`）
- 全量（`promote_release`）：切 stable 指针 + 禁用规则
- gateway `IndexHtmlService.resolveCanary()` 已启用，无需改动

### 4.3 鉴权入口

deploy-console 新增 `/api/mcp/*` 路由组：

- `@Public()` + `McpKeyGuard`：取 `X-Mcp-Key` → 调 user-service `POST /internal/keys/verify`（受 `INTERNAL_API_KEY` 保护）→ 拿 `ownerId`
- `ownerId` 作为 `operator` 写入审计日志，**禁止**出现 `mcp` / `anonymous` / `unknown`

## 五、agent-core 长任务插件（可选，非内置）

`agent-core` 保持零 MCP 依赖，长任务处理做成 **Tool 层装饰器**，由各 agent / 服务层决定是否启用。

```ts
// packages/agent-core/src/plugins/long-running.ts
export type JobStatusFetcher = (jobId: string) => Promise<JobStatus>;
export type JobIdDetector   = (result: unknown) => string | null;   // 默认识别 { jobId }

export function withLongRunning(
  tool: ToolDefinition,
  opts: { fetchStatus: JobStatusFetcher; detect?: JobIdDetector;
          intervalMs?: number; maxWaitMs?: number; onProgress?: (p) => void },
): ToolDefinition;
```

- 包的是 `ToolDefinition`，**不只 MCP 工具**，本地耗时工具同样适用
- 状态从哪查、等多久 → 全部由注入方决定，agent-core 不知道 MCP 存在
- 不启用即原工具透传，零副作用

超时参数可通过 `CapabilityRef.config`（已支持 `mcp 可覆盖 timeout`）按能力配置。

## 六、发布部署 Agent

### 6.1 定义

`servers/ai-agent/src/deploy/agents/deploy.agent.ts`：

```ts
export const deployAgent: AgentDefinition = {
  id: 'deploy',
  name: '发布助手',
  systemPrompt: /* 见下 */,
  model: 'deepseek-chat',
  tools: ['publish_pipeline', 'get_job_status', 'cancel_job', 'publish_version',
          'rollback', 'promote_release', 'list_modules', 'get_current_versions', 'list_releases'],
  capabilities: [
    { type: 'mcp', ref: 'deploy/publish_pipeline',   enabled: true, config: { longRunning: true, maxWaitMs: 600_000 } },
    { type: 'mcp', ref: 'deploy/get_job_status',     enabled: true },
    { type: 'mcp', ref: 'deploy/cancel_job',         enabled: true },
    { type: 'mcp', ref: 'deploy/publish_version',    enabled: true },
    { type: 'mcp', ref: 'deploy/rollback',           enabled: true },
    { type: 'mcp', ref: 'deploy/promote_release',    enabled: true },
    { type: 'mcp', ref: 'deploy/list_modules',       enabled: true },
    { type: 'mcp', ref: 'deploy/get_current_versions', enabled: true },
    { type: 'mcp', ref: 'deploy/list_releases',      enabled: true },
  ],
  maxSteps: 10,
  temperature: 0.2,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
```

systemPrompt 行为门禁（要点）：

- 支持按 **环境 + 模块 + 版本** 发布；参数缺失时用 `list_modules` / `list_releases` 补齐并**向用户确认**
- **prod 发布前必须向用户二次确认**，并说明影响面；非 master 分支版本禁止发 prod
- 发布为长任务：先拿到 jobId，再查 `get_job_status` 直到终态；中途向用户汇报进度，不静默等待
- 失败时给出失败阶段与日志尾部，不自行无限重试
- 提供回滚入口：失败或用户要求时，用 `list_releases` 取上一版本 → `rollback`

### 6.2 页面对话发布

`deployAgent` 注册到 ai-agent 的 `AgentRegistry`（代码内置 + DB 定义同步，DB 优先）。`AgentDefSyncService` 会自动把 `capabilities` 中 `type:'mcp'` 的引用注册为懒加载工具。

### 6.3 CLI 对话发布

`packages/kedou-agent` 的 `harness.ts` 中：

- 增加 MCP executor（调 `${MCP_GATEWAY_URL}/mcp/tools/call`，Bearer `MCP_CLIENT_KEY`）
- 注册 `deployAgent`；对 `config.longRunning` 的能力用 `withLongRunning` 包裹
- **未配置 `MCP_GATEWAY_URL` 时跳过注册，CLI 其余能力不受影响**

用法：

```bash
export MCP_GATEWAY_URL=http://127.0.0.1:6006
export MCP_CLIENT_KEY=kedou_xxx
npx kedou-agent                       # 进入对话
> 把 admin 发布到 dev
> dev 上 admin 现在是什么版本
> 把 portal 回滚到上一个版本
```

## 七、验证方案

原则：分层断言、高危只验拦截、`mcp-core` 必须回归（公共包，影响现有 4 个模块）。

| 层 | 验什么 | 手段 | 通过标准 |
|---|---|---|---|
| L0 | 静态 | lint + tsc + build | 0 error |
| L1 | 单元 | jest | 全绿，关键路径覆盖 ≥80% |
| L2 | 集成（无外网） | curl + dev-only mock 任务 | 契约/鉴权/T3 双模式全通 |
| L3 | 端到端（真 dev） | 真发 admin + 7 步断言 | 页面加载新版本 |
| L4 | Agent 侧 | 插件启用/不启用对照 | 长任务自动收敛为结果 |
| L5 | MCP 真机 | CodeBuddy 自然语言 / CLI | 一句话完成发布 |
| L6 | 回归 | 现有模块 + 页面 | 无退化 |

### L0 静态

```bash
pnpm -w lint
cd packages/mcp-core && npx tsc --noEmit
cd packages/agent-core && npx tsc --noEmit
cd servers/mcp-gateway && npx tsc --noEmit
cd servers/deploy-console && npx tsc --noEmit
```

### L1 单元测试

| 包/服务 | 必须覆盖 |
|---|---|
| `mcp-core` | 任务型声明→注册；`{jobId}` 路径替换；`resultPath` 提取；**T3 双分支**；超时错误 |
| `mcp-gateway` | `mcp_jobs` 写入/路由；jobId 不存在→404 非 500；`cancel_job` 幂等 |
| `deploy-console` | 流水线状态机（mock build/upload）；**保留 5、第 6 个被清**；灰度引用版本不被清；canary 规则写入 |
| `agent-core` | `withLongRunning`：pending→running→succeeded；failed 带 error；超时中断；**未启用时原样透传（不轮询）** |

### L2 集成（无外网依赖）

**L2.1 契约连通**

```bash
# 提交（异步模式：未配 waitTimeoutSec）
curl -s -X POST http://127.0.0.1:6006/mcp/tools/call \
  -H "Authorization: Bearer $KEDOU_KEY" -H "Content-Type: application/json" \
  -d '{"module":"deploy","tool":"publish_pipeline","args":{"env":"dev","moduleKey":"admin"}}'
# 期望: {"jobId":"...","status":"pending"}，且 <2s 返回

# 查询
curl -s -X POST http://127.0.0.1:6006/mcp/tools/call \
  -H "Authorization: Bearer $KEDOU_KEY" -H "Content-Type: application/json" \
  -d '{"module":"deploy","tool":"get_job_status","args":{"jobId":"<id>"}}'
# 期望: 含 status / progress / logs
```

**L2.2 T3 双模式**（dev-only mock 任务端点，避免每次真构建）

| 模式 | 条件 | 断言 |
|---|---|---|
| 异步 | 未配 `waitTimeoutSec` | 立即返回 jobId，<2s |
| 同步 | `waitTimeoutSec=60`，mock sleep 5s | 单次调用阻塞 5s 后返回终态结果，无 jobId |
| 同步超时 | `waitTimeoutSec=5`，mock sleep 30s | 5s 后返回 jobId + 转异步提示，**不报错、不丢任务** |

**L2.3 鉴权透传（关键）**

```bash
curl -s "http://127.0.0.1:6200/api/audit/list?page=1&limit=5" \
  -H "Authorization: Bearer $CONSOLE_JWT"
# 断言: operator == 该 key 的 ownerId，不得为 mcp/anonymous/unknown
# 补充: 无效 key → 401；已吊销 key → 401
```

**L2.4 长任务不再被 30s 截断**：mock 45s 任务经 ai-agent 调用，断言成功返回（改造前必失败，作为前后对照）。

### L3 端到端（真实 dev，核心）

```bash
V=$(git rev-parse --short HEAD)

JOB=$(curl -s -X POST http://127.0.0.1:6006/mcp/tools/call \
  -H "Authorization: Bearer $KEDOU_KEY" -H "Content-Type: application/json" \
  -d '{"module":"deploy","tool":"publish_pipeline","args":{"env":"dev","moduleKey":"admin"}}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['jobId'])")

for i in $(seq 1 60); do
  R=$(curl -s -X POST http://127.0.0.1:6006/mcp/tools/call \
    -H "Authorization: Bearer $KEDOU_KEY" -H "Content-Type: application/json" \
    -d "{\"module\":\"deploy\",\"tool\":\"get_job_status\",\"args\":{\"jobId\":\"$JOB\"}}")
  echo "$R"; echo "$R" | grep -qE '"status":"(succeeded|failed)"' && break
  sleep 5
done
```

| # | 断言 | 判据 |
|---|---|---|
| 1 | 流水线终态 succeeded | `status=succeeded`，logs 无错误 |
| 2 | 产物落盘 | `ls servers/gateway/public/static/modules/admin/$V/` 有 `index.js` |
| 3 | **版本表写对库** | `mysql -uroot -pKedouLocal@2026 web_system_deploy -e "SELECT current_version FROM deploy_deployments WHERE env_id='dev' AND module_key='admin';"` → `= $V` |
| 4 | 等 TTL 后 manifest 更新 | `sleep 12 && curl -s localhost:6000/__manifest__` → admin.version = `$V` |
| 5 | 产物可访问 | `curl -s -o /dev/null -w "%{http_code}" https://local.kedouai.com/static/modules/admin/$V/index.js` → `200` |
| 6 | 版本记录入库 | `deploy_versions` 新增，`git_commit=$V`、分支正确 |
| 7 | 浏览器实加载 | 访问 `https://local.kedouai.com/admin/` 加载 `$V` 资源 |

**L3.2 回滚**：`publish_version` 切回上一版本 → 等 12s → manifest 回到旧版本 → 页面正常。

**L3.3 版本保留 N=5**：连续发布 6 次 → `ls static/modules/admin/` 只剩最近 5 个目录；被灰度规则引用的版本仍在。

**L3.4 灰度**：灰度发布（percent=100）→ 命中请求 manifest 返回 canary 版本；未命中返回 stable。`promote_release` 后全量切换、规则禁用。

**L3.5 prod 拦截（不真发）**：
- 非 master 分支发 prod → 400，消息含分支名
- `confirm != true` 发 prod → 400
- 断言：上述请求**未产生任何远端变更**

### L4 Agent 侧

| 用例 | 断言 |
|---|---|
| 插件启用 | 调长任务工具，引擎一次性拿到最终结果，`success=true` |
| 插件不启用 | 返回 jobId 原文，引擎不轮询（证明 agent-core 未内置） |
| 45s 任务 | 成功返回，不再 30s 超时 |
| 任务失败 | `success=false` + 末次进度，Agent 可决策重试 |
| 参数缺失 | Agent 主动用 `list_modules` 补齐并向用户确认，不臆造参数 |
| 发 prod | Agent 触发二次确认，未确认则不调用工具 |

### L5 MCP 真机

`.workbuddy/mcp.json` 增加：

```json
{
  "mcpServers": {
    "kedou-deploy": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:6006/mcp/deploy",
      "timeout": 600000,
      "headers": { "Authorization": "Bearer <你的API Key>" }
    }
  }
}
```

- CodeBuddy 说「把 admin 发布到 dev」→ 调用正确 → 终态成功 → 页面生效；且不误发 prod
- CLI：`npx kedou-agent` 对话发布，同上

### L6 回归（必做）

| 项 | 断言 |
|---|---|
| 现有 4 个 MCP 模块 | `finnews/wechat_mp/paper/institution` 各抽 1 个工具调用成功 |
| deploy-console 现有页面 | 登录 + 各列表接口 200，发布中心旧「部署/回滚」仍可用 |
| gateway | `__version__?module=admin`、`__manifest__` 正常 |
| admin / portal 前端 | `mf` 模式产物不变，页面无退化 |

### 验证数据准备

1. 测试用每用户 API Key（user-service 申请，记录 `ownerId` 供 L2.3 断言）
2. dev-only mock 任务端点（`NODE_ENV != production` 才注册），供 L2.2 / L2.4 快速回归
3. 灰度验证用固定 userId / `x-canary` 头

### DoD

- L0–L6 全绿，无 skip
- L3 的 7 步断言在真实 dev 跑通并留痕（贴命令输出）
- 审计日志中 MCP 发起的发布**全部带真实 ownerId**
- 现有 4 个 MCP 模块零退化
- `mcp-skills/kedou-deploy/SKILL.md` 行为门禁齐全

## 八、常见坑（历史踩坑固化）

| 坑 | 现状/规避 |
|---|---|
| 版本表写在 `web_system` 库 | 正确库是 **`web_system_deploy`**（gateway 用独立数据源连它）。流水线阶段 4/5 固定连 deploy 库 |
| 忘了等 gateway TTL | gateway 版本缓存 TTL 10s。流水线阶段 6 固定等待 + 断言 manifest |
| agent 调 MCP 30s 硬编码 | `mcp.service.ts` 的 `AbortSignal.timeout(30000)`，改为按能力 `config.maxWaitMs` |
| 长任务同步阻塞导致代理超时 | MCP 默认异步返回 jobId；同步等待仅在显式配置 `waitTimeoutSec` 时启用 |
| 审计 operator 丢失 | 强制走 `X-Mcp-Key` → user-service verify → `ownerId`；禁止默认值兜底 |
| **Node `fetch` 访问不了 gateway:6000** | 6000 属 X11 bad port，undici 直接拒绝（curl 不受影响）。流水线验证请求改用 `http` 模块；后端地址优先直连服务端口而非 gateway 代理端口 |
| **响应体被全局拦截器包装** | `__manifest__` 实际返回 `{code,data:{modules:[...]}}`，解析需兼容 `json.data ?? json` |
| **`spawn npx ENOENT`** | pm2 拉起的进程 PATH 可能不含 `npx`。构建改为 `process.execPath` + `apps/<dir>/node_modules/vite/bin/vite.js` 绝对路径，不依赖 shell PATH |
| **pm2 restart 静默失败** | pm2 CLI 可能不在当前 shell 的 PATH（node 由 fnm 多版本管理时常见）。`pm2 restart x >/dev/null 2>&1` 会把 `command not found` 一起吞掉，服务其实没重启。改代码后务必**确认进程 PID 变化或端口重新响应**，别只看命令退出码 |

## 九、按版本发布（环境 + 模块 + 版本）

`versionTag` 的三种语义，实现在 `stageCheck`：

| 传入情况 | 行为 |
|---|---|
| 不传 | 发布当前工作区代码，版本 = 当前 git HEAD 短哈希，走完整七阶段 |
| 传了且磁盘已有该版本产物 | `reuseArtifact=true`，**跳过 build / upload**，秒级发布（版本与产物严格一致） |
| 传了但该版本无产物且与 HEAD 不同 | **拒绝**（`BadRequestException`），并列出可用产物版本 |

**为什么必须这样设计**：早期实现只是把 `versionTag` 当标签传给 `vite build`，并不切换 git 代码。
这会导致传 `versionTag=3fbb450` 时把当前 HEAD 的代码打成 `3fbb450` 发出去——版本标签与代码内容不一致，
回滚时以为回到旧版本，实际是新代码，属于高危静默错误。现在的规则是：**不重新构建就绝不改变版本与代码的对应关系**。

`listReleaseCandidates(env, component)` 为控制台与 MCP 共用（避免两边逻辑漂移），
返回按 `versionTag` 去重的候选版本，标记来源 `db`（版本表）或 `artifact`（磁盘产物）。

## 十、本地环境（local）

本地开发发布走 **`env=local`**，与远程 `dev` 完全隔离。

**为什么要隔离**：产物只投递到本机 `servers/gateway/public/static/modules/`，
而远程 dev 的 gateway 读的是同一张 `deploy_deployments` 表里 `env_id='dev'` 的指针。
若本地发布改 `dev` 指针，远程 dev 会指向一个本地才有、远程没有的产物版本 → 远程 dev 页面 404。

| 项 | 配置 |
|---|---|
| 环境记录 | `deploy_environments` 中 `id='local'`（名称「本地环境」，public_url `https://local.kedouai.com`） |
| 网关读取 | 本机 gateway 的 `.env` 设 **`DEPLOY_ENV_ID=local`**，只读 `env_id='local'` 的指针 |
| 投递目标 | `local` 环境**强制本机投递**（即使传 `target='remote'` 也会强制为 local 并记日志） |
| 分支约束 | 无（只有 `prod` 校验 master 分支） |
| 版本清理 | 只清理本机产物目录，且保留最近 5 个版本 |

初始化方式（已执行，新机器照做）：

```sql
INSERT INTO deploy_environments (id,name,public_url,builtin)
VALUES ('local','本地环境','https://local.kedouai.com',1)
ON DUPLICATE KEY UPDATE name=VALUES(name), public_url=VALUES(public_url);

-- 复制 dev 当前指针作为 local 初始状态
INSERT INTO deploy_deployments (id, env_id, module_key, current_version, status, deployed_at, deployed_by)
SELECT UUID(), 'local', module_key, current_version, status, NOW(), deployed_by
FROM deploy_deployments WHERE env_id='dev'
ON DUPLICATE KEY UPDATE current_version=VALUES(current_version), deployed_at=VALUES(deployed_at);
```

再把 `servers/gateway/.env` 的 `DEPLOY_ENV_ID` 改为 `local` 并重启 gateway。

> 注意：改 `DEPLOY_ENV_ID` 后，本机 gateway 读取的指针来源随之改变，
> 若 `local` 下还没有某模块的指针，manifest 里会缺该模块——所以初始化时务必复制一份。

## 十一、验证结果（2026-09-01，本地 dev + 本地 MySQL）

| 层 | 项目 | 结果 |
|---|---|---|
| L0 | 各包/服务 `tsc` 类型检查 | PASS（mcp-core / agent-core / kedou-agent / mcp-gateway / deploy-console / ai-agent 全通过） |
| L1 | 长任务插件单测 | PASS（agent-core 新增 8 例，全量 32 例通过） |
| L2.1 | 契约连通 + 鉴权透传 | PASS（`list_modules` 正常返回，调用者身份解析成功） |
| L2.2 | T3 三分支 | PASS（异步 0s 返回 jobId / 同步 6s 等到终态 / 超时转异步不丢任务） |
| L2.3 | 审计 operator | PASS（`user = ownerId`，无 mcp/anonymous/unknown） |
| L2.4 | 45s 长任务 | PASS（插件等待 45.8s 拿到终态，突破 30s 限制） |
| L3 | 真实发布 admin→dev | PASS（7 阶段全通，25s 完成；manifest 断言 `18e095e`；产物 200；保留 5 个版本） |
| L3.2 | 历史版本回退 | PASS（`publish_version` + `component` 回退到 `3fbb450`） |
| L3.3 | 版本保留 N=5 | PASS（kept 恰好 5 个） |
| L3.4 | 灰度 / 转全量 | PASS（灰度不切全量指针，规则生效；promote 后切全量且规则禁用） |
| L3.5 | prod 拦截 | PASS（缺 confirm → 400；非 master 分支 → check 阶段失败，无远端变更） |
| L4 | 插件可选性 | PASS（未启用时原样返回 jobId，不轮询） |
| L5 | MCP 协议层 `tools/list` | PASS（11 个工具齐全） |
| L6 | 现有模块回归 | PASS（finnews / paper / institution 均可调用） |
| L3.6 | 按版本发布（历史版本） | PASS（`3fbb450` 复用产物、跳过构建，manifest 断言通过，秒级生效） |
| L3.7 | 按版本发布（无产物版本） | PASS（`deadbeef` 在 check 阶段被拒绝，并列出可用版本） |
| L7 | 控制台流水线页 | PASS（页面 200；提交/进度/日志/取消/转全量接口连通；版本候选去重后 5 条） |
| L7.2 | 控制台提交链路 | PASS（发当前代码 → 构建成功；按版本发布 → 复用产物；审计 operator=admin） |
| L8 | 本地环境隔离 | PASS（发布到 `local` 后 manifest 生效；`dev` 指针未被改动） |

## 十二、过程中发现并处理的既有问题

| # | 问题 | 处理 |
|---|------|------|
| 1 | `scripts/deploy.sh` 没有 `micro-frontend:*` 分支，现有 `DeployService.publishModule()` 调用它必然 exit 1 | 流水线**不复用**该脚本，自建投递链路。该脚本待独立修或废弃 |
| 2 | `deploy.sh` 第 154 行更新的是 `web_system` 库，而版本表实际在 `web_system_deploy` | 同上，流水线直连 deploy 库。脚本待修 |
| 3 | mcp-gateway 本地 `.env` 把 `FINNEWS_SERVICE_URL` 指向 gateway:6000，触发 bad port，导致 finnews 工具全部 `fetch failed` | 已改为直连 `http://127.0.0.1:6007`（与 `ecosystem.config.js` 生产默认值一致） |
| 4 | 历史版本记录在 `deploy_versions` 中 component 为 `mf:admin`，与现在 `admin` 不一致，导致旧产物无法回滚 | `publish_version` 增加回退：传 `component` 时按磁盘产物校验切换并补写版本记录；`list_releases` 合并磁盘产物版本 |

## 十三、后续可选增强

- 流水线支持后端服务（backend 模块）：阶段 3 需换成 `nest build` + SSH + pm2 restart
- 长任务进度通过 MCP `notifications/progress` 实时推送（当前为轮询）
- `mcp_jobs` 索引表按时间清理过期记录
- 发布结果通知（企微/邮件），当前仅控制台 + 审计日志 |
