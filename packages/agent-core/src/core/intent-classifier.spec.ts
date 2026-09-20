import { IntentClassifier } from './intent-classifier';
import type { BaseAiClient } from '../clients/base-ai.client';

/** 假客户端：返回预设文本，或传入函数模拟超时 / 抛错 */
function fakeClient(reply: string | (() => Promise<string>)): BaseAiClient {
  return {
    chat: async () => (typeof reply === 'function' ? reply() : reply),
  } as unknown as BaseAiClient;
}

const CANDIDATES = ['emotion', 'baike', 'horoscope', 'translate', 'tool', 'general'];

describe('IntentClassifier', () => {
  it('L2 规则命中：翻译', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('帮我把这段翻成英文', { candidates: CANDIDATES });
    expect(r.agentId).toBe('translate');
    expect(r.via).toBe('rule');
  });

  it('L1-a 显式 @ 前缀优先于会话锁定', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('@horoscope 我明天运势如何', {
      candidates: CANDIDATES,
      lockedAgentId: 'translate',
    });
    expect(r.agentId).toBe('horoscope');
    expect(r.via).toBe('explicit');
  });

  it('L1-b 会话锁定：追问不重分类（核心用例）', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('那用日语呢', { candidates: CANDIDATES, lockedAgentId: 'translate' });
    expect(r.agentId).toBe('translate');
    expect(r.via).toBe('locked');
  });

  it('L3 LLM 返回带 ```json 围栏也能解析', async () => {
    const c = new IntentClassifier(
      fakeClient('```json\n{"agentId":"baike","confidence":0.9,"reason":"原理类"}\n```'),
      500,
      'general',
    );
    const r = await c.classify('什么是量子纠缠', { candidates: CANDIDATES });
    expect(r.agentId).toBe('baike');
    expect(r.via).toBe('llm');
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it('幻觉 agentId（不在候选内）必须丢弃 → 兜底', async () => {
    const c = new IntentClassifier(
      fakeClient('{"agentId":"not-exist","confidence":0.99}'),
      500,
      'general',
    );
    const r = await c.classify('随便说点什么', { candidates: CANDIDATES });
    expect(r.agentId).toBe('general');
    expect(r.via).toBe('fallback');
  });

  it('L3 超时 → L4 兜底，绝不阻塞主对话', async () => {
    const c = new IntentClassifier(
      fakeClient(() => new Promise((res) => setTimeout(() => res('{"agentId":"baike"}'), 300))),
      50,
      'general',
    );
    const r = await c.classify('什么是量子纠缠', { candidates: CANDIDATES });
    expect(r.agentId).toBe('general');
    expect(r.via).toBe('fallback');
  });

  it('模型抛错 → 兜底（不向上抛）', async () => {
    const c = new IntentClassifier(
      fakeClient(() => Promise.reject(new Error('model down'))),
      500,
      'general',
    );
    const r = await c.classify('在吗', { candidates: CANDIDATES });
    expect(r.via).toBe('fallback');
  });

  it('规则命中但 agent 不在候选集 → 不命中该 agent', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('帮我把这段翻成英文', { candidates: ['general'] });
    expect(r.agentId).toBe('general');
  });

  it('情感优先级高于百科（"好累"不落入 baike）', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('今天好累，想聊聊', { candidates: CANDIDATES });
    expect(r.agentId).toBe('emotion');
  });
});
