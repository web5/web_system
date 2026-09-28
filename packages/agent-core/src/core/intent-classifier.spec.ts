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

  it('L1-b 会话锁定：规则未命中的追问不重分类（核心用例）', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('那用日语呢', { candidates: CANDIDATES, lockedAgentId: 'translate' });
    expect(r.agentId).toBe('translate');
    expect(r.via).toBe('locked');
  });

  it('会话锁定时高置信规则命中其他 agent → 允许切走（locked 不短路）', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('英语怎么说', { candidates: CANDIDATES, lockedAgentId: 'emotion' });
    expect(r.agentId).toBe('translate');
    expect(r.via).toBe('rule');
    expect(r.confidence).toBeGreaterThanOrEqual(0.88);
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

/**
 * 注册表驱动路由（2026-09-28 正式化）：规则与 LLM 候选由 `routingHints` 实时提供。
 * 硬编码 taxonomy 的历史版本曾导致「规则永不命中 + LLM 结果被白名单丢弃」⇒ 100% 兜底。
 */
describe('IntentClassifier · routingHints 驱动', () => {
  const HINTS = [
    {
      id: 'bianbian',
      name: '变变创作助手',
      description: '把脑海里的角色、场景画成图片（AI 绘画 / 生图）',
      keywords: ['画画', '画一张', '画个', '生图', '生成图片', '变变'],
    },
    {
      id: 'translate',
      name: '翻译官',
      description: '多语种互译与润色',
      keywords: ['翻译', '译成', '英文怎么说'],
    },
    {
      id: 'general',
      name: '通用助手',
      description: '日常提问与闲聊的兜底助手',
      keywords: [],
    },
  ];
  const CANDS = ['bianbian', 'translate', 'general'];

  it('关键词命中 → 规则路由到对应 agent（登记表就是线上那套）', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('帮我画个宇航员', { candidates: CANDS, routingHints: HINTS });
    expect(r.agentId).toBe('bianbian');
    expect(r.via).toBe('rule');
    expect(r.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it('翻译类输入 → 路由到 translate', async () => {
    const c = new IntentClassifier(fakeClient('{"agentId":"translate","confidence":0.9}'), 500, 'general');
    const r = await c.classify('帮我把这段译成英文', { candidates: CANDS, routingHints: HINTS });
    expect(r.agentId).toBe('translate');
  });

  it('关键词未命中 → 走 LLM，提示词里带上用途说明（候选描述由 hints 拼出）', async () => {
    let seenPrompt = '';
    const client = {
      chat: async (msgs: Array<{ role: string; content: string }>) => {
        seenPrompt = msgs.find((m) => m.role === 'system')?.content ?? '';
        return '{"agentId":"general","confidence":0.4}';
      },
    } as unknown as BaseAiClient;
    const c = new IntentClassifier(client, 500, 'general');
    const r = await c.classify('今天心情一般', { candidates: CANDS, routingHints: HINTS });
    expect(r.via).toBe('llm');
    expect(seenPrompt).toContain('bianbian');
    expect(seenPrompt).toContain('AI 绘画');
    // 旧 taxonomy 的残留 id 不该出现在候选清单里
    expect(seenPrompt).not.toContain('horoscope');
  });

  it('LLM 吐出候选外的 id（幻觉）→ 仍然丢弃落到兜底', async () => {
    const c = new IntentClassifier(fakeClient('{"agentId":"ghost","confidence":0.9}'), 500, 'general');
    const r = await c.classify('随便聊聊', { candidates: CANDS, routingHints: HINTS });
    expect(r.via).toBe('fallback');
    expect(r.agentId).toBe('general');
  });

  it('会话锁定 + hints 规则命中别的 agent → 允许切走', async () => {
    const c = new IntentClassifier(fakeClient(''), 500, 'general');
    const r = await c.classify('帮我画个猫', {
      candidates: CANDS,
      routingHints: HINTS,
      lockedAgentId: 'translate',
    });
    expect(r.agentId).toBe('bianbian');
    expect(r.via).toBe('rule');
  });
});
