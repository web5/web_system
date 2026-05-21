import { Controller, Post, Body, Get, Param, Delete, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

@ApiTags('AI 对话')
@Controller('ai')
@ApiBearerAuth()
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @ApiOperation({ summary: '发送消息并获取 AI 回复' })
  @ApiResponse({ status: 200, description: '成功获取 AI 回复' })
  async chat(@Body() chatDto: ChatDto) {
    this.logger.log(`Received chat request: ${chatDto.message?.substring(0, 50)}...`);
    
    const result = await this.aiService.chat(chatDto);
    
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: '获取对话列表' })
  async getConversations() {
    const result = await this.aiService.getConversations();
    return {
      code: 0,
      data: result,
    };
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '获取对话详情' })
  async getConversation(@Param('id') id: string) {
    const result = await this.aiService.getConversation(id);
    return {
      code: 0,
      data: result,
    };
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除对话' })
  async deleteConversation(@Param('id') id: string) {
    await this.aiService.deleteConversation(id);
    return {
      code: 0,
      message: '删除成功',
    };
  }

  @Delete('conversations')
  @ApiOperation({ summary: '清空所有对话' })
  async clearConversations() {
    await this.aiService.clearConversations();
    return {
      code: 0,
      message: '清空成功',
    };
  }
}
