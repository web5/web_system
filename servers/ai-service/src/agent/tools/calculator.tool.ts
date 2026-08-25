import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '../interfaces/tool.interface';

/**
 * 计算器工具：安全表达式求值（少儿学习场景示例）。
 * 仅允许数字与 + - * / ( ) . 及空白，禁止使用 eval / Function 外的任何调用。
 */
@Injectable()
export class CalculatorTool implements ToolDefinition {
  readonly name = 'calculator';
  readonly description = '安全地计算数学算术表达式，如 "12 * (3 + 4)"。仅支持四则运算。';
  readonly parameters = {
    expression: { type: 'string' as const, description: '算术表达式，例如 "12 * (3 + 4)"', required: true },
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
    const raw = String(args.expression ?? '').trim();
    if (!raw) {
      return { success: false, content: '', error: 'expression 不能为空' };
    }

    // 白名单校验：仅允许数字、运算符、括号、小数点与空白
    if (!/^[\d+\-*/().\s]+$/.test(raw)) {
      return {
        success: false,
        content: '',
        error: '表达式包含不支持的字符，仅支持数字与 + - * / ( )',
      };
    }

    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${raw});`)() as number;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { success: false, content: '', error: '计算结果无效（非有限数值）' };
      }
      return { success: true, content: String(value) };
    } catch (error) {
      return { success: false, content: '', error: `计算失败: ${(error as Error).message}` };
    }
  }
}
