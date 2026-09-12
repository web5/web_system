# 静态产物缓存与版本保留策略

> **状态：A1/A2/A3、B1、C、D 已实施（2026-09-12）；B2（远端清理责任）与 E（入口带 hash）待定**
> **起因**：2026-09-11 `dev.kedouai.com/admin` 在 Chrome 下白屏（同期 QQ 浏览器 / Safari 正常）
> **关联文档**：`release-system-design.md` §10「nginx 产物缓存」风险、`nginx-micro-frontend.conf`、`micro-frontend.nginx.conf`
> **关联代码**：`servers/gateway/src/static/static.module.ts`、`servers/deploy-console/src/artifact/artifact-store.service.ts`、`servers/deploy-console/src/pipeline/steps/{upload,cleanup}.executor.ts`

## 变更日志

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-09-11 | 初稿 | 事故证据固化 + 资源分类缓存策略 + 版本保留策略 + 前端兜底 |
| 2026-09-12 | 实施 | A1/A2（gateway 缓存判定 + 13 项单测）、A3（nginx 参考配置）、B1（保留窗口 24h 下限 + 新增 2 项单测）、C（admin/portal 资源失败可见兜底）、D（shell 模块版本比对）；**B2/E 未做**，详见 §9 |
| 2026-09-12 | 核实 + 收口 | 核实 dev 为独立环境（自有发布平台，见 §10）；B2 按"明确边界"落地；§7 待确认项与状态行同步更新 |
| 2026-09-12 | 定性修正 | 上服务器取证：**T1 排除**（每个 commit 只发过 1 次）、**T2 成立为主凶**（1 小时发 4 次 × 只留 5 个版本 ≈ 2 小时窗口）；新增 §10.5「remote 投递的指针不落地」 |

---

## 1 事故现象

| 项 | 表现 |
|---|---|
| 页面 | `dev.kedouai.com/admin` 全白，无任何文案 |
| 控制台 | `[shell] mounted module: admin` 成功；**零 error / warning**；URL 停在 `/admin`，未跳到 `/admin/dashboard` |
| Network | 23 个请求几乎全 200；唯一异常是模块 `index.css` 标记「加载失败」 |
| 浏览器差异 | Chrome 白屏；Safari / QQ 正常 |
| 时序 | portal 起初正常 → 切到 admin 白屏 → 切回 portal 也不可用 |

## 2 定位过程（实测证据，2026-09-11 14:44~14:50 GMT）

### 2.1 服务端：入口文件被设成"永久强缓存"，而它们是固定文件名

```
GET /static/modules/admin/default/12e8c60/index.js      → 200, 249 B
cache-control: public, max-age=31536000, immutable
etag: W/"f9-1a090b82187"          last-modified: 11 Sep 2026 13:46:21 GMT

GET /static/modules/admin/default/12e8c60/index.css     → 200, 90 496 B
cache-control: public, max-age=31536000, immutable

GET /static/modules/portal/default/0f9bfb3/index.js     → 200, 1 024 282 B
cache-control: public, max-age=31536000, immutable

GET /admin（shell HTML）                                 → 200, 8 302 B
cache-control: no-cache            etag: W/"206e-…"      ← 指针型文件，正确
```

注意：`index.js` / `index.css` 是**固定文件名**（不含内容 hash），内容却随每次构建变化。

### 2.2 用户页面加载的是"服务端已不存在"的产物

| 文件 | 用户 Network | 服务端当前 |
|---|---|---|
| `main.DLkP3_K.js` | 200（来自浏览器缓存） | **404** |
| `main.DLIcP3_K.js` | — | 200（当前版本） |

即：用户浏览器用的是**旧构建**的入口，该入口引用的 chunk 在服务端已被删除。

### 2.3 产物结构（证明 admin/portal 同构，不是"某个模块特殊"）

| 模块 | 入口 `index.js` | 真正代码 | 按路由懒加载分包 |
|---|---|---|---|
| admin | 249 B（System.register 壳） | `main.<hash>.js` 1 033 657 B | 24 个 |
| portal | 1 024 282 B | （入口即主代码） | 17 个 |

两个模块都是「固定名入口 + 带 hash 分包」。**所以差异不在结构**，而在于：

