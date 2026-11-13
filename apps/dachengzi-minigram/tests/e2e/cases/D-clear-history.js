/**
 * D. 清空历史不误清（判据 V53④⑤）
 * 预置 kd_tr_history(3 条) + kd_tr_settings + access_token，
 * 走翻译设置页 clearHistory 逻辑（二次确认被 mock 为 confirm），
 * 断言：kd_tr_history 清空、kd_tr_settings 保留、token 类 key 保留。
 */
const HISTORY = [
  { id: 'h1', text: 'a', natural: 'A', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 1 },
  { id: 'h2', text: 'b', natural: 'B', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 2 },
  { id: 'h3', text: 'c', natural: 'C', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 3 },
];
const SETTINGS = { srcLang: '日语', tgtLang: '英语', register: '正式', style: '完整', stream: true };
const TOKEN = 'e2e-test-token-123';

module.exports = {
  name: 'D. 清空历史不误清（判据 V53④⑤）',
  async run(ctx) {
    const { mp } = ctx;

    await ctx.run('D1 预置 history/settings/token', async () => {
      await ctx.setStorage(mp, ctx.KEYS.history, HISTORY);
      await ctx.setStorage(mp, ctx.KEYS.settings, SETTINGS);
      await ctx.setStorage(mp, ctx.KEYS.token, TOKEN);
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.history), HISTORY, '预置 history 读回');
    });

    await ctx.run('D2 进翻译设置页', async () => {
      await ctx.navigateTo(mp, '/packageTranslate/pages/translate/settings/settings');
      ctx.assertEqual(await ctx.currentPath(mp), 'packageTranslate/pages/translate/settings/settings', '路径');
    });

    await ctx.run('D3 调 clearHistory（mock 确认）', async () => {
      // 注：automator 的 page.callMethod 对本项目 Proxy 页面失效（this.xxx is not a function），
      // 改用 evaluate 在 app 上下文直接调用页面方法。
      await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
      await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        p.clearHistory();
        return new Promise((resolve) => setTimeout(resolve, 600));
      });
      await mp.restoreWxMethod('showModal');
    });

    await ctx.run('D4 kd_tr_history 被清空', async () => {
      const v = await ctx.getStorage(mp, ctx.KEYS.history);
      ctx.assertOk(!v || (Array.isArray(v) && v.length === 0), 'history 应为空', `actual=${JSON.stringify(v)}`);
    });

    await ctx.run('D5 kd_tr_settings 保留', async () => {
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.settings), SETTINGS, 'settings 应原样保留');
    });

    await ctx.run('D6 token 类 key 保留', async () => {
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.token), TOKEN, 'access_token 应原样保留');
    });
  },
};
