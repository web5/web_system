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
| gateway | 6000 | admin 的 `/api` 代理目标（vite.config 里 `target: localhost:6000`） |
| ai-service | 6003 | Agent run 记录落库 / 列表查询 / Agent 定义管理 |
| ai-agent | 6010 | 合同风险 Agent 编排（推送 run 到 ai-service） |
| MySQL | 3306 | 数据库（web_system 库，存 agent_runs / agent_definitions） |

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

### 一·C 修改微前端页面模块后如何生效（产物 + 版本表）⚠️ 必读

> **通用规则**：`admin` / `portal` / `mcp-admin` 等前端都是**微前端子模块**，由 gateway 的 `__manifest__` 决定加载哪个版本的产物。
> **只改源码、不重新构建产物，页面不会更新**（浏览器仍加载旧版本 `static/modules/<module>/<旧hash>/index.js`）。

**改动前端后，要看到生效必须走完整四步**（`<module>` 换成 admin / portal / mcp-admin）。这是经真实踩坑验证的可靠流程，请整段照抄：

```bash
# ===== 第 1 步：构建微前端产物（新版本号 = git short hash）=====
cd apps/<module>                            # 如 apps/admin 或 apps/portal
V=$(git -C ../.. rev-parse --short HEAD)    # 或手动指定，如 8f3a1c2
RELEASE_TAG=$V MF_FORMAT=system npx vite build --mode mf
# 产物输出到 apps/<module>/dist/（index.js / index.css / 各路由 chunk）

# ===== 第 2 步：拷贝到 gateway 静态目录（nginx 直出位置）=====
mkdir -p ../gateway/public/static/modules/<module>/$V
cp -r dist/* ../gateway/public/static/modules/<module>/$V/

# ===== 第 3 步：更新数据库版本表（关键！在 web_system_deploy 库）=====
# ⚠️ 版本表在 web_system_deploy 库，不是 web_system 库！
#    gateway 的 deploy 模块用独立数据源连接 DEPLOY_DB_NAME（默认 web_system_deploy）。
#    表：deploy_deployments；实体：servers/gateway/src/deploy-version/deploy-deployment.entity.ts
# 本地无 mysql CLI 时，用 node 脚本（根目录跑，能 require mysql2）：
cat > .tmp-deploy.cjs <<'EOF'
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '<DB密码>', database: 'web_system_deploy' });
  const [rows] = await c.execute('SELECT * FROM deploy_deployments WHERE env_id=? AND module_key=?', ['dev', '<module>']);
  if (rows.length) await c.execute('UPDATE deploy_deployments SET current_version=?, status=?, deployed_at=NOW() WHERE env_id=? AND module_key=? ORDER BY deployed_at DESC LIMIT 1', ['<V>', 'deployed', 'dev', '<module>']);
  else await c.execute('INSERT INTO deploy_deployments (id, env_id, module_key, current_version, status, deployed_at) VALUES (UUID(), ?, ?, ?, ?, NOW())', ['dev', '<module>', '<V>', 'deployed']);
  await c.end(); console.log('版本表更新完成');
})();
EOF
node .tmp-deploy.cjs && rm -f .tmp-deploy.cjs

# ===== 第 4 步：验证 + 清缓存 =====
sleep 12   # gateway 有 TTL 10s 版本缓存，先等它失效
curl -s http://localhost:6000/__manifest__          # 看 <module> 的 version 是否变成 <V>
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:6000/static/modules/<module>/<V>/index.js   # 应为 200
# 若 manifest 仍是旧版本：重启 gateway 清内存缓存 → pm2 restart web-gateway
```

**要点 / 踩坑记录**：
- **版本表在 `web_system_deploy` 库**（gateway 独立数据源 `deploy`），写错库（如写进 `web_system`）manifest 不会变，这是最容易踩的坑。
- `RELEASE_TAG` 必须是**新值**（不能复用旧 hash），否则产物覆盖旧目录、entry 不变，浏览器缓存可能拉到旧的。
- 模块 JS/CSS 由 nginx `/static/modules/` 直出（带 hash 强缓存 1 年）；版本目录名一变，manifest 的 entry 变，浏览器即拉新版，无需清浏览器缓存。
- **gateway TTL 10s 版本缓存**：改完表后最多 10s manifest 自动刷新；若 12s 后仍旧，`pm2 restart web-gateway` 清内存缓存兜底。
- **DB 密码**：本地 MySQL `root/KedouLocal@2026`（见各服务 `.env`）。生产走 deploy-console 正常发布流程，勿手改。
- **AI 智能体铁律**：改完任何微前端前端源码（admin/portal/mcp-admin）后，必须执行上述「构建 → 拷贝 → 更新版本表（web_system_deploy 库）→ 验证/清缓存」四步，不能只改源码就宣称已生效。

