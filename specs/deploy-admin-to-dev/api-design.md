# admin 发布到 dev · 接口设计

> 类型：api-design.md（Design 阶段产物）
> 日期：2026-09-11
> 关联：需求 `requirements.md` · 设计 `design.md` · 脚本 `scripts.md`
> 原则：**涉及数据库操作的，一律走接口**（本机不直连远端 DB）

本文件定义 5 组接口：

| 组 | 接口 | 角色 |
|---|---|---|
| ① | `POST /api/hooks/release`（**已存在**，dev 机 console） | 一期：本机向远端提交发布意图（写版本+切指针由远端完成） |
| ② | `POST /api/internal/release/register`（**新增，可选**） | 二期备选：只写库（版本+指针），不拉码不构建 |
| ③ | `POST /api/pipelines`（**已存在**，本机 console） | 语义变更：`target` 按环境自动判定 |
| ④ | MCP `publish_pipeline`（**已存在**） | Agent 入口，参数不变 |
| ⑤ | `/api/pipeline-templates/:id/steps`（**已存在**） | 语义变更：`git` 节点落 DB 脚本但 `locked`（可读不可写） |

---

## ① 复用：`POST /api/hooks/release`（dev 机 console）

### 基本信息

| 项 | 值 |
|---|---|
| 完整地址 | `http://{{DEV_HOST}}:6200/api/hooks/release` |
| 方法 | `POST` |
| 鉴权 | **HMAC-SHA256**（不走 JWT；CI 场景无登录态） |
| 内容类型 | `application/json` |
| 幂等 | `deliveryId` 唯一键（`deploy_release_events.delivery_id`） |
| 实现 | `servers/deploy-console/src/hook/release-hook.controller.ts` → `release-hook.service.ts` |
| 语义 | 内部调用 `PipelineService.submit` → **锁 / 审批 / 审计 / 回滚与控制台完全一致** |

### 鉴权（HMAC）

```
签名串 = `${timestamp}.${rawBody}`            // 必须是原始请求体字节，不得重新序列化
signature = "sha256=" + hex(hmac_sha256(RELEASE_HOOK_SECRET, 签名串))

请求头：
  X-Ws-Timestamp: <unix 秒>
  X-Hub-Signature-256: sha256=<hex>
规则：
  时间窗 |now - timestamp| ≤ 300s（超出 → 401，防重放）
  常量时间比较（timingSafeEqual）
  未配置 RELEASE_HOOK_SECRET → 401（端点不可用）
```

### 请求体（`ReleaseHookDto`，白名单校验）

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `deliveryId` | string | ✅ | ≤128 | 幂等键，建议 `local-<纯短哈希>-<moduleKey>` |
| `env` | string | ✅ | `local\|dev\|staging\|prod` | 目标环境（本期 `dev`） |
| `moduleKey` | string | ✅ | `^[A-Za-z0-9._-]{1,64}$` | 如 `admin` |
| `branch` | string | ✕ | `^[A-Za-z0-9._/-]{1,128}$` | 远端 pull 用的分支；**本链路必带**（= 本机实际拉取的分支；缺省会让远端兜底 `master`，与发起端记录不一致，见 design 决策 8） |
| `commitId` | string | ✕ | `^[A-Za-z0-9._-]{4,64}$` | **纯短哈希**（不带 `<templateKey>/` 前缀）；**本链路必传** —— 缺省会令远端走「pull + build + upload」全量路径（含切分支副作用），见 design §既有能力复用核查 |
| `mode` | string | ✕ | `direct\|grayscale` | 本期只用 `direct` |
| `target` | string | ✕ | `local\|remote` | 远端执行时保持默认（远端本机投递） |
| `event` | string | ✕ | ≤64 | 默认 `push` |
| `source` | string | ✕ | ≤128 | 建议 `local-console`（operator 记为 `ci:local-console`） |

**请求示例**

```json
{
  "deliveryId": "local-1a2b3c4-admin",
  "env": "dev",
  "moduleKey": "admin",
  "branch": "feature/xxx",
  "commitId": "1a2b3c4",
  "mode": "direct",
  "source": "local-console"
}
```

### 响应

| 字段 | 类型 | 说明 |
|---|---|---|
| `deliveryId` | string | 回显 |
| `duplicate` | boolean | `true` = 该 deliveryId 已受理过（幂等命中） |
| `jobId` | string \| null | 远端流水线 ID |
| `status` | string | `pending` / `pending-approval` / … |
| `approvalId` | string? | 需审批时返回 |

```json
{ "deliveryId": "local-1a2b3c4-admin", "duplicate": false, "jobId": "1789…-ab12cd3", "status": "pending" }
```

### 远端行为（关键：产物已存在 → 复用）

