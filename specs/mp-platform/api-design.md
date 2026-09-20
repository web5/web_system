# 接口契约 · 小程序研发管理平台（mp-platform）

> 状态：**设计确认稿（2026-09-17）**｜配套设计：`./design.md`
> 上游来源：《小程序研发管理平台 · 工程落地技术方案》v2.0 §10「API 完整清单」
> 范围：`servers/mp-platform` 全部 REST 接口（含 1 个无鉴权微信回调）
> 变更日志：
> - 2026-09-17 初稿：前缀从 `/api/*` 改为 `/api/mp/*`（经 gateway）；鉴权统一为 IAM JWT + `system=deploy`；明确「已实现」的接口需并入后复验。

---

## 1. 前缀、鉴权与总则

| 项 | 约定 |
|---|---|
| 服务内路由 | **无全局前缀**（与 ai-service 一致），控制器直接 `/miniapps`、`/pipelines`… |
| 对外前缀 | `/api/mp/*` → gateway(6000) 反代 → `6100`，`pathRewrite: ^/api/mp → ''` |
| 微信回调 | `/wx/component/event` → **nginx 直出 6100**，不经 gateway、不挂 JWT（见 §6） |
| 鉴权 | 统一 IAM JWT（`Authorization: Bearer <token>`，`JWT_SECRET` 与 auth-service 同源），且 payload `systems` 必须含 `deploy` |
| 权限码 | **不新增 `mp:*`**（决策 D4）。高危动作靠审计留痕 |
| 审计 | 授权 / 提交代码 / 提审 / 发布 / 灰度 / 回滚 / 域名同步 / 绑定变更 —— 全部写 `mp_audit_log` |
| 响应包装 | 沿用仓库现状：直接返回业务对象（不额外包 `{code,data}`）；错误走 HTTP 状态码 + `{message}` |
| 分页 | 列表默认 `?page=1&pageSize=20`，返回 `{ items, total, page, pageSize }`（M0 若不一致，以并入后统一为准） |

---

## 2. 路由总览

### 2.1 已实现 ✅（M0，并入后需复验）

| 方法 | 服务内路径 | 对外路径 | 说明 |
|---|---|---|---|
| GET | `/miniapps` | `/api/mp/miniapps` | 资产列表（支持 `status` 筛选；**已去掉 tenantId 维度**，见 design D3） |
| GET | `/miniapps/:id` | `/api/mp/miniapps/:id` | 详情 |
| GET | `/miniapps/authorize-url` | `/api/mp/miniapps/authorize-url` | 生成第三方平台授权页 URL |
| POST | `/miniapps/authorize-callback` | `/api/mp/miniapps/authorize-callback` | 提交 `auth_code` 完成授权 |
| GET | `/miniapps/health/wechat` | `/api/mp/miniapps/health/wechat` | ticket + token 健康检查 |
| GET/POST | `/wx/component/event` | **nginx 直出** | 微信授权事件接收（GET 校验 / POST 推送） |

### 2.2 待实现 ⬜

**模板**：`GET /templates/drafts`（草稿箱）· `POST /templates/drafts/:draftId/to-template`（转模板）· `GET /templates`（模板库）· `DELETE /templates/:templateId` · `GET /templates/:id/ext-schema`（可覆盖字段定义）

**配置**：`GET|POST /miniapps/:id/ext-configs` · `PUT /ext-configs/:id` · `POST /ext-configs/:id/validate`（白名单校验）· `GET /ext-configs/:id/preview`（合成后的最终 `ext_json`）

**流水线**：`GET|POST /pipelines` · `GET /pipelines/:id`（含步骤）· `POST /pipelines/:id/commit` · `GET /pipelines/:id/qrcode` · `POST /pipelines/:id/submit-audit` · `POST /pipelines/:id/refresh-audit` · `POST /pipelines/:id/undo-audit` · `POST /pipelines/:id/release` · `POST /pipelines/:id/gray-release` · `POST /pipelines/:id/revert` · `POST /pipelines/:id/set-visit-status`

**服务与域名**：`CRUD /connectors` · `POST /connectors/:id/test` · `GET|POST /miniapps/:id/bindings` · `GET /miniapps/:id/bindings/preview-ext` · `GET|POST|DELETE /miniapps/:id/domains` · `POST /miniapps/:id/domains/sync`

**治理**：`GET /quota` · `GET /miniapps/:id/illegal-records` · `GET /audit-logs`

> ⚠️ 所有对外路径都加 `/api/mp` 前缀（上表省略）。

---

## 3. 关键数据结构

