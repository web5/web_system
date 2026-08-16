# 微前端平台技术设计

> 架构基线见 `micro-frontend-architecture.drawio` / 腾讯文档三张图。本文聚焦三个技术模块的详细设计：
> 1. 微前端 js 加载（自研 loader）
> 2. js 版本管理加载（清单协议 + gateway 改造）
> 3. 打包脚本 + 发布服务实现

---

## 1. 微前端 js 加载（自研 loader）

### 1.1 基座 Shell 应用

新建 `apps/shell/`，极简 Vue3 应用，只做四件事：登录鉴权、布局（顶栏+侧栏+`<div id="module-container">`）、路由表占位、装载 loader + externals 预加载。

```
apps/shell/
  src/
    main.ts              # createApp + 预加载 externals + 启动 loader
    App.vue              # 布局壳子：<router-view> + <div id="module-container">
    router.ts            # 基座路由：/login, /, /:module/*
    loader.ts            # MicroFrontendLoader 实例化
    lifecycle.ts         # 基座自己的 bootstrap/mount/unmount（未来 shell 也可被嵌套时用）
  vite.config.ts         # 基座打包，externals 全部 external
  index.html
```

基座 `main.ts` 启动顺序：
1. 从 `window.__SHARED__` 取 vue/vue-router/pinia（基座自己打包时也 external，由一段 inline script 先加载 CDN 或本地 `static/externals/vue.js`）
2. `createApp(Shell).use(router).use(pinia).mount('#app')`
3. router ready 后 `loader.register(window.__MODULES_MANIFEST__.modules)`
4. 命中 `/:module/*` 路由时 `loader.mount(module, container)`

### 1.2 模块生命周期契约

每个微前端模块打包成 UMD，挂到 `window.__MODULES__` 命名空间，暴露四个生命周期：

```ts
// 模块 src/lifecycle.ts
import type { ModuleContext } from '@web-system/shared'

export async function bootstrap(ctx: ModuleContext): Promise<void> {
  // 注册模块子路由到 ctx.router（如 /portal/chat、/portal/settings）
  // 只执行一次，模块首次加载时调用
}

export async function mount(ctx: ModuleContext, container: HTMLElement): Promise<void> {
  // createApp(ModuleRoot).use(ctx.pinia).use(ctx.router).mount(container)
  // 每次进入模块路由时调用
}

export async function unmount(ctx: ModuleContext): Promise<void> {
  // app.unmount()，清理 DOM、事件监听、定时器
  // 离开模块路由时调用
}

export async function update(ctx: ModuleContext, props: Record<string, any>): Promise<void> {
  // 可选：基座向模块传参（如用户信息、主题切换）
}
```

`ModuleContext` 定义（放 `packages/shared/src/micro-frontend.ts`）：
```ts
export interface ModuleContext {
  name: string
  router: Router          // 基座 router 实例，模块注册子路由用
  pinia: Pinia            // 共享 store
  axios: AxiosInstance    // 预配 baseURL + 拦截器的 axios
  eventBus: EventEmitter  // 模块间通信
  env: string             // dev/prod
  user: UserInfo          // 当前登录用户
  container: HTMLElement  // 挂载容器
}
```

### 1.3 自研 loader 设计

新建 `packages/shell-loader/`，框架无关的核心库，基座依赖它。

