const { normalizePath } = require('../../src/navigate');

describe('navigate.js 纯函数：normalizePath', () => {
  test('去前导斜杠', () => {
    expect(normalizePath('/pages/home/index/index')).toBe('pages/home/index/index');
  });

  test('去 query', () => {
    expect(normalizePath('/pkg/pages/x?k=v&n=1')).toBe('pkg/pages/x');
  });

  test('无前导斜杠 + 无 query 原样返回', () => {
    expect(normalizePath('pages/x/index')).toBe('pages/x/index');
  });

  test('动态拼接的字面前缀（含未闭合 query）也去 query', () => {
    expect(normalizePath('/pkg/pages/result/result?fwd=')).toBe('pkg/pages/result/result');
  });

  test('分包路径保持 root 拼接形态', () => {
    expect(normalizePath('/packageTranslate/pages/translate/index/index')).toBe(
      'packageTranslate/pages/translate/index/index',
    );
  });
});
