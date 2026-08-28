import { Injectable } from '@nestjs/common';
import {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolSchema,
} from '@kedouai/agent-core';
import { matchByText, getByScene, getStandards, type LegalStandard } from '@web-system/shared';

/**
 * 合同规则判定工具：用法定标准库（尺子）扫描合同文本，识别风险信号。
 *
 * 设计原则：能用规则算的绝不用 AI 算。此工具是"确定性规则"，供 Agent 编排时第一道闸，
 * LLM 只负责后续的"话术生成"与"结论整合"。
 */
@Injectable()
export class ContractRuleTool implements ToolDefinition {
  readonly name = 'contract-rule';
  readonly description =
    '用法定标准库扫描合同文本，识别风险信号（利率超标、砍头息、提前还款违约金、强制搭售等）。返回命中的标准、严重度与法律依据。当用户上传合同或要求识别合同风险时使用。';
  readonly parameters = {
    text: {
      type: 'string' as const,
      description: '合同文本内容（OCR 识别后的纯文本）',
      required: true,
    },
    scene: {
      type: 'string' as const,
      description:
        '合同场景，可选值：consumer-loan / car-loan / medical-insurance / car-insurance / rental / other。留空则自动扫描全部标准。',
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
            text: { type: 'string', description: '合同文本内容' },
            scene: {
              type: 'string',
              description:
                '合同场景：consumer-loan/car-loan/medical-insurance/car-insurance/rental/other',
            },
          },
          required: ['text'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const text = String(args.text ?? '').trim();
    if (!text) {
      return { success: false, content: '', error: '合同文本不能为空' };
    }

    const scene = String(args.scene ?? '').trim() || undefined;
    // 校验 scene 合法性
    const validScenes = ['consumer-loan', 'car-loan', 'medical-insurance', 'car-insurance', 'rental', 'other'];
    if (scene && !validScenes.includes(scene)) {
      return { success: false, content: '', error: `无效场景: ${scene}` };
    }

    // 1. 规则初判命中（确定性）
    const matches = matchByText(text, scene as any);

    // 2. 组装可读结果（含标准详情，供 LLM 生成话术）
    const signals = matches.map((m) => {
      const s: LegalStandard = m.standard;
      return {
        id: s.id,
        name: s.name,
        level: s.level,
        scene: s.scene,
        matchedKeyword: m.matchedKeyword,
        legalBasis: s.legalBasis,
        signalTitle: s.signalTitle,
        plainText: s.plainText,
        actions: s.actions,
        termExplain: s.termExplain,
      };
    });

    // 3. 附上该场景可用的全部标准清单（供 LLM 参考未命中项）
    const availableScenes = scene ? [scene, 'other'] : ['consumer-loan', 'car-loan', 'medical-insurance', 'car-insurance', 'rental', 'other'];
    const available = getStandards().filter((s) => availableScenes.includes(s.scene)).map((s) => s.id);

    const content = JSON.stringify({
      scene: scene ?? 'auto',
      matchedCount: signals.length,
      signals,
      availableStandards: available,
    });

    return { success: true, content };
  }
}
