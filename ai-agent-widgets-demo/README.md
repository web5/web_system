# SSE 流式 Markdown 内嵌可交互微前端 · 本地可运行 Demo

真实可运行（**不是原型 / 模拟**）的技术验证工程，作为**自包含独立 demo**放在 `web_system` 仓库根的 `ai-agent-widgets-demo/`。核心目标：

> **在 SSE 流式返回的 markdown 正文中间**，通过**微前端机制（System.register / System.import）运行时动态加载**一块**可交互**的页面区块；加载过程可视化、交互肉眼可见。

技术栈：**Vite + Vue3 + TypeScript**，markdown 用 `markdown-it` + `highlight.js`，SSE 用原生 `fetch + ReadableStream`，**零 React 生态、零新增运行时依赖**。

> 本工程只做**本地跑通**（A′ 形态），不参与 `web_system` 的构建 / 部署 / 注册（见 §7、§8）。

---

## 1. 一条命令跑起来

```bash
cd ai-agent-widgets-demo
npm install && npm run dev
```

`npm run dev` 会依次：① `build:widgets` 生成 3 个 System.register 产物 → ② `concurrently` 同时拉起 **mock SSE 服务（8799）** 与 **Vite 前端（5181）**。控制台出现 `[sse]` / `[web]` 双色日志即就绪。

打开 **http://localhost:5181/** → 页面自动开始真 SSE 流式（也可点「开始对话」重跑一轮）。

停止：`Ctrl+C`（concurrently 会同时收掉两个子进程）。也可用 `open "http://localhost:5181/"` 唤起系统默认浏览器。

> 若本机 `NODE_OPTIONS` 挂着 WorkBuddy node shim，导致 node 命令报 `ECONNREFUSED .../broker.sock`，给命令加 `env -u NODE_OPTIONS`（本次实测环境未触发，npm / vite / typecheck / test / build 均直跑成功）。

### 页面观察清单

1. 正文逐字吐出；
2. 中途出现 widget fence（info 为 `widget`），页面显示「⏳ 检测到 widget 声明，等待 JSON 闭合…」；
3. JSON 逐字到达、闭合后，**虚线橙框徽标「微前端子应用 · poll · 已挂载」**出现，右侧加载时序 7 步依次点亮；
4. **后面的文字还在继续逐字吐出**（表格 / 半截代码块 / 引用）；
5. 点子应用 → 立刻在消息流追加「✅ 你在 投票组件 中选择了：X」；
6. 再点「开始对话」重跑一轮 → 上一轮 widget 的选中态 / 输入值**仍在**；
7. 点「清空会话（卸载全部 widget）」→ 时序里出现 `unmount → bus 解绑 → slot 释放`，widget 归零。

---

## 2. 端口表

| 用途 | 端口 | 说明 |
|---|---|---|
| Vite 前端（SPA + 同源 `/agui` 代理） | **5181** | 浏览器访问入口 |
| mock SSE 服务（纯 Node http） | **8799** | 真流式吐 AGUI / SSE 事件 |

**端口选择依据（本机实测）**：

- **已占用、不能碰**：`5173`（原 demo Vite）、`8787`（原 demo mock SSE）、`6003`（ai-service）、`8180`（gateway **实际监听端口**）、`9443`（nginx）；此外 6000 段周边 `6002 / 6004-6011 / 6101 / 6200 / 7000 / 8011 / 5000`，以及 `3306`(MySQL) / `6379`(Redis) / `5432` 都已被 web_system 各服务占用。
- **避开整个 6000 段**：`6000` 字面空闲但不是好选择 —— `servers/gateway/.env:2` 的 `PORT=6000` 只是**配置默认值**，gateway 实跑在 **8180**；且 6000 被 Chromium 硬屏蔽（04-Runbook:100-106），周围端口几乎占满。
- **空闲可用**：`5181`、`8799`（本 demo 选用，已复核）、`5174`、`5180`、`7100`、`7101`、`6000`。`5180` 虽空闲但 shell 配置默认也是 5180，故选 **5181** 避免未来混淆。
- 本 demo 是**增量并存**：不抢占、不 `kill` 别人的进程，两套可同时运行互不干扰。
- A′ 路线**完全不连 gateway**；里程碑二若需连真实 gateway，地址一律写 **`http://localhost:8180`**（不是 6000）。

