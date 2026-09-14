import { BadRequestException } from '@nestjs/common';
import {
  normalizeNodes,
  isV5NodesEnabled,
  isWritableStageKey,
  resolveNodeRunPlan,
  legacyStepsToNodes,
  PLATFORM_RESERVED,
  type TemplateNode,
  type ApprovalNode,
} from './template-node';

const PLATFORM = (): TemplateNode[] => [
  { kind: 'platform', key: 'git' },
  { kind: 'platform', key: 'version' },
  { kind: 'platform', key: 'pointer' },
];

describe('normalizeNodes（v5 模板节点校验，纯函数）', () => {
  it('null/空 → null（= legacy steps 路径）', () => {
    expect(normalizeNodes(undefined)).toBeNull();
    expect(normalizeNodes([])).toBeNull();
    expect(normalizeNodes([null, undefined])).toBeNull();
  });

  it('合法：git/version/pointer 齐全 + 中间/末尾插入 script', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
      { kind: 'script', key: 'notify', label: '通知', watchdog: true },
    ];
    const out = normalizeNodes(nodes)!;
    expect(out.length).toBe(5);
    expect(out.map((n) => n.key)).toEqual(['git', 'build', 'version', 'pointer', 'notify']);
  });

  it('script 可插在 git 后 version 前；watchdog 允许在 pointer 之后', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
    ];
    expect(normalizeNodes(nodes)).toBeTruthy();
  });

  it('缺平台步骤任一 → 拒绝', () => {
    const noGit = PLATFORM().filter((n) => n.key !== 'git');
    const noVersion = PLATFORM().filter((n) => n.key !== 'version');
    expect(() => normalizeNodes(noGit)).toThrow(BadRequestException);
    expect(() => normalizeNodes(noVersion)).toThrow(BadRequestException);
  });

  it('git 不在首位 → 拒绝', () => {
    const nodes: TemplateNode[] = [
      { kind: 'script', key: 'build', label: 'b' },
      ...PLATFORM(),
    ];
    expect(() => normalizeNodes(nodes)).toThrow(/git.*第一位/);
  });

  it('version 晚于 pointer（相对序颠倒）→ 拒绝', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'platform', key: 'pointer' },
      { kind: 'platform', key: 'version' },
    ];
    expect(() => normalizeNodes(nodes)).toThrow(/version.*pointer/);
  });

  it('script key 重复 / 占用平台保留字 / 非法格式 / 缺 label → 拒绝', () => {
    const dup: TemplateNode[] = [
      ...PLATFORM(),
      { kind: 'script', key: 'build', label: 'a' },
      { kind: 'script', key: 'build', label: 'b' },
    ];
    expect(() => normalizeNodes(dup)).toThrow(/重复/);

    const clash: TemplateNode[] = [...PLATFORM(), { kind: 'script', key: 'git', label: 'x' }];
    // 命中"key 重复"(与平台 git)或"保留字"均算拦截，语义等价
    expect(() => normalizeNodes(clash)).toThrow(/重复|保留字/);

    const bad: TemplateNode[] = [...PLATFORM(), { kind: 'script', key: 'bad key!', label: 'x' }];
    expect(() => normalizeNodes(bad)).toThrow(/key 非法/);

    const noLabel: TemplateNode[] = [...PLATFORM(), { kind: 'script', key: 'build', label: '  ' }];
    expect(() => normalizeNodes(noLabel)).toThrow(/label/);
  });

  it('watchdog 超过 1 个 → 拒绝', () => {
    const nodes: TemplateNode[] = [
      ...PLATFORM(),
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
      { kind: 'script', key: 'smoke', label: '冒烟', watchdog: true },
    ];
    expect(() => normalizeNodes(nodes)).toThrow(/watchdog/);
  });

  it('platform 非法 key（不在保留字内）→ 拒绝', () => {
    const nodes = [
      { kind: 'platform', key: 'pull' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
    ] as any;
    expect(() => normalizeNodes(nodes)).toThrow();
  });
});