- `portal` 版本 `0f9bfb3`（09-10 发布）**在服务端仍然存在** → 旧标签页引用的路径依旧可解析；
- `admin` 版本 `12e8c60`（09-11 13:46 发布）是新版本，用户页面引用的是**更早的 admin 版本**，该目录已不在服务端 → 分包 404。

### 2.4 为什么只有 Chrome 中招

Chrome 严格实现 `Cache-Control: immutable`——**连条件请求都不再发**，永远使用本地缓存中的旧 `index.js`。
Safari / QQ 是新会话或对 `immutable` 处理不同，直接拉到了服务端最新产物。

### 2.5 为什么"白屏且零报错"

admin 自带 router 的初始重定向（`/` → `/dashboard`）需要动态 `import` `BasicLayout.<hash>.js` / `Dashboard.<hash>.js`。这些请求 404 → 导航失败。而 vue-router 生产构建把导航错误的提示 `warn` 包在 `__DEV__` 分支里，**被静默吞掉**：URL 不变、`router-view` 空、控制台无日志。这正是"极难定位"的来源。

## 3 根因

```53:58:servers/gateway/src/static/static.module.ts
export function isContentAddressed(filePath: string): boolean {
  const p = String(filePath).replace(/\\/g, '/');
  if (/\/(dist\/)?assets\//.test(p)) return true;
  if (/\/static\/(modules|cdn)\//.test(p)) return true;
  return /\.[A-Za-z0-9_-]{8,}\.(js|mjs|css|woff2?|ttf|eot|png|jpe?g|svg|webp|gif|ico)$/i.test(p);
}
```

`/static/(modules|cdn)/` 被**整体**判为"内容寻址"。但该前缀下混着两类语义完全不同的资源：

- **内容寻址**：带 hash 的分包（`main.DLkP3_K.js`、`AiChat.IjjyUx09.js`）→ 路径变则内容变，immutable 正确；
- **指针型但长得像内容寻址**：固定名入口 `index.js` / `index.css` → **内容变而路径不变**，immutable 直接导致"浏览器永远用旧入口"。

### 3.1 两个触发条件（任一成立即白屏）

| # | 触发场景 | 机制 |
|---|---|---|
| **T1** | **同一版本目录被重复投递覆盖** | `ArtifactStoreService.uploadLocal()` 先 `rmSync` 清空目标版本目录再 `cpSync`（见 §4.1 代码）→ 旧 chunk 被物理删除；浏览器缓存的 `index.js` 仍指向它们 → 404。**版本号相同（同 commit 重复发布）也会覆盖**，此时"版本目录 = 内容寻址"的前提直接失效 |
| **T2** | **已打开的旧标签页引用了被清理的旧版本** | cleanup 只保留最近 N 个版本目录；用户页面（未刷新）的 manifest 指向被清掉的那一版 → 分包 404 |

> 本次事故至少命中其中之一：用户页面引用的 admin 版本 ≠ 当前 `12e8c60`。

### 3.2 兜底缺失（放大故障）

- 前端无「动态 import 失败」的可视化兜底（§5 方案 C）；
- shell 的版本探测只比对 `shell/version.json`，**不覆盖模块版本**（§5 方案 D）。

## 4 现状盘点

### 4.1 投递会覆盖同版本目录

```99:107:servers/deploy-console/src/artifact/artifact-store.service.ts
  uploadLocal(moduleKey: string, version: string, srcDir: string): string {
    const dest = this.dir(moduleKey, version);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(dest)) {
      fs.rmSync(path.join(dest, f), { recursive: true, force: true });
    }
    fs.cpSync(srcDir, dest, { recursive: true });
    return dest;
  }
```

### 4.2 清理只覆盖 local 投递，且只按数量

| 事实 | 位置 |
|---|---|
| 保留 `KEEP_VERSIONS = 5` 个版本目录；当前版本 + 启用中灰度版本受保护 | `artifact-store.service.ts`、`cleanup.executor.ts` |
| `PIPELINE_UPLOAD_TARGET=remote` 时**直接跳过清理**（本地无产物可清） | `cleanup.executor.ts` L30-35 |
| 后端模块跳过清理 | 同上 L25 |

**观察（本机发布目录 `~/web_system_release/servers/gateway/public/static/modules/`）**：admin 下并存 **11 个**版本目录、portal **6 个**（>5）。且**不含** dev 当前版本 `12e8c60` → 说明 dev 的产物源并非本机 local 投递（见 §7 待确认）。

