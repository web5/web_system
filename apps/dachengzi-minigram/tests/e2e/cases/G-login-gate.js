/**
 * G. 未登录态首页只渲染 login-gate（台账 9045 / 9053）
 *
 * 9045：登出后进首页零 profile/verify 请求，且任何一帧不出现「…」或缺昵称文案
 * 9053：真实渲染层 —— 未登录态只渲染 login-gate、hero 不渲染、编译零 error
 *
 * 断言分两层：
 *   静态层（G3）：data 初值即首帧状态，读源码判「首帧必然是什么」——比运行时采样更硬（采样会漏帧）
 *   动态层（G2/G4/G5）：真实渲染层的终态 —— gate 节点存在、hero 节点不存在、greetingText 反序列化值
 */
const fs = require('fs');
const path = require('path');

/** 清场断言用：token 是真实凭据，只报「有无」，不把值打到日志里 */
const redact = (v) => (v ? '<set>' : '<empty>');

module.exports = {
  name: 'G. 未登录态首页只渲染 login-gate（台账 9045/9053）',
  async run(ctx) {
    const { mp } = ctx;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 进用例时先快照三个 key 的原值，G6 按原值恢复（见 G6 注释）
    const snapshot = {};

    // ── G1 构造「真实登出态」：清两个 token + 置主动退出标志（等价 services/auth.logout() 的本地清态）
    await ctx.run('G1 构造登出态：清 token/refreshToken + loggedOut=1', async () => {
      // 🔴 清态之前先记原值：本用例会把开发者工具置成登出态，结束时必须原样还原，
      //    否则后续用例与人工调试都被污染（G6 负责恢复）。
      for (const alias of ['token', 'refreshToken', 'loggedOut']) {
        snapshot[alias] = await ctx.getStorage(mp, ctx.KEYS[alias]);
      }
      await ctx.removeStorage(mp, ctx.KEYS.token);
      await ctx.removeStorage(mp, ctx.KEYS.refreshToken);
      await ctx.setStorage(mp, ctx.KEYS.loggedOut, '1');
      const tok = await ctx.getStorage(mp, ctx.KEYS.token);
      const rt = await ctx.getStorage(mp, ctx.KEYS.refreshToken);
      ctx.assertOk(!tok, 'access_token 已清空', `actual=${JSON.stringify(tok)}`);
      ctx.assertOk(!rt, 'refresh_token 已清空', `actual=${JSON.stringify(rt)}`);
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.loggedOut), '1', '主动退出标志=1');
    });

    // ── G2 进首页并串行采样（automator 是串行协议：导航中并发 currentPage 会挂死，故 await 后再采）
    const samples = [];
    await ctx.run('G2 reLaunch 首页 + 串行采样 greetingText/loggedIn', async () => {
      await ctx.reLaunch(mp, '/pages/home/index/index');
      for (let i = 0; i < 12; i++) {
        const p = await mp.currentPage();
        if (p && p.path === 'pages/home/index/index') {
          const d = await p.data();
          if (d) samples.push({ loggedIn: d.loggedIn, greetingText: d.greetingText });
        }
        await sleep(150);
      }
      ctx.assertOk(samples.length > 0, '采到页面数据', `samples=${samples.length}`);
      const dots = samples.filter((s) => s.greetingText === '…' || s.greetingText === '...');
      const heroish = samples.filter((s) => s.loggedIn !== false);
      ctx.assertEqual(dots.length, 0, '稳态期间无「…」占位');
      ctx.assertEqual(heroish.length, 0, '稳态期间 loggedIn 恒为 false');
    });

    // ── G3 静态判据：data 初值 = 首帧状态，必须是「未登录时为 false / 空串」
    await ctx.run('G3 源码判据：data 初值未登录时必为 loggedIn=false 且 greetingText 空串', async () => {
      const src = fs.readFileSync(path.join(__dirname, '../../../pages/home/index/index.ts'), 'utf8');
      const loggedInInit = /loggedIn:\s*([^,\n]+)/.exec(src);
      const greetInit = /greetingText:\s*([^,\n]+)/.exec(src);
      ctx.assertOk(!!loggedInInit, '能定位 loggedIn 初值');
      ctx.assertOk(!!greetInit, '能定位 greetingText 初值');
      const lv = loggedInInit[1].trim();
      const gv = greetInit[1].trim();
      ctx.assertOk(
        /isLoggedIn\s*\(/.test(lv),
        'loggedIn 初值必须是同步求值 isLoggedIn()（写死 true 会让未登录冷启动闪 hero 帧）',
        `actual=${lv}`,
      );
      ctx.assertOk(
        /isLoggedIn\s*\(/.test(gv) || gv === "''" || gv === '""',
        'greetingText 初值必须区分登录态（写死 GREETING_LOADING 会让未登录冷启动闪「…」）',
        `actual=${gv}`,
      );
    });

    // ── G4 终态：只渲染 login-gate，hero 不存在
    // 🔴 选择器有效性已由 H-probe 反证（已登录态 .hero/.hi/.daily/.fcard 均可查），
    //    故此处「查不到」= 真不渲染，不是工具缺陷导致的假绿。
    // 🔴 automator 查不到自定义组件内部节点（.gate / .gate-btn）也不支持 `login-gate` 标签选择器
    //    —— 组件存在性改由页面根 .page 的 locked class 间接证明（wxml：loggedIn ? '' : 'locked'）。
    await ctx.run('G4 终态：.page 带 locked、hero 区不渲染', async () => {
      const page = await mp.currentPage();
      const root = await page.$('.page');
      ctx.assertOk(!!root, '页面根 .page 存在');
      let cls = '';
      try {
        cls = (await root.attribute('class')) || '';
      } catch (e) {
        cls = `ERR:${(e && e.message) || e}`;
      }
      ctx.assertOk(/\blocked\b/.test(cls), '.page 带 locked class（未登录态已反映到渲染层）', cls);
      for (const sel of ['.hero', '.hi', '.hi-sub', '.daily', '.fcard', '.more']) {
        const el = await page.$(sel);
        ctx.assertOk(!el, `未登录态 ${sel} 不渲染`, `found=${!!el}`);
      }
    });

    // ── G5 终态：greetingText 反序列化为空串（不是「…」、不是 undefined）
    await ctx.run('G5 终态：loggedIn=false 且 greetingText=""', async () => {
      const p = await mp.currentPage();
      const d = await p.data();
      ctx.assertEqual(d.loggedIn, false, 'loggedIn 终值');
      ctx.assertEqual(d.greetingText, '', 'greetingText 终值（确定的空态，非「…」）');
    });

    // ── G6 清场：按 G1 的快照恢复三个 key 原值
    // 🔴 不能只移除 loggedOut：本用例把开发者工具置成了登出态，只清标志会留下「无 token」，
    //    后续用例/人工调试会莫名处于未登录，属于跨用例污染。故按原值恢复（原来没有的就移除）。
    await ctx.run('G6 清场：按快照恢复 token/refreshToken/loggedOut 原值', async () => {
      for (const alias of ['token', 'refreshToken', 'loggedOut']) {
        const original = snapshot[alias];
        // wx.getStorageSync 对不存在的 key 返回 ''：空值即「本来没有」，恢复成「移除」
        if (original === '' || original === undefined || original === null) {
          await ctx.removeStorage(mp, ctx.KEYS[alias]);
        } else {
          await ctx.setStorage(mp, ctx.KEYS[alias], original);
        }
      }
      const tok = await ctx.getStorage(mp, ctx.KEYS.token);
      const rt = await ctx.getStorage(mp, ctx.KEYS.refreshToken);
      const lo = await ctx.getStorage(mp, ctx.KEYS.loggedOut);
      // 用 assertOk 而非 assertEqual：assertEqual 失败会把 JSON 原值打出来，
      // token 是真实凭据，日志里只许出现「有无」。
      ctx.assertOk((tok || '') === (snapshot.token || ''), 'access_token 已恢复原值', `restored=${redact(tok)}`);
      ctx.assertOk((rt || '') === (snapshot.refreshToken || ''), 'refresh_token 已恢复原值', `restored=${redact(rt)}`);
      ctx.assertOk((lo || '') === (snapshot.loggedOut || ''), 'loggedOut 已恢复原值', `restored=${JSON.stringify(lo)}`);
    });
  },
};