describe('legacyStepsToNodes（9 阶段 → nodes 一次性转存）', () => {
  it('全量九阶段 + rollback=previous → git/version/pointer 为 platform，verify 带 watchdog', () => {
    const nodes = legacyStepsToNodes({ rollbackOnFailure: 'previous' });
    expect(nodes.map((n) => n.key)).toEqual([
      'git',
      'check',
      'build',
      'upload',
      'restart',
      'version',
      'pointer',
      'verify',
      'cleanup',
    ]);
    expect(nodes.filter((n) => n.kind === 'platform').map((n) => n.key)).toEqual([
      'git',
      'version',
      'pointer',
    ]);
    const verify = nodes.find((n) => n.key === 'verify') as any;
    expect(verify.watchdog).toBe(true);
    expect(verify.optional).toBe(true);
    const build = nodes.find((n) => n.key === 'build') as any;
    expect(build.optional).toBe(false); // build 必配（legacy required）
  });

  it('rollback=none → verify 节点不带 watchdog（放弃自动回滚）', () => {
    const nodes = legacyStepsToNodes({ rollbackOnFailure: 'none' });
    const verify = nodes.find((n) => n.key === 'verify') as any;
    expect(verify).toBeTruthy();
    expect(verify.watchdog).toBeUndefined();
  });

  it('skipVerify → 不生成 verify 节点', () => {
    const nodes = legacyStepsToNodes({ skipVerify: true, rollbackOnFailure: 'previous' });
    expect(nodes.some((n) => n.key === 'verify')).toBe(false);
  });

  it('自定义 steps 子集（如裁剪 upload/cleanup）→ 仅生成出现的 script', () => {
    const nodes = legacyStepsToNodes({
      steps: ['check', 'pull', 'build', 'restart', 'version', 'pointer', 'verify'],
      rollbackOnFailure: 'previous',
    });
    expect(nodes.some((n) => n.key === 'upload')).toBe(false);
    expect(nodes.some((n) => n.key === 'cleanup')).toBe(false);
    expect(nodes.some((n) => n.key === 'restart')).toBe(true);
    expect(normalizeNodes(nodes)).toBeTruthy(); // 转存结果必须自洽
  });

  it('转存结果满足 normalizeNodes（git 首位/version 在 pointer 前）', () => {
    const full = legacyStepsToNodes({ rollbackOnFailure: 'previous' });
    expect(() => normalizeNodes(full)).not.toThrow();
  });
});

describe('resolveNodeRunPlan（执行计划：顺序/watchdog/script 集合）', () => {
  it('null/空 → null（= legacy）', () => {
    expect(resolveNodeRunPlan(null)).toBeNull();
    expect(resolveNodeRunPlan([])).toBeNull();
  });

  it('输出保序 keys + scriptKeys；watchdog 记 watchKey', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
    ];
    const plan = resolveNodeRunPlan(nodes)!;
    expect(plan.keys).toEqual(['git', 'build', 'version', 'pointer', 'verify']);
    expect(plan.watchKey).toBe('verify');
    expect([...plan.scriptKeys].sort()).toEqual(['build', 'verify']);
  });

  it('无 watchdog 节点 → watchKey 为 undefined', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
    ];
    const plan = resolveNodeRunPlan(nodes)!;
    expect(plan.watchKey).toBeUndefined();
    expect(plan.scriptKeys.size).toBe(0);
  });
});

describe('isWritableStageKey（stage_commands 可写判定）', () => {
  it('自定义 key 可写；platform 保留字与非法格式拒绝', () => {
    expect(isWritableStageKey('notify')).toBe(true);
    expect(isWritableStageKey('build')).toBe(true);
    expect(isWritableStageKey('git')).toBe(false);
    expect(isWritableStageKey('version')).toBe(false);
    expect(isWritableStageKey('pointer')).toBe(false);
    expect(isWritableStageKey('')).toBe(false);
    expect(isWritableStageKey('bad key!')).toBe(false);
  });
});

describe('isV5NodesEnabled（flag，缺省 off）', () => {
  const old = process.env.PIPELINE_V5_NODES;
  afterEach(() => {
    if (old === undefined) delete process.env.PIPELINE_V5_NODES;
    else process.env.PIPELINE_V5_NODES = old;
  });

  it('缺省/off/On 大小写不敏感；on 才启用', () => {
    delete process.env.PIPELINE_V5_NODES;
    expect(isV5NodesEnabled()).toBe(false);
    process.env.PIPELINE_V5_NODES = 'off';
    expect(isV5NodesEnabled()).toBe(false);
    process.env.PIPELINE_V5_NODES = 'on';
    expect(isV5NodesEnabled()).toBe(true);
    process.env.PIPELINE_V5_NODES = 'ON';
    expect(isV5NodesEnabled()).toBe(true);
  });
});

describe('PLATFORM_RESERVED', () => {
  it('保留字 = git/version/pointer（作为 stage_commands 写入黑名单）', () => {
    expect(PLATFORM_RESERVED).toEqual(['git', 'version', 'pointer']);
  });
});

/**
 * 审批节点的防回归测试（P0 / design D8）。
 *
 * 背景：审批原本是「发布前置门禁」（提交即阻断，只能在最前面拦一次），
 * 无法表达「构建完、重启前等人确认」这类诉求。升级为节点后它可以插在任意位置，
 * 与 shell 节点混排，故保序 / key 唯一 / watchdog 计数都要在此锁定。
 */