### 4.3 配置文件之间已经互相矛盾

| 文件 | `/static/modules/` 的 js | css |
|---|---|---|
| `local.nginx.conf` | no-cache | no-cache ✅ |
| `micro-frontend.nginx.conf` | no-cache | no-cache ✅（注释已写明"index.css 无 hash 不能用 immutable"） |
| `docs/architecture/nginx-micro-frontend.conf` | no-cache | **immutable ❌** |
| **gateway `isContentAddressed`（dev 实际生效）** | **immutable ❌** | **immutable ❌** |

`docs/architecture/release-system-design.md` §10 也已列过该风险：「`static/modules/` 若配 `immutable`，同一 commit 重复上传覆盖时客户端可能读到旧缓存」。

## 5 方案

### 方案 A（P0）：缓存分类策略——固定名入口必须可校验

**原则：缓存策略按「路径是否随内容变化」判定，而不是按目录前缀。**

| 资源 | 路径特征 | 内容变化 → 路径？ | 策略 |
|---|---|---|---|
| shell `index.html` | 固定 | 否 | `no-cache` + ETag（现状 ✅） |
| `version.json` | 固定 | 否 | `no-cache`（现状 ✅） |
| 模块入口 `/static/modules/<key>/<命名空间>/<版本>/index.js` | **固定名** | 否 | **`no-cache` + ETag（需改）** |
| 模块样式 同上 `index.css` | **固定名** | 否 | **`no-cache` + ETag（需改）** |
| 模块分包 `main.<hash>.js`、`<View>.<hash>.js` | 带 hash | 是 | `immutable`（现状 ✅） |
| Vite `/assets/*` | 带 hash | 是 | `immutable`（现状 ✅） |
| 自建 CDN `/static/cdn/vue.js` 等 | **固定名** | 否 | 建议 `no-cache`（见 A2） |

**A1（必做）**：`isContentAddressed()` 增加"固定名入口"例外：

```ts
/** 微前端模块的固定名入口：内容随版本变，但路径不含 hash → 绝不能强缓存 */
const MF_ENTRY_RE = /\/static\/modules\/[^/]+\/(?:[^/]+\/)*index\.(?:js|css)$/;

export function isContentAddressed(filePath: string): boolean {
  const p = String(filePath).replace(/\\/g, '/');
  // 固定名入口（index.js / index.css）→ 指针型，必须能校验更新
  if (MF_ENTRY_RE.test(p)) return false;
  if (/\/(dist\/)?assets\//.test(p)) return true;
  if (/\/static\/(modules|cdn)\//.test(p)) return true;
  return /\.[A-Za-z0-9_-]{8,}\.(js|mjs|css|woff2?|ttf|eot|png|jpe?g|svg|webp|gif|ico)$/i.test(p);
}
```

收益：T1（同版本重传覆盖）与 T2（旧版本被清理后仍可自愈）都不再因"入口永久不可更新"而恶化；`index.css` 的样式改动也能即时生效（现状是改样式用户永远看不到）。

**A2（P1，建议同批）**：`/static/cdn/*.js` 是固定名（vue.js / antd.js / …），升级公共依赖后同样会卡在旧缓存。改为 `no-cache`（14 个文件每次 304，成本可忽略）；若要保留强缓存，需给 cdn 目录加版本段（`/static/cdn/<rev>/…`），改动更大。

**A3（同步修正文档/配置）**：`docs/architecture/nginx-micro-frontend.conf` 的 css 段改为 `no-cache`，并修正"带 hash 的文件名不变即永久有效"的注释（`index.css` 本就不带 hash）。

### 方案 B（P0/P1）：版本保留策略

| 编号 | 问题 | 建议 |
|---|---|---|
| B1 | 保留数固定为 5，高频发布时旧标签页很快无产物可用 | 保留窗口改为**双条件**：`保留最近 5 个 且 不少于 24h`（时间下限兜底） |
| B2 | `target=remote` 时 cleanup 完全跳过 → 远端要么从不清理、要么另有一套未知策略 | 明确远端清理责任方（流水线远端执行 / 远端 cron），并把结果写回 `pipeline.result` |
| B3 | 清理以"版本目录"为粒度，无法应对"同版本被覆盖" | 无法通过保留策略解决，必须由 A1 覆盖；文档需明示这一边界 |
| B4（可选） | 用户端无感知 | 发布后在 `deploy_deployments` 记录并让 shell 轮询（见 D） |

