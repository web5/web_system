import { execSync } from 'child_process';
import { PLATFORM_STEP_SCRIPTS, getPlatformStepScript, readStepScript } from './step-scripts';

/**
 * 平台托管脚本的防回归测试。
 *
 * 背景：`git` 节点改为 DB 脚本后，正文若被改坏（语法错误 / 丢了关键校验），
 * 会在真机发布时才炸，且 `locked` 意味着页面改不回来 —— 因此这里锁死：
 *   ① 脚本文件存在且 `bash -n` 语法正确；
 *   ② 四道 fail-fast 校验与 HEAD 自证都在（无 origin / 分支不存在 / commit 不可达 / 自证）；
 *   ③ 依赖同步与预构建**不在**脚本里（那是平台职责，避免两处实现）。
 */
describe('平台托管脚本 step-scripts', () => {
  it('清单至少包含 git 节点，且脚本可读取', () => {
    expect(PLATFORM_STEP_SCRIPTS.map((s) => s.nodeKey)).toContain('git');
    expect(getPlatformStepScript('git').length).toBeGreaterThan(200);
  });

  it('未知节点直接抛错（避免静默用空脚本发布）', () => {
    expect(() => getPlatformStepScript('nope')).toThrow(/未知的平台托管步骤/);
  });

  it('git 脚本通过 bash -n 语法校验', () => {
    const script = getPlatformStepScript('git');
    const file = `${process.env.TMPDIR || '/tmp'}/git-step-check.sh`;
    require('fs').writeFileSync(file, script, 'utf-8');
    expect(() => execSync(`bash -n "${file}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('四道 fail-fast 校验齐备（origin / 分支 / commit 可达 / HEAD 自证）', () => {
    const s = getPlatformStepScript('git');
    expect(s).toContain('git remote get-url origin');
    expect(s).toContain('分支不存在');
    expect(s).toContain('commit 不可达');
    expect(s).toContain('自检失败');
    expect(s).toContain('set -euo pipefail');
  });

  it('不带依赖同步与预构建（属平台职责，避免两处实现）', () => {
    const s = getPlatformStepScript('git');
    expect(s).not.toContain('pnpm install');
    expect(s).not.toContain('--filter');
  });

  it('脚本机器无关：不引用 REMOTE_* 变量', () => {
    expect(getPlatformStepScript('git')).not.toMatch(/REMOTE_(HOST|USER|KEY|DIR|GATEWAY_URL|CONSOLE_URL)/);
  });

  it('缺失文件时报错信息可定位（含 nest-cli assets 提示）', () => {
    expect(() => readStepScript('not-exist.sh')).toThrow(/assets/);
  });
});