```
check 阶段：fullRef = <templateKey>/<commitId> = default/1a2b3c4
            artifacts.exists('admin', 'default/1a2b3c4') → true
            ⇒ reuseArtifact = true，跳过 pull/build/upload/restart
后续：version → pointer → （restart 前端跳过）→ verify
```

> 因此本机只需**先投递产物**（脚本 S1），再调本接口，即可秒级完成"写版本 + 切指针"。
>
> **拉码环节**：远端内置 `pull`（`PullExecutor`+`ReleaseGitService`，作用于远端 `RELEASE_WORKSPACE=/data/web_system`）在上述 `reuseArtifact=true` 时被守卫跳过 —— 即**正常链路不产生远端拉码、也不切分支**；仅当 `commitId` 缺失或远端无该产物时才会真正 pull。
>
> **代码确定性**：若远端真的拉码，`syncToBranch(branch, commit)` 会 `checkout -B <branch>` 再 `reset --hard <commitId>` —— **最终代码由 `commitId` 决定，`branch` 只决定 fetch 来源与检出名**。因此 `branch`/`commitId` 都带上，远端与发起端的记录（`deploy_versions.git_branch/git_commit`）才一致。

### 错误码

| HTTP | 场景 | 响应 message |
|---|---|---|
| 401 | 缺头 / 时间戳非法 / 超窗 / 签名不匹配 / 未配置密钥 | `签名校验失败` / `时间戳超出允许窗口（300s），疑似重放` / `未配置 RELEASE_HOOK_SECRET，触发端点不可用` |
| 400 | JSON 非法 / DTO 校验失败 | `发布意图校验失败 → moduleKey: …` |
| 409/400 | 同 `(env,moduleKey)` 已有运行中流水线 | `该模块在 <env> 已有发布进行中`（由 `PipelineService.submit` 抛出） |

---

## ② 新增（二期可选）：`POST /api/internal/release/register`

**用途**：只做 DB 写入（版本记录 + 切指针），**不拉码、不构建、不重启**。
消除 ① 的"远端仍会 checkout 分支"副作用。

| 项 | 值 |
|---|---|
| 完整地址 | `http://{{DEV_HOST}}:6200/api/internal/release/register` |
| 鉴权 | `X-Internal-Key: <INTERNAL_API_KEY>`（服务间密钥，已在两端 `.env` 一致） |
| 实现位置 | `servers/deploy-console/src/registry/`（新增 controller）→ 复用 `ReleaseRegistryService.registerVersion` + `setPointer` |
| 审计 | 写 `audit_logs`：`action='release.register.remote'`，`user=internal:<source>` |

**请求**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `env` | string | ✅ | `dev` |
| `moduleKey` | string | ✅ | `admin` |
| `versionTag` | string | ✅ | **完整引用** `default/1a2b3c4` |
| `gitCommit` | string | ✕ | 纯短哈希（写 `deploy_versions`） |
| `branch` | string | ✕ | 记录用 |
| `remoteDir` | string | ✕ | 用于校验产物存在性（缺省按本机 `RELEASE_WORKSPACE`） |
| `operator` | string | ✕ | 缺省 `internal` |
| `note` | string | ✕ | 版本备注 |

**响应**

```json
{ "env": "dev", "moduleKey": "admin", "versionTag": "default/1a2b3c4", "pointerSwitched": true, "versionRegistered": true }
```

**错误**：`401` 密钥缺失/不匹配；`400` 参数非法；`404` 模块不存在；`422` 目标产物不存在（远端磁盘无 `index.js`）。

> 二期若采用 ②，本机 `version`/`pointer` 阶段改为调本接口，② 需随 console 代码发布到 dev 机。

---

## ③ `POST /api/pipelines`（本机 console，语义变更）

请求体（`SubmitPipelineDto`）不变：

| 字段 | 说明 |
|---|---|
| `env` | `local` / `dev` / … |
| `moduleKey` | `admin` |
| `branch` / `commitId` | 同现状 |
| `mode` | `direct`（remote 灰度本期不支持） |
| `templateId` | 可选 |
| `target` | **语义变更**：`local` → 本机；`remote` → 目标环境应用机；**不传** → 按 §design 决策 1 的环境规则解析 |

**行为差异（`env=dev`）**

| 阶段 | 行为 |
|---|---|
| upload | 投递到 `{{DEV_HOST}}:/data/web_system/…`（脚本） |
| version/pointer | 调远端 ①（接口），本机库不再写入 |
| verify | 断言 `https://dev.kedouai.com/__manifest__` + 产物 200 |
| 日志 | 每阶段打印实际目标机与远端 jobId |

**响应**：不变（`{jobId, status, approvalId?}`），查询仍用 `GET /api/pipelines/:id`。

---

## ④ MCP `publish_pipeline`（Agent 入口）