```ts
// packages/shell-loader/src/loader.ts
export interface ModuleManifest {
  name: string
  version: string
  entry: string           // js URL，如 /static/modules/portal/a1b2c3d/index.js
  css?: string            // css URL
  assetsBase: string      // 模块相对资源根，如 /static/modules/portal/a1b2c3d/
  externals?: Record<string, string>  // 覆盖默认 externals（COS 时用）
}

export interface ModuleInstance {
  manifest: ModuleManifest
  bootstrap: (ctx: ModuleContext) => Promise<void>
  mount: (ctx: ModuleContext, container: HTMLElement) => Promise<void>
  unmount: (ctx: ModuleContext) => Promise<void>
}

export class MicroFrontendLoader {
  private manifests = new Map<string, ModuleManifest>()
  private instances = new Map<string, ModuleInstance>()    // 已加载的模块（bootstrap 后）
  private mounted = new Map<string, ModuleInstance>()      // 当前挂载的模块
  private loading = new Map<string, Promise<ModuleInstance>>()
  private ctx: ModuleContext

  constructor(ctx: ModuleContext) { this.ctx = ctx }

  register(manifests: ModuleManifest[]): void {
    for (const m of manifests) this.manifests.set(m.name, m)
  }

  /** 预加载（不挂载）：用户即将进入某模块时提前拉 js */
  async preload(names: string[]): Promise<void> {
    await Promise.all(names.map(n => this.ensureLoaded(n)))
  }

  /** 挂载模块到容器 */
  async mount(name: string, container: HTMLElement): Promise<void> {
    if (this.mounted.has(name)) return  // 已挂载
    const inst = await this.ensureLoaded(name)
    await inst.mount({ ...this.ctx, container }, container)
    this.mounted.set(name, inst)
  }

  /** 卸载模块 */
  async unmount(name: string): Promise<void> {
    const inst = this.mounted.get(name)
    if (!inst) return
    await inst.unmount(this.ctx)
    this.mounted.delete(name)
    // 不释放 instance（保留 bootstrap 状态，下次 mount 更快）
  }

  /** 卸载所有（基座卸载时用） */
  async unmountAll(): Promise<void> {
    await Promise.all([...this.mounted.keys()].map(n => this.unmount(n)))
  }

  private async ensureLoaded(name: string): Promise<ModuleInstance> {
    if (this.instances.has(name)) return this.instances.get(name)!
    if (this.loading.has(name)) return this.loading.get(name)!

    const manifest = this.manifests.get(name)
    if (!manifest) throw new Error(`模块未注册: ${name}`)

    const promise = this.loadModule(manifest).then(async (inst) => {
      await inst.bootstrap(this.ctx)
      this.instances.set(name, inst)
      this.loading.delete(name)
      return inst
    })
    this.loading.set(name, promise)
    return promise
  }

  /** 动态注入 script + css，等模块挂到 window.__MODULES__[name] */
  private loadModule(manifest: ModuleManifest): Promise<ModuleInstance> {
    return new Promise((resolve, reject) => {
      // CSS
      if (manifest.css) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = manifest.css
        link.dataset.module = manifest.name
        link.dataset.version = manifest.version
        document.head.appendChild(link)
      }
      // JS（UMD，执行后挂到 window.__MODULES__[name]）
      const script = document.createElement('script')
      script.src = manifest.entry
      script.dataset.module = manifest.name
      script.async = true
      script.crossOrigin = 'anonymous'
      script.onload = () => {
        const mod = (window as any).__MODULES__?.[manifest.name]
        if (!mod?.mount) {
          reject(new Error(`模块 ${manifest.name} 未正确暴露 lifecycle`))
          return
        }
        resolve({
          manifest,
          bootstrap: mod.bootstrap || (async () => {}),
          mount: mod.mount,
          unmount: mod.unmount,
        })
      }
      script.onerror = () => reject(new Error(`加载模块失败: ${manifest.entry}`))
      document.head.appendChild(script)
    })
  }

  /** 卸载模块时移除其 CSS link（彻底清理，下次加载重新注入） */
  private removeCss(name: string): void {
    document.querySelectorAll(`link[data-module="${name}"]`).forEach(el => el.remove())
  }
}
```

### 1.4 沙箱与隔离

**第一期不引入快照沙箱或 Proxy 沙箱**（自研复杂度高，且 antd 等组件库 portal 到 body 时会有问题），采用轻量方案：

| 隔离维度 | 方案 | 实现 |
|---|---|---|
| CSS | scope 前缀 | vite 构建时 postcss 插件给每条选择器加 `[data-module="<name>"]` 前缀；模块根容器 `<div data-module="<name>">`。antd 等挂到 body 的弹窗用 portal 容器包裹 |
| JS 全局 | 命名空间 | 模块只允许往 `window.__MODULES__[name]` 挂；不允许写 window 其它字段。lint 规则禁止裸 window 赋值 |
| externals 共享 | 基座预加载 | vue/vue-router/pinia/antd/axios/dayjs 由基座打到 `window.__SHARED__`，模块 external 这些，避免重复打包 |
| 路由 | 子路由注册 | 模块 bootstrap 时向基座 router addRoute，unmount 时 removeRoute |
| 状态 | pinia 模块隔离 | 模块用 `defineStore` 时 name 加模块前缀（如 `portal/chat`），unmount 时 `pinia.state` 删除该模块的 store |

**未来增强**：若出现样式冲突难以排查，第二期切换 shadow DOM（antd 配 `getPopupContainer` 指向 shadow host）。

### 1.5 externals 清单

基座 `static/externals/` 下放预打包的 externals（CDN 兜底）：
```
servers/gateway/public/static/externals/
  vue.js          vue-router.js  pinia.js
  antd.js          axios.js       dayjs.js
```
基座 index.html inline 一段加载器，顺序加载 externals 后再加载 shell.js：

```html
<script>
window.__SHARED__ = {};
window.__MODULES__ = {};
var scripts = ['vue','vue-router','pinia','antd','axios','dayjs'];
var i = 0;
(function next() {
  if (i >= scripts.length) {
    var s = document.createElement('script');
    s.src = '/static/modules/shell/<version>/index.js';
    document.head.appendChild(s);
    return;
  }
  var name = scripts[i++];
  var s = document.createElement('script');
  s.src = '/static/externals/' + name + '.js';
  s.onload = function() {
    window.__SHARED__[name] = window[name.charAt(0).toUpperCase()+name.slice(1).replace('-','')] || window[name];
    next();
  };
  document.head.appendChild(s);
})();
</script>
```

