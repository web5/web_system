/**
 * C. 翻译设置偏好初值闭环（判据 V52③）
 * 预置 kd_tr_settings（srcLang=日语 等 4 字段），再进翻译首页，
 * 断言 page.data() 的 srcLang/tgtLang/register/style 均被回填 ——
 * 证明「设置页之外」存在真实消费方（翻译首页 onShow 读 kd_tr_settings），不是装饰。
 */
const PREFS = { srcLang: '日语', tgtLang: '德语', register: '商务', style: '简洁' };

module.exports = {
  name: 'C. 翻译设置偏好初值闭环（判据 V52③）',
  async run(ctx) {
    const { mp } = ctx;

    await ctx.run('C1 预置 kd_tr_settings', async () => {
      await ctx.setStorage(mp, ctx.KEYS.settings, PREFS);
      const back = await ctx.getStorage(mp, ctx.KEYS.settings);
      ctx.assertEqual(back, PREFS, '预置后读回');
    });

    await ctx.run('C2 navigateTo→翻译首页', async () => {
      await ctx.navigateTo(mp, '/packageTranslate/pages/translate/index/index');
      ctx.assertEqual(await ctx.currentPath(mp), 'packageTranslate/pages/translate/index/index', '路径');
    });

    await ctx.run('C3 srcLang 回填=日语（真实消费方）', async () => {
      await ctx.waitForData(mp, 'srcLang', '日语');
    });

    await ctx.run('C4 tgtLang 回填=德语', async () => {
      await ctx.waitForData(mp, 'tgtLang', '德语');
    });

    await ctx.run('C5 register 回填=商务', async () => {
      await ctx.waitForData(mp, 'register', '商务');
    });

    await ctx.run('C6 style 回填=简洁', async () => {
      await ctx.waitForData(mp, 'style', '简洁');
    });

    await ctx.run('C7 input 不被偏好冲掉（仍空）', async () => {
      ctx.assertEqual(await ctx.pageData(mp, 'input'), '', 'input 保持空');
    });
  },
};