### 方案 C（P1）：前端挂载/导航失败必须可见

现状：动态 import 失败 → 静默白屏。建议 admin / portal / shell 三处补齐：

1. `router.onError((err) => …)`：识别 `Failed to fetch dynamically imported module` / `Importing a module script failed`，渲染"资源已过期"页并提供「刷新」按钮；
2. `window.addEventListener('unhandledrejection')` 兜底动态 import 失败；
3. shell 的 `ModuleContainer` 已有 `renderMountError`，把「挂载成功但首屏导航失败」也纳入（等 router 就绪后再判定）。

### 方案 D（P1）：模块版本变化提示

`apps/shell/src/version-check.ts` 目前只比对 `/shell/version.json`。建议同时轮询 `/__manifest__`，与页面内 `window.__MODULES_MANIFEST__` 比对：

- 任一模块 `version` 变化 → 复用现有右下角「发现新版本，点击刷新」横幅；
- 这样即便产物被清理，用户也能在**首次失败前**收到提示，而不是白屏。

### 方案 E（P2，可选演进）：入口也带 hash

把 mf 构建的 `entryFileNames` 从 `index.js` 改为 `index.<hash>.js`，manifest 指路。这样入口也变成内容寻址，可继续 immutable。代价：改动 manifest 消费链路与发布/校验逻辑，收益与 A1 相同但成本高 —— **建议先做 A1，E 作为长期演进**。

## 6 验收标准

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| V1 | 模块入口不再强缓存 | `curl -sI https://<dev>/static/modules/admin/default/<ver>/index.js` → `cache-control: no-cache`（且带 ETag）；`index.css` 同 |
| V2 | 分包仍强缓存 | 同上替换为 `main.<hash>.js` → `immutable` |
| V3 | 同版本重复投递后旧页面自愈 | 连续两次发布同一 commit → 已打开页面普通刷新即可正常渲染（不依赖强刷/清缓存） |
| V4 | 样式改动即时生效 | 改一行 CSS 重新发布 → 普通刷新可见（现状：immutable 下不可见） |
| V5 | 资源缺失不再静默白屏 | 手工把当前版本目录改名 → 页面出现「资源已过期，请刷新」提示（方案 C） |
| V6 | 版本切换有提示 | 发布新版本后，已打开的旧页面右下角出现刷新横幅（方案 D） |

## 7 待确认项

1. ~~**dev.kedouai.com 的产物投递与清理由谁执行？**~~ **已确认（2026-09-12）**，结论见 §10：dev 是**独立环境**，有自己的发布平台与本地流水线（local target）；本机平台的 `remote` 通道并未被实际使用。
2. **本次是否发生"同 commit 重复投递"（T1）？** 线上 admin 版本 `12e8c60` 是 master 上 PR #54 的 merge commit（`fix(scripts): 修 $var（ 全角括号导致的 unbound variable`）——属"改了反复发布"的典型场景，与 T1 高度吻合。**确切结论需查 dev 那台的发布记录**（dev 自己的 `web_system_deploy.deploy_pipelines`）。
3. **用户浏览器侧确认（可选）**：控制台执行 `window.__MODULES_MANIFEST__` 看 admin 的 `version` —— 若为 `default/12e8c60` 则命中 T1（同版本覆盖），若为更早版本则命中 T2（旧版本被清理）。
4. ~~**A2 是否同批实施**~~ 已实施：`/static/cdn/**` 整目录改 `no-cache`。

## 8 影响面与改动清单（供实施时对照）

| 文件 | 改动 | 风险 |
|---|---|---|
| `servers/gateway/src/static/static.module.ts` | A1：`isContentAddressed` 增加固定名入口例外 | 低（仅缓存语义；需重启 gateway） |
| `docs/architecture/nginx-micro-frontend.conf` | A3：css 段改 `no-cache` + 注释修正 | 无（部署参考文件） |
| `servers/deploy-console/src/artifact/artifact-store.service.ts`、`cleanup.executor.ts` | B1：保留窗口加时间下限；B2：remote 清理责任明确 | 中（发布链路；需回归发布流程） |
| `apps/{admin,portal}/src/router`、`apps/shell/src/views/ModuleContainer.vue` | C：导航/动态 import 失败可视化 | 低 |
| `apps/shell/src/version-check.ts` | D：增加 manifest 版本比对 | 低 |

