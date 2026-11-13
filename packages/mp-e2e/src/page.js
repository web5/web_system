/**
 * 页面读取：currentPath / stackPaths / pageData / waitForData / tabBarSelected
 * （迁移自 dachengzi helper.js L67–76、L130–156，原样）
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 读当前页 tabBar 组件 selected（取不到返回 -1） */
async function tabBarSelected(mp) {
  return mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    const bar = p && typeof p.getTabBar === 'function' ? p.getTabBar() : null;
    return bar && bar.data ? bar.data.selected : -1;
  });
}

module.exports = { sleep, currentPath, stackPaths, pageData, waitForData, tabBarSelected };
