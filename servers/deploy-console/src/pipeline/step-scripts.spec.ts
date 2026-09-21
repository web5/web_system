import { execSync } from 'child_process';
import {
  PLATFORM_STEP_SCRIPTS,
  DEFAULT_STEP_SCRIPTS,
  getPlatformStepScript,
  getDefaultStepScript,
  readStepScript,
} from './step-scripts';

/**
 * 脚本清单与正文的防回归测试。
 *
 * 背景（2026-09-15 用户决定）：**git 不再是平台托管节点** —— 拉取代码是普通 shell 节点，
 * 脚本存在 DB、页面可编辑，git 的登录/密钥/权限归「git 信息维护层」。
 * 于是这里锁死两条边界：
 *  ① 托管清单（随代码同步、接口拒写）**只剩 restart / verify**，git 不在其中；
 *  ② git 作为「默认脚本」仍要可读、语法正确、四道 fail-fast 校验齐备（新建流水线时的初始值）。
 */
describe('脚本清单与正文 step-scripts', () => {
  it('平台托管清单只剩 restart / verify（git 已交还运维）', () => {
    const keys = PLATFORM_STEP_SCRIPTS.map((s) => s.nodeKey);
    expect(keys).not.toContain('git');
    expect(keys).toEqual(expect.arrayContaining(['restart', 'verify']));
    for (const k of keys) expect(getPlatformStepScript(k).length).toBeGreaterThan(50);
  });

  it('git 在默认脚本清单里，正文可读且足够完整', () => {
    expect(DEFAULT_STEP_SCRIPTS.map((s) => s.nodeKey)).toContain('git');
    expect(getDefaultStepScript('git').length).toBeGreaterThan(200);
  });

  it('未知节点直接抛错（避免静默用空脚本发布）', () => {
    expect(() => getPlatformStepScript('nope')).toThrow(/未知的平台托管步骤/);
    expect(() => getDefaultStepScript('nope')).toThrow(/未知的默认节点脚本/);
  });

  it('git 默认脚本通过 bash -n 语法校验', () => {
    const script = getDefaultStepScript('git');
    const file = `${process.env.TMPDIR || '/tmp'}/git-step-check.sh`;
    require('fs').writeFileSync(file, script, 'utf-8');
    expect(() => execSync(`bash -n "${file}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('git 默认脚本校验代码来源：REPO_URL 非空时 origin 必须一致（防改错 origin 照常构建）', () => {
    const s = getDefaultStepScript('git');
    expect(s).toContain('REPO_URL');
    expect(s).toContain('代码来源不符');
    // 未配置 REPO_URL 时必须放行（现状行为零破坏）
    expect(s).toContain('[ -n "${REPO_URL:-}" ]');
  });

  it('git 默认脚本四道 fail-fast 校验齐备（origin / 分支 / commit 可达 / HEAD 自证）', () => {
    const s = getDefaultStepScript('git');
    expect(s).toContain('git remote get-url origin');
    expect(s).toContain('分支不存在');
    expect(s).toContain('commit 不可达');
    expect(s).toContain('自检失败');
    expect(s).toContain('set -euo pipefail');
  });

  it('git 默认脚本不带依赖同步与预构建（属平台职责，避免两处实现）', () => {
    const s = getDefaultStepScript('git');
    expect(s).not.toContain('pnpm install');
    expect(s).not.toContain('--filter');
  });

  it('脚本机器无关：不引用 REMOTE_* 变量', () => {
    expect(getDefaultStepScript('git')).not.toMatch(/REMOTE_(HOST|USER|KEY|DIR|GATEWAY_URL|CONSOLE_URL)/);
  });

  it('缺失文件时报错信息可定位（含 nest-cli assets 提示）', () => {
    expect(() => readStepScript('not-exist.sh')).toThrow(/assets/);
  });
});
