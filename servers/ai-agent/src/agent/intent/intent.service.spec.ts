import { IntentService } from './intent.service';

/**
 * 编排层：兜底的「可度量」口径（降级原因落库、比例统计、告警）。
 * 分类器本身的降级原因见 packages/agent-core/src/core/intent-classifier.spec.ts。
 */
function make(opts: {
  env?: Record<string, string>;
  candidates: string[];
  reply?: () => Promise<string>;
  keywords?: Record<string, string[]>;
}) {
  const convRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
  };
  const registry = {
    list: () =>
      opts.candidates.map((id) => ({
        id,
        name: id,
        description: '',
        keywords: opts.keywords?.[id] ?? [],
      })),
  };
  const clientRegistry = {
    getOrFallback: () => ({ modelId: 'fake', chat: opts.reply ?? (async () => '') }),
  };
  const env = { INTENT_ROUTING_ENABLED: 'true', ...opts.env };
  const config = { get: (k: string, d?: string) => env[k] ?? d };
  const svc = new IntentService(convRepo as any, registry as any, clientRegistry as any, config as any);
  return { svc, convRepo, stats: () => (svc as any).stats.snapshot() };
}

const call = (svc: IntentService, userInput = '随便聊聊') =>
  svc.resolve({ userInput, conversationId: 'c1', userId: 'u1' });

describe('IntentService · 兜底可度量', () => {
  it('开关关闭：带 disabled 原因，不写流水，不计入兜底比例（全兜底是设计如此，不是故障）', async () => {
    const { svc, convRepo, stats } = make({ env: { INTENT_ROUTING_ENABLED: 'false' }, candidates: ['general', 'baike'] });
    const r = await call(svc);
    expect(r.via).toBe('fallback');
    expect(r.degradeReason).toBe('disabled');
    expect(convRepo.query).not.toHaveBeenCalled();
    expect(stats().total).toBe(0);
  });

  it('分类失败兜底（兜底 agent 在候选内）：流水带 reason，且会话锁定行为不变', async () => {
    const { svc, convRepo, stats } = make({ candidates: ['general', 'baike'], reply: async () => '' });
    const r = await call(svc);
    expect(r.via).toBe('fallback');
    expect(r.degradeReason).toBe('llm_empty');
    expect(convRepo.update).toHaveBeenCalledWith('c1', { agentId: 'general' });
    const [sql, params] = convRepo.query.mock.calls[0];
    expect(sql).toContain("'reason'");
    expect(params).toEqual(['general', 'fallback', 'llm_empty', 'c1']);
    expect(stats().byVia).toEqual({ fallback: 1 });
    expect(stats().byReason).toEqual({ llm_empty: 1 });
  });

  it('兜底 agent 不在候选集：过去不留任何痕迹，现在写流水 —— 但绝不能改写会话的 agentId', async () => {
    // 注册表里没有 general（2026-09-28 事故的隐含依赖）
    const { svc, convRepo, stats } = make({ candidates: ['bianbian', 'baike'], reply: async () => '' });
    const r = await call(svc);
    expect(r.via).toBe('fallback');
    expect(r.degradeReason).toBe('not_candidate');
    expect(convRepo.update).not.toHaveBeenCalled(); // 不走 lock：不改写会话 agentId
    const [sql, params] = convRepo.query.mock.calls[0];
    expect(sql).toContain("'reason'");
    expect(params).toEqual(['bianbian', 'fallback', 'not_candidate', 'c1']);
    expect(stats().byReason).toEqual({ not_candidate: 1 });
  });

  it('正常命中：流水 JSON 形状与改动前一致（不带 reason），无降级原因', async () => {
    const { svc, convRepo, stats } = make({
      candidates: ['general', 'translate'],
      keywords: { translate: ['翻成英文'] },
    });
    const r = await call(svc, '帮我把这段翻成英文');
    expect(r.via).toBe('rule');
    expect(r).not.toHaveProperty('degradeReason');
    const [sql, params] = convRepo.query.mock.calls[0];
    expect(sql).not.toContain("'reason'");
    expect(params).toEqual(['translate', 'rule', 'c1']);
    expect(stats().byVia).toEqual({ rule: 1 });
  });

  it('兜底比例达到告警线：只告警一次（防刷屏），且告警里带降级原因', async () => {
    const { svc } = make({ candidates: ['general', 'baike'], reply: async () => '' });
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 40; i++) await call(svc);
    const alarms = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('兜底比例偏高'));
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toContain('llm_empty');
  });

  it('告警线可配（INTENT_FALLBACK_WARN_RATIO）；非法值回落默认 0.5', async () => {
    const bad = make({ env: { INTENT_FALLBACK_WARN_RATIO: 'abc' }, candidates: ['general'] });
    expect((bad.svc as any).stats.warnRatio).toBe(0.5);
    const ok = make({ env: { INTENT_FALLBACK_WARN_RATIO: '0.2' }, candidates: ['general'] });
    expect((ok.svc as any).stats.warnRatio).toBe(0.2);
  });
});
