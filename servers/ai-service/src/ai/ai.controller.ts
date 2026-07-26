import { Controller, Post, Body, Get, Delete, Param, Res, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';
import { ImageSubmitDto } from './dto/image-gen.dto';
import { ImageQueryDto } from './dto/image-gen.dto';

@ApiTags('AI对话')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** 获取可用模型列表 */
  @Get('models')
  @ApiOperation({ summary: '获取可用AI模型列表' })
  getModels() {
    const models = this.aiService.getAvailableModels();
    const defaultModel = this.aiService.getDefaultModel();
    return { models, defaultModel };
  }

  /** 非流式对话 */
  @Post('chat')
  @ApiOperation({ summary: '非流式AI对话' })
  async chat(@Body() chatDto: ChatDto) {
    return this.aiService.chat(chatDto);
  }

  /** 流式对话（SSE） */
  @Post('chat/stream')
  @ApiOperation({ summary: '流式AI对话（SSE）' })
  async chatStream(@Body() chatDto: ChatDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const { stream, conversationId } = await this.aiService.chatStream(chatDto);

      for await (const chunk of stream) {
        const payload = JSON.stringify({
          content: chunk.content || '',
          done: chunk.done,
          model: (chunk as any).model,
          conversationId: chunk.conversationId || conversationId,
        });
        res.write(`data: ${payload}\n\n`);
      }
    } catch (error) {
      const errPayload = JSON.stringify({
        content: '',
        done: true,
        error: error.message || '流式对话失败',
      });
      res.write(`data: ${errPayload}\n\n`);
    }

    res.end();
  }

  /** 获取对话列表 */
  @Get('conversations')
  @ApiOperation({ summary: '获取对话历史列表' })
  async getConversations(@Query('userId') userId?: string) {
    const result = await this.aiService.getConversations(userId);
    return { code: 0, data: result };
  }

  /** 获取对话详情 */
  @Get('conversations/:id')
  @ApiOperation({ summary: '获取对话详情' })
  async getConversation(@Param('id') id: string) {
    const result = await this.aiService.getConversation(id);
    return { code: 0, data: result };
  }

  /** 删除对话 */
  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除对话' })
  async deleteConversation(@Param('id') id: string) {
    await this.aiService.deleteConversation(id);
    return { code: 0, message: '删除成功' };
  }

  /** 提交图片生成任务 */
  @Post('image/submit')
  @ApiOperation({ summary: '提交AI图片生成任务' })
  async submitImage(@Body() submitDto: ImageSubmitDto) {
    const data = await this.aiService.submitImage(submitDto);
    return { code: 0, message: '提交成功', data };
  }

  /** 查询图片生成结果 */
  @Post('image/query')
  @ApiOperation({ summary: '查询图片生成任务结果' })
  async queryImage(@Body() queryDto: ImageQueryDto) {
    const data = await this.aiService.queryImage(queryDto);
    return { code: 0, data };
  }
}
