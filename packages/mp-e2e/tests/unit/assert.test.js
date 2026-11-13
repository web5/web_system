const { assertEqual, assertOk } = require('../../src/assert');

describe('assert.js', () => {
  test('assertEqual 相等不抛错（含对象深比较）', () => {
    expect(() => assertEqual('a', 'a', 'label')).not.toThrow();
    expect(() => assertEqual({ x: [1, 2] }, { x: [1, 2] }, 'label')).not.toThrow();
    expect(() => assertEqual(undefined, undefined, 'label')).not.toThrow();
  });

  test('assertEqual 不等抛错，文案含 label/expected/actual', () => {
    let err;
    try {
      assertEqual('a', 'b', '路径断言');
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.message).toContain('[FAIL] 路径断言');
    expect(err.message).toContain('expected: "b"');
    expect(err.message).toContain('actual:   "a"');
  });

  test('assertOk false 抛错并拼接 detail；true 不抛', () => {
    expect(() => assertOk(true, 'ok')).not.toThrow();
    let err;
    try {
      assertOk(false, 'history 应为空', 'actual=[1,2]');
    } catch (e) {
      err = e;
    }
    expect(err.message).toContain('[FAIL] history 应为空');
    expect(err.message).toContain('detail: actual=[1,2]');
  });

  test('assertOk 无 detail 时不拼 detail 行', () => {
    let err;
    try {
      assertOk(0, 'cond');
    } catch (e) {
      err = e;
    }
    expect(err.message).toBe('[FAIL] cond');
  });
});
