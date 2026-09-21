import { pickStepBranch, validateStepBranches, type StepBranchLike } from './step-branch';

const LOCAL: StepBranchLike = {
  name: 'local',
  condition: 'DEPLOY_ENV == local',
  script: 'cp',
  sort: 0,
};
const DEV: StepBranchLike = {
  name: 'dev',
  condition: 'DEPLOY_ENV == dev',
  script: 'scp',
  sort: 1,
};
const DEFAULT_REMOTE: StepBranchLike = { name: 'remote', condition: null, script: 'scp', sort: 99 };

describe('步骤任务选择', () => {
  it('命中第一个为真的任务（按 sort 升序）', () => {
    const r = pickStepBranch([DEV, LOCAL], { DEPLOY_ENV: 'local' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.branch.name).toBe('local');
  });

  it('条件不满足 → 继续匹配下一个', () => {
    const r = pickStepBranch([LOCAL, DEV], { DEPLOY_ENV: 'dev' });
    expect(r.ok && r.branch.name).toBe('dev');
  });

  it('全不命中 → 用默认任务兑底', () => {
    const r = pickStepBranch([LOCAL, DEV, DEFAULT_REMOTE], { DEPLOY_ENV: 'prod' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.branch.name).toBe('remote');
    expect(r.ok && r.fallback).toBe(true);
  });

  it('无默认任务且全不命中 → ok=false 且给出可处置原因', () => {
    const r = pickStepBranch([LOCAL, DEV], { DEPLOY_ENV: 'prod' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('默认任务');
  });

  it('无任务 → ok=false（回落到节点的单一执行体）', () => {
    expect(pickStepBranch([], {}).ok).toBe(false);
    expect(pickStepBranch(null, {}).ok).toBe(false);
  });

  it('禁用的任务不参与匹配', () => {
    const r = pickStepBranch([{ ...LOCAL, enabled: false }, DEV], { DEPLOY_ENV: 'local' });
    expect(r.ok).toBe(false);
  });

  it('条件表达式非法 → 抛错（不静默放行）', () => {
    expect(() => pickStepBranch([{ name: 'x', condition: 'BAD', script: 's' }], {})).toThrow(
      /执行条件非法/,
    );
  });
});

describe('步骤任务集合校验', () => {
  it('合法集合无错误', () => {
    expect(validateStepBranches([LOCAL, DEV, DEFAULT_REMOTE])).toEqual([]);
  });

  it('重名 / 空脚本 / 非法条件 / 多个默认任务 → 逐条报错', () => {
    const errs = validateStepBranches([
      { name: 'a', script: 'x', condition: 'DEPLOY_ENV == a' },
      { name: 'a', script: '' },
      { name: 'c', script: 'y', condition: 'BAD' },
      { name: 'd', script: 'z', condition: null },
    ]);
    expect(errs.join('|')).toContain('名称重复');
    expect(errs.join('|')).toContain('脚本为空');
    expect(errs.join('|')).toContain('匹配条件非法');
    expect(errs.join('|')).toContain('默认任务');
  });

  it('空集合合法（= 不启用分支）', () => {
    expect(validateStepBranches([])).toEqual([]);
  });
});