**当前微前端模块**：`shell`（基座，非业务）、`admin`、`portal`、`mcp-admin`。它们的 vite 配置统一走 `scripts/vite-micro-frontend.mjs` 的 `microFrontendConfig({ name })`（`mode=mf` 分支），产物结构一致。

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
| **Agents 概览** | `http://localhost:5174/admin/agents` |
| **Agent 对话记录** | `http://localhost:5174/admin/agents/runs/:agentId` |
| **Run 详情** | `http://localhost:5174/admin/agents/runs/:agentId/run/:id` |
| **Agent 定义管理** | `http://localhost:5174/admin/agents/definitions` |
| 系统设置 | `http://localhost:5174/admin/settings` |

> 反例（会 404）：`/agents`、`/users` 等不带 `/admin/` 的路径。

---

## 三、Agent 调试模块（概览 → 对话记录 → 详情）

Agents 模块是**两级导航**，展示 agent 运行的完整审计记录（systemPrompt 原文快照 / 工具调用链 / finalAnswer），用于调 prompt 与排查 LLM 输出。

| 页面 | 文件 | 说明 |
|---|---|---|
| Agent 概览 | `views/Agents/AgentOverview.vue` | 按业务场景分组的 agent 卡片（中文名 + id + 次数/错误数），点击进入对话记录 |
| Agent 对话记录 | `views/Agents/AgentRuns.vue` | 单个 agent 的所有 run，分页 + 过滤（Agent/用户/状态/关键字），行内「原始数据」→ 详情 |
| Run 详情 | `views/Agents/AgentRunDetail.vue` | 完整原始数据：systemPrompt / userInput / 步骤流水 / finalAnswer |
| Agent 定义管理 | `views/Agents/AgentDefList.vue` | 配置化维护 agent（systemPrompt/模型/工具/记忆），支持发布/版本回滚 |

**合同特有字段（loanPlan / optimize / askableQuestions 等）不硬编码在此模块**——页面只读通用字段（agentId / steps / finalAnswer），合同内容是"数据"而非"界面结构"。

### 业务场景映射

agents 概览按"业务场景"分组（合同风险 / 学习助手 / AI 创作 / 其他），场景映射维护在
`apps/admin/src/views/Agents/AgentOverview.vue` 的 `AGENT_SCENE_MAP`：

```ts
const AGENT_SCENE_MAP: Record<string, string> = {
  'contract-risk': '合同风险',
  'study-assistant': '学习助手',
  bianbian: 'AI 创作',
};
```

新增 agent 时在此登记一行即可让概览页按场景分组。

---

## 四、常见操作

| 操作 | 做法 |
|---|---|
| 排查合同分析结果为空 | `/admin/agents/runs/:agentId/run/:id` 看 `AI 最终输出` 原文，确认 LLM 是否输出了 signals/rights |
| 看工具调用链 | Run 详情的 `步骤流水`，看 contract-rule/irr/benchmark 各返回了什么 |
| 调 prompt | **DB 优先**：在 `/admin/agents/definitions` 编辑对应 agent 的 systemPrompt → 发布（≤30s 生效）；也可改 `servers/ai-agent/src/contract/agents/contract-risk.agent.ts` 代码兜底 |
| 加新场景分组 | 改 `AgentOverview.vue` 的 `AGENT_SCENE_MAP` |
| **改 admin 前端页面后更新** | 见 §一·C（构建微前端产物 → 拷贝 → 更新版本表） |

> ⚠️ **AI 智能体铁律**：改完 admin/portal 前端源码后，必须按 §一·C 执行「构建 → 拷贝 → 更新版本表」三步，否则页面不生效。