```ts
/** 小程序资产（双轨） */
interface MpAppDto {
  id: number;
  appid: string;
  name: string;
  mode: 'authorize' | 'secret';      // 授权模式 / 密钥模式
  authStatus: 'authorized' | 'cancelled' | 'pending';
  owner?: string;                     // 负责人（替代 tenant 归属，见 design D3）
  status: 'active' | 'disabled';
  lastReleaseAt?: string;
  createdAt: string;
}

/** 发布单（状态机见 design → 上游 §7.1） */
interface MpReleaseOrderDto {
  id: number;
  appId: number;
  templateId: number;
  env: 'dev' | 'staging' | 'prod';
  version: string;                    // user_version，commit 幂等键
  status:
    | 'draft' | 'committed' | 'commit_failed'
    | 'audit_submitted' | 'audit_approved' | 'audit_rejected' | 'audit_withdrawn'
    | 'released' | 'graying' | 'gray_cancelled' | 'reverted';
  steps: MpReleaseStepDto[];          // 步骤时间线
}

interface MpReleaseStepDto {
  step: 'commit' | 'submit_audit' | 'release' | 'gray_release' | 'revert' | string;
  status: 'running' | 'success' | 'failed';
  requestBody?: unknown;              // ⚠️ 微信原始请求，排障必留
  responseBody?: unknown;             // ⚠️ 微信原始响应，排障必留
  durationMs?: number;
  createdAt: string;
}
```

---

## 4. 接口明细（挑 6 个关键契约写清）

### 4.1 `GET /api/mp/miniapps/authorize-url`

- 权限：JWT（`systems` 含 `deploy`）
- 响应：`{ url: string }` —— 第三方平台授权页地址
- 前端：跳转该 URL → 用户扫码授权 → 微信回调 `/wx/component/event`（`InfoType=authorized`）入库

### 4.2 `POST /api/mp/miniapps/authorize-callback`

- 请求：`{ authCode: string }`
- 语义：用 `auth_code` 换 `authorizer_access_token` + `refresh_token` 并入库（**refresh_token 必须加密落库**）
- ⚠️ 失败不得返回微信原文报错给前端（可能含 token 片段），只回状态与错误码

### 4.3 `POST /api/mp/pipelines/:id/commit`

- 请求：`{ userVersion?: string }`（缺省用发布单 version）
- 语义：`wxa/commit`（授权模式传 `template_id`；密钥模式走 `ci.upload()`）
- 幂等：**相同 `user_version` 重试在微信侧幂等**（上游 §7.2）
- 响应：`{ status: 'committed', qrcodeUrl?: string }`

### 4.4 `GET /api/mp/pipelines/:id/qrcode`

- 响应：`image/png` 或 `{ url }`（实现二选一，需固定契约）
- 用途：拉体验版二维码给业务方人工验证（提审前必做）

### 4.5 `POST /api/mp/ext-configs/:id/validate`

- 请求：`{ extJson: object }`
- 响应：`{ ok: boolean, errors: string[] }`（顶层字段白名单：`extEnable / extAppid / ext / pages / window / tabBar / networkTimeout / plugins / resizable`）
- ⚠️ 白名单必须以**字段穷举实测**为准（上游 §6.3），不要照抄上游示例；非法字段会让 `commit` 报模糊错误

### 4.6 `POST /api/mp/miniapps/:id/domains/sync`

- 语义：把 `mp_domain` 中 `status=pending` 的域名调 `wxa/modify_domain_directly` 同步，成功后回写 `synced_at`
- ⚠️ 用 `directly` 版本（不走第三方平台域名池），否则会踩「服务商侧删域名导致小程序发布时域名被移除」（上游 §8.3 风险 6）

---

## 5. 错误、幂等与重试约定

| 场景 | 约定 |
|---|---|
| token 失效（`errcode ∈ {40001, 40014, 42001, 42007, 42009}`） | 强制刷新后**重试一次**（封装在 `withAuthorizerToken` 内，业务禁止裸调） |
| 网络抖动 | 指数退避重试 3 次（`WechatHttpService` 已实现） |
| 重复提审 | 先查 `get_latest_auditstatus`，已在审核中则跳过（不报错） |
| 审核轮询 | 间隔 **≥5 分钟**（避免限流）；前端轮询走 `refresh-audit` |
| 微信原始报文 | **必须落 `mp_release_step`**（request/response），这是唯一可排障依据 |
| 回滚 | `revertCodeRelease` 回到上一线上版本；失败不自动重试，需人工介入并记审计 |

---

## 6. 网关与 nginx 配置要点

| 项 | 配置 |
|---|---|
| gateway | 新增 `mpProxy`：目标 `MP_PLATFORM_URL`（默认 `http://localhost:6100`），`pathRewrite: ^/api/mp` → ``，超时用默认档（提审轮询类接口在 `refresh-audit` 单次调用内，不阻塞连接） |
| 路由绑定 | `@All('mp')` + `@All('mp/:path(*)')`（与现有 `/api/ai`、`/api/ai-agent` 同构） |
| nginx | `location ^~ /wx/component/event { proxy_pass http://127.0.0.1:6100; }` —— 必须**不加** JWT、**不改写**路径 |
| 前端 | 只调 `/api/mp/*`（禁直连 6100），与仓库铁律一致 |

---

## 7. 待确认（3 条）

| # | 问题 | 影响 |
|---|---|---|
| Q1 | `GET /pipelines/:id/qrcode` 返回 `image/png` 还是 `{url}`（M0 无此接口，需定死） | 前端实现方式 |
| Q2 | 列表响应用 `{items,total,page,pageSize}` 还是裸数组（仓库内两种都有） | 前端分页组件 |
| Q3 | 提审类接口的单次 HTTP 超时（微信侧偶尔 >30s），是否需要在 mp 侧改为「异步任务 + 轮询步骤」 | 前端交互与错误率 |
