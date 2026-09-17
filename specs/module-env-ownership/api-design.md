# 接口契约 · 模块 × 环境（1:N 改造）

> 状态：**P0 已实现**（2026-09-15）｜配套设计：`./design.md`
> 实现偏差（已落地为准）：`GET /environments` 不传参时返回**按 id 去重的环境字典**（`{id,name,publicUrl,builtin,moduleCount}`），而非全量行 —— 这样审计/通知等纯筛选下拉无需改动；按环境 id 取跨模块全部行的能力由 `list({id})` 在服务层提供（monitor 用）。
> 范围：`servers/deploy-console/src/environment/*` 全部 REST 接口（仅控制台 JWT，不暴露 MCP）

---

## 1. 路由总览

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| GET | `/modules/:key/environments` | **新增（P0）** | 某模块的环境列表（主入口） |
| POST | `/modules/:key/environments` | **新增（P0）** | 在该模块下新建环境 |
| PUT | `/modules/:key/environments/:envId` | **新增（P0）** | 更新该模块的某环境 |
| DELETE | `/modules/:key/environments/:envId` | **新增（P0）** | 删除该模块的某环境 |
| GET | `/environments?moduleKey=` | 保留（P0 起只读） | **不传 moduleKey → 环境字典（按 id 去重，含 `moduleCount`**，供审计/通知等筛选下拉）；传了则返回该模块的环境行 |
| POST/PUT/DELETE | `/environments`、`/environments/:id` | **废弃（P0 起返回 410，P2 删除）** | 写操作一律走模块子资源 |

> 为什么不沿用 `/environments/:id?moduleKey=`：环境 id 不再全局唯一，`/environments/:id` 本身语义已不成立；子资源路径让「环境属于模块」在 URL 上可见，也避免旧客户端误用。

---

## 2. 数据结构

```ts
interface ModuleEnvDto {
  moduleKey: string;      // 所属模块
  id: string;             // 环境 id（模块内唯一，如 dev/prod/staging）
  name: string;           // 展示名
  publicUrl?: string;     // 公网地址（每模块可覆盖）
  address?: string;       // 服务地址 host:port 或域名（backend 才有；留空 = 不在本环境部署）
  serverName?: string;    // 服务器组
  port?: number;          // 覆盖组内端口
  builtin: boolean;       // dev/prod，不可删
  createdAt: string;
  updatedAt: string;
}
```

---

## 3. 接口明细

### 3.1 `GET /modules/:key/environments`

- 权限：控制台 JWT
- 响应：`ModuleEnvDto[]`，按 `builtin DESC, id ASC`
- 空态：模块存在但无环境 → `[]`（前端提示「该模块还没有环境」）

### 3.2 `POST /modules/:key/environments`

请求体：

```jsonc
{
  "id": "staging",              // 必填，模块内唯一
  "name": "预发环境",            // 必填
  "publicUrl": "https://...",   // 可选
  "address": "127.0.0.1:6000",  // 可选（backend 模块）
  "serverName": "dev-default",  // 可选
  "port": 6000,                 // 可选
  "copyFrom": "dev"             // 可选：复制本模块已有环境的 address/serverName/publicUrl 作初值
}
```

- 201 → `ModuleEnvDto`
- 409 `环境已存在: {id}`（同模块同 id）
- 404 `模块不存在: {key}`
- 400 缺少 `id` / `name`

### 3.3 `PUT /modules/:key/environments/:envId`

- 可改：`name` / `publicUrl` / `address` / `serverName` / `port`
- 不可改：`id`（主键的一部分）、`moduleKey`
- 200 → `ModuleEnvDto`；404 模块或环境不存在

### 3.4 `DELETE /modules/:key/environments/:envId`

- `builtin=true` → 400 `内置环境不可删除`
- 删除前统计关联（`deploy_deployments` / `deploy_env_service_routes` / `deploy_canary_rules` / `deploy_versions`），响应体带出：

```json
{ "ok": true, "cascade": { "deployments": 2, "routes": 1, "canaryRules": 0, "versions": 5 } }
```

> 本期**不做物理级联**（design.md Q6）：接口只统计并如实返回，前端弹二次确认展示「将留下 N 条历史记录」。

### 3.5 `GET /environments`（只读聚合，兼容期）

| 参数 | 说明 |
|---|---|
| `moduleKey` | 过滤某模块（等价 3.1） |
| `id` | 按环境 id 跨模块聚合（如 `id=dev` 返回所有模块的 dev 行） |
| 都不传 | 返回全部（含 `moduleKey`，供审计日志等纯筛选场景按 `id` 去重） |

**不返回** `ports` 字段（废弃中），只读 `address`。

---

## 4. 服务层签名变更

| 现状 | 改造后 |
|---|---|
| `list()` | `list(opts?: { moduleKey?: string; id?: string })` |
| `get(id)` | `get(moduleKey: string, id: string)` |
| `create(dto)` | `create(moduleKey: string, dto)` |
| `update(id, dto)` | `update(moduleKey: string, id: string, dto)` |
| `remove(id)` | `remove(moduleKey: string, id: string)` |

新增：`ensureModuleEnvs(moduleKey)` —— 新建模块后懒补 `dev` / `prod` 两条内置环境（design.md Q3）。

---

## 5. 前端调用改动

| 位置 | 改动 |
|---|---|
| `api/index.ts` | `environmentApi` 全部方法加 `moduleKey`；`listByModule(key)` / `copyFrom` 支持 |
| `components/EnvManagerPanel.vue` | 列表/表单改为模块内环境；删 `buildPortsFromEnv`（ports 映射），`base 环境` 改为 `copyFrom`（复制本模块某环境） |
| `views/ModuleDetail.vue` | 「服务环境」Tab → 本模块环境列表，直接调子资源接口增删改 |
| `views/ServiceManager.vue` | 「环境管理」抽屉：先选模块，再管该模块环境 |
| 各环境下拉 | 绑定模块的场景用 `listByModule`；纯筛选（审计日志/通知）用 `GET /environments` 按 `id` 去重 |

---

## 6. 兼容与灰度

1. P0 上线后旧写接口返回 `410 Gone` + `message: 请改用 /modules/:key/environments`，避免静默写错；
2. 只读聚合接口继续服务旧前端一个发布周期；
3. P2 删除旧路由与 `ports` 字段。
