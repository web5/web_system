/**
 * A. 启动到达首页（kedou 首条用例，步骤号 A1 起，字母 per-app 独立计数）
 *
 * launch → pollPath(entryPath) → assertEqual(currentPath, entryPath)。
 * entryPath = pages/welcome/index/index（= app.json pages[0]）。
 *
 * 实现核对记录（2026-11-11）：welcome 页源码 pages/welcome/index/index.ts 无
 * 「已登录自动跳 chat」逻辑——仅 onLoad(?to=chat) 指令分支与用户点击才 navigateTo 对话页，
 * 冷启动落点恒为 welcome，故直接断言等值（不需要「welcome 或 chat 之一」的宽口径）。
 */
module.exports = {
  name: 'A. 启动到达首页（kedou 首条）',
  async run(ctx) {
    const { mp } = ctx;

    await ctx.run('A1 启动到达 welcome 首页', async () => {
      await ctx.pollPath(mp, 'pages/welcome/index/index');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/welcome/index/index', '启动落点路径');
    });
  },
};
