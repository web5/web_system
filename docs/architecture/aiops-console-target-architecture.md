# deploy-console 目标架构：面向 AI 的智能运维平台（Agent-Native DevOps）

> 版本：v1 · 2026-09-29 · 作者：Chase Wen
> 设计意图（用户原话）：**prod 理论上不应该参与发布部署的运维相关事情**；console 定位为**面向 AI 的智能运维平台**，
> 由 Agent 下发发布/部署指令，通过 console 的 **MCP / 接口**完成研发智能体运维闭环。
> 相关：现状 review 见 `docs/development/release-arch-review-2026-09-29.md`。

---

## 一、设计原则（先立规矩）

| # | 原则 | 含义 |
|---|---|---|
| P1 | **prod 零触碰（Zero-Touch Prod）** | prod 环境不安装发布脚本、不接收入站 SSH 部署指令、不托管 CI 产物中转；prod 上只有「业务进程 + 一个轻量 runner」 |
| P2 | **控制面 / 执行面分离** | console = 控制面（意图、策略、编排、审批、锁、审计、事实）；runner = 执行面（落在各环境本机） |
| P3 | **拉模式优先（Pull over Push）** | 控制面不再 SSH 推任务；runner 主动拉任务 → prod 无需对任何机器开放写入权限 |
| P4 | **AI 一等公民** | 所有运维能力以 MCP 工具暴露，工具本身带「风险等级 / 幂等性 / dry-run / 需要审批」元数据 |
| P5 | **意图 ≠ 执行** | Agent 只能产生「意图」；任何变更必须先 plan（dry-run）→ 校验不变量 →（必要时）人类/策略审批 → execute |
| P6 | **单一事实源** | 版本指针、环境清单、健康状态只有一处真相源；everything auditable with `ownerId + agentId` |

---

## 二、目标架构（四层）

