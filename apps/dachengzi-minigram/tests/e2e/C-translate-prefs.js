/**
 * C. 翻译设置偏好初值闭环（判据 V52③）
 * 预置 kd_tr_settings（srcLang=日语 等 4 字段），再进翻译首页，
 * 断言 page.data() 的 srcLang/tgtLang/register/style 均被回填 ——
 * 证明「设置页之外」存在真实消费方（翻译首页 onShow 读 kd_tr_settings），不是装饰。
 */
const h = require('./helper');

const PREFS = { srcLang: '日语', tgtLang: '德语', register: '商务', style: '简洁' };

(async () => {
  const mp = await h.launch();
  const results = [];
  try {
    results.push(await h.run('C1 预置 kd_tr_settings', async () => {
      await h.setStorage(mp, h.KEYS.settings, PREFS);
      const back = await h.getStorage(mp, h.KEYS.settings);
      h.assertEqual(back, PREFS, '预置后读回');
    }));

    results.push(await h.run('C2 navigateTo→翻译首页', async () => {
      await h.navigateTo(mp, '/packageTranslate/pages/translate/index/index');
      h.assertEqual(await h.currentPath(mp), 'packageTranslate/pages/translate/index/index', '路径');
    }));

    results.push(await h.run('C3 srcLang 回填=日语（真实消费方）', async () => {
      await h.waitForData(mp, 'srcLang', '日语');
    }));

    results.push(await h.run('C4 tgtLang 回填=德语', async () => {
      await h.waitForData(mp, 'tgtLang', '德语');
    }));

    results.push(await h.run('C5 register 回填=商务', async () => {
      await h.waitForData(mp, 'register', '商务');
    }));

    results.push(await h.run('C6 style 回填=简洁', async () => {
      await h.waitForData(mp, 'style', '简洁');
    }));

    results.push(await h.run('C7 input 不被偏好冲掉（仍空）', async () => {
      h.assertEqual(await h.pageData(mp, 'input'), '', 'input 保持空');
    }));
  } finally {
    await h.close(mp);
  }

  h.summary(results);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('[C-translate-prefs] ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
