/**
 * 新版本探测（基座）。
 *
 * 为什么需要：shell 是「指针型」入口 —— /shell/index.html 引用带 hash 的 assets，
 * 发布新 shell 后已打开的标签页仍跑旧代码。此前若整页刷新时命中缓存/内存里的旧 HTML，
 * 会去请求**已被删除**的旧 hash 资源，而网关当时把缺失文件回退成 200 + HTML，
 * 导致「白屏 + console 零日志」，用户只能靠"退出重新登录"来恢复。
 * 现在：网关侧已改为缺失即 404（可见），这里再补一层主动提示 ——
 * 比对「构建时注入的版本」与「服务端最新 version.json」，不一致就提示点击刷新。
 */

/** 构建时注入（scripts/vite-app-version.mjs 的 __APP_VERSION__ = git short commit） */
declare const __APP_VERSION__: string;

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const BANNER_ID = 'ws-version-banner';

function currentVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : '';
}

function showBanner(latest: string) {
  if (document.getElementById(BANNER_ID)) return;
  const el = document.createElement('div');
  el.id = BANNER_ID;
  el.setAttribute('role', 'button');
  el.textContent = `发现新版本（${latest}），点击刷新`;
  el.title = `当前页面版本 ${currentVersion()}，服务端已更新到 ${latest}`;
  el.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:9999',
    'padding:10px 16px',
    'border-radius:6px',
    'background:#fa8c16',
    'color:#fff',
    'font-size:13px',
    'line-height:1.4',
    'cursor:pointer',
    'box-shadow:0 4px 12px rgba(0,0,0,.18)',
  ].join(';');
  el.onclick = () => location.reload();
  document.body.appendChild(el);
}

async function checkVersion(): Promise<void> {
  try {
    // no-store：version.json 是「指针」文件，必须绕过一切缓存
    const res = await fetch('/shell/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    const latest = String(data?.version || '');
    const current = currentVersion();
    if (latest && current && latest !== current) showBanner(latest);
  } catch {
    // 网络异常忽略，等下一轮
  }
}

/** 启动后查一次 + 定时查 + 回到前台时查 */
export function startVersionCheck(): void {
  setTimeout(() => void checkVersion(), 3000);
  setInterval(() => void checkVersion(), CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkVersion();
  });
}
