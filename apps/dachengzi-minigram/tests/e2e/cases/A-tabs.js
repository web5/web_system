/**
 * A. 三 tab 渲染 + 选中态（判据 V21）
 * 依次 switchTab home/discover/mine，断言 currentPage().path 一致 + tabBar selected 一致，再回 home。
 */
module.exports = {
  name: 'A. 三 tab 渲染 + 选中态（判据 V21）',
  async run(ctx) {
    const { mp } = ctx;

    // 启动默认落在首页
    await ctx.run('A1 启动默认首页', async () => {
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/home/index/index', '启动默认页面路径');
    });

    await ctx.run('A2 switchTab→discover', async () => {
      await ctx.switchTab(mp, '/pages/discover/index/index');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/discover/index/index', 'discover 路径');
    });

    await ctx.run('A3 discover 选中态=1', async () => {
      ctx.assertEqual(await ctx.tabBarSelected(mp), 1, 'tabBar selected');
    });

    await ctx.run('A4 switchTab→mine', async () => {
      await ctx.switchTab(mp, '/pages/mine/index/index');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/mine/index/index', 'mine 路径');
    });

    await ctx.run('A5 mine 选中态=2', async () => {
      ctx.assertEqual(await ctx.tabBarSelected(mp), 2, 'tabBar selected');
    });

    await ctx.run('A6 switchTab→home', async () => {
      await ctx.switchTab(mp, '/pages/home/index/index');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/home/index/index', 'home 路径');
    });

    await ctx.run('A7 home 选中态=0', async () => {
      ctx.assertEqual(await ctx.tabBarSelected(mp), 0, 'tabBar selected');
    });
  },
};
