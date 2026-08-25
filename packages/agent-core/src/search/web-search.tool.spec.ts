import { SearchProviderRegistry } from './registry';
import { SearchProvider } from './provider.interface';
import { WebSearchTool } from './web-search.tool';
import { ToolContext } from '../interfaces/tool.interface';

const ctx: ToolContext = { userId: 'u', runId: 'r', deps: {} };

function fakeProvider(id: string, available: boolean, results: any[] = []): SearchProvider {
  return {
    id,
    name: id,
    isAvailable: () => available,
    search: jest.fn().mockResolvedValue(results),
  } as any;
}

describe('WebSearchTool', () => {
  it('无可用 provider 时返回配置提示', async () => {
    const reg = new SearchProviderRegistry();
    const tool = new WebSearchTool(reg);
    const r = await tool.execute({ query: 'test' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('BING_SEARCH_API_KEY');
  });

  it('选中最先注册的可用 provider', async () => {
    const reg = new SearchProviderRegistry();
    reg.register(fakeProvider('bocha', false));
    reg.register(fakeProvider('bing', true, [{ title: 'R1', url: 'http://x', snippet: 's' }]));
    const tool = new WebSearchTool(reg);
    const r = await tool.execute({ query: 'hello' }, ctx);
    expect(r.success).toBe(true);
    expect(r.content).toContain('R1');
  });

  it('query 为空时报错', async () => {
    const reg = new SearchProviderRegistry();
    const tool = new WebSearchTool(reg);
    const r = await tool.execute({}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('query');
  });
});
