import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AgentRunner, AgentRegistry, StreamEvent } from '@kedouai/agent-core';
import { AgentRunDto } from './dto/agent-run.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AgentRunPusher } from './agent-run-pusher';

@ApiTags('AI Agent')
@Controller('agent')
@UseGuards(AuthGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly agentRegistry: AgentRegistry,
    private readonly runPusher: AgentRunPusher,
  ) {}

  /** Agent 运行（SSE 流式，含工具调用过程） */
  @Post('run')
  @ApiOperation({ summary: '运行 Agent（流式 SSE，返回工具调用与最终回答）' })
  async run(@Body() dto: AgentRunDto, @Res() res: Response, @Req() req: Request) {
    const user = (req as any).user;
    const userId = String(user?.id ?? '');
    this.logger.log(`收到 agent/run 请求: agentId=${dto.agentId} userId=${userId} inputLen=${(dto.userInput || '').length}`);
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 收集步骤流水 + 取 agent 定义快照（systemPrompt / tools / model）
    const steps: Array<{ type: string; name?: string; content?: string; step?: number; ts: number }> = [];
    let finalAnswer: string | null = null;
    let errorMessage: string | null = null;
    let conversationIdFromEngine: string | null = null;
    const startedAt = Date.now();

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
      // agentId 找不到时，agent-runner 也会报错
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
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // content_delta 是逐字增量（可能上千条），只透传前端用于逐字渲染，
        // 不落库 steps（避免 agent-runs 表被污染/膨胀）
        if (event.type !== 'content_delta') {
          steps.push({
            type: event.type,
            name: event.name,
            content: event.content,
            step: event.step,
            ts: Date.now(),
          });
        }
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
      this.logger.error(`Agent run error: ${msg}`);
      const errPayload = JSON.stringify({ type: 'error', content: msg });
      res.write(`data: ${errPayload}\n\n`);
      steps.push({ type: 'error', content: msg, ts: Date.now() });
    }

    res.end();

    // 异步把 run 推送到 ai-service 统一落库（admin 调试用）
    this.runPusher
      .push({
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
        source: 'ai-agent',
      })
      .catch(() => {
        /* pusher 内已 warn，不外抛 */
      });
  }
}