模块 vite externals 映射（见 §3.1）。

### 1.6 路由同步

基座 router 占位：
```ts
// apps/shell/src/router.ts
const routes = [
  { path: '/login', component: Login },
  { path: '/', component: Layout, children: [
    { path: ':module/:pathMatch(.*)*', name: 'module-route', component: { template: '<div id="module-container"></div>' } }
  ]},
]
```

进入 `:module/*` 时：
```ts
router.afterEach(async (to) => {
  const name = to.params.module as string
  const container = document.getElementById('module-container')!
  await loader.unmountAll()  // 先卸载其它模块（单实例模式；多实例可保留）
  await loader.mount(name, container)
})
```

模块 bootstrap 注册子路由示例：
```ts
// apps/portal/src/lifecycle.ts bootstrap
ctx.router.addRoute({ path: '/portal/chat', component: ChatView })
ctx.router.addRoute({ path: '/portal/settings', component: SettingsView })
```

---

## 2. js 版本管理加载

### 2.1 模块清单协议

gateway 向基座 `index.html` 注入 `window.__MODULES_MANIFEST__`（替代当前的单模块 `__DEPLOY_VERSION__`）：

```ts
interface ModulesManifest {
  env: string                       // dev/prod
  modules: ModuleManifestEntry[]    // 当前环境所有启用模块的当前版本
  canary: { module: string; version: string } | null  // 命中灰度的模块（未来）
}

interface ModuleManifestEntry {
  name: string         // portal / admin / mcp-admin
  version: string      // git commit short，如 a1b2c3d
  entry: string        // /static/modules/portal/a1b2c3d/index.js
  css: string | null   // /static/modules/portal/a1b2c3d/index.css
  assetsBase: string   // /static/modules/portal/a1b2c3d/
}
```

注入位置：`<head>` 第一个子节点前。

### 2.2 gateway IndexHtmlService 改造

当前 `index-html.service.ts` 按 `pub` 单模块注入版本。改造方向：

```ts
// servers/gateway/src/deploy-version/index-html.service.ts

@Injectable()
export class IndexHtmlService {
  /**
   * 渲染基座 index.html，注入模块清单
   * pub === 'shell' 时查所有 enabled micro-frontend 模块
   */
  async render(pub: string, req?: any): Promise<string> {
    if (pub === 'shell') {
      const manifest = await this.resolveModulesManifest(this.envId, req)
      return this.injectManifest(this.readHtml('shell'), manifest)
    }
    // 旧 SPA 模式（admin/mcp-admin 过渡期保留）
    return this.renderLegacy(pub, req)
  }

  /** 查所有 enabled 模块的当前版本，拼成 manifest */
  private async resolveModulesManifest(envId: string, req: any): Promise<ModulesManifest> {
    const modules = await this.moduleRepo.find({ where: { type: 'micro-frontend', enabled: true } })
    const entries: ModuleManifestEntry[] = []
    for (const m of modules) {
      const version = await this.getCurrentVersion(envId, m.key)  // 复用现有 TTL 缓存
      if (!version) continue
      const canary = await this.resolveCanary(envId, m.key, version, req)
      const v = canary.version
      entries.push({
        name: m.key,
        version: v,
        entry: `/static/modules/${m.key}/${v}/index.js`,
        css: `/static/modules/${m.key}/${v}/index.css`,
        assetsBase: `/static/modules/${m.key}/${v}/`,
      })
    }
    return { env: envId, modules: entries, canary: null }
  }

  private injectManifest(html: string, manifest: ModulesManifest): string {
    const meta = `<script id="__MODULES_MANIFEST__">window.__MODULES_MANIFEST__=${JSON.stringify(manifest)};</script>`
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`)
    return meta + html
  }

  /** 灰度扩展点：按 req 中的 user/header/cookie 查 deploy_canary_rules */
  private async resolveCanary(envId, moduleKey, stable, req): Promise<{ version: string }> {
    // TODO: const rule = await this.canaryRepo.findOne({ where: { envId, moduleKey, enabled: true } })
    // if (rule && this.matchUser(req, rule)) return { version: rule.canaryVersion }
    return { version: stable }
  }
}
```

### 2.3 静态资源路由（nginx + gateway 分工）

**nginx 配置**（dev 服务器 `/etc/nginx/conf.d/web_system.conf`）：
```nginx
# 模块 js/css —— nginx 直接 serve，不经过 gateway
location /static/modules/ {
  alias /data/web_system/static/modules/;
  # index.js 走 etag（版本切换后要能拿到新的），带 hash 的 assets 强缓存
  location ~* \.js$ {
    add_header Cache-Control "no-cache, must-revalidate";
    etag on;
  }
  location ~* \.(css|png|jpg|svg|woff2?)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
}