---

## 9 实施记录（2026-09-12）

### 9.1 已落地改动

| 方案 | 文件 | 变更 |
|---|---|---|
| A1/A2 | `servers/gateway/src/static/static.module.ts` | 新增 `MF_FIXED_ENTRY_RE`（模块 `index.js`/`index.css`）与 `CDN_DIR_RE`（`/static/cdn/`）两条例外，命中即返回 `false`（网关下发 `Cache-Control: no-cache`，走 ETag 校验）；`/static/modules/` 仅对**带 hash 的分包**保持 `immutable`。同步重写了文件头 §2 的缓存约束说明 |
| A1 | `servers/gateway/src/static/static.module.spec.ts` **（新增）** | 13 项单测：固定名入口 / legacy 扁平入口 / 带 hash 分包 / CDN / assets / 指针型文件 / 兜底 hash 规则 / Windows 路径 |
| — | `servers/gateway/jest.config.js` **（新增）** | 该服务 `package.json` 早有 `test: jest` 却缺配置（测试实际跑不起来），按 `auth-service` 约定补齐 |
| A3 | `docs/architecture/nginx-micro-frontend.conf` | `/static/modules/` 改为「① 固定名入口 no-cache ② 带 hash 产物 immutable ③ 其余 no-cache」三段式，并修正原先"css 带 hash 可强缓存"的错误注释 |
| B1 | `servers/deploy-console/src/artifact/artifact-store.service.ts` | 新增 `KEEP_MIN_AGE_MS = 24h`；`cleanup()` 增加第 4 参数 `minAgeMs`，保留条件变为「受保护 ∨ 最近 keep 个 ∨ 未满 minAgeMs」 |
| B1 | `servers/deploy-console/src/artifact/artifact-store.service.spec.ts` | 原清理用例显式传 `minAgeMs=0`（保持原语义），新增「时间下限内全保留」「超时限且不在 keep 才删」「`KEEP_MIN_AGE_MS` 默认 24h」3 项 |
| B2 | `servers/deploy-console/src/pipeline/steps/cleanup.executor.ts` | remote 模式不再**静默**跳过：显式写入 `p.result.cleanup = { skipped: true, reason: 'remote-target' }` 并写明责任边界（见 §10.2） |
| C | `apps/admin/src/utils/module-load-error.ts`、`apps/portal/src/utils/module-load-error.ts` **（新增）** | `isChunkLoadError` / `showModuleLoadError`（内联样式遮罩 + 刷新按钮，幂等）/ `installChunkLoadErrorGuard`（`unhandledrejection` 兜底） |
| C | `apps/admin/src/router/index.ts`、`apps/portal/src/router/index.ts` | 接入 `router.onError`（仅对 chunk 类错误提示，其它错误照旧抛出）+ 安装全局兜底 |
| D | `apps/shell/src/version-check.ts` | 新增 `checkManifest()`：比对页面内 `__MODULES_MANIFEST__` 与服务端 `/__manifest__`，任一模块版本变化即复用右下角刷新横幅；`showBanner` 增加 `kind` 以区分文案 |

### 9.2 验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| gateway 缓存判定单测 | `cd servers/gateway && npx jest src/static/static.module.spec.ts` | 13 passed |
| deploy-console 清理单测 | `cd servers/deploy-console && npx jest src/artifact/artifact-store.service.spec.ts` | 9 passed |
| gateway 编译 | `cd servers/gateway && npm run build` | 通过 |
| deploy-console 编译 | `cd servers/deploy-console && npm run build` | 通过 |
| admin/portal/shell 类型检查 | `npx vue-tsc --noEmit`（按改动文件过滤） | 无与本次改动相关的诊断（仓库存在既有类型错误，见 9.4） |

> 注意：`apps/portal/src/router/index.ts` 原有的 `TS6133 'from' is declared but never read` 已顺手修为 `_from`。

### 9.3 未做项与原因

| 项 | 原因 |
|---|---|
| **B2**（远端清理责任） | 已按"明确边界"处理（2026-09-12，见 §10.2）：远投产物的保留/清理由**目标环境自己的发布平台**负责，本平台不做远端 `rm`（误删风险远高于收益）；原有"静默跳过"改为显式落进 `p.result.cleanup`，避免误以为已清理 |
| **E**（入口带 hash） | 改动 manifest 消费链路与发布/校验逻辑，收益与 A1 相同而成本更高；A1 已解除致命风险，留作长期演进 |
| **A2 的 nginx 版本段方案** | 已按"`/static/cdn/` 整目录 no-cache"落地（14 个文件每次 304，成本可忽略），未引入版本段 |

