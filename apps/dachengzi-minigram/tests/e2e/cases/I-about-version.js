/**
 * I. 关于页版本号渲染（台账 9060 的渲染层证据）
 *
 * 背景（1.0.17 线上包显示 `v1.0.0`）：关于页把版本号写死在模板里，用户装了 1.0.17
 * 却看到 1.0.0。1.0.18 改为「运行期解析 + 模板绑定」：
 *   utils/version.ts 的 resolveAppVersion()（正式版读微信真值，开发/体验/老基础库回退 APP_VERSION 常量）
 *   → about.ts data.appVersion → about.wxml `v{{appVersion}}`。
 *
 * 断言分三层，缺一层就留一个假绿口子：
 *   I2 选择器有效性反证：先证明 `.page` / `.brand` / `.name` / `.ver` 都能命中——
 *      否则「.ver 查不到」可能是 automator 选择器失效而非版本号没渲染（README 已知限制④踩过）；
 *   I3 数据层：data.appVersion 等于 utils/version.ts 的 APP_VERSION 常量（不写死字面量，bump 忘改会红）；
 *   I4/I5 渲染层：`.ver` 文本含 `v{版本号}`，且**不含** 1.0.17 的缺陷形态 `v1.0.0`、
 *      不含 `vundefined` / 孤零零一个 `v`（模板绑定丢值时的退化形态）。
 *
 * 🔴 关于页不依赖登录态（about.ts 的 onShow 只读 radiusClass），故本用例不造登录态、不清 token。
 * 🔴 全程串行 await：导航未完成就并发 currentPage() 会让开发者工具主进程崩（已踩两次）。
 */
const fs = require('fs');
const path = require('path');

/** 关于页路径：先按 app.json 的 pages 实名核对，再与导航用的字面量对齐（漂移即红） */
function readAboutPagePath() {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../app.json'), 'utf8'));
  const hit = (appJson.pages || []).find((p) => /(^|\/)about$/.test(p));
  if (!hit) throw new Error('app.json 的 pages 里找不到 about 页（页面被改名/下线？）');
  return hit;
}

/** 期望版本号真源：utils/version.ts 的 `export const APP_VERSION = 'x.y.z'` */
function readAppVersion() {
  const src = fs.readFileSync(path.join(__dirname, '../../../utils/version.ts'), 'utf8');
  const m = /export const APP_VERSION\s*=\s*(['"])([^'"]+)\1/.exec(src);
  if (!m) throw new Error('读不到 utils/version.ts 的 APP_VERSION 常量（真源被改名？）');
  return m[2];
}

module.exports = {
  name: 'I. 关于页版本号渲染（台账 9060）',
  async run(ctx) {
    const { mp } = ctx;
    const expected = readAppVersion();

    await ctx.run('I1 核对关于页路径已登记，并 reLaunch 到关于页', async () => {
      ctx.assertEqual(readAboutPagePath(), 'pages/mine/about/about', 'app.json 里 about 页的登记路径');
      await ctx.reLaunch(mp, '/pages/mine/about/about');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/mine/about/about', '关于页路径');
    });

    await ctx.run('I2 反证选择器有效：先证 .page/.brand/.name 可命中，再断 .ver 命中', async () => {
      const page = await mp.currentPage();
      const probe = {};
      for (const sel of ['.page', '.brand', '.logo', '.name', '.card', '.list']) {
        // 串行 await：一次一个选择器，不并发
        const el = await page.$(sel);
        probe[sel] = !!el;
      }
      const known = Object.keys(probe).filter((k) => probe[k]);
      // 先证「页面级 class 选择器体系没坏」（与 G/H 用例同一套 .page/.hero 事实）
      ctx.assertOk(
        known.length >= 3,
        '页面级 class 选择器可用（≥3 个已知节点命中）',
        `probe=${JSON.stringify(probe)}`,
      );
      // 反证完成后才断 .ver：它若查不到 = 版本号真没渲染，不是选择器失效
      const ver = await page.$('.ver');
      probe['.ver'] = !!ver;
      ctx.assertOk(
        !!ver,
        '.ver 版本号节点命中（若已知节点也全 false 才是选择器失效；这里都 true，故查不到即真没渲染）',
        `probe=${JSON.stringify(probe)}`,
      );
    });

    await ctx.run('I3 数据层：data.appVersion 等于 utils/version.ts 的 APP_VERSION', async () => {
      // data.wait 语义：onLoad 会再解析一次，轮询到期望值即返回（不命中则抛错并带 actual）
      await ctx.waitForData(mp, 'appVersion', expected);
      ctx.assertEqual(await ctx.pageData(mp, 'appVersion'), expected, '关于页 data.appVersion');
    });

    await ctx.run(`I4 渲染层：.ver 文本含 v${expected}`, async () => {
      const page = await mp.currentPage();
      const el = await page.$('.ver');
      ctx.assertOk(!!el, '.ver 节点存在');
      const text = ((await el.text()) || '').trim();
      ctx.assertOk(text.includes(`v${expected}`), `.ver 文本含 v${expected}`, `actual=${JSON.stringify(text)}`);
    });

    await ctx.run('I5 渲染层：.ver 文本不含 v1.0.0 / vundefined / 孤 v', async () => {
      const page = await mp.currentPage();
      const el = await page.$('.ver');
      ctx.assertOk(!!el, '.ver 节点存在');
      const text = ((await el.text()) || '').trim();
      // 1.0.17 的缺陷本体：模板写死 v1.0.0
      ctx.assertOk(!text.includes('v1.0.0'), '.ver 不含缺陷形态 v1.0.0', `actual=${JSON.stringify(text)}`);
      // 绑定丢值时的退化形态：{{appVersion}} 取到 undefined / 空 → 渲染成 vundefined 或孤 v
      ctx.assertOk(!/vundefined/i.test(text), '.ver 不含 vundefined', `actual=${JSON.stringify(text)}`);
      ctx.assertOk(text !== 'v' && text !== '', '.ver 不是孤零零的 v / 空文本', `actual=${JSON.stringify(text)}`);
    });
  },
};