端口只在两处显式定义且值一致：`vite.config.ts` 用 `process.env.VITE_PORT || 5181`（`strictPort: true` 防止被占时静默漂移），`server/mock-sse-server.mjs` 用 `process.env.PORT || 8799`；`npm run dev` / `npm run server` 通过环境变量传入同一值。

**绑定地址**：`vite.config.ts` 显式设 `server.host: '::'`（IPv6 通配，macOS 双栈，IPv4-mapped 一并接受）。Vite 5 默认 `host=localhost` 在本机只绑 `[::1]`，会让验收命令里的 `http://127.0.0.1:5181` 连不上；显式双栈后 `localhost` 与 `127.0.0.1` 都能访问，浏览器地址与 curl 验收命令一致。

**同源代理（关键，必须做）**：`vite.config.ts` 把 `/agui` 代理到 `http://localhost:8799`。前端 `fetch('/agui')` 走同源，而不是跨域直连 mock SSE：

- gateway CSP `connectSrc` 不含 `http://localhost:*`（`servers/gateway/src/main.ts:115-122`）→ 跨域直连会被拦；
- CORS `allowedHeaders` 不含 `X-Mcp-Key`（同文件 `:142`）；
- 全仓 `servers/` 检索 `agui` 为 0 命中，**无现成 AGUI 端点**，故 A′ 用 Vite 同源代理把 `/agui` 转到本地 mock（8799）。

---

## 3. 环境变量

| 变量 | 默认 | 作用 | 读取处 |
|---|---|---|---|
| `VITE_AGUI_ENDPOINT` | `/agui` | SSE 端点；优先于 `main.ts` / `AgentPanel.vue` 的默认值 | 前端 `import.meta.env` |
| `VITE_MCP_KEY` | 空 | AGUI 网关鉴权头 `X-Mcp-Key` | 前端 `import.meta.env` |
| `VITE_WIDGET_BASE` | `/mf-widgets` | widget 产物 URL base（`System.import` 的 fetch 前缀） | `src/microfrontend/system-loader.ts` |
| `VITE_PORT` | `5181` | Vite 监听端口 | `vite.config.ts`（Node `process.env`） |
| `MOCK_SSE_URL` | `http://localhost:8799` | `/agui` 代理目标 | `vite.config.ts`（Node `process.env`） |
| `PORT` | `8799` | mock SSE 服务监听端口 | `server/mock-sse-server.mjs` |

密钥走 `~/env_config/`，代码不落明文。默认无需任何 `.env` 即可跑通。

---

## 4. 验收命令（本地实测）

```bash
# 0) 依赖 / 类型 / 单测 / 构建
npm install
npm run typecheck          # 0 错
npm run test               # 全绿
npm run build              # 含 build:widgets，产出 3 个 .system.js

# 1) 一条命令起两个进程（后台保持运行）
npm run dev

# 2) 产物可达
curl --noproxy '*' -I http://127.0.0.1:5181/mf-widgets/poll.system.js
#   => 200 text/javascript

# 3) 同源代理生效（必须是 text/event-stream，不能是 text/html）
curl --noproxy '*' -o /dev/null -w '%{http_code} %{content_type}' -X POST http://127.0.0.1:5181/agui
#   => 200 text/event-stream; charset=utf-8

# 4) 直连 mock 看逐字帧
curl --noproxy '*' -sN --max-time 3 http://127.0.0.1:8799/agui | head -n 20
#   => 正文 → widget fence → 逐字 JSON 帧

# 5) 唤起浏览器
open "http://localhost:5181/"

# 6) 构建后自检：dist/mf-widgets/ 应有 3 个 .system.js
ls -la dist/mf-widgets/
```

