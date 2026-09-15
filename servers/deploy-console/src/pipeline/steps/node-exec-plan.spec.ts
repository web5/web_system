import { planNodeExec } from './node-exec-plan';

/**
 * 节点执行策略的防回归测试。
 *
 * 背景（实测）：v5 模板转存后 `check` 是 `optional=true` 的 script 节点，DB 未配命令即
 * 整段跳过 → `reuseArtifact` / 分支缺省 master / prod 分支约束全部丢失
 * （日志 `[check] 校验 未配置脚本，已跳过（optional）`、`reuse_artifact=0`）。
 * 此测试锁定「check 恒内置执行 + 命令叠加」与「git 支持 DB 脚本 + 内置回退」。
 */
describe('planNodeExec（v5 节点执行策略）', () => {
  it('check → base：恒内置安全基线，命令作为附加校验叠加', () => {
    expect(
      planNodeExec({ kind: 'script', key: 'check', label: '校验', optional: true }),
    ).toEqual({ how: 'check-base' });
  });

  it('git → 优先 DB 锁定脚本，缺省回退内置 pull', () => {
    expect(planNodeExec({ kind: 'platform', key: 'git' })).toEqual({ how: 'git' });
  });

  it('version / pointer → 纯内置（发布语义真相源，不可被命令覆盖）', () => {
    expect(planNodeExec({ kind: 'platform', key: 'version' })).toEqual({
      how: 'builtin',
      builtinKey: 'version',
    });
    expect(planNodeExec({ kind: 'platform', key: 'pointer' })).toEqual({
      how: 'builtin',
      builtinKey: 'pointer',
    });
  });

  it('其余 script 节点 → 命令驱动', () => {
    for (const key of ['build', 'upload', 'restart', 'verify', 'cleanup', 'notify']) {
      expect(planNodeExec({ kind: 'script', key, label: key })).toEqual({ how: 'script' });
    }
  });

  // P0：审批由「发布前置门禁」升级为节点（design D8），执行分派必须有独立分支
  it('approval 节点 → 挂起等人批（不执行命令）', () => {
    expect(
      planNodeExec({ kind: 'approval', key: 'approve', label: '发布确认' }),
    ).toEqual({ how: 'approval' });
  });

  it('approval 节点带审批人/拒绝策略不影响分派（策略在决议时使用）', () => {
    expect(
      planNodeExec({
        kind: 'approval',
        key: 'gate',
        label: '门禁',
        approvers: ['bob'],
        onReject: 'rollback',
        onTimeout: 'abort',
      }),
    ).toEqual({ how: 'approval' });
  });
});
