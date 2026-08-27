import { Injectable, Logger } from '@nestjs/common';
import {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolSchema,
  ClientRegistry,
} from '@kedou-ai/agent-core';

/**
 * 合同文本清洗工具（方案 B：AI 清洗）。
 *
 * OCR 识别出的原始文本常混入页眉页脚（时间/状态栏）、表格行、模板固定声明等
 * "毛刺"。此工具用 LLM 把原始 OCR 文本清洗成"纯净的合同条款"，供规则判定更准确。
 *
 * 清洗规则由 systemPrompt 约束：删页眉页脚/状态栏噪声、删重复表格行、
 * 删与合同条款无关的导航/按钮文字，保留合同正文条款，输出纯净文本。
 */
@Injectable()
export class ContractCleanerTool implements ToolDefinition {
  readonly name = 'contract-cleaner';
  readonly description =
    '清洗 OCR 识别出的合同原始文本：删除页眉页脚、时间/状态栏、重复表格行、无关导航文字等"毛刺"，输出纯净的合同条款文本。当合同文本来自 OCR 识别、包含噪声时，先用本工具清洗再判定风险。';
  readonly parameters = {
    rawText: {
      type: 'string' as const,
      description: 'OCR 识别出的合同原始文本（可能含页眉页脚/表格/导航等噪声）',
      required: true,
    },
  };

  private readonly logger = new Logger(ContractCleanerTool.name);

  constructor(private readonly clientRegistry: ClientRegistry) {}

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            rawText: { type: 'string', description: 'OCR 识别的合同原始文本' },
          },
          required: ['rawText'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const rawText = String(args.rawText ?? '').trim();
    if (!rawText) {
      return { success: false, content: '', error: '原始文本不能为空' };
    }

    // 取一个可用模型（优先 deepseek-chat，稳定 tool-calling；回退 hy3）
    const model = this.clientRegistry.getOrFallback('deepseek-chat');

    const systemPrompt =
      '你是一个专业的合同文本清洗助手。给定一份 OCR 识别出的合同原始文本，请清洗后输出"纯净的合同条款"。\n' +
      '清洗规则：\n' +
      '1. 删除页眉/页脚噪声：手机时间、状态栏（如"13:30"、"5G @24"）、页脚、页码、导航文字。\n' +
      '2. 删除与合同条款无关的内容：表格行（重复的套餐/权益记录）、按钮文字、"合同列表"等界面元素。\n' +
      '3. 保留合同正文条款，按逻辑顺序重排；若条款有编号，保留编号。\n' +
      '4. 输出纯文本，不要添加任何解释、前言、markdown 标题或代码块。\n' +
      '5. 若某段文字既有噪声又有合同内容，保留合同内容部分。\n' +
      '只输出清洗后的合同文本，不要输出任何其他内容。';

    try {
      const cleaned = await model.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请清洗以下合同 OCR 文本：\n\n${rawText}` },
        ],
        { temperature: 0.2, maxTokens: 3000 },
      );

      const result = cleaned.trim();
      if (!result) {
        return { success: true, content: rawText }; // 清洗失败回退原始文本
      }
      return { success: true, content: result };
    } catch (error) {
      this.logger.error(`合同清洗失败: ${(error as Error).message}`);
      // 清洗失败时回退原始文本，保证下游流程可用
      return { success: true, content: rawText, error: `清洗失败回退原文: ${(error as Error).message}` };
    }
  }
}
