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
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { randomUUID } from 'crypto';
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
import { PostRunHook, POST_RUN_HOOKS } from './post-run-hook';

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
    @Inject(POST_RUN_HOOKS) private readonly postRunHooks: PostRunHook[],
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
    return this.conversationQueryService.listConversations(
      userId,
      query.page,
      query.pageSize,
      query.source,
      query.agentId,
    );
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
      // 意图路由结果（2026-10-15 透出）：两列早已落库，此前只是没往外拿。
      //
      // 为什么必须透出：前端恢复历史时只能靠文本形态猜「这条是不是翻译官答的」
      //（looksLikeTranslateReply：含【推荐译文】或「英文开头+中文说明」），
      // 而实时态用的是权威 agentId —— 两套判定标准必然漂移，表现为
      // 「实时出卡片、刷新历史卡片没了」或把普通英文回答错套成翻译卡。
      //
      // · agentId：会话级锁定值（每轮被覆盖），只作「当前 agent」参考
      // · intentHistory：逐轮 append-only 流水，历史消息定归属要用它
      //   ⚠️ 会话级 agentId 不够 —— 同一会话「先闲聊后翻译」是合法形态，
      //      会话级只留最后一个 agent，前面的轮次会全判错。
      agentId: conv.agentId,
      intentHistory: conv.intentHistory,
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
    // Admin 调试台有确认 UI，强制不过滤 requiresConfirm 工具（N3）
    await this.handleRun({ ...dto, scene: 'admin' }, res, req);
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
   *
   * N4（2026-10-26）：返回体从 { ok: boolean } 升级为区分「已处理/不存在/越权」——
   * 越权时 broker 立刻 reject 挂起工具（不等 60s 超时），前端可按 code 给可读提示。
   * ok===true 语义不变；ok===false 新增 code 字段（旧前端只读 ok，向后兼容）。
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
    return this.permissionBroker.resolve(requestId, userId, body.approve === true);
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

    // N5（2026-10-26）：controller 预生成 runId，贯穿 SSE 帧 → 引擎 → 落库，支持反查。
    // agent_runs 表主键复用此值（零 DDL）。
    const runId = randomUUID();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // N1（2026-10-26）：SSE 心跳保活——工具执行/等待期间可能 90s 无字节输出，
    // 代理按空闲超时掐连接。每 15s 推一帧 SSE 注释（`: keepalive`），EventSource 自动忽略，
    // 不进事件解析。间隔 15s < 常见代理 60s 空闲超时，留 4 倍余量。
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: keepalive\n\n`);
      }
    }, 15_000);

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
        ` (via=${intent.via} conf=${intent.confidence} switched=${intent.switched}` +
        `${intent.degradeReason ? ` degrade=${intent.degradeReason}` : ''})`,
    );
    res.write(
      `data: ${JSON.stringify({
        type: 'intent',
        runId, // N5：前端可反查 agent_runs
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
          // N3：C 端装配侧过滤 requiresConfirm 工具；缺省按 c-end（安全侧默认）
          scene: dto.scene ?? 'c-end',
        },
        userId,
        confirmHandler,
        runId, // N5：controller 预生成，引擎侧同值
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
      const errPayload = JSON.stringify({ type: 'error', runId, content: msg });
      res.write(`data: ${errPayload}\n\n`);
      steps.push({ type: 'error', content: msg, ts: Date.now() });
    } finally {
      clearInterval(heartbeat);
    }

    res.end();

    // 对话结束后置钩子（fire-and-forget，不阻塞响应）：用户记忆更新等插件
    for (const hook of this.postRunHooks) {
      hook
        .trigger({
          userId,
          conversationId: conversationIdFromEngine,
          userInput: dto.userInput,
          finalAnswer,
          steps,
          source: dto.source === 'tool' ? 'tool' : 'chat',
        })
        .catch(() => {
          /* 后置钩子失败不影响对话结果 */
        });
    }

    // 工具页（翻译 / 合同评估）产生的会话标记 source='tool' → 不出现在主对话记录列表。
    // 同时落库显式 agentId：工具页各取各的记录（左栏「翻译记录 / 体检记录」靠它过滤）。
    if (dto.source === 'tool' && conversationIdFromEngine) {
      this.conversationQueryService
        .markSource(userId, conversationIdFromEngine, 'tool', dto.agentId)
        .catch(() => {
          /* 标记失败不影响本次对话结果 */
        });
    }

    // 异步把 run 推送到 ai-service 统一落库（admin 调试用）
    this.runPusher
      .push({
        // N5：runId 作为 agent_runs 主键，前端可反查
        runId,
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
