import { execSync } from 'child_process';
import fs from 'fs';
import { buildEnvBranchScript, parseEnvBranchScript, isEnvBranchScript } from './env-branch';

const LOCAL = `#!/usr/bin/env bash
set -euo pipefail
VER="\${COMMIT_ID##*/}"
echo "[release] local cp $VER"
`;
const DEV = `#!/usr/bin/env bash
set -euo pipefail
echo "[release] scp to $PUBLISH_HOST"
`;

describe('env-branch（环境分支拼装）', () => {
  it('多分支 → 各环境包成函数 + case 分派', () => {
    const { script, envs } = buildEnvBranchScript({ local: LOCAL, dev: DEV });
    expect(envs).toEqual(['local', 'dev']);
    expect(script).toContain('__branch_local() {');
    expect(script).toContain('__branch_dev() {');
    expect(script).toContain('  local) __branch_local ;;');
    expect(script).toContain('  dev) __branch_dev ;;');
  });

  it('未配置脚本的环境 → fail-fast（*) exit 1，不静默回落）', () => {
    const { script } = buildEnvBranchScript({ local: LOCAL });
    expect(script).toContain('*)');
    expect(script).toContain('未配置发布脚本');
    expect(script).toContain('exit 1');
    // 只有 local 有函数，dev 绝不能落到 local
    expect(script).not.toContain('__branch_dev');
  });

  it('拼装结果通过 bash -n（含中文注释与未配分支）', () => {
    const { script } = buildEnvBranchScript({ local: LOCAL, dev: DEV });
    const file = `${process.env.TMPDIR || '/tmp'}/env-branch-${Date.now()}.sh`;
    fs.writeFileSync(file, script, 'utf-8');
    expect(() => execSync(`bash -n "${file}"`, { stdio: 'pipe' })).not.toThrow();
    fs.rmSync(file, { force: true });
  });

  it('DEPLOY_ENV 缺失 → 前置 fail-fast', () => {
    const { script } = buildEnvBranchScript({ local: LOCAL });
    expect(script).toContain('${DEPLOY_ENV:?缺少 DEPLOY_ENV');
  });

  it('非法 envId 直接拒绝（防拼出坏语法）', () => {
    expect(() => buildEnvBranchScript({ 'bad env': LOCAL })).toThrow(/环境 ID 非法/);
    expect(() => buildEnvBranchScript({ 'a;b': LOCAL })).toThrow(/环境 ID 非法/);
    expect(() => buildEnvBranchScript({ '': LOCAL })).toThrow(/环境 ID 非法/);
  });

  it('空分支 / 空脚本拒绝', () => {
    expect(() => buildEnvBranchScript({})).toThrow(/环境分支为空/);
    expect(() => buildEnvBranchScript({ local: '   ' })).toThrow(/脚本为空/);
  });

  it('反向解析：与拼装互为逆运算（迁移存量脚本用）', () => {
    const branches = { local: LOCAL.trim(), dev: DEV.trim() };
    const { script } = buildEnvBranchScript(branches);
    expect(isEnvBranchScript(script)).toBe(true);
    expect(parseEnvBranchScript(script)).toEqual(branches);
  });

  it('非拼装脚本 → 解析返回 null（页面据此判定未启用环境分支）', () => {
    expect(isEnvBranchScript('#!/usr/bin/env bash\necho hi')).toBe(false);
    expect(parseEnvBranchScript('#!/usr/bin/env bash\necho hi')).toBeNull();
    expect(parseEnvBranchScript(null)).toBeNull();
  });
});
