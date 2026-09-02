import type { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '../interfaces/tool.interface';
import { withLongRunning, isTerminalJobStatus } from './long-running';

/** 测试用工具：按预设队列依次返回结果（模拟返回 jobId 的长任务工具） */
class FakeTool implements ToolDefinition {
  name = 'fake_publish';
  description = 'fake';
  parameters = {};
  constructor(private readonly results: ToolResult[]) {}
  async execute(): Promise<ToolResult> {
    return this.results.shift() ?? { success: true, content: '{"done":true}' };
  }
  toSchema(): ToolSchema {
    return { type: 'function', function: { name: 'fake_publish', description: 'fake', parameters: { type: 'object', properties: {}, required: [] } } };
  }
}

const ctx: ToolContext = { userId: 'u1', runId: 'r1', deps: {} };

describe('withLongRunning', () => {
  it('未识别到 jobId 时原样透传（等价于未启用插件）', async () => {
    const tool = new FakeTool([{ success: true, content: 'plain result' }]);
    const wrapped = withLongRunning(tool, { fetchStatus: async () => ({ status: 'succeeded' }) });
    const r = await wrapped.execute({}, ctx);
    expect(r.content).toBe('plain result');
  });

  it('轮询到成功终态后返回 result', async () => {
    const tool = new FakeTool([{ success: true, content: JSON.stringify({ jobId: 'j1', status: 'pending' }) }]);
    const states = [
      { status: 'running', progress: { current: 30, total: 100 } },
      { status: 'succeeded', result: { version: 'abc123' } },
    ];
    const wrapped = withLongRunning(tool, {
      fetchStatus: async () => states.shift() ?? { status: 'succeeded' },
      intervalMs: 1,
      maxWaitMs: 1000,
    });
    const r = await wrapped.execute({}, ctx);
    expect(r.success).toBe(true);
    expect(JSON.parse(r.content)).toEqual({ version: 'abc123' });
  });

  it('失败终态返回 success=false 且带上错误', async () => {
    const tool = new FakeTool([{ success: true, content: '{"jobId":"j2"}' }]);
    const wrapped = withLongRunning(tool, {
      fetchStatus: async () => ({ status: 'failed', error: '构建失败: exit 1' }),
      intervalMs: 1,
      maxWaitMs: 1000,
    });
    const r = await wrapped.execute({}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('构建失败');
  });

  it('取消终态返回 success=false', async () => {
    const tool = new FakeTool([{ success: true, content: '{"jobId":"j3"}' }]);
    const wrapped = withLongRunning(tool, {
      fetchStatus: async () => ({ status: 'cancelled' }),
      intervalMs: 1,
      maxWaitMs: 1000,
    });
    const r = await wrapped.execute({}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('已取消');
  });

  it('等待超时返回失败但保留 jobId 与最后状态', async () => {
    const tool = new FakeTool([{ success: true, content: '{"jobId":"j4"}' }]);
    const wrapped = withLongRunning(tool, {
      fetchStatus: async () => ({ status: 'running' }),
      intervalMs: 20,
      maxWaitMs: 60,
    });
    const r = await wrapped.execute({}, ctx);
    expect(r.success).toBe(false);
    const parsed = JSON.parse(r.content);
    expect(parsed.jobId).toBe('j4');
    expect(parsed.status).toBe('running');
  });

  it('查询状态抛异常时返回失败而非崩溃', async () => {
    const tool = new FakeTool([{ success: true, content: '{"jobId":"j5"}' }]);
    const wrapped = withLongRunning(tool, {
      fetchStatus: async () => {
        throw new Error('network down');
      },
      intervalMs: 1,
      maxWaitMs: 1000,
    });
    const r = await wrapped.execute({}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('network down');
  });
});

describe('isTerminalJobStatus', () => {
  it('识别各类终态（兼容 succeeded/success 两套命名）', () => {
    for (const s of ['succeeded', 'success', 'failed', 'cancelled', 'canceled', 'error']) {
      expect(isTerminalJobStatus(s)).toBe(true);
    }
  });
  it('非终态返回 false', () => {
    for (const s of ['pending', 'running', undefined, 123, '']) {
      expect(isTerminalJobStatus(s)).toBe(false);
    }
  });
});