# 基座 index.html + API —— 转发 gateway:6000
location / {
  proxy_pass http://127.0.0.1:6000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

**gateway 职责收敛**：
- 只服务基座 `index.html`（注入 manifest）+ `/api/*`
- **删除**旧 `resolveAsset` 的 versions 目录逻辑，不留过渡兜底（模块 js/css 全走 nginx `/static/modules/`）
- 基座 `public/shell/index.html` 由 gateway 直接读文件

### 2.4 版本切换流程

```
deploy-console 发布新版本
  ↓ 写 deploy_versions (component=mf:portal, versionTag=a1b2c3d)
  ↓ 更新 deploy_deployments (envId, moduleKey=portal, currentVersion=a1b2c3d)
  ↓ 上传产物到 nginx 静态目录 /static/modules/portal/a1b2c3d/
  ↓
gateway versionCache TTL 10s 过期
  ↓
用户刷新页面 → gateway 查到新 currentVersion → 注入新 manifest
  ↓
基座 loader 读新 manifest → 加载 /static/modules/portal/a1b2c3d/index.js
  ↓
旧版本目录保留（回滚 = 改 deployments 指针，gateway 缓存过期后生效）
```

### 2.5 灰度扩展点

新增 `deploy_canary_rules` 表，支持三种灰度方式：

```ts
@Entity('deploy_canary_rules')
export class DeployCanaryRuleEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column() @Index() envId: string
  @Column() @Index() moduleKey: string
  @Column() canaryVersion: string        // 灰度版本号
  /**
   * 灰度规则 JSON，支持三种 type：
   *  - user-list: { type: 'user-list', userIds: ['u1','u2',...] }   // 用户名单精确匹配
   *  - percent:   { type: 'percent', value: 10 }                      // 10% 用户走灰度（稳定 hash）
   *  - header:    { type: 'header', key: 'x-canary', values: ['on'] } // 请求头匹配（调试用）
   */
  @Column({ type: 'json' }) matchRule: CanaryMatchRule
  @Column({ default: true }) enabled: boolean
  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date
}

type CanaryMatchRule =
  | { type: 'user-list'; userIds: string[] }
  | { type: 'percent'; value: number }
  | { type: 'header'; key: string; values: string[] }
```

`resolveCanary` 实现（比例灰度用稳定 hash 保证同一用户每次命中结果一致）：

```ts
private async resolveCanary(envId, moduleKey, stable, req): Promise<{ version: string }> {
  const rules = await this.canaryRepo.find({ where: { envId, moduleKey, enabled: true } })
  for (const rule of rules) {
    if (this.matchUser(req, rule.matchRule, rule.id)) {
      return { version: rule.canaryVersion }
    }
  }
  return { version: stable }
}

private matchUser(req: any, rule: CanaryMatchRule, ruleId: string): boolean {
  const userId = req.user?.id || req.headers['x-user-id'] || ''
  switch (rule.type) {
    case 'user-list':
      // 用户名单：精确匹配
      return rule.userIds.includes(userId)
    case 'percent':
      // 比例灰度：userId hash % 100 < value
      // hash 种子加入 ruleId，让不同规则的命中人群错开，避免多个灰度同时命中同一批用户
      if (!userId) return false
      return this.hashUserId(userId + ':' + ruleId) % 100 < rule.value
    case 'header':
      return rule.values.includes(req.headers[rule.key.toLowerCase()])
    default:
      return false
  }
}

/** 稳定字符串 hash（FNV-1a 变体），同一输入永远得到同一数值 */
private hashUserId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)  // 无符号 32 位
}
```

**比例灰度说明**：
- 用户 ID + 规则 ID 一起 hash，再对 100 取模，落在 `[0, value)` 区间即命中
- 同一用户对同一规则多次请求结果稳定（不会忽走 stable 忽走 canary）
- 调整 `value` 可平滑放量：5% → 20% → 50% → 100%
- 调整 `value=100` 等于全量灰度，可作"预发布"用
- 用户名单优先级高于比例：同一模块若同时配了 user-list 和 percent 两条规则，user-list 命中的用户直接走 canary，不参与比例计算（按规则顺序短路）

**第一期 UI**：deploy-console 发布中心给每个微前端模块配一个"灰度规则"卡片，可选三种类型，预览命中用户数（输入 userId 即时算是否命中）。

### 2.6 公开端点（供调试/未来 COS 拉取清单）

保留并扩展 `GET /__version__`：
```ts
// GET /__version__?env=dev&module=portal
// 返回该模块当前版本 + entry URL（供运维/CI 查询）
@Get('/__version__')
async getVersion(@Query('env') env, @Query('module') module) {
  const version = await this.indexHtmlService.getCurrentVersion(env, module)
  return { env, module, version, entry: `/static/modules/${module}/${version}/index.js` }
}

// GET /__manifest__?env=dev  （新增）
// 返回完整模块清单（基座调试/未来 COS 注入用）
@Get('/__manifest__')
async getManifest(@Query('env') env, @Req() req) {
  return this.indexHtmlService.resolveModulesManifest(env, req)
}
```

---

## 3. 打包脚本 + 发布服务实现

### 3.1 模块化 vite 配置

新建 `scripts/vite-micro-frontend.mjs`，提供共享配置工厂：

```js
// scripts/vite-micro-frontend.mjs
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import postcssPrefix from 'postcss-prefix-selector'
import { appVersionDefine, appVersionPlugin } from './vite-app-version.mjs'

// 默认 externals 映射：模块 external 这些，运行时从 window.__SHARED__ 取
const DEFAULT_EXTERNALS = {
  vue: 'window.__SHARED__.vue',
  'vue-router': 'window.__SHARED__["vue-router"]',
  pinia: 'window.__SHARED__.pinia',
  axios: 'window.__SHARED__.axios',
  dayjs: 'window.__SHARED__.dayjs',
}

/**
 * 微前端模块 vite 配置工厂
 * @param {object} opts
 * @param {string} opts.name  模块名（portal/admin/mcp-admin）
 * @param {string} opts.entry  入口文件相对路径，默认 src/main.ts
 */
export function microFrontendConfig({ name, entry = 'src/main.ts' }) {
  const version = process.env.RELEASE_TAG || 'dev'
  return defineConfig({
    base: `/static/modules/${name}/${version}/`,  // 模块内相对资源根
    define: appVersionDefine(),
    plugins: [
      appVersionPlugin(),
      vue(),
      // CSS scope 前缀：每条选择器加 [data-module="<name>"]
      {
        name: 'postcss-module-prefix',
        config() {
          return {
            css: {
              postcss: {
                plugins: [
                  postcssPrefix({
                    prefix: `[data-module="${name}"]`,
                    transform(prefix, selector) {
                      // 不给 html/body 加前缀，避免基座布局被覆盖
                      if (selector.startsWith('html') || selector.startsWith('body')) return selector
                      return `${prefix} ${selector}`
                    },
                  }),
                ],
              },
            },
          }
        },
      },
    ],
    build: {
      outDir: 'dist',
      sourcemap: false,
      cssCodeSplit: false,  // 单 css 文件
      emptyOutDir: true,
      lib: {
        entry,
        formats: ['umd'],
        name: `__modules_${name.replace(/-/g, '_')}`,  // 挂到 window.__modules_<name>
        fileName: () => 'index.js',
      },
      rollupOptions: {
        external: Object.keys(DEFAULT_EXTERNALS),
        output: {
          globals: DEFAULT_EXTERNALS,
          assetFileNames: 'index.[ext]',  // css 产 index.css
        },
      },
    },
  })
}
```

### 3.2 模块入口改造

每个模块新增 `src/lifecycle.ts`，改造 `src/main.ts`：

```ts
// apps/portal/src/lifecycle.ts
import type { ModuleContext } from '@web-system/shared'
import { createApp } from 'vue'
import { useRouter } from 'vue-router'
import App from './App.vue'
import { routes } from './routes'

let app: ReturnType<typeof createApp> | null = null

export async function bootstrap(ctx: ModuleContext): Promise<void> {
  // 注册模块子路由到基座 router
  for (const r of routes) {
    ctx.router.addRoute({ path: `/${ctx.name}${r.path}`, component: r.component })
  }
}

export async function mount(ctx: ModuleContext, container: HTMLElement): Promise<void> {
  app = createApp(App)
  app.use(ctx.pinia)
  app.use(ctx.router)
  app.provide('moduleCtx', ctx)
  app.mount(container)
}

export async function unmount(ctx: ModuleContext): Promise<void> {
  app?.unmount()
  app = null
  // 移除该模块注册的路由
  ctx.router.getRoutes().forEach(r => {
    if (r.path.startsWith(`/${ctx.name}/`)) ctx.router.removeRoute(r.name!)
  })
}
```

```ts
// apps/portal/src/main.ts（微前端模式入口，保留旧 SPA 入口为 main-standalone.ts）
import { bootstrap, mount, unmount } from './lifecycle'
const lifecycle = { bootstrap, mount, unmount }
// vite lib 模式下，UMD name 挂载由 rollup 处理；
// 这里手动挂到 window.__MODULES__ 兜底（dev 直跑时也生效）
;(window as any).__MODULES__ = (window as any).__MODULES__ || {}
;(window as any).__MODULES__['portal'] = lifecycle
export default lifecycle
```

### 3.3 打包脚本

新建 `scripts/build-module.mjs`：

```js
// scripts/build-module.mjs
// 用法: node scripts/build-module.mjs <module-key> [--branch <branch>]
// 流程: 查 DB deploy_modules → git 取 commit → cd apps/<dir> → vite build --mode mf → 产 manifest.json
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'

async function main() {
  const moduleKey = process.argv[2]
  if (!moduleKey) { console.error('用法: build-module.mjs <module-key>'); process.exit(1) }

  // 1. 查模块定义（优先 DB，fallback scripts/modules.json）
  const moduleDef = await resolveModuleDef(moduleKey)  // { key, dir, buildCmd, publicPath }
  if (!moduleDef) { console.error(`模块未注册: ${moduleKey}`); process.exit(1) }

  // 2. git commit 作为版本号
  const commit = execSync('git rev-parse --short HEAD').toString().trim()
  const branch = process.argv.includes('--branch')
    ? process.argv[process.argv.indexOf('--branch') + 1]
    : execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
  const version = commit
  const buildTime = new Date().toISOString()

  // 3. 构建产物到 apps/<dir>/dist
  const appDir = resolve(moduleDef.dir)  // apps/portal
  process.env.RELEASE_TAG = version
  const buildCmd = moduleDef.buildCmd || `npx vite build --mode mf`
  console.log(`[build-module] 构建 ${moduleKey} @ ${version} (${branch})`)
  execSync(buildCmd, { cwd: appDir, stdio: 'inherit', env: { ...process.env, RELEASE_TAG: version } })

  // 4. 写 manifest.json（gateway loader 读）
  const manifest = {
    name: moduleKey,
    version,
    branch,
    commit,
    buildTime,
    entry: `index.js`,
    css: `index.css`,
    assetsBase: ``,  // 相对自身目录
  }
  writeFileSync(join(appDir, 'dist', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[build-module] 产物: ${appDir}/dist/ (index.js + index.css + manifest.json)`)
  console.log(JSON.stringify(manifest))
}

