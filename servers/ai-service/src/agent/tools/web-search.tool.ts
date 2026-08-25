import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '../interfaces/tool.interface';

/**
 * 联网搜索工具（占位）。
 * 后续接 search 服务实现，v1 不强制。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class WebSearchTool implements ToolDefinition {
  readonly name = 'web-search';
  readonly description = '联网搜索实时信息';
  readonly parameters = {
    query: { type: 'string', description: '搜索关键词', required: true },
  };

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

  async execute(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    return { success: false, content: '', error: 'WebSearchTool 未实现（占位）' };
  }
}
