/**
 * G. accent 已删（A2 落地验收）
 * ① 进翻译设置页，断言设置项数量 = 6（不是 7，发音设置已删）。
 * ② grep -rnE "accent|美音|英音" packageTranslate/ = 0（源码无残留）。
 *    （sourceShell 断言走裸 node execSync——不封装、允许直达，见 README 第③章）
 */
const { execSync } = require('child_process');
const path = require('path');

module.exports = {
  name: 'G. accent 已删（A2 落地验收）',
  async run(ctx) {
    const { mp } = ctx;

    await ctx.run('G1 进翻译设置页', async () => {
      await ctx.navigateTo(mp, '/packageTranslate/pages/translate/settings/settings');
      ctx.assertEqual(await ctx.currentPath(mp), 'packageTranslate/pages/translate/settings/settings', '路径');
    });

    await ctx.run('G2 设置项数量 = 6（不是 7）', async () => {
      const page = await mp.currentPage();
      const items = await page.$$('.r');
      ctx.assertEqual(items.length, 6, '设置行 .r 数量');
    });

    await ctx.run('G3 源码无 accent/美音/英音 残留', async () => {
      const dir = path.resolve(__dirname, '../../../packageTranslate');
      let out = '';
      try {
        out = execSync(`grep -rnE "accent|美音|英音" "${dir}"`, { encoding: 'utf8' });
      } catch (e) {
        // grep 无匹配返回非零退出码 + 空输出，属预期
        out = '';
      }
      ctx.assertEqual(out.trim(), '', 'grep 结果应为空');
    });
  },
};