async function resolveModuleDef(key) {
  // TODO: 查 deploy-console DB（HTTP）；fallback scripts/modules.json
  // 第一期直接读 scripts/modules.json
  const modules = JSON.parse(execSync('cat scripts/modules.json').toString())
  return modules.find(m => m.key === key)
}

main().catch(e => { console.error(e); process.exit(1) })
```

每个模块 `vite.config.ts` 增加 `--mode mf` 分支：
```ts
// apps/portal/vite.config.ts
import { microFrontendConfig } from '../../scripts/vite-micro-frontend.mjs'
export default defineConfig(({ mode }) => {
  if (mode === 'mf') return microFrontendConfig({ name: 'portal' })
  // 原 SPA 配置（独立运行/过渡期）
  return { /* 现有配置 */ }
})
```

### 3.4 发布服务 deploy-console 改造

新增 `POST /deploy/modules/publish`（前端模块发布，走 §3.3 打包 + 上传）：

```ts
// servers/deploy-console/src/deploy/deploy.controller.ts
@Post('modules/publish')
@UseGuards(JwtGuard)
async publishModule(
  @Body() dto: PublishModuleDto,  // { envId, moduleKey, branch }
  @CurrentUser() user: User,
) {
  return this.deployService.publishModule(dto.envId, dto.moduleKey, dto.branch, user.username)
}
```

```ts
// servers/deploy-console/src/deploy/deploy.service.ts
async publishModule(envId: string, moduleKey: string, branch: string, operator: string) {
  const env = await this.environmentService.findOne(envId)
  const mod = await this.moduleRegistry.findByKey(moduleKey)
  if (mod.type !== 'micro-frontend') throw new BadRequestException('仅支持微前端模块发布')

  // 1. prod 校验 master
  if (env.key === 'prod' && branch !== 'master') {
    throw new BadRequestException('现网仅允许发布 master 分支版本')
  }

  // 2. 触发任务记录
  const task = await this.createTask({ type: 'deploy', env: env.key, component: `mf:${moduleKey}`, operator })

  try {
    // 3. 本地构建（调 build-module.mjs）
    this.emit(task.id, '执行模块构建...')
    execSync(`node scripts/build-module.mjs ${moduleKey} --branch ${branch}`, {
      cwd: this.repoRoot, stdio: 'pipe',
    })

    // 4. 取产物 version（从 manifest.json）
    const manifest = JSON.parse(readFileSync(`apps/${mod.dir}/dist/manifest.json`, 'utf-8'))
    const version = manifest.version

    // 5. rsync 上传到 nginx 静态目录
    this.emit(task.id, `上传到 ${env.key}: /static/modules/${moduleKey}/${version}/`)
    await this.uploadViaSsh(env, {
      localPath: `apps/${mod.dir}/dist/`,
      remotePath: `${env.remoteDir}/static/modules/${moduleKey}/${version}/`,
      stripComponents: 0,
    })

    // 6. 写版本表
    await this.versionRepo.save({
      component: `mf:${moduleKey}`,
      versionTag: version,
      branch, commit: version,
      envId: env.id,
      files: ['index.js', 'index.css', 'manifest.json'],
      operator,
    })

    // 7. 更新发布指针（deploy_deployments）
    await this.deploymentRepo.save({
      envId: env.id, moduleKey, currentVersion: version,
      deployedAt: new Date(), operator,
    })

    // 8. 审计
    await this.auditService.log({ operator, action: 'module.publish', target: `${env.key}/${moduleKey}:${version}` })

    // 9. 不需要重启 gateway/nginx（gateway versionCache TTL 10s 过期后自动生效）
    await this.completeTask(task.id, 'success')
    this.emit(task.id, `发布完成: ${moduleKey}@${version}`)
  } catch (e) {
    await this.completeTask(task.id, 'failed', e.message)
    throw new InternalServerErrorException(e.message)
  }
}
```

### 3.5 deploy.sh 改造

新增 `deploy_micro_frontend` 函数，**替代** `deploy_frontend`（旧函数删除，不留过渡）：

```bash
# scripts/deploy.sh

