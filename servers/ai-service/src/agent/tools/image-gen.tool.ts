import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '../interfaces/tool.interface';
import { ImageGenClient } from '../../common/http/image-gen.client';

/**
 * 生图工具：包装现有 ImageGenClient。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class ImageGenTool implements ToolDefinition {
  readonly name = 'image-gen';
  readonly description = '根据文本提示词生成图片，返回任务 ID';
  readonly parameters = {
    prompt: { type: 'string', description: '图片生成的文本描述', required: true },
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
    // TODO: 调 imageGenClient.submit(args.prompt)，轮询 query 拿结果 URL
    void args;
    return { success: false, content: '', error: 'ImageGenTool 未实现' };
  }
}
