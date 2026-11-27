/**
 * B. 返回栈：home → NCE 目录 → NCE 详情 → 逐级返回（判据 V7 / V22 / V23）
 *
 * ── 判据溯源 ──
 * V7/V22/V23 的原文断言口径未在现有产物中找到（历史 B 卡仅标注编号，
 * 见 30-任务产物/2026-11-27-小程序E2E现状盘点/B8-用例卡草案.md §3/§6）。
 * 本卡沿用其编号与「返回栈/栈深」语义：navigateTo 入栈深 +1、navigateBack 出栈深 -1，
 * 逐级返回后栈深归 1 且不残留重建页。若产品对 V7/V22/V23 有更严格定义，须另行校准。
 *
 * ── 目标页与 id/book 取值（为什么不是草案的 book=1）──
 * 旧目标页 packageTranslate/pages/translate/result 随 commit 75898073 删除，
 * 改用 dachengzi 现有已注册的最深本地导航栈（app.json pages 已注册，preflight pages-guard 可过）：
 *   pages/home/index/index                reLaunch 起点，栈深 1
 *   → pages/nce/index/index               navigateTo，栈深 2
 *   → pages/nce/detail/detail?id=1&book=NCE2  navigateTo，栈深 3
 * book=NCE2 而非草案示例 book=1：pages/nce/books.ts DEFAULT_NCE_BOOK='NCE2'，
 * 合法册为 NCE2/NCE3/NCE4（book=1 查无此册，B4 会假红）。
 * id=1&book=NCE2 真机/api 双证：curl https://dev.kedouai.com/api/content-admin/nce/lessons/1?book=NCE2
 * → http=200 / code=0 / data.id=1 / data.title='A Private Conversation'，非空 lesson。
 *
 * ── 为什么全程无阻塞步骤 ──
 * NCE 栈走普通 HTTP GET（getNceLesson → /api/content-admin/nce/*），非 LLM、非流式网络依赖，
 * 不命中基建 README §⑤ 任一已知限制。草案 §4 的 BLOCKED 只适用于「坚持 AI 首问挂 kedou:B」，
 * 本轮采纳方案 A 的 NCE 本地栈，不采用首问语义，故本卡全程真实 PASS/FAIL。
 *
 * ── 卡字段 ↔ 产品字段映射 ──
 * 卡 B4 写「data.now lesson 非空」；产品详情页 data 字段实为 `detail`（NceLessonDetail），
 * 含 title / lines / words（pages/nce/detail/detail.ts data.detail、load() 回填）。
 * 故 B4 断 detail.title 非空串 + detail.lines 非空数组 = 断真实数据回填，不是只断路径。
 *
 * ── 三条反例（假绿防线）如何落地 ──
 * ① B4：详情页路径对但 service 失败兜底空白（detail=null/error）也必须红
 *    → 断 detail.title 非空串 + detail.lines 非空数组（不是只断 currentPath）。
 * ② B6：navigateBack 异常重建致栈深≠1、但路径碰巧是 home 也必须红
 *    → 断完整 stackPaths === [home]（不是只断 currentPath）。
 * ③ B3：navigateTo 误用 redirectTo（栈顶替换、栈深仍 2）也必须红
 *    → 断完整 stackPaths === [home, nce/index, nce/detail]（含栈深 3）。
 */
const HOME = '/pages/home/index/index';
const NCE_INDEX = '/pages/nce/index/index';
// book=NCE2 为合法册（books.ts DEFAULT_NCE_BOOK）；query 由 currentPath/stackPaths 自动去除
const NCE_DETAIL = '/pages/nce/detail/detail?id=1&book=NCE2';

const P_HOME = 'pages/home/index/index';
const P_NCE_INDEX = 'pages/nce/index/index';
const P_NCE_DETAIL = 'pages/nce/detail/detail';