起服务前先确认端口空闲：`lsof -nP -iTCP:5181 -iTCP:8799 -sTCP:LISTEN`；被占则改 `VITE_PORT` / `PORT` 并同步改本表与命令。

> 验收硬指标：命令 3 若返回 `text/html`，说明 Vite 把它当 SPA 回退、proxy 没生效，必须修到 `text/event-stream`。

### 🔴 构建顺序不可反

`npm run build` 在 `package.json` 里**写死**为 `vue-tsc --noEmit && node scripts/build-widgets.mjs && vite build`：

1. `vue-tsc --noEmit`：类型门禁；
2. `build:widgets`：产出到 **`public/mf-widgets/`（源）** —— `vite.widgets.config.ts:29` 的 `outDir` 就在 public 内；
3. `vite build`：**最后**才把 publicDir 原样拷进 **`dist/mf-widgets/`（输出）**。

顺序反了 / 漏了第 2 步 → `dist/mf-widgets/` 为空 → 生产构建下运行时 `System.import('mf-widgets/poll')` fetch 404、白屏式失败。`dev` 脚本里的 `npm run build:widgets && concurrently ...` 前置同理，**必须保留**。

`public/mf-widgets/*.system.js` 是**源**（Vite dev 直接服务它，实测 `200 text/javascript`），随代码提交；`dist/mf-widgets/` 是构建输出，被 `.gitignore` 忽略。两者是源与拷贝的关系，不矛盾。

---

## 5. 目录结构

```
ai-agent-widgets-demo/
├── package.json / package-lock.json   # 自包含 npm 依赖（不进根 pnpm workspace）
├── .gitignore                         # node_modules/ dist/ .env*；反忽略 package-lock.json；3 个 .system.js 不忽略
├── index.html                         # 入口（浅色白底）
├── vite.config.ts                     # 5181 + strictPort + host '::' + /agui 同源代理
├── vite.widgets.config.ts             # widget 子应用构建：formats:['system'] + external
├── scripts/build-widgets.mjs          # 逐个构建 3 个 System.register 产物
├── server/mock-sse-server.mjs         # 真 HTTP 流：正文中途逐字吐 widget JSON
├── public/mf-widgets/                 # 🔴 源：3 个 System.register 产物（随代码提交，dev 直接服务）
│   ├── poll.system.js / chart.system.js / form.system.js
├── dist/mf-widgets/                   # 输出：vite build 时 publicDir 原样拷贝（已忽略，不入仓）
└── src/ ...（见 §6）
```

`src/` 关键文件：`main.ts`（endpoint 默认 `/agui`）、`components/AgentPanel.vue`（默认值同为 `/agui`）、`lib/widget-protocol.ts`（白名单 + `WIDGET_NAMESPACE`）、`lib/sse-client.ts`（真 `fetch + ReadableStream`）、`lib/markdown-blocks.ts`（稳定 block 切分）、`microfrontend/system-loader.ts`（精简 System.register 运行时 + `WIDGET_BASE`）、`microfrontend/widget-loader.ts`（Shadow DOM 挂载 / 卸载无泄漏）、`components/WidgetSlot.vue` / `StreamingMarkdown.vue` / `LoadTrace.vue`。

`tsconfig.json` 的两个别名 `@/* -> src/*` 与 `agui-bus -> src/microfrontend/agui-bus-seed.ts` **原样保留**：前者是子应用 external 与基座种子共用的解析入口，丢了会编译 / 运行双失败。

---

## 6. 架构与数据流

