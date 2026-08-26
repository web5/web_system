import { Injectable } from '@nestjs/common';
import {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolSchema,
} from '@kedou-ai/agent-core';
import { analyzeLoan } from '@web-system/shared';

/**
 * 合同 IRR / 贷款分析工具：精确计算真实年化利率、总利息等。
 *
 * 设计原则：能用规则算的绝不用 AI 算。成本测算必须 100% 准确，此工具是纯函数封装。
 */
@Injectable()
export class ContractIrrTool implements ToolDefinition {
  readonly name = 'contract-irr';
  readonly description =
    '精确测算贷款的真实年化利率（IRR/APR）、总利息与总还款。当合同涉及借款分期、需要算真实利率或多付金额时使用。';
  readonly parameters = {
    principal: {
      type: 'number' as const,
      description: '名义借款本金（元）',
      required: true,
    },
    upfrontFee: {
      type: 'number' as const,
      description: '前置费用（元），如砍头息/服务费，0 表示无',
      required: false,
    },
    periods: {
      type: 'number' as const,
      description: '期数（月）',
      required: true,
    },
    monthlyPayment: {
      type: 'number' as const,
      description: '每期还款额（元）',
      required: true,
    },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            principal: { type: 'number', description: '名义借款本金（元）' },
            upfrontFee: { type: 'number', description: '前置费用（元）' },
            periods: { type: 'number', description: '期数（月）' },
            monthlyPayment: { type: 'number', description: '每期还款额（元）' },
          },
          required: ['principal', 'periods', 'monthlyPayment'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const principal = Number(args.principal);
    const upfrontFee = Number(args.upfrontFee ?? 0);
    const periods = Number(args.periods);
    const monthlyPayment = Number(args.monthlyPayment);

    if (![principal, upfrontFee, periods, monthlyPayment].every((n) => isFinite(n))) {
      return { success: false, content: '', error: '贷款参数必须为数字' };
    }

    try {
      const result = analyzeLoan({ principal, upfrontFee, periods, monthlyPayment });
      const content = JSON.stringify({
        monthlyRatePercent: +(result.monthlyRate * 100).toFixed(4),
        aprPercent: +result.apr.toFixed(2),
        totalPayment: +result.totalPayment.toFixed(2),
        totalInterest: +result.totalInterest.toFixed(2),
        effectivePrincipal: +result.effectivePrincipal.toFixed(2),
      });
      return { success: true, content };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
