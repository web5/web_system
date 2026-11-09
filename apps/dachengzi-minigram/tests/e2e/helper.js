/**
 * 大橙子助理 · 小程序 E2E 基础设施封装
 *
 * 隔离两个「必踩坑」：
 * 1. automator 0.12.1 的 MiniProgram.checkVersion() 读 Tool.getInfo().SDKVersion，
 *    但开发者工具 36.6.0 的 automation 协议已移除该字段（返回 undefined），
 *    导致 licia/cmpVersion 里 .split 报错、launch 直接失败 —— 必须在 launch 前 patch 掉。
 * 2. pnpm monorepo：automator 装在根 node_modules，须用绝对路径 require。
 *
 * 不修改产品代码，只封装 launch / 断言 / storage 预置等测试工具。
 */

const MP = require('/Users/geekwen/workspace/web_system-dachengzi/node_modules/miniprogram-automator/out/MiniProgram').default;
// eslint-disable-next-line
MP.prototype.checkVersion = async function () {};

const automator = require('/Users/geekwen/workspace/web_system-dachengzi/node_modules/miniprogram-automator');

const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT_PATH = '/Users/geekwen/workspace/web_system-dachengzi/apps/dachengzi-minigram';

/** 存储 key 真源（与产品 utils/translate-keys、utils/request、utils/appearance 对齐） */
const KEYS = {
  history: 'kd_tr_history',
  params: 'kd_translate_params',
  settings: 'kd_tr_settings',
  radius: 'appearance_radius',
  token: 'access_token',
  refreshToken: 'refresh_token',
  loggedOut: 'account_logged_out',
  apiBase: 'api_base',
  nceMode: 'nce-mode',
  nceFont: 'nce-font',
};

/** 启动小程序（每次 launch 都会起一个新的自动化会话；项目 storage 在 devtools 内持久化） */
async function launch() {
  return automator.launch({ cliPath: CLI_PATH, projectPath: PROJECT_PATH });
}

/** 关闭小程序会话（杀自动化进程；storage 保留在 devtools 项目里） */
async function close(mp) {
  if (!mp) return;
  try {
    await mp.close();
  } catch (e) {
    // close 可能因已断连抛错，忽略
  }
}

/** 读 storage（走小程序上下文里的 wx.getStorageSync） */
async function getStorage(mp, key) {
  return mp.callWxMethod('getStorageSync', key);
}

/** 写 storage */
async function setStorage(mp, key, value) {
  return mp.callWxMethod('setStorageSync', key, value);
}

/** 删 storage */
async function removeStorage(mp, key) {
  return mp.callWxMethod('removeStorageSync', key);
}

/** 取当前页面路径（不含前导斜杠，如 pages/home/index/index） */
async function currentPath(mp) {
  const page = await mp.currentPage();
  return page ? page.path : null;
}

/** 取当前页面栈路径数组 */
async function stackPaths(mp) {
  const pages = await mp.pageStack();
  return pages.map((p) => p.path);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  throw new Error(`pollPath timeout: expected=${expected}, actual=${await currentPath(mp)}`);
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
  return pollPath(mp, url.replace(/^\//, ''));
}

async function navigateTo(mp, url) {
  const path = url.split('?')[0].replace(/^\//, '');
  await nav(mp, 'navigateTo', url);
  return pollPath(mp, path);
}

async function reLaunch(mp, url) {
  const path = url.split('?')[0].replace(/^\//, '');
  await nav(mp, 'reLaunch', url);
  return pollPath(mp, path);
}

async function navigateBack(mp, expectedPath) {
  await nav(mp, 'navigateBack');
  return pollPath(mp, expectedPath);
}

/** 读当前页某个 data 字段（返回 undefined 表示取不到） */
async function pageData(mp, key) {
  const page = await mp.currentPage();
  if (!page) return undefined;
  const d = await page.data();
  return d ? d[key] : undefined;
}

/** 轮询某页 data 字段直到等于期望值（应对 onShow setData 异步） */
async function waitForData(mp, key, expected, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await pageData(mp, key);
    if (JSON.stringify(v) === JSON.stringify(expected)) return v;
    await sleep(400);
  }
  throw new Error(`waitForData timeout: key=${key} expected=${JSON.stringify(expected)} actual=${JSON.stringify(await pageData(mp, key))}`);
}

/** 读当前页 tabBar 组件 selected（0=home 1=discover 2=mine；取不到返回 -1） */
async function tabBarSelected(mp) {
  return mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    const bar = p && typeof p.getTabBar === 'function' ? p.getTabBar() : null;
    return bar && bar.data ? bar.data.selected : -1;
  });
}

/** 简易断言：失败抛错并带期望值 vs 实际值 + 标签 */
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`[FAIL] ${label}\n  expected: ${b}\n  actual:   ${a}`);
  }
}

function assertOk(cond, label, detail) {
  if (!cond) {
    throw new Error(`[FAIL] ${label}${detail ? `\n  detail: ${detail}` : ''}`);
  }
}

/** 逐个跑用例并汇总，返回 { name, status, message }[]（不因单条失败中断） */
async function run(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    console.log(`  ✅ PASS  ${name}  (${ms}ms)`);
    return { name, status: 'PASS', message: '' };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`  ❌ FAIL  ${name}  (${ms}ms)`);
    console.log(`     ${String(e && e.message ? e.message : e)}`);
    return { name, status: 'FAIL', message: String(e && e.message ? e.message : e) };
  }
}

function summary(results) {
  console.log('\n================ 汇总 ================');
  for (const r of results) {
    console.log(`  [${r.status}] ${r.name}${r.message ? ' —— ' + r.message.split('\n')[0] : ''}`);
  }
}

module.exports = {
  automator,
  launch,
  close,
  getStorage,
  setStorage,
  removeStorage,
  currentPath,
  stackPaths,
  pollPath,
  switchTab,
  navigateTo,
  reLaunch,
  navigateBack,
  pageData,
  waitForData,
  tabBarSelected,
  assertEqual,
  assertOk,
  run,
  summary,
  KEYS,
  CLI_PATH,
  PROJECT_PATH,
};
