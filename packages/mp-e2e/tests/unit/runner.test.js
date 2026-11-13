const fs = require('fs');
const os = require('os');
const path = require('path');
const { exitCodeOf, deriveCaseStatus, discoverCases } = require('../../src/runner');

describe('runner.js exit code 映射（§2.6 口径）', () => {
  const env = process.env.MP_E2E_REQUIRE_ENV;
  afterEach(() => {
    if (env === undefined) delete process.env.MP_E2E_REQUIRE_ENV;
    else process.env.MP_E2E_REQUIRE_ENV = env;
  });

  test('全 PASS → 0', () => {
    expect(exitCodeOf([{ status: 'PASS' }], { envUnavailable: false })).toBe(0);
  });

  test('PASS + BLOCKED 混合 → 0（BLOCKED 不计失败）', () => {
    expect(exitCodeOf([{ status: 'PASS' }, { status: 'BLOCKED' }], { envUnavailable: false })).toBe(0);
  });

  test('≥1 条 FAIL → 1', () => {
    expect(exitCodeOf([{ status: 'PASS' }, { status: 'FAIL' }], { envUnavailable: false })).toBe(1);
  });

  test('环境不可用全 SKIP → 默认 0', () => {
    delete process.env.MP_E2E_REQUIRE_ENV;
    expect(exitCodeOf([{ status: 'SKIP' }, { status: 'SKIP' }], { envUnavailable: true })).toBe(0);
  });

  test('环境不可用全 SKIP + MP_E2E_REQUIRE_ENV=1 → 2', () => {
    process.env.MP_E2E_REQUIRE_ENV = '1';
    expect(exitCodeOf([{ status: 'SKIP' }], { envUnavailable: true })).toBe(2);
  });

  test('执行中环境死亡出现 SKIP + REQUIRE_ENV=1 → 2', () => {
    process.env.MP_E2E_REQUIRE_ENV = '1';
    expect(exitCodeOf([{ status: 'PASS' }, { status: 'SKIP' }], { envUnavailable: false })).toBe(2);
  });

  test('FAIL 优先级高于 SKIP（FAIL + SKIP → 1，不是 2）', () => {
    process.env.MP_E2E_REQUIRE_ENV = '1';
    expect(exitCodeOf([{ status: 'FAIL' }, { status: 'SKIP' }], { envUnavailable: false })).toBe(1);
  });
});

describe('runner.js 用例级状态推导', () => {
  test('任一步骤 FAIL → 用例 FAIL', () => {
    expect(deriveCaseStatus([{ status: 'PASS' }, { status: 'FAIL' }])).toBe('FAIL');
  });

  test('全 BLOCKED → 用例 BLOCKED；混合 PASS+BLOCKED → PASS', () => {
    expect(deriveCaseStatus([{ status: 'BLOCKED' }])).toBe('BLOCKED');
    expect(deriveCaseStatus([{ status: 'PASS' }, { status: 'BLOCKED' }])).toBe('PASS');
  });

  test('fallback（用例体抛错）覆盖步骤推导', () => {
    expect(deriveCaseStatus([{ status: 'PASS' }], 'FAIL')).toBe('FAIL');
  });
});

describe('runner.js 用例发现', () => {
  test('文件名排序 + filter 子串过滤', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-e2e-cases-'));
    try {
      fs.writeFileSync(path.join(dir, 'B-b.js'), '');
      fs.writeFileSync(path.join(dir, 'A-a.js'), '');
      fs.writeFileSync(path.join(dir, 'C-c.js'), '');
      fs.writeFileSync(path.join(dir, 'README.md'), '');
      const all = discoverCases(dir);
      expect(all.map((c) => c.file)).toEqual(['A-a.js', 'B-b.js', 'C-c.js']);
      expect(all[0].letter).toBe('A');
      const filtered = discoverCases(dir, 'B-');
      expect(filtered.map((c) => c.file)).toEqual(['B-b.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('casesDir 不存在 → 空数组', () => {
    expect(discoverCases('/nonexistent-dir-xyz')).toEqual([]);
  });
});