module.exports = {
  name: 'B. 返回栈 home→NCE目录→NCE详情→逐级返回（判据 V7/V22/V23）',
  async run(ctx) {
    const { mp } = ctx;

    // B1 reLaunch 起点：清栈 + 断路径与栈深 1
    await ctx.run('B1 reLaunch 首页清栈（栈深=1）', async () => {
      await ctx.reLaunch(mp, HOME);
      ctx.assertEqual(await ctx.currentPath(mp), P_HOME, 'B1 当前路径 = home');
      ctx.assertEqual(await ctx.stackPaths(mp), [P_HOME], 'B1 页面栈 = [home]，栈深1');
    });

    // B2 navigateTo 目录页：入栈 + 断路径与栈深 2
    await ctx.run('B2 navigateTo NCE 目录（栈深=2）', async () => {
      await ctx.navigateTo(mp, NCE_INDEX);
      ctx.assertEqual(await ctx.currentPath(mp), P_NCE_INDEX, 'B2 当前路径 = nce/index');
      ctx.assertEqual(await ctx.stackPaths(mp), [P_HOME, P_NCE_INDEX], 'B2 页面栈 = [home, nce/index]，栈深2');
    });

    // B3 navigateTo 详情页（带合法 query）：入栈 + 断路径与栈深 3（反例③：防 redirectTo 误用）
    await ctx.run('B3 navigateTo NCE 详情（栈深=3，query 自动去）', async () => {
      await ctx.navigateTo(mp, NCE_DETAIL);
      ctx.assertEqual(await ctx.currentPath(mp), P_NCE_DETAIL, 'B3 当前路径 = nce/detail（自动去 query）');
      ctx.assertEqual(
        await ctx.stackPaths(mp),
        [P_HOME, P_NCE_INDEX, P_NCE_DETAIL],
        'B3 页面栈 = [home, nce/index, nce/detail]，栈深3（redirectTo 会让栈深停在2，此处必红）',
      );
    });

    // B4 同页断真实数据回填（反例①：防「只断路径」假绿）
    // detail 为异步 setData：用 data.wait 等 loading=false 后再 data.now 读 detail，避免同步直读异步假红。
    await ctx.run('B4 详情页真实渲染：detail.title/lines 非空（非仅路径对）', async () => {
      await ctx.waitForData(mp, 'loading', false);
      const detail = await ctx.pageData(mp, 'detail');
      ctx.assertOk(
        !!detail && typeof detail.title === 'string' && detail.title.length > 0,
        'B4 detail.title 非空串（service 失败兜底空白时必红）',
        `detail=${JSON.stringify(detail)}`,
      );
      ctx.assertOk(
        !!detail && Array.isArray(detail.lines) && detail.lines.length > 0,
        'B4 detail.lines 非空数组（课文正文已回填，非白屏）',
        `lines=${detail && Array.isArray(detail.lines) ? detail.lines.length : 'n/a'}`,
      );
    });

    // B5 navigateBack 第一跳：回目录页 + 断路径与栈深 2
    await ctx.run('B5 navigateBack 回 NCE 目录（栈深=2）', async () => {
      await ctx.navigateBack(mp, P_NCE_INDEX);
      ctx.assertEqual(await ctx.currentPath(mp), P_NCE_INDEX, 'B5 当前路径 = nce/index');
      ctx.assertEqual(await ctx.stackPaths(mp), [P_HOME, P_NCE_INDEX], 'B5 页面栈 = [home, nce/index]，栈深2');
    });

    // B6 navigateBack 第二跳：回首页 + 断路径与栈深 1（反例②：防重建假绿）
    await ctx.run('B6 navigateBack 回首页（栈深=1，不残留）', async () => {
      await ctx.navigateBack(mp, P_HOME);
      ctx.assertEqual(await ctx.currentPath(mp), P_HOME, 'B6 当前路径 = home');
      ctx.assertEqual(
        await ctx.stackPaths(mp),
        [P_HOME],
        'B6 页面栈 = [home]，栈深1（重建残留页导致栈深≠1 时必红）',
      );
    });
  },
};
