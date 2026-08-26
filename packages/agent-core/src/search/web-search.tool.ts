/**
 * 联网搜索工具（通用互联网搜索，插件式 Provider）。
 * 默认依赖 SearchProviderRegistry 中已注册且已配 key 的 provider（默认 Bing）。
 */
import { ToolDefinition, ToolContext, ToolResult, ToolSchema, ToolParameter } from '../interfaces/tool.interface';
import { SearchProviderRegistry } from './registry';

export class WebSearchTool implements ToolDefinition {
  readonly name = 'web-search';
  readonly description =
    '联网搜索实时互联网信息，返回标题/链接/摘要列表。适合查询最新资讯、技术资料、事实性信息。';
  readonly parameters: Record<string, ToolParameter> = {
    query: { type: 'string', description: '搜索关键词', required: true },
  };

  constructor(private readonly registry: SearchProviderRegistry) {}

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '搜索关键词' } },
          required: ['query'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) {
      return { success: false, content: '', error: 'query 不能为空' };
    }

    const provider = this.registry.selectAvailable();
    if (!provider) {
      return {
        success: false,
        content: '',
        error: '未配置任何可用的搜索服务。请在 config 中设置 BING_SEARCH_API_KEY，或注册其他搜索 Provider。',
      };
    }

    try {
      const results = await provider.search(query);
      if (results.length === 0) {
        return { success: true, content: `未找到与 "${query}" 相关的结果。` };
      }
      const text = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet ?? ''}`)
        .join('\n');
      return { success: true, content: `搜索 "${query}" 的结果：\n${text}` };
    } catch (error) {
      const msg = (error as Error).message;
      return { success: false, content: `搜索失败: ${msg}`, error: msg };
    }
  }
}