| 项 | 值 |
|---|---|
| 端点 | `POST http://127.0.0.1:6006/mcp/tools/call`（本机 mcp-gateway） |
| 鉴权 | `Authorization: Bearer <KEDOU_KEY>` |
| 入参 | `env` / `moduleKey` / `branch` / `commitId` / `mode` / `templateId` / `waitTimeoutSec` / `confirm`（prod） |
| 变更 | **无参数变更**；`env=dev` 自动走远端链路（同一 `PipelineService.submit`） |
| 长任务 | 默认异步返回 `jobId`，用 `get_job_status` 轮询到终态 |

```bash
curl -s -X POST http://127.0.0.1:6006/mcp/tools/call \
  -H "Authorization: Bearer $KEDOU_KEY" -H "Content-Type: application/json" \
  -d '{"module":"deploy","tool":"publish_pipeline","args":{"env":"dev","moduleKey":"admin","branch":"feature/xxx"}}'
```

---

## ⑤ 节点命令接口（`/api/pipeline-templates/:id/steps`，语义变更）

> `git` 节点改为 DB 脚本后，本组接口增加「平台托管」语义：`git` **可读、不可写**。

| 方法 | 路径 | 变更 |
|---|---|---|
| GET | `/api/pipeline-templates/:id/steps` | 响应项新增 `locked: boolean`（true = 平台托管，页面据此渲染只读） |
| GET | `/api/pipeline-templates/:id/steps/:nodeKey` | `nodeKey='git'` 正常返回该行（供 UI 只读展示脚本文本） |
| PUT | `/api/pipeline-templates/:id/steps/:nodeKey` | `nodeKey='git'`（或该行 `locked=true`）→ **400**「节点 git 为平台托管，不可编辑」 |
| DELETE | `/api/pipeline-templates/:id/steps/:nodeKey` | 同上 → 400 |
| POST | `/api/pipeline-templates/:id/steps/:nodeKey/validate` | 不变（仅语法校验，不落库） |

**写入途径**：仅**迁移/seed**（随 console 代码发布，本机与 dev 机各跑一次 → 天然一致）。鉴权沿用控制台 JWT，不暴露 MCP。

**运行期读取路径**：引擎 `executeV5Node` 的 platform/git 分支调 `stepCommands.resolveActions(templateId, 'git')`；为空回退内置 `PullExecutor`。

---

## 配置项（部署前置）

| 位置 | key | dev 值 | 说明 |
|---|---|---|---|
| 配置中心（scope=env, env_id=dev） | `REMOTE_CONSOLE_URL` | `http://{{DEV_HOST}}:6200` | ① 的调用地址 |
| 配置中心（scope=env, env_id=dev） | `REMOTE_GATEWAY_URL` | `https://dev.kedouai.com` | verify 断言的地址 |
| 本机 `.env` | `RELEASE_HOOK_SECRET` | （与 dev 机同值） | HMAC 密钥；不写日志 |
| 本机 `.env` | `PIPELINE_UPLOAD_TARGET` | `local`（**保持**） | 仅作为内置规则兜底，不再决定 dev 走向 |
| DB `deploy_servers` | `dev-default` | `{{DEV_HOST}} / ubuntu / ~/.ssh/id_ed25519_servers / /data/web_system` | 已存在 |

---

## 安全设计汇总

| 面 | 措施 |
|---|---|
| 传输鉴权 | HMAC-SHA256 + 时间窗；密钥仅存 `.env`，不落日志、不入库明文 |
| 幂等 | `deliveryId` 唯一键；重复调用返回 `duplicate=true` 且不新建流水线 |
| 最小权限 | 本机仅需 SSH key 可达 dev 机；**不持有** dev 数据库凭证 |
| 注入防护 | `branch`/`commitId`/`moduleKey` 正则白名单（沿用现有校验） |
| 审计 | 远端 `operator=ci:<source>`；本机流水线 operator 为控制台用户或 agent owner |
| 回滚 | 复用远端 `rollbackOnFailure=previous` 语义；本机 verify 失败即标失败 |

---

## 变更日志

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-11 | v0.1 | 初稿：①/②/③/④ 四组接口 + 配置项 + 安全汇总 |
| 2026-09-11 | v0.2 | ① 明确 `commitId` 本链路必传（缺省触发远端 pull+build 全量路径）；远端行为补充「reuse 命中时内置 pull 被跳过、不切分支」 |
| 2026-09-11 | v0.3 | 新增 ⑤ 节点命令接口语义变更（`git` 落 DB 脚本但 `locked`：GET 返回 `locked`、PUT/DELETE 拒绝、仅迁移 seed 写入） |
| 2026-09-11 | v0.4 | ① `branch` 标为本链路必带；远端行为补「代码确定性：`commitId` 决定代码、`branch` 决定检出名」 |
