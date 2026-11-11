const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertKeysInSource, collectSourceFiles } = require('../../src/keys-guard');

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-e2e-keys-'));
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests/e2e'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'utils/keys.ts'), "export const A = 'kd_tr_history';\nconst B = 'access_token';\n");
  fs.writeFileSync(path.join(dir, 'app.json'), '{"pages":["pages/home/index/index"]}');
  // 排除目录里的同名 key 不应计入命中
  fs.writeFileSync(path.join(dir, 'tests/e2e/case.js'), "'only_in_tests_key'");
  fs.writeFileSync(path.join(dir, 'node_modules/pkg/index.js'), "'only_in_nm_key'");
  // 非文本扩展名不扫描
  fs.writeFileSync(path.join(dir, 'private.key'), 'secret-not-scanned');
  return dir;
}

describe('keys-guard.js', () => {
  let dir;
  beforeEach(() => {
    dir = makeApp();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('key 全部命中 → 通过并返回扫描统计', () => {
    const r = assertKeysInSource({ keys: { history: 'kd_tr_history', token: 'access_token' }, srcDir: dir });
    expect(r.keys).toBe(2);
    expect(r.scanned).toBeGreaterThan(0);
  });

  test('key 缺失 → FAIL-fast，文案含 key 别名/值与扫描目录', () => {
    let err;
    try {
      assertKeysInSource({ keys: { history: 'kd_tr_history', ghost: 'kd_ghost_key' }, srcDir: dir });
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.message).toContain('keys-guard');
    expect(err.message).toContain("ghost: 'kd_ghost_key'");
    expect(err.message).toContain(dir);
  });

  test('排除目录：tests/ 与 node_modules/ 里的字面量不算命中', () => {
    expect(() =>
      assertKeysInSource({ keys: { a: 'only_in_tests_key', b: 'only_in_nm_key' }, srcDir: dir }),
    ).toThrow(/keys-guard/);
    // 收集文件清单也不含排除目录
    const files = collectSourceFiles(dir);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes(`${path.sep}tests${path.sep}`))).toBe(false);
    expect(files.some((f) => f.endsWith('.key'))).toBe(false);
  });

  test('自匹配防护：key 只出现在 e2e.config.js 自己里 → 仍 FAIL-fast（V4 回归）', () => {
    // 把 ghost key 写进 app 根的 e2e.config.js（真实使用场景），产品源码里没有
    fs.writeFileSync(path.join(dir, 'e2e.config.js'), "module.exports={storageKeys:{ghost:'ghost_only_in_config'}};");
    expect(() => assertKeysInSource({ keys: { ghost: 'ghost_only_in_config' }, srcDir: dir })).toThrow(
      /ghost: 'ghost_only_in_config'/,
    );
  });

  test('自定义 exclude 生效', () => {
    fs.mkdirSync(path.join(dir, 'legacy'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'legacy/x.ts'), "'legacy_key'");
    expect(() => assertKeysInSource({ keys: { l: 'legacy_key' }, srcDir: dir })).not.toThrow();
    expect(() =>
      assertKeysInSource({ keys: { l: 'legacy_key' }, srcDir: dir, exclude: ['legacy'] }),
    ).toThrow(/keys-guard/);
  });
});
