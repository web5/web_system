import { Injectable } from '@nestjs/common';
import {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolSchema,
} from '@kedou-ai/agent-core';
import { findBenchmarkByType, getMarketBenchmarks } from '@web-system/shared';

/**
 * 合同市场基准工具：查询同类贷款的真实年化利率区间，用于"对比优劣势"。
 *
 * 设计原则：能用规则算的绝不用 AI 算。基准为确定性数据（内置市场基准库），
 * LLM 只负责引用与话术，不编造"同类贷款利率"。
 */
@Injectable()
export class ContractBenchmarkTool implements ToolDefinition {
  readonly name = 'contract-benchmark';
  readonly description =
    '查询同类贷款（消费贷/信用卡分期/购车贷/小贷等）的真实年化利率市场区间，用于对比本合同利率的优劣势。当需要"对比其他贷款、判断这份合同利率高不高"时使用。';
  readonly parameters = {
    type: {
      type: 'string' as const,
      description: '贷款类型关键词，如"消费贷"、"购车贷"、"信用卡分期"。留空返回全部基准供参考。',
      required: false,
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
            type: { type: 'string', description: '贷款类型关键词' },
          },
          required: [],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const type = String(args.type ?? '').trim();

    // 指定类型：返回最匹配的单条基准
    if (type) {
      const matched = findBenchmarkByType(type);
      if (matched) {
        return {
          success: true,
          content: JSON.stringify({
            type,
            benchmark: matched,
            isMarketReference: true,
          }),
        };
      }
      return {
        success: false,
        content: '',
        error: `未找到类型"${type}"对应的市场基准，请尝试：消费贷/购车贷/信用卡分期/消费金融/小贷`,
      };
    }

    // 未指定：返回全部基准供 AI 参考
    return {
      success: true,
      content: JSON.stringify({
        benchmarks: getMarketBenchmarks(),
        isMarketReference: true,
      }),
    };
  }
}