```
mock SSE server (8799, 真 HTTP 流，正文中途逐字吐 widget JSON)
        │  Vite /agui 同源代理（5181 → 8799）
        │ fetch + ReadableStream.getReader() 逐块读取（不是 setTimeout 假流）
        ▼
  sse-client.ts ──解析 data: 帧──▶ AGUI 事件 ──aguiBus.emit──▶ EventTarget 单例
        │                                                          ▲
        ▼                                                          │ widget_action
  AgentPanel.vue ──维护 messages[]──▶ MessageList                    │
        │                                │                          │
        │                                ▼                          │
        │              StreamingMarkdown.vue                         │
        │                 ├─ splitRenderable()  未闭合 fence → pending│
        │                 ├─ splitWidgetBlocks() 切稳定 block 序列    │
        │                 └─ reconcileBlocks()  复用对象引用          │
        │                        │                                   │
        │                        ├─ md block     → v-html（仅最后一块随 token 变）
        │                        └─ widget block → WidgetSlot(:key 稳定)
        │                                              │ onMounted
        │                                              ▼
        │                              widget-loader.mountWidget()
        │                                 ├─ 白名单校验（最终防线）
        │                                 ├─ System.import('mf-widgets/poll')
        │                                 │     └─ fetch <WIDGET_BASE>/poll.system.js
        │                                 │        → System.register([vue, agui-bus])
        │                                 │        → setters 命中基座单例
        │                                 ├─ ?inline CSS 注入 Shadow DOM
        │                                 └─ module.mount(container, props, ctx)
        │                                              │
        └────────── 追加 system 消息 ◀──── aguiBus ◀── 点击 / 输入 / 提交
                                                  │
                                           LoadTrace.vue（7 步状态灯 + 日志）
```

### 6.1 核心价值（保持不变，本次未改动）

- **协议**：自定义 fence（info = `widget`）→ `WidgetSpec`，白名单只允许 `poll / chart / form`（`WIDGET_REGISTRY` 把 app 名映射为逻辑模块 id `mf-widgets/<app>`），markdown 里禁止出现任意 URL，从根上堵死 prompt injection 动态 `import()`。props 走 `base64(UTF-8 JSON)` + HTML 转义，剔除原型污染键，限深 6 层。
- **半截容错**：未闭合 fence 整块 pending；`parseWidgetSpec()` 对非法 / 半截 JSON 返回 `null` → 占位「⏳ 组件加载中…」，**绝不抛错、绝不提前 import**。
- **稳定挂载**：源码层按 fence 切 `md` / `widget` 块 + 稳定 `:key` + `reconcileBlocks()` 引用复用；后续 token **只让最后一个文本块**变化，已挂载子应用不被连根拔起（这是「可交互且状态不丢」的关键）。
- **真微前端**：`vite.widgets.config.ts` 以 `formats:['system']` + `external:['vue','agui-bus']` 产出 3 个 `System.register` JS；基座 `System.set('vue', Vue)` / `System.set('agui-bus', { aguiBus })` 注入单例，运行时 `fetch + new Function` 求值 + 按 URL 缓存实例，产物不打包第二份 Vue。**该 `new Function` 在 web_system gateway 下无需改动**（见 §8.3）。
- **样式沙箱**：widget 挂 `attachShadow`，`?inline` 注入 `global.css + markdown.css + widgets.css`，`widgets.css` 用 `:host` 重声明 `--bg:#FFFFFF` / `--text:#1A1A1F` / `--brand:#F97316` / `--accent:#0EA5A4`（浅色白底）。
- **卸载无泄漏**：`Map<slotId, handle>` + 幂等 `unmountWidget()` + `releaseDisconnectedHandles()` + `unmountAllWidgets()`。

### 6.2 base 联动（本次新增）

`VITE_WIDGET_BASE` 默认 `/mf-widgets`，一处配置驱动四处，避免 `mf-widgets` 字面量散落：

| 文件 | 作用 |
|---|---|
| `src/lib/widget-protocol.ts` | 导出 `WIDGET_NAMESPACE = 'mf-widgets'`，`WIDGET_REGISTRY` 的 module id 由它派生 |
| `src/microfrontend/system-loader.ts` | 导出 `WIDGET_BASE`（默认由 namespace 派生，可由 `VITE_WIDGET_BASE` 覆写）；`resolve()` 用它拼真实 fetch URL |
| `src/microfrontend/widget-loader.ts` | LoadTrace 的「fetch …」日志文案用 `WIDGET_BASE` |
| `src/microfrontend/system-loader.test.ts` | 断言用 `WIDGET_NAMESPACE` / `WIDGET_BASE` 派生 |
| `src/vite-env.d.ts` | 补 `VITE_WIDGET_BASE` 类型 |

