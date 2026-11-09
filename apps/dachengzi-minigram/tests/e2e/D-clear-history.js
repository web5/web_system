/**
 * D. 清空历史不误清（判据 V53④⑤）
 * 预置 kd_tr_history(3 条) + kd_tr_settings + access_token，
 * 走翻译设置页 clearHistory 逻辑（二次确认被 mock 为 confirm），
 * 断言：kd_tr_history 清空、kd_tr_settings 保留、token 类 key 保留。
 */
const h = require('./helper');

const HISTORY = [
  { id: 'h1', text: 'a', natural: 'A', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 1 },
  { id: 'h2', text: 'b', natural: 'B', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 2 },
  { id: 'h3', text: 'c', natural: 'C', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 3 },
];
const SETTINGS = { srcLang: '日语', tgtLang: '英语', register: '正式', style: '完整', stream: true };
const TOKEN = 'e2e-test-token-123';

(async () => {
  const mp = await h.launch();
  const results = [];
  try {
    results.push(await h.run('D1 预置 history/settings/token', async () => {
      await h.setStorage(mp, h.KEYS.history, HISTORY);
      await h.setStorage(mp, h.KEYS.settings, SETTINGS);
      await h.setStorage(mp, h.KEYS.token, TOKEN);
      h.assertEqual(await h.getStorage(mp, h.KEYS.history), HISTORY, '预置 history 读回');
    }));

    results.push(await h.run('D2 进翻译设置页', async () => {
      await h.navigateTo(mp, '/packageTranslate/pages/translate/settings/settings');
      h.assertEqual(await h.currentPath(mp), 'packageTranslate/pages/translate/settings/settings', '路径');
    }));

    results.push(await h.run('D3 调 clearHistory（mock 确认）', async () => {
      // 注：automator 的 page.callMethod 对本项目 Proxy 页面失效（this.xxx is not a function），
      // 改用 evaluate 在 app 上下文直接调用页面方法。
      await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
      await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        p.clearHistory();
        return new Promise((resolve) => setTimeout(resolve, 600));
      });
      await mp.restoreWxMethod('showModal');
    }));

    results.push(await h.run('D4 kd_tr_history 被清空', async () => {
      const v = await h.getStorage(mp, h.KEYS.history);
      h.assertOk(!v || (Array.isArray(v) && v.length === 0), 'history 应为空', `actual=${JSON.stringify(v)}`);
    }));

    results.push(await h.run('D5 kd_tr_settings 保留', async () => {
      h.assertEqual(await h.getStorage(mp, h.KEYS.settings), SETTINGS, 'settings 应原样保留');
    }));

    results.push(await h.run('D6 token 类 key 保留', async () => {
      h.assertEqual(await h.getStorage(mp, h.KEYS.token), TOKEN, 'access_token 应原样保留');
    }));
  } finally {
    await h.close(mp);
  }

  h.summary(results);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('[D-clear-history] ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
