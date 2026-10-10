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
 * ## 图标地址：一律**站根绝对路径**，不用模块产物路径
 *
 * 图标是**品牌资产，不随代码版本走**。此前用 `BASE_URL + 'favicon.svg'`（BASE_URL 是版本目录
 * `/static/modules/shell/<env>/<版本>/`）上线看着正常，但远端产物清理只保留有限版本，
 * 旧版本目录被删掉后该地址即 404 —— 于是「清了一次历史产物」就把线上页签图标弄没了。
 *
 * 站根两个固定地址，由 gateway 静态根提供（dev = `servers/gateway/public/`、
 * prod = 外置根 `/data/web_system_static/public/`），与版本无关：
 * - `/favicon.svg` —— 默认（portal 及未识别模块）：品牌橙底 + 白豆
 * - `/favicon-admin.svg` —— admin：透明底 + 品牌橙豆
 *
 * 用绝对地址还有第二个原因（index.html 同理）：相对路径 `favicon.svg` 会随文档 URL 解析，
 * 深链接（如 `/admin/system/dict`）下变成 `/admin/system/favicon.svg` → 404 无图标。
 *
 * ⚠️ 同一份 admin 图标另存于 `apps/admin/public/favicon-admin.svg`（admin 独立构建时
 * `public/` 即站根），改样式要两处同步。
 */

/** 站根默认图标（不随 shell 版本漂移，见文件头说明） */
const DEFAULT_FAVICON = '/favicon.svg';

/** 模块名 → 页签图标（站根地址）。未列出的模块沿用默认图标。 */
const MODULE_FAVICONS: Record<string, string> = {
  admin: '/favicon-admin.svg',
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
