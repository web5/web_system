import { DeepseekClient } from './deepseek.client';
import { ChatMessage, StreamChunk, ToolCallSchema } from './base-ai.client';

describe('DeepseekClient TokenHub 兼容入口', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of [
      'TOKENHUB_API_KEY',
      'TOKENHUB_BASE_URL',
      'HY3_API_KEY',
      'HY3_BASE_URL',
      'DEEPSEEK_API_KEY',
      'DEEPSEEK_BASE_URL',
      'TOKENHUB_THINKING',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('仅配置旧官方 key 不会将 TokenHub 客户端标为可用', () => {
    process.env.DEEPSEEK_API_KEY = 'unused-official-key';
    expect(new DeepseekClient().isAvailable()).toBe(false);
  });

  it.each(['TOKENHUB_API_KEY', 'HY3_API_KEY'])('%s 可用于旧接口的普通对话', async (key) => {
    process.env[key] = 'test-gateway-key';
    process.env.HY3_BASE_URL = 'https://gateway.test/v1/';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      ),
    );
    const client = new DeepseekClient();

    expect(client.isAvailable()).toBe(true);
    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toBe('OK');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://gateway.test/v1/chat/completions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-gateway-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 2000,
      stream: false,
    });
  });

  it('工具回放和 tool_calls 使用 TokenHub key / base，保留旧消息协议', async () => {
    process.env.TOKENHUB_API_KEY = 'preferred-key';
    process.env.TOKENHUB_BASE_URL = 'https://tokenhub.test/v1';
    process.env.HY3_API_KEY = 'fallback-key';
    process.env.HY3_BASE_URL = 'https://fallback.test/v1';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'next-call',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'previous-call', name: 'lookup', arguments: '{}' }],
      },
      { role: 'tool', content: 'result', toolCallId: 'previous-call' },
    ];
    const tools: ToolCallSchema[] = [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'lookup',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ];

    const result = await new DeepseekClient().chatWithTools(messages, tools, { maxTokens: 128 });

    expect(result.toolCalls).toEqual([{ id: 'next-call', name: 'lookup', arguments: '{}' }]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://tokenhub.test/v1/chat/completions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer preferred-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      tools,
      tool_choice: 'auto',
      max_tokens: 128,
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'previous-call', function: { name: 'lookup' } }] },
        { role: 'tool', tool_call_id: 'previous-call', content: 'result' },
      ],
    });
  });

  it('SSE 保持 content / done 流式协议', async () => {
    process.env.TOKENHUB_API_KEY = 'test-gateway-key';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const chunks: StreamChunk[] = [];

    for await (const chunk of new DeepseekClient().chatStream([
      { role: 'user', content: 'hello' },
    ])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: 'OK', done: false },
      { content: '', done: true },
    ]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://tokenhub.tencentmaas.com/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: true,
    });
  });
});