逻辑模块 id 与 URL 解耦：改 `VITE_WIDGET_BASE` 不需要动白名单，markdown 里也不出现任意 URL。

---

## 7. 为什么不参与根 pnpm workspace

`pnpm-workspace.yaml:1-4` 只 glob `apps/* servers/* packages/*`，仓库根下的 `ai-agent-widgets-demo/` **不匹配任何一条**，因此：

- 不会被根 `pnpm install` 解析，根 `pnpm-lock.yaml`（795 KB）与根 `package.json` **零变化**；
- 本 demo 依赖的 `markdown-it` / `highlight.js` / `@types/markdown-it` / `vitest` 在 `web_system` 主 workspace 全仓无声明（`WS/node_modules/` 下三者均不存在），若挂进 workspace 会污染根依赖解析；
- 自带 `package.json` + `package-lock.json` + 本地 `node_modules/`，用 **npm（非 pnpm）** 独立安装，一条 `npm run dev` 起前后端；
- 先例：`ai-writing-demo/README.md:3-4` 明写「独立 demo 原样放进 web_system、不进 workspace」的约定，本 demo 照抄该形态；
- 根 `.gitignore:3` 明令「pnpm workspace 禁止 npm lockfile 入仓」，本 demo 用目录内 `.gitignore` 的 `!package-lock.json` **局部反忽略**，仅对本目录生效，不动根规则；
- 本地跑通**不需要** DB / nginx / pm2 / `deploy_apps` seed / 本地 CDN（那是里程碑二）。

**git 纪律**：本 demo 在独立 worktree 的 `spike/*` 分支上开发，不在 master 主检出改动；分支名不用 `feature/*` / `fix/*`（`.github/workflows/auto-pr.yml` 的 `jobs.create-pr.if` 只匹配这两类，会触发自动建 PR + auto-merge 合进受保护 master）。**禁止 push、禁止建 PR**。

---

## 8. 里程碑二：如何注册成真正的 System.register 子应用（B 形态，当前不做）

> ⚠️ **先明确现状**：demo 里**只有 widget 子应用化了，AgentPanel 本身仍是独立 SPA**。
> `src/microfrontend/bootstrap.ts:24-53` 的 `mountAgentPanel()` 是独立 SPA 挂载函数
> （返回带 `unmount()` 的 handle），**没有** `bootstrap / mount / unmount` 顶层 lifecycle；
> `:55-70` 注释明写「真正由 System.register 加载的是 SSE 正文中间的 widget 子应用，
> 若要把整个 AgentPanel 也作为子应用，需打开 `vite.config.ts` 里注释掉的 build.lib」。
> 所以「搬过去挂不上」不是补个函数就能解决 —— 这正是先 A′ 后 B 的理由：A′ 完全不碰这层契约。

### 8.1 契约缺口（第一条是硬伤）

1. 🔴 **lifecycle 契约不匹配**：基座 `packages/shell-loader/src/loader.ts:248-255` 的 `toLifecycle` 要求子应用暴露 `bootstrap / mount / unmount`；`:154` 是基座侧 `System.import` 入口。demo 只有 `mountAgentPanel()`，**直接注册会挂载失败**，必须新增 lifecycle 适配入口或基座侧适配。
2. **共享依赖机制不同**：基座用 `window.__SHARED__` + importmap + `System.set(虚拟URL)`，externals key 为 camelCase（`scripts/vite-micro-frontend.mjs:11-20`）；demo 是自写 System 运行时 + `System.set('vue')` / `System.set('agui-bus')` + `agui-bus` TS 别名，且 **aguiBus 单例透传在基座契约下无对应项**。
3. **产物格式不同**：基座 `scripts/vite-micro-frontend.mjs:162-175` 产出 `index.js` + `index.css` + `manifest.json`；demo 是单个 `*.system.js`、无 manifest，**3 个 widget 产物不属于基座 manifest 体系**，仍需运行时 fetch 另行托管。
4. **注册链路未打通**：`scripts/modules.json` 仅 `portal` / `admin` 为 `type:"micro-frontend"`；`scripts/seed-dev-deployment.mjs:49-85` 只写旧表，NEW 表 `deploy_apps` 等在 master 无 seed → 需补 seed，或走 `servers/deploy-console/src/apps/apps.service.ts:264` / 手动 SQL。

