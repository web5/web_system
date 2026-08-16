import type {
  ModuleManifest,
  ModuleInstance,
  ModuleContext,
  ModuleLifecycle,
} from '@web-system/shared';

/**
 * 自研微前端加载器。
 * 不依赖 qiankun / single-spa 等第三方库。
 *
 * 职责：
 * - register(manifests)：注册 gateway 注入的模块清单
 * - preload(names)：预加载模块 js（不挂载）
 * - mount(name, container)：挂载模块到 DOM 容器
 * - unmount(name)：卸载模块（保留 bootstrap 状态，便于快速重挂）
 * - unmountAll()：卸载所有模块（基座卸载用）
 *
 * 模块契约：UMD 打包后挂到 window.__MODULES__[name]，暴露 bootstrap/mount/unmount。
 */
export class MicroFrontendLoader {
  /** 已注册的模块清单（name → manifest） */
  private manifests = new Map<string, ModuleManifest>();
  /** 已加载 js 并 bootstrap 过的模块实例 */
  private instances = new Map<string, ModuleInstance>();
  /** 当前已挂载的模块 */
  private mounted = new Map<string, ModuleInstance>();
  /** 正在挂载中的模块（防并发重复挂载） */
  private mounting = new Set<string>();
  /** 加载中的 promise（防重复加载） */
  private loading = new Map<string, Promise<ModuleInstance>>();

  constructor(private ctx: ModuleContext) {}

  /** 注册模块清单（gateway 注入后调用） */
  register(manifests: ModuleManifest[]): void {
    for (const m of manifests) {
      this.manifests.set(m.name, m);
    }
  }

  /** 判断模块是否已注册（供路由 404 兜底判断） */
  has(name: string): boolean {
    return this.manifests.has(name);
  }

  /** 预加载模块（不挂载）：用户即将进入某模块时提前拉 js */
  async preload(names: string[]): Promise<void> {
    await Promise.all(names.map((n) => this.ensureLoaded(n).catch(() => void 0)));
  }

  /** 挂载模块到容器（并发安全：mounted/mounting 双重检查，防止重复挂载） */
  async mount(name: string, container: HTMLElement): Promise<void> {
    if (this.mounted.has(name)) return;
    if (this.mounting.has(name)) return;  // 正在挂载中，跳过并发调用
    this.mounting.add(name);
    try {
      const inst = await this.ensureLoaded(name);
      // 每次挂载都确保 CSS 已注入（重挂时 unmount 已移除 CSS，这里兜底重新注入）
      this.ensureCss(name);
      await inst.lifecycle.mount({ ...this.ctx, name, container }, container);
      this.mounted.set(name, inst);
    } finally {
      this.mounting.delete(name);
    }
  }

  /** 卸载模块（保留 instance，便于快速重挂；同时移除 CSS，避免 :root 变量跨模块污染） */
  async unmount(name: string): Promise<void> {
    const inst = this.mounted.get(name);
    if (!inst) return;
    try {
      await inst.lifecycle.unmount(this.ctx);
    } catch (e) {
      console.warn(`[loader] unmount ${name} 异常:`, e);
    }
    this.mounted.delete(name);
    this.removeCss(name);
  }

  /** 卸载所有已挂载模块 */
  async unmountAll(): Promise<void> {
    const names = [...this.mounted.keys()];
    await Promise.all(names.map((n) => this.unmount(n)));
  }

  /** 释放模块（卸载 + 移除 css + 清缓存，彻底回收） */
  async release(name: string): Promise<void> {
    await this.unmount(name);
    this.instances.delete(name);
    this.removeCss(name);
  }

  /** 确保模块已加载并 bootstrap（幂等） */
  private async ensureLoaded(name: string): Promise<ModuleInstance> {
    const cached = this.instances.get(name);
    if (cached) return cached;
    const loading = this.loading.get(name);
    if (loading) return loading;

    const manifest = this.manifests.get(name);
    if (!manifest) throw new Error(`模块未注册: ${name}`);

    const promise = this.loadModule(manifest).then(async (lifecycle) => {
      const inst: ModuleInstance = { manifest, lifecycle };
      await lifecycle.bootstrap({ ...this.ctx, name });
      this.instances.set(name, inst);
      this.loading.delete(name);
      return inst;
    });
    this.loading.set(name, promise);
    return promise;
  }

  /** 动态注入 script + css，等模块挂到 window.__MODULES__[name] */
  private loadModule(manifest: ModuleManifest): Promise<ModuleLifecycle> {
    return new Promise((resolve, reject) => {
      // CSS（幂等：已注入则跳过）
      this.ensureCss(manifest.name);
      // JS（UMD，执行后挂到 window.__MODULES__[name]）
      const script = document.createElement('script');
      script.src = manifest.entry;
      script.dataset.module = manifest.name;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const mod = (window as any).__MODULES__?.[manifest.name];
        if (!mod || typeof mod.mount !== 'function') {
          reject(new Error(`模块 ${manifest.name}@${manifest.version} 未正确暴露 lifecycle（缺 mount）`));
          return;
        }
        resolve({
          bootstrap: mod.bootstrap || (async () => {}),
          mount: mod.mount,
          unmount: mod.unmount || (async () => {}),
          update: mod.update,
        });
      };
      script.onerror = () => reject(new Error(`加载模块失败: ${manifest.entry}`));
      document.head.appendChild(script);
    });
  }

  /** 幂等注入模块 CSS（已存在同 data-module 的 link 则跳过） */
  private ensureCss(name: string): void {
    const manifest = this.manifests.get(name);
    if (!manifest?.css) return;
    if (document.querySelector(`link[data-module="${name}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = manifest.css;
    link.dataset.module = name;
    link.dataset.version = manifest.version;
    document.head.appendChild(link);
  }

  /** 移除模块的 CSS link */
  private removeCss(name: string): void {
    document.querySelectorAll(`link[data-module="${name}"]`).forEach((el) => el.remove());
  }

  /** 调试：列出当前注册/已加载/已挂载的模块名 */
  debug(): { registered: string[]; loaded: string[]; mounted: string[] } {
    return {
      registered: [...this.manifests.keys()],
      loaded: [...this.instances.keys()],
      mounted: [...this.mounted.keys()],
    };
  }
}
