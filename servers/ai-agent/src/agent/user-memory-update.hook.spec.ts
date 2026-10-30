import { UserMemoryUpdateHook } from './user-memory-update.hook';
import { UserMemorySummaryClient } from './memory/user-memory-summary.client';
import { ClientRegistry } from '@kedouai/agent-core';
import type { PostRunContext } from './post-run-hook';

/**
 * UserMemoryUpdateHook 单测（#8229 批次1 卡1.7）：
 * - 明细写入成功后触发摘要 refresh（fire-and-forget）
 * - refresh 失败不影响对话：trigger 正常 resolve，不抛错
 * - 无可提炼记忆时不触发 refresh
 */
describe('UserMemoryUpdateHook', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  function makeCtx(overrides?: Partial<PostRunContext>): PostRunContext {
    return {
      userId: 'u1',
      conversationId: 'conv-1',
      userInput: '我叫橙子哥哥，偏好简洁的回答',
      finalAnswer: '好的，已记住。',
      steps: [],
      source: 'chat',
      ...overrides,
    };
  }

  function makeHook(options?: { refreshError?: Error }) {
    // hook.upsert 走真实 fetch：mock 掉，internal upsert 返回 200
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    const configService = {
      // 尊重 ConfigService.get(key, default) 的默认值语义（USER_SERVICE_URL 未配时回落默认地址）
      get: jest.fn((key: string, dflt?: string) => (key === 'USER_SERVICE_KEY' ? 'k' : dflt)),
    } as never;
    // extract 返回固定 1 条（chat 被直接 mock，不走真模型）
    const clientRegistry = {
      getOrFallback: jest.fn().mockReturnValue({
        chat: jest.fn().mockResolvedValue(
          '{"items":[{"category":"fact","content":"用户叫橙子哥哥","confidence":0.9,"action":"add"}]}',
        ),
      }),
    } as unknown as ClientRegistry;
    const summaryClient = {
      refreshSummary: options?.refreshError
        ? jest.fn().mockRejectedValue(options.refreshError)
        : jest.fn().mockResolvedValue(undefined),
    } as unknown as UserMemorySummaryClient;
    const hook = new UserMemoryUpdateHook(configService, clientRegistry, summaryClient);
    return { hook, summaryClient };
  }

  it('明细写入成功后触发摘要 refresh', async () => {
    const { hook, summaryClient } = makeHook();
    await hook.trigger(makeCtx());
    expect(summaryClient.refreshSummary).toHaveBeenCalledWith('u1');
  });

  it('refresh 失败不影响对话：trigger 正常 resolve（fire-and-forget + catch）', async () => {
    const { hook } = makeHook({ refreshError: new Error('connect ECONNREFUSED') });
    await expect(hook.trigger(makeCtx())).resolves.toBeUndefined();
  });

  it('无可提炼记忆（items 空）时不触发 refresh', async () => {
    const configService = {
      get: jest.fn((key: string, dflt?: string) => (key === 'USER_SERVICE_KEY' ? 'k' : dflt)),
    } as never;
    const clientRegistry = {
      getOrFallback: jest.fn().mockReturnValue({
        chat: jest.fn().mockResolvedValue('{"items":[]}'),
      }),
    } as unknown as ClientRegistry;
    const summaryClient = {
      refreshSummary: jest.fn(),
    } as unknown as UserMemorySummaryClient;
    const hook = new UserMemoryUpdateHook(configService, clientRegistry, summaryClient);
    await hook.trigger(makeCtx());
    expect(summaryClient.refreshSummary).not.toHaveBeenCalled();
  });
});
