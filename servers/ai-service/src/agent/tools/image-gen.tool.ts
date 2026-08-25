import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '@kedou/agent-core';
import { ImageGenClient } from '../../common/http/image-gen.client';
import { API_TIMEOUT } from '@web-system/shared';

/**
 * 生图工具：包装现有 ImageGenClient，提交任务并轮询结果。
 */
@Injectable()
export class ImageGenTool implements ToolDefinition {
  readonly name = 'image-gen';
  readonly description = '根据文本提示词生成图片，返回生成结果的图片 URL。当用户需要画图、创作插画或视觉内容时使用。';
  readonly parameters = {
    prompt: { type: 'string' as const, description: '图片生成的文本描述（中文或英文）', required: true },
  };

  constructor(private readonly imageGenClient: ImageGenClient) {}

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { prompt: { type: 'string', description: '图片生成的文本描述' } },
          required: ['prompt'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) {
      return { success: false, content: '', error: 'prompt 不能为空' };
    }

    try {
      const submit = await this.imageGenClient.submit(prompt);
      if (!submit.id) {
        return { success: false, content: '', error: '生图任务提交失败：未返回任务 ID' };
      }

      // 轮询结果（最多约 AI_QUERY 超时 / 间隔）
      const maxAttempts = Math.floor(API_TIMEOUT.AI_QUERY / 2000);
      let lastStatus = '';
      for (let i = 0; i < maxAttempts; i++) {
        const result = await this.imageGenClient.query(submit.id);
        lastStatus = result.status;
        if (result.done) {
          if (result.status === 'succeeded' && result.results?.length) {
            const urls = result.results.map((r) => r.url).join('\n');
            return {
              success: true,
              content: `已生成图片，URL 如下：\n${urls}`,
            };
          }
          return { success: false, content: '', error: `生图任务失败，状态: ${result.status}` };
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      return {
        success: false,
        content: '',
        error: `生图任务超时未完成，最后状态: ${lastStatus}`,
      };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
