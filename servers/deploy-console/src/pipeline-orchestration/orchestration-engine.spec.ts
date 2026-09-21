/**
 * 编排执行引擎单测（specs/pipeline-step-task/design.md §3 执行语义 + §8 验收 V2/V4/V5）。
 *
 * 脚本执行 / 审批等待 / 日志全部 mock，专注调度语义：
 * 条件过滤、并行批次、动作串行链（失败即断）、审核处置、全不命中失败、取消。
 */
import {
  runOrchestration,
  type EngineStep,
  type EngineTask,
  type EngineAction,
  type EngineContext,
} from './orchestration-engine';

function step(name: string, tasks: EngineTask[]): EngineStep {
  return { id: `s-${name}`, name, tasks };
}
function scriptTask(name: string, actions: string[], condition?: string): EngineTask {
  return {
    id: `t-${name}`,
    kind: 'script',
    name,
    condition: condition ?? null,
    actions: actions.map((n, i) => ({ id: `a-${name}-${i}`, name: n, script: `echo ${n}` })),
  };
}
function approvalTask(name: string, approval: EngineTask['approval']): EngineTask {
  return { id: `t-${name}`, kind: 'approval', name, approval };
}

interface Harness {
  ctx: EngineContext;
  ran: string[];
  logs: string[];
  approvalResult: 'approved' | 'rejected' | 'timeout';
  failOn: string | null;
}
function harness(vars: Record<string, string> = { DEPLOY_ENV: 'local' }): Harness {
  const h: Harness = {
    ran: [],
    logs: [],
    approvalResult: 'approved',
    failOn: null,
    ctx: {
      vars,
      baseEnv: { CONSOLE_API: 'http://x' },
      log: (line) => h.logs.push(line),
      runScript: async (a: EngineAction) => {
        if (h.failOn === a.name) throw new Error('boom');
        h.ran.push(a.name);
      },
      waitApproval: async () => h.approvalResult,
    },
  };
  return h;
}

