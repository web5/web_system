/**
 * A. 三 tab 渲染 + 选中态（判据 V21）
 * 依次 switchTab home/discover/mine，断言 currentPage().path 一致 + tabBar selected 一致，再回 home。
 */
const h = require('./helper');

(async () => {
  const mp = await h.launch();
  const results = [];
  try {
    // 启动默认落在首页
    results.push(await h.run('A1 启动默认首页', async () => {
      h.assertEqual(await h.currentPath(mp), 'pages/home/index/index', '启动默认页面路径');
    }));

    results.push(await h.run('A2 switchTab→discover', async () => {
      await h.switchTab(mp, '/pages/discover/index/index');
      h.assertEqual(await h.currentPath(mp), 'pages/discover/index/index', 'discover 路径');
    }));

    results.push(await h.run('A3 discover 选中态=1', async () => {
      h.assertEqual(await h.tabBarSelected(mp), 1, 'tabBar selected');
    }));

    results.push(await h.run('A4 switchTab→mine', async () => {
      await h.switchTab(mp, '/pages/mine/index/index');
      h.assertEqual(await h.currentPath(mp), 'pages/mine/index/index', 'mine 路径');
    }));

    results.push(await h.run('A5 mine 选中态=2', async () => {
      h.assertEqual(await h.tabBarSelected(mp), 2, 'tabBar selected');
    }));

    results.push(await h.run('A6 switchTab→home', async () => {
      await h.switchTab(mp, '/pages/home/index/index');
      h.assertEqual(await h.currentPath(mp), 'pages/home/index/index', 'home 路径');
    }));

    results.push(await h.run('A7 home 选中态=0', async () => {
      h.assertEqual(await h.tabBarSelected(mp), 0, 'tabBar selected');
    }));
  } finally {
    await h.close(mp);
  }

  h.summary(results);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('[A-tabs] ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
