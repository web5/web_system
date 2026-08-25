import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AgentRunner } from '@kedou/agent-core';
import { AgentRunDto } from './dto/agent-run.dto';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('AI Agent')
@Controller('ai/agent')
@UseGuards(AuthGuard)
export class AgentController {
  constructor(private readonly agentRunner: AgentRunner) {}

  /** Agent 运行（SSE 流式，含工具调用过程） */
  @Post('run')
  @ApiOperation({ summary: '运行 Agent（流式 SSE，返回工具调用与最终回答）' })
  async run(@Body() dto: AgentRunDto, @Res() res: Response, @Req() req: Request) {
    const user = (req as any).user;
    const userId = String(user?.id ?? '');
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const stream = this.agentRunner.stream(
        {
          agentId: dto.agentId,
          userInput: dto.userInput,
          conversationId: dto.conversationId,
        },
        userId,
      );

      for await (const event of stream) {
        // conversationId 由引擎在 final 事件内返回（首次运行即创建）
        const payload = JSON.stringify(event);
        res.write(`data: ${payload}\n\n`);
      }
    } catch (error) {
      const errPayload = JSON.stringify({
        type: 'error',
        content: (error as Error).message || 'Agent 运行失败',
      });
      res.write(`data: ${errPayload}\n\n`);
    }

    res.end();
  }
}
