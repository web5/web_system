import { BadRequestException } from '@nestjs/common';
import {
  normalizeNodes,
  isV5NodesEnabled,
  isWritableStageKey,
  resolveNodeRunPlan,
  legacyStepsToNodes,
  PLATFORM_RESERVED,
  type TemplateNode,
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
