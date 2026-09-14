import { StepAction } from '../../entities/deploy-pipeline-step-command.entity';
import {
  runActionSequence,
  resolveActionTimeout,
  ActionFailedError,
  ActionShellInvocation,
  RunActionsDeps,
} from './action-sequence';

/**
 * shell 节点「多操作顺序执行」的防回归测试（T4）。
 *
 * 背景：这段语义原先内联在 `PipelineService.runStageCommand` 里直接 spawn，
 * 全仓 0 处 mock ⇒ **该路径零测试**。任何一次重构（比如把 platform 三节点降级为
 * 普通 shell 节点）都可能悄悄改掉「失败即停 / continueOnError / 结果回传」。
 * 这里用假 runner 把它锁住。
 */
describe('runActionSequence（节点内多操作顺序执行）', () => {
  const shell = (id: string, code: string, extra: Partial<StepAction> = {}): StepAction => ({
    id,
    type: 'shell',
    name: id,
    code,
    ...extra,
  });

  /** 构造一个假 runner：按操作脚本决定退出码，并记录调用 */
  function makeRunner(codes: Record<string, number> = {}) {
    const calls: ActionShellInvocation[] = [];
    const store = new Map<string, Record<string, unknown>>();
    const seenAt: Record<string, unknown> = {};
    const runShell = jest.fn(async (inv: ActionShellInvocation) => {
      calls.push(inv);
      const file = String(inv.env.WS_RESULT_FILE ?? '');
      // 记住每个操作开始时看到的结果文件内容（验证前后操作可传递）
      seenAt[inv.code] = { ...(store.get(file) ?? {}) };
      // 模拟脚本往 $WS_RESULT_FILE 回传结果
      store.set(file, { ...(store.get(file) ?? {}), [inv.code]: 'ok' });
      return codes[inv.code] ?? 0;
    });
    return {
      calls,
      runShell,
      seenAt,
      readResult: jest.fn(() => ({})),
    };
  }

  const baseDeps = (
    over: Pick<RunActionsDeps, 'actions' | 'runShell' | 'readResult' | 'onLog'> &
      Partial<RunActionsDeps>,
  ): RunActionsDeps => ({
    stage: 'build',
    baseEnv: { MODULE_KEY: 'admin' },
    resultFile: '/tmp/ws-result-1.json',
    ...over,
  });

  it('V1 多操作顺序执行（前一个结束才跑下一个）', async () => {
    const { runShell, readResult, calls } = makeRunner();
    const order: string[] = [];
    const out = await runActionSequence(
      baseDeps({
        actions: [shell('a1', 'first'), shell('a2', 'second')],
        runShell: async (inv) => {
          order.push(`start:${inv.code}`);
          const code = await runShell(inv);
          order.push(`end:${inv.code}`);
          return code;
        },
        readResult,
        onLog: () => undefined,
      }),
    );
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(calls.map((c) => c.code)).toEqual(['first', 'second']);
    expect(out.executed).toBe(2);
    expect(out.tolerated).toEqual([]);
  });

  it('V1 失败即停：退出码非 0 且未声明 continueOnError ⇒ 抛错，后续操作不执行', async () => {
    const { runShell, readResult, calls } = makeRunner({ first: 2 });
    await expect(
      runActionSequence(
        baseDeps({
          actions: [shell('a1', 'first'), shell('a2', 'second')],
          runShell,
          readResult,
          onLog: () => undefined,
        }),
      ),
    ).rejects.toThrow(ActionFailedError);
    expect(calls.map((c) => c.code)).toEqual(['first']); // 第二个没跑
  });

  it('V2 continueOnError=是 ⇒ 记录失败但继续执行后续操作', async () => {
    const { runShell, readResult, calls } = makeRunner({ first: 1 });
    const out = await runActionSequence(
      baseDeps({
        actions: [shell('a1', 'first', { cont: true }), shell('a2', 'second')],
        runShell,
        readResult,
        onLog: () => undefined,
      }),
    );
    expect(calls.map((c) => c.code)).toEqual(['first', 'second']);
    expect(out.tolerated).toEqual(['a1']);
    expect(out.executed).toBe(2);
  });

  it('V3 WS_RESULT_FILE：前序操作写入、后续操作可读（同一路径贯穿全节点）', async () => {
    const { runShell, seenAt } = makeRunner();
    const readResult = jest.fn(() => ({}));
    const resultFile = '/tmp/ws-result-abc.json';
    await runActionSequence(
      baseDeps({
        actions: [shell('a1', 'op1'), shell('a2', 'op2')],
        resultFile,
        runShell,
        readResult,
        onLog: () => undefined,
      }),
    );
    // 两个操作拿到的是同一个结果文件
    expect(runShell.mock.calls.every(([inv]) => inv.env.WS_RESULT_FILE === resultFile)).toBe(true);
    // op2 启动时能看到 op1 写进去的内容
    expect(seenAt.op2).toEqual({ op1: 'ok' });
  });

  it('V3 操作回传的结果按 key 合并（多操作的键值都保留）', async () => {
    const runShell = jest.fn(async () => 0);
    const readResult = jest.fn((op: string) => ({ [`${op}_key`]: op }));
    const out = await runActionSequence(
      baseDeps({
        actions: [shell('a1', 'first'), shell('a2', 'second')],
        runShell,
        readResult,
        onLog: () => undefined,
      }),
    );
    expect(out.merged).toEqual({ op1_key: 'op1', op2_key: 'op2' });
  });

  it('V4 超时：操作级优先，缺省用节点级 timeoutSec', async () => {
    const { runShell, readResult, calls } = makeRunner();
    await runActionSequence(
      baseDeps({
        actions: [shell('a1', 'first', { timeoutSec: 30 }), shell('a2', 'second')],
        defaultTimeoutSec: 600,
        runShell,
        readResult,
        onLog: () => undefined,
      }),
    );
    expect(calls[0].timeoutSec).toBe(30);
    expect(calls[1].timeoutSec).toBe(600);
  });

  it('V4 超时：节点也未配 ⇒ 不传超时（由 runner 用全局默认）', async () => {
    const { runShell, readResult, calls } = makeRunner();
    await runActionSequence(
      baseDeps({
        actions: [shell('a1', 'first')],
        runShell,
        readResult,
        onLog: () => undefined,
      }),
    );
    expect(calls[0].timeoutSec).toBeUndefined();
    expect(resolveActionTimeout(shell('a', 'x'), undefined)).toBeUndefined();
    expect(resolveActionTimeout(shell('a', 'x', { timeoutSec: 0 }), 60)).toBe(60);
  });

  it('service 操作：登记后跳过，不计入 executed', async () => {
    const { runShell, readResult, calls } = makeRunner();
    const logs: string[] = [];
    const out = await runActionSequence(
      baseDeps({
        actions: [
          shell('a1', 'first'),
          { id: 'a2', type: 'service', name: '切指针', tool: 'switch-pointer' },
        ],
        runShell,
        readResult,
        onLog: (l) => logs.push(l),
      }),
    );
    expect(out.executed).toBe(1);
    expect(calls.length).toBe(1);
    expect(logs.some((l) => l.includes('switch-pointer'))).toBe(true);
  });

  it('每个操作执行前检查取消（取消后不再起新进程）', async () => {
    const { runShell, readResult, calls } = makeRunner();
    let n = 0;
    await expect(
      runActionSequence(
        baseDeps({
          actions: [shell('a1', 'first'), shell('a2', 'second')],
          runShell,
          readResult,
          onLog: () => undefined,
          assertNotCancelled: () => {
            n += 1;
            if (n === 2) throw new Error('流水线已被取消');
          },
        }),
      ),
    ).rejects.toThrow('流水线已被取消');
    expect(calls.length).toBe(1);
  });
});
