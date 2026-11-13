/**
 * F. 清缓存白名单（判据 V45）
 * 预置白名单 key（token / 偏好 / 常用功能）+ 非白名单垃圾 key，
 * 走「我的→设置→清除缓存」clearCache 逻辑（二次确认 mock 为 confirm），
 * 断言：白名单 key 全保留、非白名单 key 被清。
 */
const TOKEN = 'e2e-cache-token';
const REFRESH = 'e2e-cache-refresh';
const RADIUS = 'crisp';
const PINNED = ['nce', 'glossary'];
const NCE_FONT = 2;
const JUNK1 = 'junk_e2e_key';
const JUNK2 = 'temp_foo';

module.exports = {
  name: 'F. 清缓存白名单（判据 V45）',
  async run(ctx) {
    const { mp } = ctx;

    await ctx.run('F1 预置白名单 + 垃圾 key', async () => {
      await ctx.setStorage(mp, ctx.KEYS.token, TOKEN);
      await ctx.setStorage(mp, ctx.KEYS.refreshToken, REFRESH);
      await ctx.removeStorage(mp, ctx.KEYS.loggedOut);
      await ctx.setStorage(mp, ctx.KEYS.radius, RADIUS);
      await ctx.setStorage(mp, ctx.KEYS.featurePinned, PINNED);
      await ctx.setStorage(mp, ctx.KEYS.nceFont, NCE_FONT);
      await ctx.setStorage(mp, JUNK1, 'garbage-1');
      await ctx.setStorage(mp, JUNK2, { foo: 42 });
      // 确认垃圾 key 确实已写入
      ctx.assertEqual(await ctx.getStorage(mp, JUNK1), 'garbage-1', '垃圾 key1 读回');
      ctx.assertEqual(await ctx.getStorage(mp, JUNK2), { foo: 42 }, '垃圾 key2 读回');
    });

    await ctx.run('F2 进「我的→设置」页（需登录态）', async () => {
      await ctx.navigateTo(mp, '/pages/mine/settings/settings');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/mine/settings/settings', '设置页路径');
    });

    await ctx.run('F3 调 clearCache（mock 确认）', async () => {
      // 注：automator 的 page.callMethod 对本项目 Proxy 页面失效（this.xxx is not a function），
      // 改用 evaluate 在 app 上下文直接调用页面方法。
      await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
      await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        p.clearCache();
        return new Promise((resolve) => setTimeout(resolve, 600));
      });
      await mp.restoreWxMethod('showModal');
    });

    await ctx.run('F4 白名单：token/refresh 保留', async () => {
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.token), TOKEN, 'access_token');
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.refreshToken), REFRESH, 'refresh_token');
    });

    await ctx.run('F5 白名单：偏好/常用功能保留', async () => {
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.radius), RADIUS, 'appearance_radius');
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.featurePinned), PINNED, 'feature_pinned');
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.nceFont), NCE_FONT, 'nce-font');
    });

    await ctx.run('F6 非白名单垃圾 key 被清', async () => {
      const j1 = await ctx.getStorage(mp, JUNK1);
      const j2 = await ctx.getStorage(mp, JUNK2);
      ctx.assertOk(!j1 && !j2, '垃圾 key 应被清除', `junk1=${JSON.stringify(j1)} junk2=${JSON.stringify(j2)}`);
    });
  },
};
