# Admin Web（管理后台）开发指南

> 面向：需要启动 / 调试 / 扩展 admin 后台的开发者（含 AI 编程助手）。
> 目的：让"启动 admin + 访问调试页"这类高频操作，不需要翻代码就能一次跑对。

---

## 一、如何启动 admin

```bash
cd apps/admin
pnpm install        # 首次
pnpm dev            # 启动 vite dev server → http://localhost:5174
```

> 生产构建：`pnpm build`（走 `vue-tsc -b && vite build`）。

### 前置依赖

admin 只是**前端**，页面数据依赖后端 API（经 gateway 代理）。要看到真实数据，需先起后端链路：

| 依赖 | 端口 | 说明 |
|---|---|---|
| gateway | 3000 | admin 的 `/api` 代理目标（vite.config 里 `target: localhost:6000`） |
| ai-service | 3003 | Agent run 记录落库 / 列表查询 |
| ai-agent | — | 合同风险 Agent 编排（推送 run 到 ai-service） |
| PostgreSQL / MySQL | — | 数据库 |

> ⚠️ 全栈一键启动见 `docs/development/local-dev-setup.md` 或根目录 `start-local.sh`。

### 运行形态二选一

| 形态 | 方式 | 访问地址 |
|---|---|---|
| **A. vite dev（推荐开发）** | `cd apps/admin && pnpm dev` | `http://localhost:5174/admin/` |
| **B. 本地 nginx 集成** | 见下文 §一·B | 见 §一·B |

> 说明：本文档面向 admin，但"本地启动速查"覆盖全部前端。portal 启动方式见下。

> ⚠️ **重要：admin 是微前端子模块，不是独立应用**
> admin 的 `main.ts` 只导出 `lifecycle`（bootstrap/mount/unmount），**必须由 shell 基座挂载才会渲染**。
> - 直接访问 admin 的 vite dev（`http://localhost:5174/admin/`）会**白屏**，因为没人调用它的 `mount()`。
> - **纯看页面 / 验证功能**：直接用 nginx 集成地址 `https://local.kedouai.com/admin/`（见 §一·B），**不需要**启动 shell dev(5180)。
> - **单独改 admin 代码做热更新**：才需要走 dev 集成（见下方 §一·B-1）。

---

## 一·A 本地 portal 启动方式（少儿教育门户）

> portal 是另一个前端（少儿教育门户，非 admin）。若你同时开发 portal，用此方式。

```bash
cd apps/portal
pnpm dev        # → http://localhost:5173/portal/
```

**关键点**：
- **base 是 `/portal/`**：访问 URL 必须带 `/portal/` 前缀（如 `http://localhost:5173/portal/`），与 admin 的 `/admin/` 同理。
- **代理**：`/api`、`/materials` → 本地 gateway(6000)；`/api/ai/tts` → ai-service(6003)。
- **微前端模式**：portal 默认 standalone 独立运行；若要打成微前端模块（UMD + externals），用 `pnpm build --mode mf`（对应 `scripts/vite-micro-frontend.mjs`）。

---

## 一·B 本地 nginx 集成形态（静态托管 + 反代）

用本地 nginx 托管前端构建产物、反代 `/api`，与生产架构一致。适合联调微前端 / 验证部署形态。

### 前置
1. 后端服务已启动：gateway(6000) auth(6001) user(6002) ai(6003) system(6004) todo(6005) mcp-gateway(6006) finnews(6007) upload(6008)
2. 前端已构建：`cd apps/admin && npx vite build`（及 portal/mcp-admin 按需）

### nginx 配置引入（已配置好，无需重复做）
- nginx 主配置 `~/local/nginx/conf/nginx.conf` 里 `include conf.d/*.conf`
- `conf.d/web_system-local.conf` 已 include 工程根目录的 `local.nginx.conf`
- 若重装 nginx，按上面两步重建即可

### 启动 / 重载
```bash
# 首次启动（80/443 需 root）
sudo /Users/geekwen/local/nginx/sbin/nginx

# 改配置后重载
sudo /Users/geekwen/local/nginx/sbin/nginx -s reload

# 校验配置（改配置前必跑）
/Users/geekwen/local/nginx/sbin/nginx -t
```

### 访问地址（需 /etc/hosts 加域名映射）
| 域名 | 用途 |
|---|---|
| `https://local.kedouai.com/admin/` | 管理后台（主入口 80/443） |
| `http://admin.kedouai.com:8082/` | admin 独立静态托管 |
| `https://local.kedouai.com/api/*` | API（反代 gateway 6000） |

> `local.kedouai.com` 等域名需在 `/etc/hosts` 指向 `127.0.0.1`。

