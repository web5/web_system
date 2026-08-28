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
import { AgentRunner, AgentRegistry, StreamEvent } from '@kedouai/agent-core';
import { AgentRunDto } from './dto/agent-run.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AgentLogService } from '../agent-log/agent-log.service';

@ApiTags('AI Agent')
@Controller('ai/agent')
@UseGuards(AuthGuard)
export class AgentController {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly agentRegistry: AgentRegistry,
    private readonly agentLog: AgentLogService,
  ) {}

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

    // 收集步骤流水（admin debug 用）—— 全部事件都记录，保留原始字节
    const steps: Array<{ type: string; name?: string; content?: string; args?: unknown; step?: number; ts: number }> = [];
    let finalAnswer: string | null = null;
    let errorMessage: string | null = null;
    let conversationIdFromEngine: string | null = null;
    const startedAt = Date.now();

    // 读取 agent 定义快照（systemPrompt / tools / model），即使后续定义改了也保留历史
    let agentName: string | null = null;
    let systemPrompt = '';
    let tools: string[] | null = null;
    let model: string | null = null;
    try {
      const def = this.agentRegistry.get(dto.agentId);
      agentName = def?.name ?? null;
      systemPrompt = def?.systemPrompt ?? '';
      tools = def?.tools ?? null;
      model = def?.model ?? null;
    } catch {
      // agentId 找不到时，agent-runner 也会报错，这里不重复抛
    }

    try {
      const stream = this.agentRunner.stream(
        {
          agentId: dto.agentId,
          userInput: dto.userInput,
          conversationId: dto.conversationId,
        },
        userId,
      );

      for await (const event of stream as AsyncGenerator<StreamEvent>) {
        // 1) 推给客户端
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // 2) 收集到本地（admin debug 用）
        steps.push({
          type: event.type,
          name: event.name,
          content: event.content,
          step: event.step,
          ts: Date.now(),
        });
        if (event.type === 'final') {
          finalAnswer = event.content ?? '';
          conversationIdFromEngine = event.conversationId ?? null;
        } else if (event.type === 'error') {
          errorMessage = event.content ?? 'unknown error';
        }
      }
    } catch (error) {
      const msg = (error as Error).message || 'Agent 运行失败';
      errorMessage = msg;
      const errPayload = JSON.stringify({ type: 'error', content: msg });
      res.write(`data: ${errPayload}\n\n`);
      steps.push({ type: 'error', content: msg, ts: Date.now() });
    }

    res.end();

    // 落库 run 记录（异步，错误不抛）
    this.agentLog
      .recordRun({
        agentId: dto.agentId,
        agentName,
        userId,
        conversationId: conversationIdFromEngine,
        userInput: dto.userInput,
        systemPrompt,
        tools,
        model,
        steps,
        finalAnswer,
        error: errorMessage,
        status: errorMessage ? 'error' : 'ok',
        durationMs: Date.now() - startedAt,
        source: 'ai-service',
      })
      .catch(() => {
        // 已在 service 内打日志
      });
  }
}
