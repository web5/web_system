import { IntentClassifier } from './intent-classifier';
import type { BaseAiClient } from '../clients/base-ai.client';

/**
 * 回归：withTimeout 的 setTimeout 必须被清除。
 *
 * 此前 Promise.race 里的超时 timer 从不清除：分类成功后，每次调用仍会留下一个
 * 存活 `timeoutMs`（默认 3s）的悬空定时器。单次影响很小，但高并发下是持续的定时器堆积，
 * 且会让测试进程无法优雅退出（"worker failed to exit gracefully"）。
 */
const CANDIDATES = ['baike', 'general'];
const fake = (chat: () => Promise<string>) => ({ chat } as unknown as BaseAiClient);

describe('IntentClassifier · 超时定时器清理', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('LLM 正常返回 → 不遗留超时定时器', async () => {
    const c = new IntentClassifier(fake(async () => '{"agentId":"baike","confidence":0.9}'), 3000, 'general');
    const r = await c.classify('什么是量子纠缠', { candidates: CANDIDATES });
    expect(r.via).toBe('llm');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('LLM 抛错 → 不遗留超时定时器', async () => {
    const c = new IntentClassifier(fake(() => Promise.reject(new Error('down'))), 3000, 'general');
    const r = await c.classify('在吗', { candidates: CANDIDATES });
    expect(r.via).toBe('fallback');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('真正超时 → 仍然兜底（清理逻辑不能破坏超时语义），且无遗留定时器', async () => {
    const never = new Promise<string>(() => undefined);
    const c = new IntentClassifier(fake(() => never), 1200, 'general');
    const pending = c.classify('什么是量子纠缠', { candidates: CANDIDATES });
    await jest.advanceTimersByTimeAsync(1200);
    const r = await pending;
    expect(r.via).toBe('fallback');
    expect(jest.getTimerCount()).toBe(0);
  });
});
