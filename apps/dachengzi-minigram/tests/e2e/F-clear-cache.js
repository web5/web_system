/**
 * F. 清缓存白名单（判据 V45）
 * 预置白名单 key（token / 偏好 / 历史）+ 非白名单垃圾 key，
 * 走「我的→设置→清除缓存」clearCache 逻辑（二次确认 mock 为 confirm），
 * 断言：白名单 key 全保留、非白名单 key 被清。
 */
const h = require('./helper');

const TOKEN = 'e2e-cache-token';
const REFRESH = 'e2e-cache-refresh';
const RADIUS = 'crisp';
const HISTORY = [{ id: 'h1', text: 'a', natural: 'A', srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', conversationId: '', ts: 1 }];
const SETTINGS = { srcLang: '日语', tgtLang: '英语', register: '正式', style: '完整', stream: true };
const NCE_MODE = 'bilingual';
const NCE_FONT = 'large';
const JUNK1 = 'junk_e2e_key';
const JUNK2 = 'temp_foo';

(async () => {
  const mp = await h.launch();
  const results = [];
  try {
    results.push(await h.run('F1 预置白名单 + 垃圾 key', async () => {
      await h.setStorage(mp, h.KEYS.token, TOKEN);
      await h.setStorage(mp, h.KEYS.refreshToken, REFRESH);
      await h.removeStorage(mp, h.KEYS.loggedOut);
      await h.setStorage(mp, h.KEYS.radius, RADIUS);
      await h.setStorage(mp, h.KEYS.history, HISTORY);
      await h.setStorage(mp, h.KEYS.settings, SETTINGS);
      await h.setStorage(mp, h.KEYS.nceMode, NCE_MODE);
      await h.setStorage(mp, h.KEYS.nceFont, NCE_FONT);
      await h.setStorage(mp, JUNK1, 'garbage-1');
      await h.setStorage(mp, JUNK2, { foo: 42 });
      // 确认垃圾 key 确实已写入
      h.assertEqual(await h.getStorage(mp, JUNK1), 'garbage-1', '垃圾 key1 读回');
      h.assertEqual(await h.getStorage(mp, JUNK2), { foo: 42 }, '垃圾 key2 读回');
    }));

    results.push(await h.run('F2 进「我的→设置」页（需登录态）', async () => {
      await h.navigateTo(mp, '/pages/mine/settings/settings');
      h.assertEqual(await h.currentPath(mp), 'pages/mine/settings/settings', '设置页路径');
    }));

    results.push(await h.run('F3 调 clearCache（mock 确认）', async () => {
      // 注：automator 的 page.callMethod 对本项目 Proxy 页面失效（this.xxx is not a function），
      // 改用 evaluate 在 app 上下文直接调用页面方法。
      await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
      await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        p.clearCache();
        return new Promise((resolve) => setTimeout(resolve, 600));
      });
      await mp.restoreWxMethod('showModal');
    }));

    results.push(await h.run('F4 白名单：token/refresh 保留', async () => {
      h.assertEqual(await h.getStorage(mp, h.KEYS.token), TOKEN, 'access_token');
      h.assertEqual(await h.getStorage(mp, h.KEYS.refreshToken), REFRESH, 'refresh_token');
    }));

    results.push(await h.run('F5 白名单：偏好/历史保留', async () => {
      h.assertEqual(await h.getStorage(mp, h.KEYS.radius), RADIUS, 'appearance_radius');
      h.assertEqual(await h.getStorage(mp, h.KEYS.history), HISTORY, 'kd_tr_history');
      h.assertEqual(await h.getStorage(mp, h.KEYS.settings), SETTINGS, 'kd_tr_settings');
      h.assertEqual(await h.getStorage(mp, h.KEYS.nceMode), NCE_MODE, 'nce-mode');
      h.assertEqual(await h.getStorage(mp, h.KEYS.nceFont), NCE_FONT, 'nce-font');
    }));

    results.push(await h.run('F6 非白名单垃圾 key 被清', async () => {
      const j1 = await h.getStorage(mp, JUNK1);
      const j2 = await h.getStorage(mp, JUNK2);
      h.assertOk(!j1 && !j2, '垃圾 key 应被清除', `junk1=${JSON.stringify(j1)} junk2=${JSON.stringify(j2)}`);
    }));
  } finally {
    await h.close(mp);
  }

  h.summary(results);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('[F-clear-cache] ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