```
┌──────────────────────────────────────────────────────────────────────┐
│ ① 意图层  Intent Plane                                               │
│   Agent（ai-agent / 研发智能体）· WorkBuddy Skill · CI Bot · 人（UI）  │
│   产出：意图（"把 portal 的 cdb055bc 发到 prod"），不含执行细节        │
└───────────────┬──────────────────────────────────────────────────────┘
                │ MCP tools/call（mcp-gateway 6006 → deploy 模块）
┌───────────────▼──────────────────────────────────────────────────────┐
│ ② 控制面  Control Plane = deploy-console（dev 机 6200）               │
│   Intent API(/api/mcp/*)  Policy Engine  Release Graph(编排)          │
│   Guardrails: 不变量校验 / 环境锁 / 审批门 / 配额 / 审批人路由         │
│   Facts: 版本真相源 · 环境清单 · 健康快照 · 审计 · 指标                │
│   ▸ 只下发「已签名的任务」，不持有 prod 写权限                         │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS 拉任务（outbox poll，runner 持尊重 TTL 的短期凭证）
┌───────────────▼──────────────────────────────────────────────────────┐
│ ③ 执行面  Execution Plane = deploy-runner（每环境本机常驻）           │
│   pull task → 本地校验签名/幂等 → 本地执行（bash/pm2/docker）→ 回报    │
│   dev-runner / prod-runner：同一份二进制，不同环境凭证                 │
│   ▸ prod-runner 只能在 prod 本机操作，不做跨环境跳转                   │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────┐
│ ④ 事实面  Fact Plane                                                 │
│   版本真相源（deploy_app_env_versions）· 健康/指标 · 事件总线 · 审计   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 与现状的差距（不是推倒重来）

| 层 | 现状 | 目标 | 缺口 |
|---|---|---|---|
| ① 意图 | ai-agent → `POST /mcp/tools/call` → mcp-gateway → console `/api/mcp/*`（**已通**） | 同上 + 意图语义（plan/execute 分离） | Agent 拿不到参数 schema（见 §5-A1） |
| ② 控制面 | console 已有编排、审批、锁表、审计、指标 | 同上 + Guardrails/Policy 引擎 | 缺「不变量校验 / 环境锁未强制 / plan 模式」 |
| ③ 执行面 | **console 直接 ssh2/scp 到 dev&prod 执行脚本** | runner 拉模式 | 缺 deploy-runner 组件 |
| ④ 事实面 | 三处版本真相源并存 | 收敛单一层次 | legacy 表退役路径 |

> ⚠️ 最大债：现状控制面同时兼任执行面（console 用 `ssh2` + `scp` + 直连 mysql 操作 prod），
> 控制台一旦被攻破 = 全部环境写权限沦陷。这是 P1/P3 要解决的根。

---

## 三、prod 零触碰：从 Push 到 Pull

### 3.1 现状（要淘汰）

```
console(dev机) ──ssh/scp──▶ prod root@106.52.176.246   # 写文件、解压、pm2 restart
               ──mysql──▶ prod 172.16.16.10            # 直写 deploy_deployments
```
问题：prod 必须开放 SSH 给 dev 机、控制台握着 root 私钥、脚本在远端以 shell 字符串跑（无法审计/无法版本化）。

### 3.2 目标（拉模式 + 任务信封）

```
prod-runner ──(HTTPS, 短期 token)──▶ GET /api/agent/tasks/next?env=prod
           ◀── TaskEnvelope ─────────
prod-runner: 校验签名 → 本地 build check → 本地执行 → PATCH /api/agent/tasks/:id (state, logs exitCode)
```

**TaskEnvelope**：
```jsonc
{
  "taskId": "tsk_01J...",          // 幂等键，重复执行直接返回上次结果
  "planId": "pln_01J...",          // 来自哪次 plan（可追溯意图）
  "kind": "switch_pointer|restart_service|sync_config|rollback|health_probe",
  "target": { "env": "prod", "scope": "module|service", "key": "portal" },
  "params": { "version": "cdb055bc" },
  "scriptRef": "sha256:<hash>",    // 脚本内容不在信封里！runner 从本地脚本库按 hash 取
  "signature": "hmac-sha256(...)", // console 用 AgentTaskKey 签，runner 验
  "expiresAt": "2026-09-29T13:00:00Z",
  "attempt": 1, "maxAttempts": 2
}
```

**三条硬约束**：
1. **脚本 Assets 化**：所有发布脚本随 runner 打包发布（git 里的 `scripts/pipeline-actions/`），信封里只有 `scriptRef` hash → 杜绝「任意 shell 注入」，也杜绝本次 13 条流水线的脚本损坏问题。
2. **runner 只做原子动词**：`switch_pointer` / `restart_service` / `sync_config` / `health_probe` / `rollback`——**不传命令字符串**。
3. **幂等 + TTL + 一次性**：taskId 已执行 → 返回上次结果；过期信封拒收；每步回报 state machine（`pending→running→succeeded|failed`）。

**过渡期（不必一次到位）**：先保留「console 推任务给 dev-runner」，prod 先上 runner 拉模式；两者可并存一个发布周期。

---

## 四、Agent 交互协议：intent → plan → approve → execute → verify

```
Agent                          console                        runner
  │ ① tools: release_plan       │                              │
  │  （dry-run，只读＋不变量校验）│                              │
  │────────────────────────────▶│ 计算影响面 + 前置检查          │
  │◀──────── planId + 风险等级 ──│ （锁/版本存在/健康/审批需求）  │
  │                              │                              │
  │ ② tools: release_submit      │                              │
  │  （带 planId + idempotencyKey）                             │
  │────────────────────────────▶│ 落地任务 → 若需审批暂停       │
  │                              │──── enqueue TaskEnvelope ───▶│
  │                              │◀──── state/log 回报 ─────────│
  │◀──── jobId ──────────────────│                              │
  │ ③ tools: job_status(轮询/SSE)│                              │
  │ ④ tools: verify_release      │ 页面/版本/健康断言            │
  │ ⑤ tools: rollback(如需)      │                              │
```

- **`planId` 是一次性令牌**：execute 必须携带，且 plan 与其后的事实变化（比如期间有人发了新版本）会让 plan 失效（乐观并发）。
- **idempotencyKey** 由 Agent 生成：同一意图重复调用不产生第二次发布。
- **SSE**：复用现有 `/api/deploy/stream/:taskId` 形态，为 Agent 提供 `job_stream` 工具。

---

## 五、MCP 工具矩阵（Agent 可见能力面）

> 现有 7 个工具（`list_modules`/`get_current_versions`/`list_releases`/`publish_version`/`rollback`/`promote_release`/`publish_pipeline`）。
> 分级：**L0 只读 · L1 可提案(plan) · L2 变更（默认需 confirm/审批） · L3 危险（强制人类审批）**

| 工具 | 级别 | 幂等 | 说明 | 现状 |
|---|---|---|---|---|
| `list_modules` / `get_current_versions` / `list_releases` | L0 | 是 | 事实查询 | ✅ 已有 |
| `diff_envs`(新增，dev vs prod 版本矩阵) | L0 | 是 | 「prod 落后几个版本」 | ❌ |
| `health_probe`(新增) | L0 | 是 | 服务/pm2/端口健康（今天 probe 走 SSH → 改造为 runner 执行） | ❌ |
| `pipeline_lint`(新增) | L0 | 是 | 编排健康巡检（kind/condition/bash -n/env 完备性） | ❌（今日一次性脚本） |
| `release_plan`(新增) | L1 | 是 | **dry-run**：影响面 + 前置检查 + 风险 + 是否需审批 | ❌ |
| `release_submit` | L2 | 幂等键 | 提交变更（须带 planId） | ⚠️ `publish_pipeline` 有，需加 planId 语义 |
| `job_status` / `job_stream` | L0 | 是 | 进度、日志、阶段 state | ✅ `publish_pipeline` 内嵌 / ⚠️ 需独立工具 |
| `job_cancel` | L2 | 是 | 取消（仅本人/本人 agent） | ✅ 已有（`ownedPipeline` 404 语义已加固） |
| `verify_release`(新增) | L0 | 是 | 发布后断言（版本一致/入口 200/无 pageerror） | ❌（今日靠人工 curl 清单） |
| `rollback` | L3 | 是 | 回滚到 previous_version | ✅ 已有，建议升 L3 强制审批 |
| `promote_release` | L3 | 是 | 灰度转全量 | ✅ 已有 |
| `lock_status` / `acquire_lock`(新增) | L1/L2 | 是 | 发布互斥（同 module+env） | ⚠️ 有 `deploy_release_lock` 表未用起来 |
| `audit_query`(新增) | L0 | 是 | 查「谁/Agent 何时改了什么」 | ❌（ `/api/audit/list` 未 MCP 化） |

**每个工具的元数据必须是机器可读的**（放进 mcp-gateway 的 tool 描述，供 Policy Engine 判 DENY/ALLOW/NEED_APPROVE）：

```jsonc
{
  "name": "release_submit",
  "x-aiops": { "level": "L2", "idempotent": true, "requiresPlanId": true,
               "scope": "publish", "approval": "auto:dev|human:prod", "timeoutSec": 900 }
}
```

---

## 六、安全与治理

| 机制 | 设计 |
|---|---|
| 身份双人 **ownerId + agentId** | 现状只有 `ownerId`（API Key 主人）→ **必须增加 agentId**（哪个智能体发起），审计不能只剩人 |
| 三档权限 | `read-only` / `propose`（只能 plan）/ `execute`（可落地）；Agent 默认 propose-first，prod 的 execute 需人审批 |
| Policy Engine | 集中判：`env==prod && path~=/infra|schema|rm/ → 拒绝`；窗口期/冻结期；每日发布配额；模块白名单 |
| 不变量校验（发布前置） | ①目标版本产物存在 ②无并发锁 ③前序环境健康 ④脚本 hash 与脚本库一致 ⑤回滚点存在 |
| 密钥 | Agent 不持有任何 SSH/DB 凭据；只有短期 bearer；runner 凭据本机保存、仅用于拉任务 |
| 审计 | 每次 Intent/Plan/Execute 三阶段全留痕（意图原文、plan 差异、执行结果、verify 证据） |

---

## 七、落地路线图

| Phase | 目标 | 关键交付 | 验收标准 |
|---|---|---|---|
| **P0（本周）** | 先让「AI 说得准」 | ① 修 `inputSchema` 回填（让 LLM 看到真实参数 schema）<br>② 补 `release_plan`（dry-run，只读）<br>③ `pipeline_lint` 工具化 + CI<br>④ `pipeline_lint` 入 CI | Agent 能在不执行的前提下产出正确 plan；编排脏数据 CI 拦截 |
| **P1（两周）** | 意图/控制面成型 | ⑤ `planId + idempotencyKey` 接入 submit<br>⑥ `diff_envs` / `health_probe` / `verify_release` / `audit_query`<br>⑦ `agentId` 审计字段 + Policy Engine 最小版 | 全链路「plan→submit→verify」可用；审计可追到 Agent |
| **P2（一个月）** | **prod 零触碰** | ⑧ `deploy-runner` 组件（拉模式 + TaskEnvelope + 签名）<br>⑨ 脚本 Assets 化（删掉 shell 字符串通道）<br>⑩ prod 入站 SSH 部署通道下线 | prod 无入站 SSH 写操作；发布经 runner 拉模式跑通 |
| **P3（一个月+）** | AI 自治闭环 | ⑪ 发布后自动 verify → 失败自动 rollback → 事件回写 Agent 对话<br>⑫ 异常检测（health 指标）→ 自动提案修复 | 无人值守：告警→Agent 提案→人确认→执行→验证 闭环 |

---

## 八、立即可开工的三件事（最小价值闭环）

1. **补 `inputSchema` 回填**（`servers/ai-agent/src/agent/agent-def-sync.service.ts` / `agent.module.ts` 的 `registerMcpTools`）：
   当前 `properties` 为空 → LLM 不知道 `publish_pipeline` 要 `moduleKey/commitId`，**这是 Agent 现在调不准的第一根因**。来源用 mcp-gateway `tools/list`。
2. **`release_plan` 工具**：把今天人工做的「前置检查清单」变成只读 API（产物存在？锁？前版本健康？要不要审批？返回风险等级）。
3. **`pipeline_lint` 工具化**：今天一次性巡检脚本 → console `/api/mcp/lint` + CI 双重入口，防止 13 条流水线病变复发。

> 这三条都是「只读/提案」级别，不改发布语义，风险最低，收益最高。