### 9.4 既有问题（本次未处理，与事故无关）

`vue-tsc --noEmit` 在三个前端应用上均有历史遗留类型错误（`packages/agent-core/src/tools/coding/*`、`packages/shared/src/entities/user.entity.ts`、`apps/portal/src/views/{Create,Todo,Transform}.vue`、`tools/{SqlFormatter,Uglify}.vue` 等）。它们不阻塞发布（流水线的 mf 构建只跑 `vite build`，不含 `vue-tsc`），故不在本次范围内。

### 9.5 生效方式

| 改动 | 生效路径 |
|---|---|
| gateway（A1/A2） | 需**构建并重启 gateway**；dev 环境还需确认该服务由哪条发布通道部署 |
| deploy-console（B1） | 走传统发布 `./scripts/publish-deploy-console.sh` |
| admin / portal（C） | 微前端四步铁律：`RELEASE_TAG=<模板key>/<commit> MF_FORMAT=system npx vite build --mode mf`（会同时带上 A/D 对 shell 的影响） |
| shell（D） | shell 构建发布 |
| `docs/architecture/nginx-micro-frontend.conf` | 仅部署参考；dev 实际走 gateway，无需单独操作 |

> ⚠️ 已中招的浏览器仍持有旧的 `index.js` 缓存，**首次需要强刷（Cmd+Shift+R）**；此后网关下发 `no-cache`，不再复发。

---

## 10 dev 环境发布链路核实结论（2026-09-12）

### 10.1 事实对照

| 项 | 本机（local） | dev |
|---|---|---|
| 入口 | `local.kedouai.com` | `dev.kedouai.com` → DNS **`42.194.200.69`**（nginx SSL 层）→ **`175.27.189.123:6000`**（后端） |
| 与 `deploy_servers` 对照 | — | `dev-default.host = 175.27.189.123`、`ssh_user=ubuntu`、`remote_dir=/data/web_system` ✓ **一致**（域名 IP 是网关层，两者本就不是同一台） |
| `/__manifest__` 的 env | `local` | `dev` |
| admin 版本 | `b2b6d4a`（**本机磁盘无该目录**） | `default/12e8c60` |
| portal 版本 | `b2b6d4a` | `default/0f9bfb3` |
| 产物布局 | 扁平 `/static/modules/admin/<ver>/` | 带产品线段 `/static/modules/admin/default/<ver>/` |
| 静态资源出口 | gateway `ServeStatic` | gateway `ServeStatic` —— 实测 `/static/modules/.../index.js` 返回 `immutable`，与 `isContentAddressed` 行为一致，**不是** nginx 直出 |
| 发布平台 | 本机 deploy-console（6200） | **dev 自己也有一套**：`https://dev.kedouai.com/console/` → 200，标题「Beehive · 智能研发平台」 |

佐证"**dev 的常规发布（含版本指针切换）不走本机平台**"：

- 本机 `web_system_deploy.deploy_release_events` **为空**；
- dev 那台的 `deploy_versions` 只登记了**它自己**的三次发布（`ba44c25` / `10b74d8` / `12e8c60`），本机平台投进去的 `4caf272` **不在其中**；
- 本机平台的 dev 记录（`4caf272`）与 dev 线上实际服务的版本（`12e8c60`）不一致，产物布局也不同（本机扁平 `admin/<ver>/` vs dev `admin/default/<ver>/`）；
- 注意：本机平台**确实用过** remote 通道往 dev 投产物——但只送产物、送不了版本指针，见 §10.5。

### 10.2 对本次修复的影响

| 方案 | 影响与动作 |
|---|---|
| **A1/A2（gateway 缓存判定）** | dev 的 `/static/modules/` 确实由 **dev 那台的 gateway** 提供 → **改动必须部署到 `175.27.189.123` 上的 gateway**，对 dev 才生效 |
| **B1（保留窗口 24h）** | dev 那台的流水线是 **local target**（产物落它自己机器）→ cleanup 正常执行 ✓；**它自己的 deploy-console 也需更新**才能获得时间下限 |
| **B2（远端清理）** | 本机平台的 `remote` 通道并未被实际使用 → 按"明确边界"落地：不做远端 `rm`，改为显式记录 `p.result.cleanup` |
| **C/D（前端兜底 + 模块版本提示）** | 需重新构建并把 admin / portal / shell **发布到 dev** |

