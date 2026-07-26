# Whistle 本地开发代理方案

> 目标：统一本地开发域名，消除多端口（5173/5174/3000/3001/3002/3003/3004/3006）导致的跨域、预览、调试问题。

---

## 1. 背景

当前本地开发架构：

| 服务 | 端口 | 说明 |
|------|------|------|
| Portal (Vite) | 5173 | 用户端 |
| Admin (Vite) | 5174 | 管理后台 |
| Gateway | 3000 | 统一入口 + SPA 托管 |
| auth-service | 3001 | 认证 |
| user-service | 3002 | 用户 |
| ai-service | 3003 | AI |
| system-service | 3004 | 系统管理 |
| upload-service | 3006 | 文件上传 |

**痛点：**
- 后端返回的静态资源 URL（如 `/uploads/avatars/xxx.png`）通过 Vite proxy 代理链路长（5173 → 3000 → 3002），调试困难
- 后端若返回绝对 URL 含端口号（如 `http://localhost:3002/xxx`），浏览器直接跨端口访问失败
- 微信 OAuth 回调、第三方登录等场景要求统一域名

**Whistle 解决思路：** 所有服务映射到统一域名 `local.kedouai.com`，浏览器只看到同一个"站点"，Whistle 在底层按规则分发到各端口。

---

## 2. 安装与启动

```bash
# 全局安装
npm i -g whistle

# 启动（默认代理端口 8899，管理界面同端口）
w2 start

# 开机自启（可选）
w2 restart --init
```

启动后：
- 代理地址：`http://127.0.0.1:8899`
- 管理界面：`http://127.0.0.1:8899`

---

## 3. HTTPS 证书（可选，用于微信 OAuth 调试）

微信 OAuth 强制要求 HTTPS 回调域名。Whistle 可自动签发本地信任证书：

```bash
# 安装根证书到系统信任链
w2 ca
```

按提示将 Whistle 根证书安装到 macOS 钥匙串并设为"始终信任"。

---

## 4. 系统代理配置

### 方案 A：全局代理（推荐开发时使用）

macOS：**系统偏好设置 → 网络 → 高级 → 代理**

勾选 **HTTP 代理** 和 **HTTPS 代理**，服务器均填 `127.0.0.1`，端口 `8899`。

不开发时记得关掉，否则断网。

### 方案 B：浏览器插件（推荐）

安装 Chrome 插件 [SwitchyOmega](https://chrome.google.com/webstore/detail/proxy-switchyomega/padekgcemlokbadohgkifijomclgjgif)，新建情景模式：

```
代理协议: HTTP
代理服务器: 127.0.0.1
代理端口: 8899
```

按需一键切换，不影响系统其他网络请求。

---

## 5. 规则配置

打开 `http://127.0.0.1:8899`，进入 **Rules** 页签，创建规则组 `kedouai-local`：

```
# ============================================================
# 科豆 AI · 本地开发 Whistle 规则
# 统一域名: local.kedouai.com
# ============================================================

# ----- 前端页面 -----

# Portal → Vite Dev Server
local.kedouai.com 127.0.0.1:5173  excludeFilter:///(api|uploads|admin|assets|docs|swagger)/

# Admin 后台（Vite base: /admin/）
local.kedouai.com/admin/ 127.0.0.1:5174

# ----- API（全部到 Gateway）-----

local.kedouai.com/api/ 127.0.0.1:3000

# ----- 静态资源 -----

# 上传文件 → user-service（Gateway 实际也转到这里，直连少一跳）
local.kedouai.com/uploads/ 127.0.0.1:3002

# Vite 构建产出 assets（开发时由 Vite server 提供，这里做兜底）
local.kedouai.com/assets/ 127.0.0.1:5173

# ----- 文档 / Swagger -----

local.kedouai.com/docs/ 127.0.0.1:3000
local.kedouai.com/swagger/ 127.0.0.1:3000

# ----- 兜底：SPA 回退 -----

# 未匹配的路径 → Gateway（处理 SPA 路由回退）
local.kedouai.com 127.0.0.1:3000
```

### 规则说明

| 规则 | 作用 |
|------|------|
| `excludeFilter` | Portal 页面请求到 Vite，但 API/静态资源/管理后台路径排除在外 |
| `/admin/` → `:5174` | Admin 的 Vite base 是 `/admin/`，所以按路径前缀匹配 |
| `/api/` → `:3000` | 所有 API 走 Gateway 统一鉴权、路由 |
| `/uploads/` → `:3002` | 直连 user-service，比走 Gateway 少一跳代理 |
| 末尾兜底规则 | 其余请求（如 SPA 路由）走 Gateway 的 SPA 回退逻辑 |

---

## 6. 最终访问方式

| 页面 | 地址 |
|------|------|
| Portal | `http://local.kedouai.com` |
| Admin | `http://local.kedouai.com/admin/` |
| API（通过前端调用） | `http://local.kedouai.com/api/xxx` |
| Swagger 文档 | `http://local.kedouai.com/docs` |

**全部统一在 `local.kedouai.com` 一个域名下，不再有多端口困扰。**

---

## 7. 开发流程

```bash
# 1. 启动 Whistle
w2 start

# 2. 启用系统代理（SwitchyOmega 切到 Whistle 情景模式）

# 3. 启动所有后端服务（PM2 或手动）
cd servers/gateway && npm run start:dev &
cd servers/user-service && npm run start:dev &
# ... 其他服务同理

# 4. 启动前端开发服务器
cd apps/portal && npm run dev &
cd apps/admin-web && npm run dev &

# 5. 打开浏览器访问 http://local.kedouai.com
```

---

## 8. 故障排查

### 页面打不开
```bash
# 检查 Whistle 是否在运行
w2 status

# 查看 Whistle 日志
w2 run    # 前台运行，实时看日志
```

### 某类请求 404
在 Whistle 管理界面 **Network** 页签查看请求详情，确认被哪条规则匹配、转发到了哪里。

### Vite HMR 不生效
Vite 的 WebSocket 热更新走的是 `ws://` 协议。Whistle 默认透传 WebSocket，无需额外配置。

### Admin 页面样式丢失
Admin 的 `base: '/admin/'` 可能导致静态资源路径错误。确认 Vite dev server 直接访问 `http://localhost:5174/admin/` 正常后，Whistle 规则 `/admin/ → :5174` 即可。

---

## 9. 可选增强

### 9.1 手机端调试

手机和电脑连同一 WiFi，手机设置 HTTP 代理为 `电脑IP:8899`，即可在手机上用 `local.kedouai.com` 访问本地服务（需要电脑防火墙允许 8899 端口）。

```bash
# 查看电脑局域网 IP
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### 9.2 模拟生产环境

如果需要完全模拟生产域名 `dev.kedouai.com`：

```
dev.kedouai.com 127.0.0.1:3000
```

把所有请求直接打到 Gateway，Gateway 内部处理 SPA 托管和 API 代理（就像生产环境一样）。适合做上线前最终验证。

### 9.3 Mock API 响应

在 Rules 中添加：
```
local.kedouai.com/api/users/me file://{mockGetUser.json}
```

配合本地 JSON 文件做接口 mock。

---

## 10. 相关链接

- [Whistle 官方文档](https://wproxy.org/docs/)
- [Whistle 规则配置参考](https://wproxy.org/docs/rules/)
- [SwitchyOmega 插件](https://chrome.google.com/webstore/detail/proxy-switchyomega/padekgcemlokbadohgkifijomclgjgif)
