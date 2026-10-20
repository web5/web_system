import { Repository } from 'typeorm';
import { AgentLogService, RecordRunInput } from './agent-log.service';
import { AgentRun } from './entities/agent-run.entity';
import { RunMetrics } from './entities/run-metrics.entity';
import { DictPricingProvider } from './dict-pricing.provider';

/**
 * B0 结果归因单测（2026-10-20）
 *
 * 锁住三件事：
 *  1. 错误码 → fail_stage 的映射（决定「改 prompt / 改工具 / 改基础设施」的判断依据）
 *  2. outcome 与 status 的分工（status 是链路成败，outcome 是任务成败）
 *  3. **不伪造**：拿不到依据时落 `other`，绝不靠猜补一个看似合理的归因
 */

function makeService() {
  const saved: Array<Partial<AgentRun>> = [];
  const repo = {
    create: (row: Partial<AgentRun>) => row,
    save: async (row: Partial<AgentRun>) => {
      saved.push(row);
      return { id: 'run-1', ...row } as AgentRun;
    },
  } as unknown as Repository<AgentRun>;
  const metricsRepo = {
    findOne: async () => null,
    create: (row: Partial<RunMetrics>) => row,
    save: async (row: Partial<RunMetrics>) => row as RunMetrics,
    update: async () => undefined,
  } as unknown as Repository<RunMetrics>;
  const pricing = { getPrice: () => null } as unknown as DictPricingProvider;
  return { service: new AgentLogService(repo, metricsRepo, pricing), saved };
}

function baseInput(over: Partial<RecordRunInput> = {}): RecordRunInput {
  return {
    agentId: 'study-assistant',
    userId: 'u-1',
    userInput: '问题',
    systemPrompt: '你是助手',
    steps: [],
    status: 'ok',
    ...over,
  };
}

describe('AgentLogService.deriveAttribution', () => {
  const { service } = makeService();

  it('正常完成 → success，无失败阶段', () => {
    const r = service.deriveAttribution(baseInput({ status: 'ok' }));
    expect(r.outcome).toBe('success');
    expect(r.failStage).toBeNull();
    expect(r.gradedBy).toBe('rule');
    expect(r.gradedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['[MODEL_ERROR] 模型调用失败: upstream timeout', 'model'],
    ['[MODEL_EMPTY] 模型未返回结果', 'model'],
    ['[AGENT_ERROR] 工具执行失败', 'tool'],
    ['[NETWORK_TIMEOUT] 请求超时', 'network'],
    ['[AUTH_EXPIRED] 登录态失效', 'auth'],
    ['[RATE_LIMITED] 429', 'upstream'],
    ['[SERVER_ERROR] 502', 'upstream'],
  ])('错误码 %s → fail_stage=%s', (content, stage) => {
    const r = service.deriveAttribution(
      baseInput({
        status: 'error',
        steps: [{ type: 'error', content, ts: Date.now() }],
      }),
    );
    expect(r.outcome).toBe('fail');
    expect(r.failStage).toBe(stage);
  });

  it('超步数 → partial / max_steps（已产出部分内容，不是彻底失败）', () => {
    const r = service.deriveAttribution(
      baseInput({
        status: 'error',
        steps: [{ type: 'error', content: '达到最大步数限制', ts: Date.now() }],
      }),
    );
    expect(r.outcome).toBe('partial');
    expect(r.failStage).toBe('max_steps');
  });

  it('无错误码且无法归类 → other，不猜', () => {
    const r = service.deriveAttribution(
      baseInput({ status: 'error', steps: [{ type: 'error', content: 'boom', ts: Date.now() }] }),
    );
    expect(r.outcome).toBe('fail');
    expect(r.failStage).toBe('other');
  });

  it('⚠️ 不伪造：status=error 但拿不到任何错误信息，仍然判 fail/other 而不是 unknown', () => {
    // 「历史未知结果不伪造」的另一面：新 run 链路确实报错了就如实记 fail，
    // unknown 只留给调用方显式声明（人工无法判定的场景），推导逻辑不主动产出。
    const r = service.deriveAttribution(baseInput({ status: 'error' }));
    expect(r.outcome).toBe('fail');
    expect(r.failStage).toBe('other');
  });

  it('多条 error 事件取最后一条（最后一次失败才是终止原因）', () => {
    const r = service.deriveAttribution(
      baseInput({
        status: 'error',
        steps: [
          { type: 'error', content: '[AGENT_ERROR] 工具失败', ts: 1 },
          { type: 'error', content: '[MODEL_ERROR] 模型超时', ts: 2 },
        ],
      }),
    );
    expect(r.failStage).toBe('model');
  });

  it('steps 无 error 事件时退回 input.error', () => {
    const r = service.deriveAttribution(
      baseInput({
        status: 'error',
        steps: [{ type: 'tool_call', name: 'x', ts: 1 }],
        error: '[NETWORK_TIMEOUT] 断连',
      }),
    );
    expect(r.failStage).toBe('network');
  });

  it('调用方显式判定 → 直接采信，不再推导（人工标注 / 离线评测入口）', () => {
    const r = service.deriveAttribution(
      baseInput({
        status: 'error',
        steps: [{ type: 'error', content: '[MODEL_ERROR] x', ts: 1 }],
        outcome: 'unknown',
        gradedBy: 'human',
      }),
    );
    expect(r.outcome).toBe('unknown');
    expect(r.gradedBy).toBe('human');
    expect(r.failStage).toBeNull();
  });

  it('权限确认类失败 → permission', () => {
    const r = service.deriveAttribution(
      baseInput({ status: 'error', steps: [{ type: 'error', content: '权限确认超时', ts: 1 }] }),
    );
    expect(r.failStage).toBe('permission');
  });
});

describe('AgentLogService.recordRun 落库携带归因', () => {
  it('error run 落库时写入推导出的 outcome / fail_stage / graded_at', async () => {
    const { service, saved } = makeService();
    await service.recordRun(
      baseInput({
        status: 'error',
        steps: [{ type: 'error', content: '[MODEL_ERROR] upstream timeout', ts: 1 }],
      }),
    );

    expect(saved).toHaveLength(1);
    expect(saved[0].outcome).toBe('fail');
    expect(saved[0].failStage).toBe('model');
    expect(saved[0].gradedBy).toBe('rule');
    expect(saved[0].gradedAt).toBeInstanceOf(Date);
  });

  it('ok run 落库时 outcome=success 且不带 fail_stage', async () => {
    const { service, saved } = makeService();
    await service.recordRun(baseInput({ status: 'ok' }));

    expect(saved[0].outcome).toBe('success');
    expect(saved[0].failStage).toBeNull();
  });

  it('推导异常不影响落库（归因是辅助能力，不能拖垮主链路）', async () => {
    const { service, saved } = makeService();
    // steps 传成非数组，模拟脏输入：lastErrorMessage 有防御，落库仍应成功
    await service.recordRun({
      ...baseInput({ status: 'error' }),
      steps: undefined as unknown as RecordRunInput['steps'],
    });

    expect(saved).toHaveLength(1);
    expect(saved[0].outcome).toBe('fail');
    expect(saved[0].failStage).toBe('other');
  });
});
