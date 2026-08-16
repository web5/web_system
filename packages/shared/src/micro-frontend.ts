/**
 * 微前端平台共享类型定义。
 * 基座 shell-loader、各业务模块、gateway IndexHtmlService 共同引用。
 */

/** 模块上下文：基座在 bootstrap/mount 时传给模块的运行环境句柄。 */
export interface ModuleContext {
  /** 模块名（与 manifest.name 一致，如 portal / admin / mcp-admin） */
  name: string;
  /** 基座 vue-router 实例，模块 bootstrap 时 addRoute 注册子路由 */
  router: any;
  /** 共享 pinia 实例 */
  pinia: any;
  /** 预配 baseURL + 拦截器的 axios（已带 token） */
  axios: any;
  /** 模块间通信事件总线 */
  eventBus: any;
  /** 当前环境 dev/prod */
  env: string;
  /** 当前登录用户（基座鉴权后注入） */
  user: UserInfo | null;
  /** 模块挂载容器 DOM 节点（HTMLElement；shared 不依赖 DOM lib，用 any 避免 lib 污染） */
  container: any;
}

export interface UserInfo {
  id: string;
  username: string;
  avatar?: string;
  [k: string]: any;
}

/** 模块清单条目：gateway 注入到 window.__MODULES_MANIFEST__.modules[] */
export interface ModuleManifestEntry {
  name: string;
  /** git commit short，如 a1b2c3d */
  version: string;
  /** js 入口 URL，如 /static/modules/portal/a1b2c3d/index.js */
  entry: string;
  /** css URL，无则 null */
  css: string | null;
  /** 模块相对资源根，如 /static/modules/portal/a1b2c3d/ */
  assetsBase: string;
}

/** 完整模块清单：gateway 向基座 index.html 注入 */
export interface ModulesManifest {
  env: string;
  modules: ModuleManifestEntry[];
  /** 命中灰度的模块（未来用），null 表示无灰度 */
  canary: { module: string; version: string } | null;
}

/** 模块生命周期契约：模块打包后挂到 window.__MODULES__[name] */
export interface ModuleLifecycle {
  bootstrap: (ctx: ModuleContext) => Promise<void> | void;
  mount: (ctx: ModuleContext, container: any) => Promise<void> | void;
  unmount: (ctx: ModuleContext) => Promise<void> | void;
  update?: (ctx: ModuleContext, props: Record<string, any>) => Promise<void> | void;
}

/** 已加载的模块实例（loader 内部用） */
export interface ModuleInstance {
  manifest: ModuleManifestEntry;
  lifecycle: ModuleLifecycle;
}

/** loader register 用的 manifest（与 ModuleManifestEntry 同构，便于复用） */
export type ModuleManifest = ModuleManifestEntry;