> ⚠️ **必须信任自签证书，否则 admin 白屏/页面无响应**：
> `local.kedouai.com` 走 HTTPS，且响应带 HSTS（强制升级 HTTPS）。若浏览器不信任 `dev.kedouai.com.crt`，会 `ERR_CERT_AUTHORITY_INVALID` 导致 shell 资源加载失败 → 白屏或"页面无响应"。
> 一次性信任（macOS）：
> ```bash
> sudo security add-trusted-cert -d -r trustRoot \
>   -k /Library/Keychains/System.keychain \
>   /Users/geekwen/local/nginx/conf/ssl/dev.kedouai.com.crt
> ```
> 信任后 `https://local.kedouai.com/admin/` 正常（未登录会跳 `/login?redirect=/admin/`，登录即可）。

### 本配置要点（`local.nginx.conf`）
- admin 的 base 是 `/admin/`，nginx 通过 `rewrite ^/admin/(.*)$ /$1` 去前缀映射到 `apps/admin-web/dist`
- `/api`、`/mcp` 分别反代到本地 gateway(6000)、mcp-gateway(6006)
- SSE 流式：`proxy_buffering off` + `proxy_read_timeout 180s`（合同分析流式输出依赖此配置，否则会被 nginx 缓冲截断）

### §一·B-1 admin dev 集成（改 admin 代码热更新）

> admin 是纯微前端模块（无 standalone 渲染入口）。本地改 admin 源码做热更新时，需让 shell 从**本地 dev server** 加载 admin，而不是 gateway manifest 注入的生产产物 entry（`/static/modules/admin/<version>/index.js`）。

关键：让 `__MODULES_MANIFEST__` 里 admin 的 `entry` 指向本地 vite dev（`http://localhost:5174/assets/index.js`）。

| 场景 | 做法 |
|---|---|
| **纯看页面 / 验证功能** | 直接访问 nginx 集成 `https://local.kedouai.com/admin/`，**不需要** dev 集成 |
| **改 admin 源码热更新** | 覆盖 manifest 的 admin entry 指向 5174（gateway manifest 由 DB 驱动，需在 shell 侧覆盖或临时改 gateway 模块 entry），属进阶配置按需处理 |

---

## 二、关键路由前缀（重要，别搞错）

**admin 的路由 base 是 `/admin/`**（`apps/admin/src/router/index.ts` 的 `createWebHistory('/admin/')`）。

因此所有前端页面 URL 必须带 `/admin/` 前缀，**不带会 404**：

| 模块 | 正确 URL |
|---|---|
| 工作台 | `http://localhost:5174/admin/dashboard` |
| 用户管理 | `http://localhost:5174/admin/users` |
| MCP 管理 | `http://localhost:5174/admin/mcp` |
| 变变管理 | `http://localhost:5174/admin/bianbian` |
| **Agent 运行记录** | `http://localhost:5174/admin/agents` |
| **Run 详情** | `http://localhost:5174/admin/agents/:id` |
| 系统设置 | `http://localhost:5174/admin/settings` |

> 反例（会 404）：`/agents`、`/users` 等不带 `/admin/` 的路径。

---

## 三、Agent 调试页（合同风险场景）

`/admin/agents` 是通用的 Agent Run 调试页，展示某次 agent 运行的完整审计记录（systemPrompt 原文快照 / 工具调用链 / finalAnswer），用于调 prompt 与排查 LLM 输出。

**合同特有字段（loanPlan / optimize / askableQuestions 等）不硬编码在此页**——页面只读通用字段（agentId / steps / finalAnswer），合同内容是"数据"而非"界面结构"。

### 按场景筛选

左栏 agents 列表按"业务场景"分组（合同风险 / AI 创作 / 其他），场景映射维护在
`apps/admin/src/views/Agents/AgentList.vue` 的 `AGENT_SCENE_MAP`：

```ts
const AGENT_SCENE_MAP: Record<string, string> = {
  'contract-risk': '合同风险',
  bianbian: 'AI 创作',
};
```

新增 agent 时在此登记一行即可让调试页按场景分组/筛选。

---

## 四、常见操作

| 操作 | 做法 |
|---|---|
| 排查合同分析结果为空 | 打开 `/admin/agents/:id` 看 `AI 最终输出` 原文，确认 LLM 是否输出了 signals/rights |
| 看工具调用链 | `/admin/agents/:id` 的 `步骤流水`，看 contract-rule/irr/benchmark 各返回了什么 |
| 调 prompt | 改 `servers/ai-agent/src/contract/agents/contract-risk.agent.ts`，再用调试页看 prompt 快照 |
| 加新场景分组 | 改 `AgentList.vue` 的 `AGENT_SCENE_MAP` |
