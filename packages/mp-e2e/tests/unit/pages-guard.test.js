const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRegisteredPages, extractNavPaths, assertPagesRegistered } = require('../../src/pages-guard');

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-e2e-pages-'));
  fs.writeFileSync(
    path.join(dir, 'app.json'),
    JSON.stringify({
      pages: ['pages/home/index/index', 'pages/mine/index/index'],
      subPackages: [
        { root: 'packageTranslate', pages: ['pages/translate/index/index'] },
        { root: 'packageSlash/', pages: ['pages/x/index'] },
      ],
    }),
  );
  fs.mkdirSync(path.join(dir, 'cases'), { recursive: true });
  return dir;
}

describe('pages-guard.js readRegisteredPages（移植 preview.js）', () => {
  test('主包 pages + subPackages root 拼接 + root 尾斜杠处理', () => {
    const dir = makeApp();
    try {
      const pages = readRegisteredPages(path.join(dir, 'app.json'));
      expect(pages).toContain('pages/home/index/index');
      expect(pages).toContain('packageTranslate/pages/translate/index/index');
      expect(pages).toContain('packageSlash/pages/x/index'); // root 尾斜杠不双写
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pages-guard.js extractNavPaths', () => {
  test('提取四种导航方法的字面量 path，去前导斜杠与 query', () => {
    const src = `
      await ctx.switchTab(ctx.mp, '/pages/home/index/index');
      await ctx.navigateTo(ctx.mp, '/packageTranslate/pages/translate/index/index');
      await ctx.reLaunch(ctx.mp, '/pages/mine/index/index?x=1');
      await ctx.navigateBack(ctx.mp, 'pages/home/index/index');
      const u = '/dynamic/' + id; await ctx.navigateTo(ctx.mp, u);
    `;
    const hits = extractNavPaths(src);
    expect(hits.map((h) => h.path)).toEqual([
      'pages/home/index/index',
      'packageTranslate/pages/translate/index/index',
      'pages/mine/index/index',
      'pages/home/index/index',
    ]);
  });
});

describe('pages-guard.js assertPagesRegistered', () => {
  test('entryPath 与 case 导航 path 全注册 → 通过', () => {
    const dir = makeApp();
    try {
      fs.writeFileSync(
        path.join(dir, 'cases/A-ok.js'),
        "module.exports={name:'A',async run(ctx){await ctx.switchTab(ctx.mp,'/pages/home/index/index');}};",
      );
      expect(() =>
        assertPagesRegistered({
          entryPath: 'pages/home/index/index',
          casesDir: path.join(dir, 'cases'),
          appJsonPath: path.join(dir, 'app.json'),
        }),
      ).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('未注册 path → FAIL-fast，文案含 path 与来源文件', () => {
    const dir = makeApp();
    try {
      fs.writeFileSync(
        path.join(dir, 'cases/B-bad.js'),
        "module.exports={name:'B',async run(ctx){await ctx.navigateTo(ctx.mp,'/pages/ghost/index?a=1');}};",
      );
      let err;
      try {
        assertPagesRegistered({
          entryPath: 'pages/home/index/index',
          casesDir: path.join(dir, 'cases'),
          appJsonPath: path.join(dir, 'app.json'),
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err.message).toContain('pages-guard');
      expect(err.message).toContain('pages/ghost/index');
      expect(err.message).toContain('B-bad.js');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('entryPath 未注册也被拦', () => {
    const dir = makeApp();
    try {
      expect(() =>
        assertPagesRegistered({
          entryPath: 'pages/ghost/entry',
          casesDir: path.join(dir, 'cases'),
          appJsonPath: path.join(dir, 'app.json'),
        }),
      ).toThrow(/pages\/ghost\/entry/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