describe('runOrchestration（执行引擎）', () => {
  it('V2 顺序执行：步骤串行、动作串行', async () => {
    const h = harness();
    const tree = [
      step('拉取代码', [scriptTask('git', ['校验', '检出'])]),
      step('发布', [scriptTask('local', ['发布文件', '写版本'])]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('succeeded');
    expect(h.ran).toEqual(['校验', '检出', '发布文件', '写版本']);
  });

  it('V2 条件命中执行、未命中跳过（日志留痕）', async () => {
    const h = harness(); // DEPLOY_ENV=local
    const tree = [
      step('发布', [
        scriptTask('local', ['本机 cp'], 'DEPLOY_ENV == local'),
        scriptTask('dev', ['远程 scp'], 'DEPLOY_ENV == dev'),
      ]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('succeeded');
    expect(h.ran).toEqual(['本机 cp']);
    expect(h.logs.some((l) => l.includes('dev') && l.includes('已跳过'))).toBe(true);
  });

  it('V2 非法条件 → 整体失败（不静默放行）', async () => {
    const h = harness();
    const tree = [step('发布', [scriptTask('bad', ['x'], 'DEPLOY_ENV === local')])];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('failed');
    expect(r.failedAt).toBe('发布 / bad');
  });

  it('V4 互斥分支全不命中 → 步骤失败并指明环境', async () => {
    const h = harness({ DEPLOY_ENV: 'prod' });
    const tree = [
      step('发布', [
        scriptTask('local', ['本机 cp'], 'DEPLOY_ENV == local'),
        scriptTask('dev', ['远程 scp'], 'DEPLOY_ENV == dev'),
      ]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('failed');
    expect(r.failedAt).toBe('发布');
    expect(r.error).toContain('DEPLOY_ENV=prod');
    expect(h.ran).toEqual([]);
  });

  it('V5 动作串行链失败即断：后续动作不再执行，任务失败定位到动作', async () => {
    const h = harness();
    h.failOn = '发布文件到目标位置';
    const tree = [
      step('发布', [scriptTask('local', ['发布文件到目标位置', 'write-version'])]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('failed');
    expect(r.failedAt).toBe('发布 / local');
    expect(r.error).toContain('发布文件到目标位置');
    expect(h.ran).toEqual([]); // write-version 未执行
  });

  it('任务被条件跳过时其全部动作不执行（V5 反向）', async () => {
    const h = harness({ DEPLOY_ENV: 'dev' });
    const tree = [
      step('发布', [
        scriptTask('local', ['本机 cp', '写版本'], 'DEPLOY_ENV == local'),
        scriptTask('dev', ['远程 scp', '写版本'], 'DEPLOY_ENV == dev'),
      ]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('succeeded');
    expect(h.ran).toEqual(['远程 scp', '写版本']);
  });

  it('审核：通过继续；拒绝默认失败；onReject=skip 则跳过', async () => {
    const tree = [step('确认', [approvalTask('门禁', { approvers: ['ops'] })])];

    const h1 = harness();
    expect((await runOrchestration(tree, h1.ctx)).status).toBe('succeeded');

    const h2 = harness();
    h2.approvalResult = 'rejected';
    const r2 = await runOrchestration(tree, h2.ctx);
    expect(r2.status).toBe('failed');
    expect(r2.error).toContain('拒绝');

    const h3 = harness();
    h3.approvalResult = 'rejected';
    const tree3 = [step('确认', [approvalTask('门禁', { approvers: ['ops'], onReject: 'skip' })])];
    expect((await runOrchestration(tree3, h3.ctx)).status).toBe('succeeded');
    expect(h3.logs.some((l) => l.includes('跳过'))).toBe(true);
  });

  it('审核超时：默认失败，timeoutAction=skip 则跳过', async () => {
    const tree = [step('确认', [approvalTask('门禁', { approvers: ['ops'], timeoutAction: 'skip' })])];
    const h = harness();
    h.approvalResult = 'timeout';
    expect((await runOrchestration(tree, h.ctx)).status).toBe('succeeded');

    const h2 = harness();
    h2.approvalResult = 'timeout';
    const tree2 = [step('确认', [approvalTask('门禁', { approvers: ['ops'] })])];
    expect((await runOrchestration(tree2, h2.ctx)).status).toBe('failed');
  });

  it('审核任务不执行任何动作（混排在步骤中）', async () => {
    const h = harness();
    const tree = [
      step('确认', [
        approvalTask('门禁', { approvers: ['ops'] }),
        scriptTask('条件分支', ['跑脚本'], 'DEPLOY_ENV == local'),
      ]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('succeeded');
    expect(h.ran).toEqual(['跑脚本']);
  });

  it('同步骤内并行：无条件任务与命中条件任务同批执行，任一失败整体失败', async () => {
    const h = harness();
    h.failOn = '并行脚本B';
    const tree = [
      step('并行步', [
        scriptTask('A', ['并行脚本A']),
        scriptTask('B', ['并行脚本B']),
        scriptTask('未命中', ['x'], 'DEPLOY_ENV == dev'),
      ]),
    ];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('failed');
    expect(r.failedAt).toBe('并行步 / B');
  });

  it('env 合成：任务级 env 覆盖 baseEnv', async () => {
    const h = harness();
    const seen: Record<string, string>[] = [];
    h.ctx.runScript = async (_a, env) => {
      seen.push(env);
    };
    const task = scriptTask('t', ['x']);
    task.env = { CONSOLE_API: 'http://override', EXTRA: '1' };
    await runOrchestration([step('s', [task])], h.ctx);
    expect(seen[0].CONSOLE_API).toBe('http://override');
    expect(seen[0].EXTRA).toBe('1');
  });

  it('停用的步骤与任务被跳过；无任务步骤（分组占位）合法通过', async () => {
    const h = harness();
    const tree = [
      { ...step('停用步', [scriptTask('x', ['y'])]), enabled: false },
      step('占位', []),
      step('正常', [{ ...scriptTask('t', ['z']), enabled: false }, scriptTask('t2', ['ok'])]),
    ];
    const r = await runOrchestration(tree as EngineStep[], h.ctx);
    expect(r.status).toBe('succeeded');
    expect(h.ran).toEqual(['ok']);
  });

  it('脚本任务零启用动作 → 失败（配置缺口在执行时暴露）', async () => {
    const h = harness();
    const tree = [step('s', [scriptTask('t', ['a', 'b'])])];
    tree[0].tasks![0].actions = [];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('没有可执行的动作');
  });

  it('shouldAbort → 立即中止为 aborted', async () => {
    const h = harness();
    let calls = 0;
    h.ctx.shouldAbort = () => ++calls > 1; // 第一次 false，第二次 true
    const tree = [step('s1', [scriptTask('t', ['a'])]), step('s2', [scriptTask('t', ['b'])])];
    const r = await runOrchestration(tree, h.ctx);
    expect(r.status).toBe('aborted');
  });
});
