# MCP 平台服务间鉴权方案

> 记录 mcp-gateway 与 gateway 之间的服务间鉴权：**当前方案（静态共享密钥）** 与 **未来方案（带过期时间的动态登录态）** 两套架构，作为后续改造依据。

---

## 目录

- [1. 背景](#1-背景)
- [2. MCP 平台架构现状](#2-mcp-平台架构现状)
- [3. 当前方案：静态共享密钥（已上线）](#3-当前方案静态共享密钥已上线)
- [4. 未来方案：带过期时间的动态登录态（待改造）](#4-未来方案带过期时间的动态登录态待改造)
- [5. 两方案对比](#5-两方案对比)
- [6. 演进路径](#6-演进路径)

---

## 1. 背景

MCP 平台由三个部分组成：

| 组件 | 角色 | 端口 |
|------|------|------|
| `mcp-gateway` | MCP 工具网关：聚合/分发各微服务的 MCP 工具，对 WorkBuddy 暴露 streamable-http 端点 | 6006 |
| `gateway` | 统一 API 网关：`/api/*` 代理到各微服务 | 6000 |
| `finnews` | 财经资讯微服务（第一个接入的业务） | 6007 |

调用链路中，存在**服务间调用**：mcp-gateway 需要调用 finnews 的 REST 接口。有两种方式：

1. **直连**：mcp-gateway → `http://127.0.0.1:6007`（本机内网，不对外）
2. **经 gateway 代理**：mcp-gateway → `https://dev.kedouai.com/api/finnews/*` → gateway → finnews

采用方式 2 后，服务间调用需要**鉴权**，防止未授权方直接访问 `/api/finnews`。

---

## 2. MCP 平台架构现状

```
WorkBuddy（MCP 客户端）
    │ streamable-http
    ▼
https://dev.kedouai.com/mcp/finnews          ← mcp-gateway 按模块拆路径
    │ nginx 正则 ^/mcp(/.*)?$ 转发
    ▼
mcp-gateway (:6006)
    │ createModuleTransport("finnews")
    │ 声明式 HTTP 模块（base_url + auth）
    ▼
https://dev.kedouai.com/api/finnews/api/market-pulse
    │ nginx 转发
    ▼
gateway (:6000)
    │ /api/finnews 路由 + 鉴权
    │ pathRewrite ^/api/finnews → ''
    ▼
finnews (:6007) /api/market-pulse
```

**关键路由：**

| 路径 | 归属 | 说明 |
|------|------|------|
| `/mcp` | mcp-gateway | 聚合所有启用模块工具 |
| `/mcp/:module` | mcp-gateway | 只暴露指定模块（按 `code_key`），如 `/mcp/finnews` |
| `/api/mcp/*` | gateway 代理 | mcp-admin 管理接口 |
| `/api/finnews/*` | gateway 代理 | finnews 微服务（需鉴权） |
| `/mcp-admin/` | gateway 托管 | mcp-admin 前端 SPA |

---

## 3. 当前方案：静态共享密钥（已上线）

### 3.1 原理

两个进程持有**同一个固定密钥**，请求方加 `Authorization: Bearer <key>` 头，接收方**字符串全等比对**。本质是「门钥匙」，非登录态。

### 3.2 完整链路

```
mcp-gateway                                gateway
    │ ① 数据库 mcp_modules 表：                │
    │    auth_type = 'bearer'                │
    │    auth_config = {"token":"<key>"}      │
    │                                       │
    │ ② 调用工具时 mcp-core 自动加头：          │
    │    Authorization: Bearer <key>         │
    │ ────────────────────────────────────▶  │
    │                                       │ ③ checkServiceAuthAndProxy
    │                                       │    读 FINNEWS_SERVICE_KEY
    │                                       │    比对 header 是否全等
    │                                       │    相等 → 转发 finnews
    │                                       │    不等 → 401
```

### 3.3 代码位置

| 环节 | 文件 | 逻辑 |
|------|------|------|
| 密钥注入 | `ecosystem.config.js` | gateway / mcp-gateway 的 env 块注入 `FINNEWS_SERVICE_KEY` |
| seed 写库 | `servers/mcp-gateway/src/mcp/mcp.service.ts` | `FINNEWS_SERVICE_AUTH_TYPE=bearer` + `FINNEWS_SERVICE_AUTH_CONFIG={"token":...}` |
| 自动加头 | `packages/mcp-core/src/http-adapter.ts:68` | `auth.type === 'bearer'` → `Authorization: Bearer ${auth.token}` |
| 验证 | `servers/gateway/src/proxy/proxy.controller.ts` | `checkServiceAuthAndProxy` 比对 `Bearer ${expected}` |

### 3.4 密钥管理

- 密钥存在 `.env.production` 的 `FINNEWS_SERVICE_KEY`（64 位 hex）
- 通过 `ecosystem.config.js` 的 `process.env.FINNEWS_SERVICE_KEY` 注入两个服务
- 两边读同一个值，天然一致

### 3.5 优缺点

| 优点 | 缺点 |
|------|------|
| 实现简单，零依赖 | 密钥固定，**永不过期** |
| 无状态，无性能开销 | 泄漏后需手动轮换，且无法撤销单个客户端 |
| 无需 Redis/DB | 无身份区分（所有调用方同一个 key） |
| 适合内网/低风险场景 | 无审计（不知谁调的） |

---

## 4. 未来方案：带过期时间的动态登录态（待改造）

> 目标：解决「密钥永不过期、无身份区分、无法吊销」三大问题。

### 4.1 核心思路

从「固定 key」升级为「**客户端凭证 + 短期 access token + 过期管理**」，参考 OAuth2 client credentials 模式。

```
长期凭证（client_secret）     短期凭证（access_token）
   永不过期，存 .env  ──签发──▶  2 小时过期，JWT
   用于「换发」token           用于「调用」接口
```

### 4.2 凭证分层

| 凭证 | 生命周期 | 存储 | 用途 |
|------|---------|------|------|
| `client_id` + `client_secret` | 长期（轮换周期可配） | `.env` / DB | 换发 access_token |
| `access_token`（JWT） | 短期（如 2h） | 不落库（stateless） | 调用 `/api/*` 服务间接口 |
| `refresh_token`（可选） | 中期（如 7d） | Redis | 续期 access_token |

### 4.3 数据模型

**JWT access_token 的 payload：**

```json
{
  "sub": "mcp-gateway",        // 客户端标识
  "aud": "gateway",            // 目标服务
  "scope": ["finnews"],        // 允许访问的模块
  "iat": 1755000000,
  "exp": 1755007200            // 2 小时后过期
}
```

**Redis 存储（可选，按需启用）：**

| Key | Value | TTL | 用途 |
|-----|-------|-----|------|
| `auth:blacklist:{jti}` | `1` | 直到原 token 过期 | 吊销（登出/轮换） |
| `auth:client:{client_id}` | `{active: true, rotatedAt}` | 长期 | 客户端状态/审计 |
| `auth:access:{client_id}` | `{issuedAt, ip}` | 2h | 活跃会话追踪（可选） |

### 4.4 签发与验证流程

**签发（mcp-gateway 启动时 / 到期前）：**

```
mcp-gateway 启动
  → 用 client_secret 请求 gateway POST /api/auth/service-token
  → gateway 校验 secret，签发 JWT access_token（exp=2h）
  → mcp-gateway 缓存 token，到期前自动续期
```

**验证（每次调用）：**

```
mcp-gateway 调 /api/finnews，带 Authorization: Bearer <JWT>
  → gateway 验 JWT 签名 + exp
  → 校验 aud=gateway、scope 含 finnews
  → 查 Redis 黑名单（可选，用于吊销）
  → 通过则转发，失败则 401
```

### 4.5 过期与轮换

| 场景 | 处理 |
|------|------|
| token 正常过期 | mcp-gateway 提前用 secret 续期（滑动窗口） |
| secret 泄漏 | 轮换 secret，旧 access_token 加入 Redis 黑名单立即失效 |
| 单个客户端下线 | 吊销该 client 的 access_token + 禁用 client 记录 |

### 4.6 多实例支持

- **access_token 是 JWT**：stateless，天然支持 gateway 多实例（无需共享 session）
- **黑名单在 Redis**：多实例共享，吊销即时生效
- **mcp-gateway 的 MCP session**：仍受限于内存 transport，多实例需 sticky session（与鉴权无关，另见 transport 说明）

### 4.7 优点

- ✅ token 有过期时间，泄漏影响窗口受限
- ✅ 支持吊销（黑名单）
- ✅ 区分不同客户端身份（sub/scope）
- ✅ 可审计（记录谁在何时调了什么）
- ✅ JWT stateless，性能开销低

---

## 5. 两方案对比

| 维度 | 当前：静态密钥 | 未来：动态登录态 |
|------|--------------|----------------|
| 凭证类型 | 固定 Bearer key | 短期 JWT access_token |
| 过期 | 永不过期 | 可配置（如 2h） |
| 身份区分 | ❌ 所有调用方同一个 key | ✅ sub/scope 区分 |
| 吊销 | ❌ 只能整体换 key | ✅ Redis 黑名单即时吊销 |
| 审计 | ❌ | ✅ 可记录 |
| 存储依赖 | 无 | Redis（黑名单/会话，可选） |
| 实现复杂度 | 低 | 中 |
| 适用场景 | 内网、低风险、快速落地 | 多客户端、需审计/吊销的生产环境 |

---

## 6. 演进路径

```
阶段 1（当前）      静态共享密钥              ← 已上线
    │
    │  动机：多客户端接入 / 需要吊销 / 审计
    ▼
阶段 2（近期）      动态 JWT access_token     ← 改造目标
                    + client_secret 换发
    │
    │  动机：多实例 / 跨服务会话打通
    ▼
阶段 3（远期）      + Redis 黑名单/会话
                    + 完整 client 管理
```

**改造触发条件**（满足其一即可启动阶段 2）：

1. 接入第二个需要服务间调用的微服务（不只 finnews）
2. 需要区分不同 MCP 客户端身份（不只 WorkBuddy）
3. 出现密钥泄漏风险，需要吊销能力
4. 需要审计「谁在何时调了什么工具」

---

> 文档版本：v1.0
> 更新时间：2026-08-14
> 状态：✅ 阶段 1（静态密钥）已上线，阶段 2（动态登录态）为待改造设计稿
> 关联文档：[技术架构](./技术架构.md) · [网关 URL 规划](./网关URL规划.md)
