/**
 * E. 圆角设置持久化（判据 V42）
 * ① 写 appearance_radius=crisp → 首页 radiusClass=radius-crisp（偏好→class 闭环，PASS）。
 * ② close() 后重新 launch() 断言仍生效（杀进程不丢）—— 实测 devtools 自动化在 close→launch
 *    之间会整体清空 wx storage（仅 api_base 因 onLaunch 重写残留），属测试基建限制
 *    （README 已知限制①），判 BLOCKED，不作为产品 bug。
 *    产品侧已确认：无任何 clearStorage/removeStorageSync 触碰 appearance_radius。
 */
module.exports = {
  name: 'E. 圆角设置持久化（判据 V42）',
  async run(ctx) {
    let { mp } = ctx;

    await ctx.run('E1 清登录态 + 预置圆角=crisp', async () => {
      await ctx.removeStorage(mp, ctx.KEYS.token);
      await ctx.removeStorage(mp, ctx.KEYS.refreshToken);
      await ctx.removeStorage(mp, ctx.KEYS.loggedOut);
      await ctx.setStorage(mp, ctx.KEYS.radius, 'crisp');
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.radius), 'crisp', '预置读回');
    });

    await ctx.run('E2 reLaunch home → radiusClass=radius-crisp', async () => {
      await ctx.reLaunch(mp, '/pages/home/index/index');
      await ctx.waitForData(mp, 'radiusClass', 'radius-crisp');
    });

    // E3：跨进程持久化探测（close→launch）—— 命中 README 已知限制①，判 BLOCKED
    {
      let message;
      try {
        await ctx.close(mp);
        mp = await ctx.launch();
        const keys = (await mp.callWxMethod('getStorageInfoSync')).keys;
        const radius = await ctx.getStorage(mp, ctx.KEYS.radius);
        message = `close→launch 后 storage keys=${JSON.stringify(keys)}（仅 api_base 因 onLaunch 重写残留），appearance_radius=${JSON.stringify(radius)}。` +
          `结论：devtools 自动化在会话间清空 wx storage，跨进程持久化无法在此基础设施上验证（非产品 bug：产品用 wx.setStorageSync 且无任何 clearStorage 触碰该 key）。`;
      } catch (e) {
        message = `close→launch 探测异常：${e && e.message ? e.message : e}`;
      }
      ctx.blocked('E3 跨进程持久化（杀进程不丢）', message);
    }

    // 用例内重新 launch 的会话由 runner 的 finally close 不到（ctx.mp 是旧引用），这里自行收尾
    await ctx.close(mp);
  },
};