✅ **好消息**：新增子应用**不用改 shell 路由表** —— `apps/shell/src/main.ts:64-79` 是 catch-all `/:module/*`。

### 8.2 真要做 B 形态，改的是这三层（不是补个函数）

1. **新建 mf 入口**：把 `mountAgentPanel()` 映射为 `mount`、`handle.unmount` 映射为 `unmount`、`bootstrap` 空实现，导出标准 lifecycle（注意 `src/main.ts` 已是独立 SPA 入口，不能覆盖，需另建入口文件）；
2. 打开 `vite.config.ts` 注释掉的 `build.lib`（`formats:['system']`、`external:['vue']`），产出 System.register 格式的 AgentPanel 子应用；
3. 把 `aguiBus` 单例经 `System.set` 注入基座，并解决 §8.1 第 2 条的 externals key 差异。

基座契约真源：`packages/shell-loader/src/loader.ts:154`（`System.import`）/ `:248-255`（`toLifecycle` 要求 mount）。

### 8.3 其余接线（A′ 完全不碰）

- **CSP：不改，但标注依赖白名单**：`src/microfrontend/system-loader.ts:71` 的 `new Function('System', code)` 在 web_system gateway 下**无需改动** —— `servers/gateway/src/main.ts:99,105` 的 helmet `scriptSrc` 已明确为 SystemJS 放开 `'unsafe-eval'`，且全仓 index.html 无 CSP meta。只有**脱离 gateway** 部署到严格 CSP 环境（如 `servers/deploy-console/src/main.ts:44` 默认 helmet，或未来收紧策略）才需改 `<script>` 注入 + trusted-types / 预注册模块。
- **SSE 端点**：全仓 `servers/` 无现成 AGUI 端点；把 `/agui` 代理目标从 mock（`MOCK_SSE_URL`）切到真实网关。若连 gateway，地址是 **`http://localhost:8180`**（不是 6000）。前端 `VITE_AGUI_ENDPOINT=/agui` 不用改；同源 `/agui` 代理仍必须做（gateway `connectSrc` 不含 `http://localhost:*`）。
- **widget 产物托管**：3 个 `*.system.js` 需版本化 + 缓存策略另行托管（§8.1 第 3 条），`VITE_WIDGET_BASE` 可指向新路径，无需改白名单。
- **部署配套**：DB / nginx / pm2 / `deploy_apps` seed / 产物 SRI 完整性校验（本地 demo 均未涉及）。

---

## 9. 已知限制

- `highlight.js` 引入完整包（语言全），主 bundle ~1.2 MB；生产建议改 `highlight.js/lib/common` 按需注册。
- `new Function` 求值产物**在 web_system gateway 下无需改动**（`servers/gateway/src/main.ts:99,105` 已放开 `scriptSrc: 'unsafe-eval'`，全仓 index.html 无 CSP meta）；但**依赖这条 CSP 白名单**，脱离 gateway 部署到严格 CSP 环境才需改求值方式（见 §8.3）。
- 白名单是编译期常量；生产建议版本化产物名 + SRI。
- 超长文档（>5k token）block 序列线性增长，建议虚拟滚动；单块已用 `contain: content`。
- 交互闭环目前是「点击 → 追加 system 消息」，未做「点击 → 服务端回吐新 markdown」（需双向 SSE / gateway 契约）。
- `X-Mcp-Key` 等密钥走 `~/env_config/`，不落代码明文。
- 跨轮状态语义（保留历史 vs 每轮清空）需产品拍板，当前默认保留历史。
