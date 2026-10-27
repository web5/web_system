/**
 * TokenHubClient 密钥兜底回归测试（P0 REQ-2 密钥兜底断裂修复）。
 *
 * 根因：TokenHubClient.getApiKey() 只读 TOKENHUB_API_KEY → HY3_API_KEY，
 * 漏了 LLM_API_KEY 兜底——content-hub 的 resolveApiKey() 三级兜底链会选出
 * LLM_API_KEY，但传给 client 后 client 自己又从 env 读，读不到就报「不可用」。
 *
 * 修复：① getApiKey() 补 LLM_API_KEY 兜底；② 构造参数 apiKey 显式优先。
 */
import { TokenHubClient } from './tokenhub.client';

describe('TokenHubClient.getApiKey() 密钥兜底链', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // 清空所有相关 key，隔离测试
    delete process.env.TOKENHUB_API_KEY;
    delete process.env.HY3_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('仅设 LLM_API_KEY 时 getApiKey() 返回该值（P0 回归）', () => {
    process.env.LLM_API_KEY = 'test-llm-key';
    const client = new TokenHubClient('test-model');
    // getApiKey 是 private，用类型断言访问
    expect((client as any).getApiKey()).toBe('test-llm-key');
  });

  it('TOKENHUB_API_KEY 优先级最高', () => {
    process.env.TOKENHUB_API_KEY = 'tok-key';
    process.env.HY3_API_KEY = 'hy3-key';
    process.env.LLM_API_KEY = 'llm-key';
    const client = new TokenHubClient('test-model');
    expect((client as any).getApiKey()).toBe('tok-key');
  });

  it('HY3_API_KEY 回落（无 TOKENHUB_API_KEY 时）', () => {
    process.env.HY3_API_KEY = 'hy3-key';
    process.env.LLM_API_KEY = 'llm-key';
    const client = new TokenHubClient('test-model');
    expect((client as any).getApiKey()).toBe('hy3-key');
  });

  it('无任何 env key 时返回空串', () => {
    const client = new TokenHubClient('test-model');
    expect((client as any).getApiKey()).toBe('');
  });

  it('构造参数 apiKey 优先于环境变量', () => {
    process.env.TOKENHUB_API_KEY = 'env-key';
    const client = new TokenHubClient('test-model', undefined, 'explicit-key');
    expect((client as any).getApiKey()).toBe('explicit-key');
  });

  it('仅设 LLM_API_KEY 时 isAvailable() 返回 true', () => {
    process.env.LLM_API_KEY = 'test-llm-key';
    const client = new TokenHubClient('test-model');
    expect(client.isAvailable()).toBe(true);
  });

  it('无任何 key 时 isAvailable() 返回 false', () => {
    const client = new TokenHubClient('test-model');
    expect(client.isAvailable()).toBe(false);
  });
});