# ===========================================================
# 微前端模块发布：本地 vite build → 上传到 nginx static/modules 目录
# 用法: deploy_micro_frontend <module-key>
# 依赖环境变量: DEPLOY_MODULE_JSON（DB 注入模块定义）或 scripts/modules.json
# ===========================================================
deploy_micro_frontend() {
  local key="$1"
  local moduleDef
  moduleDef=$(resolve_module "$key") || err "模块未注册: $key"
  local dir=$(echo "$moduleDef" | jq -r '.dir')
  local pub=$(echo "$moduleDef" | jq -r '.publicPath')

  log "===== 部署微前端模块 $key ====="
  cd "$SCRIPT_DIR/apps/$dir"

  # 版本号 = git commit short
  local tag="${RELEASE_TAG:-$(git rev-parse --short HEAD)}"
  log "构建 $dir (vite build --mode mf, version=$tag)..."
  RELEASE_TAG=$tag npx vite build --mode mf 2>&1 || err "$dir 构建失败"
  log "$dir 构建完成 (index.js + index.css + manifest.json)"

  # 上传到 nginx 静态目录（不走 gateway public）
  log "同步到 nginx 静态目录 ($SERVER:$REMOTE_DIR/static/modules/$key/$tag/)..."
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/static/modules/$key/$tag"
  tar czf - -C dist . | ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/static/modules/$key/$tag && tar xzf -"
  log "$key 同步完成 (版本目录: static/modules/$key/$tag)"

  # 不重启 gateway（gateway versionCache TTL 自动过期；nginx 静态目录直出）
  # 不写兜底目录（微前端版本切换由 deployments 指针控制，不需要兜底）
}
```

后端 `deploy_backend_git` 保持不变；deploy_modules 中 `type=backend` 的记录 `key=服务名`（如 `auth-service`），`pm2` 字段对应进程名，`dir=servers/auth-service`。

### 3.6 数据库变更

`deploy_modules` 新增字段：
```ts
// deploy-module.entity.ts 新增
@Column({ type: 'varchar', length: 255, nullable: true, comment: '完整入口 URL（COS 时覆盖相对 entry）' })
entryUrl?: string

