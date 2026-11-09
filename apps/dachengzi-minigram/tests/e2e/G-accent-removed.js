/**
 * G. accent 已删（A2 落地验收）
 * ① 进翻译设置页，断言设置项数量 = 6（不是 7，发音设置已删）。
 * ② grep -rnE "accent|美音|英音" packageTranslate/ = 0（源码无残留）。
 */
const h = require('./helper');
const { execSync } = require('child_process');
const path = require('path');

(async () => {
  const mp = await h.launch();
  const results = [];
  try {
    results.push(await h.run('G1 进翻译设置页', async () => {
      await h.navigateTo(mp, '/packageTranslate/pages/translate/settings/settings');
      h.assertEqual(await h.currentPath(mp), 'packageTranslate/pages/translate/settings/settings', '路径');
    }));

    results.push(await h.run('G2 设置项数量 = 6（不是 7）', async () => {
      const page = await mp.currentPage();
      const items = await page.$$('.r');
      h.assertEqual(items.length, 6, '设置行 .r 数量');
    }));

    results.push(await h.run('G3 源码无 accent/美音/英音 残留', async () => {
      const dir = path.resolve(__dirname, '../../packageTranslate');
      let out = '';
      try {
        out = execSync(`grep -rnE "accent|美音|英音" "${dir}"`, { encoding: 'utf8' });
      } catch (e) {
        // grep 无匹配返回非零退出码 + 空输出，属预期
        out = '';
      }
      h.assertEqual(out.trim(), '', 'grep 结果应为空');
    }));
  } finally {
    await h.close(mp);
  }

  h.summary(results);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('[G-accent-removed] ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
