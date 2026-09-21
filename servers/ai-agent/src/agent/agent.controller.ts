import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  Res,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response, Request } from 'express';
import {
  AgentRunner,
  AgentRegistry,
  ClientRegistry,
  StreamEvent,
  withCode,
  classifyError,
} from '@kedouai/agent-core';
import { AgentRunDto } from './dto/agent-run.dto';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';
import { AgentRunPusher } from './agent-run-pusher';
import { PermissionBroker } from './permission-broker';
import { AgentConversationQueryService } from './agent-conversation-query.service';
import { ListConversationsDto } from './dto/conversation-query.dto';
import { ContractConversationService } from '../contract/contract-conversation.service';
import { IntentService } from './intent/intent.service';

@ApiTags('AI Agent')
@Controller('agent')
@UseGuards(AuthGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly agentRegistry: AgentRegistry,
    private readonly runPusher: AgentRunPusher,
    private readonly clientRegistry: ClientRegistry,
    private readonly permissionBroker: PermissionBroker,
    private readonly contractConversationService: ContractConversationService,
    private readonly conversationQueryService: AgentConversationQueryService,
    private readonly intentService: IntentService,
  ) {}

  /**
   * 我的对话列表（C 端历史）：仅当前用户，updatedAt 倒序，轻量列分页。
   * 供 kedou-ai-minigram 历史记录页展示多次合同分析记录。
   */
  @Get('conversations')
  @ApiOperation({ summary: '我的 Agent 对话列表（分页）' })
  async listConversations(@Query() query: ListConversationsDto, @Req() req: Request) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }
    return this.conversationQueryService.listConversations(userId, query.page, query.pageSize);
  }

  /** 对话详情（含报告快照与消息序列）：仅会话所属用户可读，他人会话统一 404 */
  @Get('conversations/:id')
  @ApiOperation({ summary: 'Agent 对话详情（报告快照 + 消息序列）' })
  async getConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: Request,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }
    const conv = await this.conversationQueryService.getConversation(userId, id);
    if (!conv) {
      throw new NotFoundException('对话不存在');
    }
    return {
      id: conv.id,
      title: conv.title,
      report: conv.report,
      meta: conv.meta,
      messages: Array.isArray(conv.messages) ? conv.messages : [],
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  /** 删除会话（仅会话所属用户；不可恢复，前端有二次确认） */
  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除我的 Agent 对话' })
  async deleteConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: Request,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }
    const ok = await this.conversationQueryService.deleteConversation(userId, id);
    if (!ok) {
      throw new NotFoundException('对话不存在');
    }
    return { ok: true };
  }

  /** Agent 运行（C 端，SSE 流式，含工具调用过程） */
  @Post('run')
  @ApiOperation({ summary: '运行 Agent（流式 SSE，返回工具调用与最终回答）' })
  async run(@Body() dto: AgentRunDto, @Res() res: Response, @Req() req: Request) {
    await this.handleRun(dto, res, req);
  }

  /**
   * Admin Playground 专用运行端点：要求 agents:debug 权限（消耗真实 LLM token）。
   * C 端用户无此权限，无法绕过权限校验直刷对话。
   */
  @Post('admin-run')
  @UseGuards(PermissionGuard)
  @RequirePermission('agents:debug')
  @ApiOperation({ summary: 'Admin 对话调试运行（需 agents:debug）' })
  async adminRun(@Body() dto: AgentRunDto, @Res() res: Response, @Req() req: Request) {
    await this.handleRun(dto, res, req);
  }

  /** 可用模型列表（Playground 模型下拉用，含可用性状态） */
  @Get('models')
  @UseGuards(PermissionGuard)
  @RequirePermission('agents:debug')
  @ApiOperation({ summary: '列出已注册的可用模型' })
  listModels() {
    return { models: this.clientRegistry.listModels() };
  }

  /**
   * 权限确认：前端弹窗后调用（approve=true 允许 / false 拒绝）。
   * 只用 AuthGuard（登录即可），因为 C 端业务用户也需要确认自己触发的高危操作；
   * 由 PermissionBroker 校验确认者 userId 与发起 run 的用户一致，防止越权替他人确认。
   */
  @Post('permission/:requestId')
  @ApiOperation({ summary: '确认/拒绝 Agent 工具执行的权限请求' })
  async resolvePermission(
    @Param('requestId') requestId: string,
    @Body() body: { approve?: boolean },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const userId = String(user?.id ?? '');
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }
    const ok = this.permissionBroker.resolve(requestId, userId, body.approve === true);
    return { ok };
  }

  /** 共用运行逻辑（SSE 流式 + 步骤收集 + 异步落库） */
  private async handleRun(dto: AgentRunDto, res: Response, req: Request): Promise<void> {
    const user = (req as any).user;
    const userId = String(user?.id ?? '');
    this.logger.log(
      `收到 agent/run 请求: agentId=${dto.agentId ?? '(auto)'} userId=${userId} inputLen=${(dto.userInput || '').length}`,
    );
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 收集步骤流水 + 取 agent 定义快照（systemPrompt / tools / model）
    // usage：final/summary/error 事件携带的 token 用量（Phase1.6 随 steps 落库，供成本/用量统计）
    const steps: Array<{
      type: string;
      name?: string;
      content?: string;
      step?: number;
      ts: number;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    }> = [];
    let finalAnswer: string | null = null;
    let errorMessage: string | null = null;
    let conversationIdFromEngine: string | null = null;
    const startedAt = Date.now();

    let agentName: string | null = null;
    let systemPrompt = '';
    let tools: string[] | null = null;
    let model: string | null = null;
    let agentVersion: number | null = null;

    // ===== 意图路由：把「客户端传死的 agentId」变成「服务端解析出来的」 =====
    // 不传 / 传 'auto' → 服务端分类；显式传值 → 原样使用（向后兼容，一行都不用改）。
    // 时序要求：intent 事件必须早于任何 token（前端据此渲染 agent 徽标、排查误判）。
    const intent = await this.intentService.resolve({
      agentId: dto.agentId,
      userInput: dto.userInput,
      conversationId: dto.conversationId,
      userId,
    });
    const resolvedAgentId = intent.agentId;
    this.logger.log(
      `意图路由: ${dto.agentId ?? '(auto)'} → ${resolvedAgentId}` +
        ` (via=${intent.via} conf=${intent.confidence} switched=${intent.switched})`,
    );
    res.write(
      `data: ${JSON.stringify({
        type: 'intent',
        intent: {
          agentId: resolvedAgentId,
          agentName: this.agentRegistry.has(resolvedAgentId)
            ? this.agentRegistry.get(resolvedAgentId).name
            : undefined,
          confidence: intent.confidence,
          via: intent.via,
          switched: intent.switched,
          previousAgentId: intent.previousAgentId,
        },
      })}\n\n`,
    );

    try {
      // 【易漏点】取定义快照要用**解析后**的 id，不是 dto.agentId ——
      // 否则 auto 时 get('auto') 抛错被 catch 吞掉，systemPrompt 快照为空，埋点静默降级。
      const def = this.agentRegistry.get(resolvedAgentId);
      agentName = def?.name ?? null;
      systemPrompt = def?.systemPrompt ?? '';
      tools = def?.tools ?? null;
      model = def?.model ?? null;
      agentVersion = def?.version ?? null;
    } catch {
      // agentId 找不到时，agent-runner 也会报错
    }

    try {
      // 权限确认器：工具遇到高危操作时，把 permission_request 事件写入 SSE 流并挂起，
      // 等待前端通过 POST /agent/permission/:requestId 确认（60s 超时自动拒绝）
      const confirmHandler = async (message: string): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
          const requestId = this.permissionBroker.register(userId, resolve);
          res.write(
            `data: ${JSON.stringify({ type: 'permission_request', requestId, content: message })}\n\n`,
          );
          setTimeout(() => this.permissionBroker.rejectTimeout(requestId), 60_000);
        });
      };

      const stream = this.agentRunner.stream(
        {
          agentId: resolvedAgentId,
          userInput: dto.userInput,
          conversationId: dto.conversationId,
          // 调试时可临时覆盖模型（仅本次运行）
          model: dto.model,
        },
        userId,
        confirmHandler,
      );

      for await (const event of stream as AsyncGenerator<StreamEvent>) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);

        // 结构化卡片：把 present-music-card 的工具结果转成 card 事件下发前端。
        // 引擎只认识通用 tool_result，卡片语义在这里收口；steps 仍记原始 tool_result
        // （内容即卡片 JSON），历史回看据此还原卡片而不退化成文本。
        if (event.type === 'tool_result' && event.name === 'present-music-card' && event.content) {
          try {
            const card = JSON.parse(event.content);
            res.write(`data: ${JSON.stringify({ type: 'card', card, step: event.step })}\n\n`);
          } catch {
            this.logger.warn('歌曲卡片载荷解析失败，跳过 card 事件');
          }
        }
        // content_delta / reasoning_delta 是逐字增量（可能上千条），只透传前端用于逐字渲染，
        // 不落库 steps（避免 agent-runs 表被污染/膨胀）
        if (event.type !== 'content_delta' && event.type !== 'reasoning_delta') {
          steps.push({
            type: event.type,
            name: event.name,
            content: event.content,
            step: event.step,
            ts: Date.now(),
            // usage 只出现在 final/summary/error 等汇总事件，随 steps 落库（Phase1.6）
            ...(event.usage ? { usage: event.usage } : {}),
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
      const raw = (error as Error).message || 'Agent 运行失败';
      // 带错误码下发：客户端按码查表给提示；技术原文照旧进 run 落库供排查
      const msg = withCode(classifyError(error), raw);
      errorMessage = msg;
      this.logger.error(`Agent run error: ${raw}`);
      const errPayload = JSON.stringify({ type: 'error', content: msg });
      res.write(`data: ${errPayload}\n\n`);
      steps.push({ type: 'error', content: msg, ts: Date.now() });
    }

    res.end();

    // 工具页（翻译 / 合同评估）产生的会话标记 source='tool' → 不出现在主对话记录列表
    if (dto.source === 'tool' && conversationIdFromEngine) {
      this.conversationQueryService.markSource(userId, conversationIdFromEngine, 'tool').catch(() => {
        /* 标记失败不影响本次对话结果 */
      });
    }

    // 异步把 run 推送到 ai-service 统一落库（admin 调试用）
    this.runPusher
      .push({
        // 埋点同样用解析后的 id，否则 agent_log 会写进 'auto'
        agentId: resolvedAgentId,
        agentName,
        userId,
        conversationId: conversationIdFromEngine,
        userInput: dto.userInput,
        systemPrompt,
        tools,
        model,
        agentVersion,
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

    // 合同风险场景：分析 final 若为结构化报告 → 落 report 快照（独立于摘要压缩，保证历史可回放）。
    // 追问文本无法解析成报告 → 服务内 no-op，天然不覆盖既有快照。
    if (
      resolvedAgentId === 'contract-risk' &&
      conversationIdFromEngine &&
      finalAnswer &&
      !errorMessage
    ) {
      this.contractConversationService
        .snapshotReport(userId, conversationIdFromEngine, finalAnswer)
        .catch(() => {
          /* 快照失败不阻塞对话主链路 */
        });
    }
  }
}
