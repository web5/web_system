/**
 * 导航与路径轮询（迁移自 dachengzi helper.js L78–127，原样保留设计决策注释）
 */

const { sleep } = require('./page');

/**
 * url → path 归一化（纯函数）：去前导斜杠、去 query。
 * 如 '/pages/x/index?a=1' → 'pages/x/index'。
 */
function normalizePath(url) {
  return String(url).split('?')[0].replace(/^\//, '');
}

/**
 * 轮询当前页路径直到命中（页面切换期间 getCurrentPage 会偶发 rawPath 竞态报错，忽略重试）。
 * 路径统一为「不含前导斜杠」形式，如 pages/home/index/index。
 */
async function pollPath(mp, expected, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const page = await mp.currentPage();
      if (page && page.path === expected) return page;
    } catch (e) {
      /* 过渡期竞态，忽略 */
    }
    await sleep(400);
  }
  const page = await mp.currentPage();
  throw new Error(`pollPath timeout: expected=${expected}, actual=${page ? page.path : null}`);
}

/**
 * 导航封装：绕开 automator 的 changeRoute（其内部 changeRoute 前后各调一次 currentPage，
 * 在 webview 重建期会抛 rawPath 竞态），直连 wx 方法 + 轮询当前页。
 */
async function nav(mp, method, url) {
  const args = url === undefined ? { delta: 1 } : { url };
  await mp.callWxMethod(method, args);
}

async function switchTab(mp, url) {
  await nav(mp, 'switchTab', url);
  return pollPath(mp, normalizePath(url));
}

async function navigateTo(mp, url) {
  const path = normalizePath(url);
  await nav(mp, 'navigateTo', url);
  return pollPath(mp, path);
}

async function reLaunch(mp, url) {
  const path = normalizePath(url);
  await nav(mp, 'reLaunch', url);
  return pollPath(mp, path);
}

async function navigateBack(mp, expectedPath) {
  await nav(mp, 'navigateBack');
  return pollPath(mp, expectedPath);
}

module.exports = { normalizePath, pollPath, switchTab, navigateTo, reLaunch, navigateBack };