@Column({ type: 'json', nullable: true, comment: '模块 externals 清单（覆盖默认）' })
externals?: Record<string, string>

@Column({ type: 'boolean', default: false, comment: '是否基座（shell）' })
isShell?: boolean
```

新增 `deploy_canary_rules` 表（第一期建表不接 UI）：
```ts
@Entity('deploy_canary_rules')
export class DeployCanaryRuleEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column() @Index() envId: string
  @Column() @Index() moduleKey: string
  @Column() canaryVersion: string
  @Column({ type: 'json' }) matchRule: { type: 'header'|'cookie'|'user'; key: string; values: string[] }
  @Column({ default: true }) enabled: boolean
  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date
}
```

### 3.7 目录结构最终态

```
/data/web_system/
  static/
    externals/                 # 公共依赖（nginx 直出）
      vue.js  vue-router.js  pinia.js
      antd.js  axios.js  dayjs.js
    modules/                   # 微前端模块产物（nginx 直出）
      portal/
        a1b2c3d/  e4f5g6h/  ...   # 每版本一目录，永久保留
          index.js
          index.css
          manifest.json
      admin/  mcp-admin/  ...
  servers/
    gateway/
      public/
        shell/                 # 基座 index.html + assets（gateway serve + 注入 manifest）
          index.html
          assets/
        externals/             # externals 同步一份（nginx alias 指向）