describe('ApprovalNode（审批成为节点）', () => {
  it('V1 类型定义含 key / label / approvers / timeoutSec / onTimeout / onReject', () => {
    const n: ApprovalNode = {
      kind: 'approval',
      key: 'approve',
      label: '发布确认',
      approvers: ['bob'],
      timeoutSec: 3600,
      onTimeout: 'auto-approve',
      onReject: 'rollback',
    };
    expect(n.kind).toBe('approval');
    expect(n.key).toBe('approve');
    expect(n.label).toBe('发布确认');
    expect(n.approvers).toEqual(['bob']);
    expect(n.timeoutSec).toBe(3600);
    expect(n.onTimeout).toBe('auto-approve');
    expect(n.onReject).toBe('rollback');
    // 缺省：不指定审批人（任意有权限者）、不超时
    const minimal: ApprovalNode = { kind: 'approval', key: 'a', label: 'A' };
    expect(minimal.approvers).toBeUndefined();
    expect(minimal.timeoutSec).toBeUndefined();
  });

  it('V2 与 shell 节点混排时保序（审批可插在任意位置）', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'approval', key: 'approve', label: '发布确认' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
    ];
    const out = normalizeNodes(nodes)!;
    expect(out.map((n) => n.key)).toEqual([
      'git',
      'build',
      'approve',
      'version',
      'pointer',
      'verify',
    ]);
    expect(out[2]).toEqual({ kind: 'approval', key: 'approve', label: '发布确认' });
  });

  it('V3 approval 节点 key 与 shell 重复 → 拒绝', () => {
    const nodes: TemplateNode[] = [
      ...PLATFORM(),
      { kind: 'script', key: 'gate', label: '门禁' },
      { kind: 'approval', key: 'gate', label: '重复 key' },
    ];
    expect(() => normalizeNodes(nodes)).toThrow(/重复/);
  });

  it('V3 approval 节点同样受 key 格式 / 保留字 / label 约束', () => {
    const reserved = [...PLATFORM(), { kind: 'approval', key: 'git', label: 'x' }] as any;
    expect(() => normalizeNodes(reserved)).toThrow(/保留字|重复/);
    const badKey = [...PLATFORM(), { kind: 'approval', key: 'bad key!', label: 'x' }] as any;
    expect(() => normalizeNodes(badKey)).toThrow(/key 非法/);
    const noLabel = [...PLATFORM(), { kind: 'approval', key: 'approve', label: '' }] as any;
    expect(() => normalizeNodes(noLabel)).toThrow(/label/);
  });

  it('V4 approval 节点不占用 watchdog 唯一性（watchdog 只统计 shell 节点）', () => {
    // 即便带上 watchdog 字段（历史数据/前端误传），审批节点也不参与计数
    const nodes = [
      ...PLATFORM(),
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
      { kind: 'approval', key: 'approve', label: '发布确认', watchdog: true },
    ] as any;
    expect(() => normalizeNodes(nodes)).not.toThrow();
    // 两个 shell watchdog 仍然被拒（回归保护）
    const two = [
      ...PLATFORM(),
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
      { kind: 'script', key: 'smoke', label: '冒烟', watchdog: true },
      { kind: 'approval', key: 'approve', label: '发布确认' },
    ] as any;
    expect(() => normalizeNodes(two)).toThrow(/watchdog/);
  });

  it('onReject / onTimeout 非法值 → 拒绝', () => {
    const badReject = [
      ...PLATFORM(),
      { kind: 'approval', key: 'approve', label: 'a', onReject: 'whatever' },
    ] as any;
    expect(() => normalizeNodes(badReject)).toThrow(/onReject 非法/);
    const badTimeout = [
      ...PLATFORM(),
      { kind: 'approval', key: 'approve', label: 'a', onTimeout: 'whatever' },
    ] as any;
    expect(() => normalizeNodes(badTimeout)).toThrow(/onTimeout 非法/);
  });

  it('执行计划：approval 计入 keys（执行到会挂起），但不进 scriptKeys（不可配命令）', () => {
    const nodes: TemplateNode[] = [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'approval', key: 'approve', label: '发布确认' },
      { kind: 'script', key: 'verify', label: '探活', watchdog: true },
    ];
    const plan = resolveNodeRunPlan(nodes)!;
    expect(plan.keys).toEqual(['git', 'build', 'approve', 'verify']);
    expect([...plan.scriptKeys].sort()).toEqual(['build', 'verify']);
    expect(plan.watchKey).toBe('verify');
  });
});