### 10.3 dev 的更新路径

后端主机（`175.27.189.123`，ubuntu，key `~/.ssh/id_ed25519_servers`，目录 `/data/web_system`）：

```bash
ssh ubuntu@175.27.189.123
cd /data/web_system && git pull
cd servers/gateway && npx nest build && pm2 restart web-gateway --update-env
```

前端（admin / portal / shell）走 **dev 自己的发布平台** `https://dev.kedouai.com/console/` 的流水线（不要用本机 6200 那套——本机发的是 local 环境）。

> ⚠️ dev 上的 deploy-console 自身更新不能走它自己的流水线（restart 会杀掉执行进程），需在 dev 机器上手动构建重启；与本机 `scripts/publish-deploy-console.sh` 同理。

### 10.4 触发条件定性（2026-09-12 已确证）

**T1（同一 commit 重复投递覆盖）→ 排除。**
dev 那台 `web_system` 库（发布表与业务表同库）显示 admin 每个 commit 只发布过 1 次：

| version_tag | git_branch | 流水线创建 | 版本落库 |
|---|---|---|---|
| `default/ba44c25` | impl/check-reuse-fix | 2026-09-11 19:27:10 | 19:28:03 |
| `default/10b74d8` | impl/check-reuse-fix | 2026-09-11 19:43:41 | 19:44:24 |
| `default/12e8c60` | master | 2026-09-11 21:45:30 | 21:46:21 |

**T2（旧版本被 cleanup 清理）→ 成立，为本次主凶。** 证据：

1. dev 平台配置 `PIPELINE_UPLOAD_TARGET=local`（`servers/deploy-console/.env`）→ cleanup **真的在跑**；
2. dev 上 admin 现存版本目录恰为 **5 个**（`10b74d8 12e8c60 41fffaa 4caf272 ba44c25`），与 `KEEP_VERSIONS=5` 完全吻合；
3. **发布频率极高**：09-11 当晚 **1 小时内发了 4 次**（19:27 / 19:43 / 20:40 / 21:45）→ 5 个版本只覆盖约 **2 小时**；
4. 用户页面引用的版本落在保留窗口之外：其 `index.js` 入口 + `main.<hash>.js` 已被 Chrome 以 `immutable` 缓存（所以还能跑），但**懒加载分包请求时 404** → 首屏导航失败 → 白屏；
5. 现存 4 个带分包的版本目录里，主 chunk 分别是 `mUG_qF1N` / `DLIcP3_K` / `C7XMWzTX` / `BUYyqGLx` —— **都不是用户页面加载的 `DLkP3_K`**，佐证其所属版本已被清理。

**结论**：**主凶是 T2** → **B1（24h 时间下限）即对症主药**（24h 内发 50 次也不会清掉旧版本）；A1 负责"入口/样式可更新 + 防同版本重传粘滞"；C/D 负责"失败可见 + 提前提示"。这也说明原文档把 T1 排在首位是误判，已修正。

### 10.5 顺带发现：remote 投递的"指针不落地"

本机平台**确实用过** remote 通道往 dev 投产物：本机 `deploy_pipelines` 有 `env=dev, module=admin, version_tag=default/4caf272, status=succeeded`（09-11 20:42），且 dev 上存在 `admin/default/4caf272` 目录（mtime 20:40）。

但它是一枚**孤儿产物**：`version` / `pointer` 阶段写的是**本机平台自己的库**，而 dev 的 gateway 读的是 **dev 自己的库**（两套独立 MySQL，`MYSQL_HOST=127.0.0.1` 各指各机）→ **dev 的 manifest 永远不会指向 4caf272**。

含义：**跨机 remote 投递只能送产物、送不了版本指针**。要用它就必须让两边的库/指针打通（或投递后由目标环境自行登记版本），否则产物进来也不会被加载。这也是 §10.2 中 B2 按"责任边界"处理（远端清理由目标环境负责）的现实依据——dev 自己的 cleanup 最终把包括 4caf272 在内的旧版本一并按 5 个窗口管理。