```

**未来迁 COS**：只需把 `static/modules/` 整体迁到 COS，gateway 注入 manifest 时把 entry 改成完整 CDN URL（用 `deploy_modules.entryUrl` 字段覆盖），nginx location 可保留作 fallback。基座 loader 逻辑零改动。

### 3.8 改造范围（第一期一次性完成，不留旧 SPA 过渡）

| 范围 | 改造动作 |
|---|---|
| `apps/shell/`（新建） | 基座应用 + 装载 loader |
| `apps/portal/` | 改造为微前端模块：新增 `src/lifecycle.ts`，`vite.config.ts` 增加 `mode=mf` 分支，原 `main.ts` 保留为 `main-standalone.ts`（本地 dev 直跑用） |
| `apps/admin-web/` | 同上 |
| `apps/mcp-admin/` | 同上 |
| `apps/deploy-console/` | **保持独立 SPA 不微前端化**（避免发布平台依赖被发布物；登录/布局自包含） |
| `servers/gateway/src/deploy-version/index-html.service.ts` | 删除 `resolveAsset` 旧逻辑，`render` 只保留 shell 走 manifest 注入 + deploy-console 走旧 SPA 两种 |
| `servers/gateway/src/main.ts` | SPA 回退中间件：`/admin`、`/mcp-admin` 不再走 `sendIndex`（改由基座路由处理）；保留 `/console/`（deploy-console）和 `/`（shell） |
| `scripts/deploy.sh` | **删除** `deploy_frontend` / `deploy_portal`，由 `deploy_micro_frontend` 统一替代；`deploy_backend_git` 不变 |
| `servers/gateway/public/versions/` | 不再写兜底目录（模块走 nginx `/static/modules/`） |

**dev 直跑**：模块本地开发时 `vite` dev server 仍走 `main-standalone.ts`（独立 SPA 模式，proxy 到 gateway:6000）；基座 dev 时用 `vite` dev server 跑 shell，模块通过 `vite-plugin-federation-mock` 或简单 proxy 加载本地 dev 版本。

后端发布（`deploy_backend_git`）不受影响。

### 3.9 nginx 完整配置片段

```nginx
# /etc/nginx/conf.d/web_system.conf（dev 服务器）

# 公共依赖 externals
location /static/externals/ {
  alias /data/web_system/servers/gateway/public/static/externals/;
  add_header Cache-Control "public, max-age=31536000, immutable";
}

# 微前端模块 js/css —— nginx 直出，不经过 gateway
location /static/modules/ {
  alias /data/web_system/static/modules/;
  location ~* \.js$ {
    add_header Cache-Control "no-cache, must-revalidate";
    etag on;
    add_header Access-Control-Allow-Origin "*";
  }
  location ~* \.(css|png|jpg|svg|woff2?)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    add_header Access-Control-Allow-Origin "*";
  }
}

# 基座 index.html + API → gateway
location / {
  proxy_pass http://127.0.0.1:6000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

---

## 附录：关键文件清单

| 类型 | 路径 | 动作 |
|---|---|---|
| 新建 | `apps/shell/` | 基座应用 |
| 新建 | `packages/shell-loader/` | 自研 loader |
| 新建 | `packages/shared/src/micro-frontend.ts` | ModuleContext / ModuleManifest 类型 |
| 新建 | `scripts/vite-micro-frontend.mjs` | 模块化 vite 配置工厂 |
| 新建 | `scripts/build-module.mjs` | 模块打包脚本 |
| 改造 | `servers/gateway/src/deploy-version/index-html.service.ts` | 注入 manifest（替代单模块版本）；删除 resolveAsset |
| 改造 | `servers/gateway/src/main.ts` | SPA 回退：`/`→shell、`/console/`→deploy-console；删除 admin/mcp-admin 的 sendIndex |
| 改造 | `servers/deploy-console/src/deploy/deploy.service.ts` | 新增 publishModule |
| 改造 | `servers/deploy-console/src/deploy/deploy.controller.ts` | 新增 POST /deploy/modules/publish |
| 改造 | `servers/deploy-console/src/entities/deploy-module.entity.ts` | 新增 entryUrl/externals/isShell |
| 新建 | `servers/deploy-console/src/entities/deploy-canary-rule.entity.ts` | 灰度规则表（user-list / percent / header） |
| 新建 | `servers/deploy-console/src/canary/canary.service.ts` + `canary.controller.ts` + `canary.module.ts` | 灰度规则 CRUD + 命中预览接口 |
| 改造 | `scripts/deploy.sh` | 删除 deploy_frontend/deploy_portal，新增 deploy_micro_frontend |
| 改造 | `apps/portal/vite.config.ts`、`apps/admin-web/vite.config.ts`、`apps/mcp-admin/vite.config.ts` | 增加 mode=mf 分支 |
| 新建 | `apps/portal/src/lifecycle.ts`、`apps/admin-web/src/lifecycle.ts`、`apps/mcp-admin/src/lifecycle.ts` | 各模块生命周期 |
| 改造 | dev 服务器 nginx conf | /static/modules/ + /static/externals/ location |
