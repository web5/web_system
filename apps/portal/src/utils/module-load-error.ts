/**
 * 微前端模块「资源已过期」兜底提示（portal）。
 *
 * 背景（2026-09-11 白屏事故）：
 *   模块入口/分包被服务端清理或覆盖后，路由懒加载的动态 import 会失败。而 vue-router
 *   生产构建把导航失败的错误提示包在 __DEV__ 分支里，**静默吞掉** ——
 *   表现为「页面全白 + 控制台零日志 + URL 不变」，用户与排查者都无从下手。
 *
 * 这里把「资源类失败」变成可见、可自救（刷新即拉取最新产物）的提示页。
 * 只处理 chunk / 动态 import 类错误，其它错误照旧抛出，避免掩盖真实缺陷。
 *
 * 为什么不放 @web-system/ui：该包以 dist 产物被各模块消费，而当前发布流水线的
 * 阶段命令并不构建它 —— 放进去会要求额外构建步骤，反而制造新的"改了不生效"。
 */
const OVERLAY_ID = 'ws-module-load-error';

/** 动态 import / chunk 加载失败的识别（不同浏览器与打包器文案不同） */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /dynamically imported module|Importing a module script failed|Loading chunk \S+ failed|Loading CSS chunk|ChunkLoadError|error loading dynamically imported module/i.test(
    msg,
  );
}

export interface ModuleLoadErrorOptions {
  /** 出问题的模块名（如 portal） */
  moduleName?: string;
  /** 触发来源，便于定位（如 router） */
  source?: string;
}

/**
 * 渲染「资源已过期」遮罩。幂等：已存在则跳过。
 * 全程内联样式 —— 出问题时模块 CSS 往往也加载失败，不能依赖外部样式表。
 */
export function showModuleLoadError(err: unknown, options: ModuleLoadErrorOptions = {}): void {
  const tag = options.moduleName ? `${options.moduleName}${options.source ? `/${options.source}` : ''}` : options.source;
  console.error(`[module] 资源加载失败${tag ? ` (${tag})` : ''}:`, err);

  if (typeof document === 'undefined' || document.getElementById(OVERLAY_ID)) return;

  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  wrap.setAttribute('role', 'alertdialog');
  wrap.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(255,255,255,.96)',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText =
    'max-width:420px;padding:28px 32px;border:1px solid #ffe7ba;border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.08);text-align:center';

  const title = document.createElement('p');
  title.textContent = '页面资源已更新';
  title.style.cssText = 'margin:0 0 10px;font-size:16px;font-weight:600;color:#1f1f1f';

  const desc = document.createElement('p');
  desc.textContent = '当前页面加载的部分资源已被新版本替换，刷新后即可继续使用。';
  desc.style.cssText = 'margin:0 0 20px;font-size:13px;line-height:1.7;color:#595959';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '刷新页面';
  btn.style.cssText =
    'padding:8px 20px;border:none;border-radius:6px;background:#f97316;color:#fff;font-size:14px;cursor:pointer';
  btn.onclick = () => window.location.reload();

  box.appendChild(title);
  box.appendChild(desc);
  box.appendChild(btn);

  if (tag) {
    const hint = document.createElement('p');
    hint.textContent = `（${tag}）`;
    hint.style.cssText = 'margin:14px 0 0;font-size:12px;color:#bfbfbf';
    box.appendChild(hint);
  }

  wrap.appendChild(box);
  document.body.appendChild(wrap);
}

/**
 * 安装全局兜底：捕获 router.onError 覆盖不到的资源类失败
 * （组件内 defineAsyncComponent、手动 import() 等）。
 *
 * 只在模块入口（router/index.ts，模块级单例）调用一次；showModuleLoadError 自身幂等，
 * 多模块共存时即便挂多个监听也只会渲染一个遮罩。
 */
export function installChunkLoadErrorGuard(moduleName: string): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkLoadError((e as PromiseRejectionEvent).reason)) {
      showModuleLoadError((e as PromiseRejectionEvent).reason, { moduleName, source: 'unhandledrejection' });
    }
  });
}
