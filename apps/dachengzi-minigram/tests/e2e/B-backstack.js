/**
 * B. 返回栈（判据 V7 / V22 / V23）
 * discover → navigateTo 翻译首页 → navigateTo 结果页（fwd 真实参数，走转发落地分支、无真 LLM）
 * → navigateBack 回翻译首页 → navigateBack 回 discover，栈深不残留。
 */
const h = require('./helper');

(async () => {
  const mp = await h.launch();
  const results = [];
  try {
    results.push(await h.run('B1 switchTab→discover（起点）', async () => {
      await h.switchTab(mp, '/pages/discover/index/index');
      h.assertEqual(await h.stackPaths(mp), ['pages/discover/index/index'], '初始栈');
    }));

    results.push(await h.run('B2 navigateTo→翻译首页', async () => {
      await h.navigateTo(mp, '/packageTranslate/pages/translate/index/index');
      h.assertEqual(await h.currentPath(mp), 'packageTranslate/pages/translate/index/index', '翻译首页路径');
      h.assertEqual(await h.stackPaths(mp), ['pages/discover/index/index', 'packageTranslate/pages/translate/index/index'], '栈深=2');
    }));

    results.push(await h.run('B3 navigateTo→结果页(fwd 转发落地)', async () => {
      await h.navigateTo(mp, '/packageTranslate/pages/translate/result/result?fwd=' + encodeURIComponent('你好，世界'));
      h.assertEqual(await h.currentPath(mp), 'packageTranslate/pages/translate/result/result', '结果页路径');
      const stack = await h.stackPaths(mp);
      h.assertEqual(stack, [
        'pages/discover/index/index',
        'packageTranslate/pages/translate/index/index',
        'packageTranslate/pages/translate/result/result',
      ], '栈深=3');
    }));

    results.push(await h.run('B4 结果页转发落地渲染（不触发真 LLM）', async () => {
      // fwd 分支：只渲染译文、不发起流式请求（避免 BLOCKED/真网络）
      h.assertEqual(await h.pageData(mp, 'natural'), '你好，世界', '转发译文');
      h.assertEqual(await h.pageData(mp, 'fromShare'), true, 'fromShare 标记');
    }));

    results.push(await h.run('B5 navigateBack→翻译首页', async () => {
      await h.navigateBack(mp, 'packageTranslate/pages/translate/index/index');
      h.assertEqual(await h.currentPath(mp), 'packageTranslate/pages/translate/index/index', '回到翻译首页');
      h.assertEqual(await h.stackPaths(mp), ['pages/discover/index/index', 'packageTranslate/pages/translate/index/index'], '栈深=2');
    }));

    results.push(await h.run('B6 navigateBack→discover（栈不残留）', async () => {
      await h.navigateBack(mp, 'pages/discover/index/index');
      h.assertEqual(await h.currentPath(mp), 'pages/discover/index/index', '回到 discover');
      h.assertEqual(await h.stackPaths(mp), ['pages/discover/index/index'], '栈深=1（不残留）');
    }));
  } finally {
    await h.close(mp);
  }

  h.summary(results);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('[B-backstack] ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
