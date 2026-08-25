import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '../interfaces/tool.interface';

/**
 * 计算器工具：安全表达式求值（少儿学习场景示例）。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class CalculatorTool implements ToolDefinition {
  readonly name = 'calculator';
  readonly description = '安全地计算数学算术表达式，如 "12 * (3 + 4)"';
  readonly parameters = {
    expression: { type: 'string', description: '算术表达式', required: true },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: '算术表达式' } },
          required: ['expression'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    // TODO: 安全解析表达式（禁止 eval，用表达式解析库或白名单字符校验）
    void args;
    return { success: false, content: '', error: 'CalculatorTool 未实现' };
  }
}
