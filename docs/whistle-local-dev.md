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
- 后端返回的静态资源 URL（如 `/api/uploads/avatars/xxx.png`）通过 Gateway 统一代理，架构一致
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
# 原则：精确路径优先，无需 excludeFilter
# ============================================================

# ----- Admin 后台（注意：不带斜杠，同时匹配 /admin 和 /admin/*）-----
local.kedouai.com/admin    127.0.0.1:5174

# ----- API → Gateway -----
local.kedouai.com/api/     127.0.0.1:3000

# ----- 构建产物 assets -----
local.kedouai.com/assets/  127.0.0.1:5173

# ----- 文档 / Swagger -----
local.kedouai.com/docs/    127.0.0.1:3000
local.kedouai.com/swagger/ 127.0.0.1:3000

# ----- Portal 兜底（Vite dev server 自带 SPA 回退）-----
local.kedouai.com          127.0.0.1:5173
```

### 规则说明

| 规则 | 作用 |
|------|------|
| `/admin` → `:5174` | 匹配 `/admin` 和 `/admin/*`，统一走 Admin Vite |
| `/api/` → `:3000` | 所有 API 走 Gateway 统一鉴权、路由 |
| `/assets/` → `:5173` | 构建产物由 Vite dev server 提供 |
| `/docs/` `/swagger/` → `:3000` | API 文档走 Gateway |
| 末尾兜底 → `:5173` | 其余所有请求走 Portal（含 SPA 路由回退） |

### 为什么不使用 excludeFilter？

旧方案用 `excludeFilter:///(api|uploads|admin|assets|docs|swagger)/` 排除特定路径，但这个正则会误杀包含这些**子串**的模块请求（如 ant-design-vue 内部路径含 `assets`），导致 Vite 模块被错误转发到 Gateway，Gateway 返回 `text/html` 触发浏览器 MIME 类型报错。

新方案利用 **Whistle 规则优先级**：更精确的路径（`/admin`、`/api/`）自动覆盖模糊的兜底规则，完全不需要 `excludeFilter`。

---

## 6. Vite 配置要求

两个前端项目需要确保 Vite dev server 正确监听 IPv4（Whistle 通过 `127.0.0.1` 连接）：

```ts
// apps/portal/vite.config.ts 和 apps/admin-web/vite.config.ts
export default defineConfig({
  server: {
    host: true,   // 同时监听 IPv4/IPv6
    allowedHosts: ['local.kedouai.com', 'localhost', '127.0.0.1'],
  },
});
```

### 为什么需要 `host: true`？

Vite 默认只监听 IPv6 `localhost`（`[::1]`）。Whistle 通过 IPv4 `127.0.0.1` 连接后端，两者不匹配 → `ECONNREFUSED`。`host: true` 让 Vite 同时监听 IPv4 和 IPv6。

## 7. 域名解析：为什么不需要 /etc/hosts？

`local.kedouai.com` 是 `.com` 真 TLD，公网 DNS 解析不到。但 **不需要手动加 `/etc/hosts`**：

- 浏览器配置代理后，**直接向代理服务器（Whistle）发送原始主机名**，不走本地 DNS
- Whistle 收到后按规则匹配主机名并转发到正确的本地端口
- **加 `/etc/hosts` 反而有害**：Chrome 的代理绕过列表默认包含 `127.x.x.x`，当 `/etc/hosts` 将域名解析到 `127.0.0.1` 时，Chrome 会绕过代理直连 → `ERR_CONNECTION_REFUSED`

## 8. 最终访问方式

| 页面 | 地址 |
|------|------|
| Portal | `http://local.kedouai.com` |
| Admin | `http://local.kedouai.com/admin/` |
| API（通过前端调用） | `http://local.kedouai.com/api/xxx` |
| Swagger 文档 | `http://local.kedouai.com/docs` |

**全部统一在 `local.kedouai.com` 一个域名下，不再有多端口困扰。**

---

## 9. 开发流程

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

## 10. 故障排查

### 页面打不开

```bash
# 检查 Whistle 是否在运行
w2 status

# 查看 Whistle 日志
w2 run    # 前台运行，实时看日志
```

### `ERR_CONNECTION_REFUSED` 或 `ERR_PROXY_CONNECTION_FAILED`

1. 确认系统代理已开启（**系统偏好设置 → 网络 → 高级 → 代理**，勾选 HTTP 和 HTTPS 代理）
2. 或确认 SwitchyOmega 已切换到 Whistle 情景模式
3. 确认 Vite dev server 使用了 `host: true` 配置
4. **不要加 `/etc/hosts`**：Chrome 默认绕过 `127.x.x.x` 代理，加了反而直连失败

### 模块加载报 MIME type "text/html" 错误

这是 `excludeFilter` 误杀导致的。旧规则中的正则 `(api|uploads|admin|assets|docs|swagger)` 会匹配任意包含这些子串的路径。升级到本文档第 5 节的新规则（去掉 excludeFilter）即可。

### `/admin`（不带斜杠）不工作

Whistle 规则写 `/admin`（不带斜杠）即可匹配 `/admin` 和 `/admin/*`。同时 Portal 路由内置了 `/admin` → `/admin/` 重定向作为兜底。

### 某类请求 404

在 Whistle 管理界面 **Network** 页签查看请求详情，确认被哪条规则匹配、转发到了哪里。

### Vite HMR 不生效

Vite 的 WebSocket 热更新走的是 `ws://` 协议。Whistle 默认透传 WebSocket，无需额外配置。

### Admin 页面样式丢失

Admin 的 `base: '/admin/'` 可能导致静态资源路径错误。确认 Vite dev server 直接访问 `http://localhost:5174/admin/` 正常后，Whistle 规则 `/admin → :5174` 即可。

---

## 11. 可选增强

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

## 12. 相关链接

- [Whistle 官方文档](https://wproxy.org/docs/)
- [Whistle 规则配置参考](https://wproxy.org/docs/rules/)
- [SwitchyOmega 插件](https://chrome.google.com/webstore/detail/proxy-switchyomega/padekgcemlokbadohgkifijomclgjgif)
