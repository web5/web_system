const path = require('path');
const { loadAutomator, buildCallerRequire } = require('../../src/automator');

const FIXTURE_APP = path.join(__dirname, 'fixtures/caller-app');

describe('automator.js', () => {
  test('createRequire 从调用方目录解析（mock callerDir fixture）', async () => {
    const automator = loadAutomator(FIXTURE_APP);
    expect(automator).toBeTruthy();
    const mp = await automator.launch({ cliPath: '/x', projectPath: '/y' });
    expect(mp.__fixture).toBe(true); // 证明拿到的是 fixture 那份，不是别处的
  });

  test('checkVersion 被 patch 成空函数', async () => {
    const req = buildCallerRequire(FIXTURE_APP);
    const MP = req('miniprogram-automator/out/MiniProgram').default;
    loadAutomator(FIXTURE_APP);
    await expect(MP.prototype.checkVersion.call({})).resolves.toBeUndefined();
  });

  test('patch 幂等：二次调用不重复包原型（函数引用不变）', () => {
    const req = buildCallerRequire(FIXTURE_APP);
    const MP = req('miniprogram-automator/out/MiniProgram').default;
    loadAutomator(FIXTURE_APP);
    const first = MP.prototype.checkVersion;
    loadAutomator(FIXTURE_APP);
    expect(MP.prototype.checkVersion).toBe(first);
  });

  test('callerDir 无 automator 时抛 MODULE_NOT_FOUND（解析路径推导正确）', () => {
    // 用系统临时目录（仓库外，保证向上查找链上没有任何 node_modules/miniprogram-automator）
    expect(() => loadAutomator(require('os').tmpdir())).toThrow(/miniprogram-automator/);
  });
});
