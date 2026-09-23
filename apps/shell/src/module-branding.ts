/**
 * 按模块切换浏览器页签图标（favicon）。
 *
 * 背景：admin / portal 都是挂在基座下的微前端模块，页签的 `<link rel="icon">` 来自
 * **基座 index.html**（gateway 对 `/admin`、`/portal` 都回退到同一份 shell index.html），
 * 所以两个模块在浏览器里显示同一个图标，多标签打开时无法区分。
 * 改模块自己的 `public/favicon.svg` 只对「模块独立构建/直连访问」生效，对基座托管无效。
 *
 * 因此由基座（唯一知道当前模块的层）在路由切换时改写页签图标。
 *
 * 图标地址：
 * - 默认（portal 及未识别模块）→ 基座自带的 `favicon.svg`（保持原有品牌橙 + 白豆不变）；
 * - admin → 深底 + 品牌橙豆（见 src/assets/brand/favicon-admin.svg）。
 * 两者都用 **绝对地址**：index.html 里原先是相对路径 `favicon.svg`，会随文档 URL 解析，
 * 深链接（如 `/admin/system/dict`）下会被解析成 `/admin/system/favicon.svg` → 404 无图标。
 */
import adminFavicon from './assets/brand/favicon-admin.svg';

/** 基座默认图标：随 shell 产物一起发布，路径随 vite base 变化（BASE_URL 已含结尾斜杠） */
const DEFAULT_FAVICON = `${import.meta.env.BASE_URL}favicon.svg`;

/** 模块名 → 页签图标。未列出的模块沿用默认图标。 */
const MODULE_FAVICONS: Record<string, string> = {
  admin: adminFavicon,
};

/** 供重复调用时复用同一节点（id 便于识别本模块管理的 link） */
const ICON_LINK_ID = 'ws-tab-icon';

function setFavicon(href: string) {
  let link = document.getElementById(ICON_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    // 复用 index.html 里的 <link rel="icon">，避免同时存在两个图标声明
    link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.id = ICON_LINK_ID;
  link.type = 'image/svg+xml';
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/**
 * 应用当前模块的页签图标。
 * @param moduleName 模块名（取自路由参数），空串表示非模块路由（如登录页）→ 默认图标
 */
export function applyModuleBranding(moduleName: string) {
  setFavicon(MODULE_FAVICONS[moduleName] || DEFAULT_FAVICON);
}
