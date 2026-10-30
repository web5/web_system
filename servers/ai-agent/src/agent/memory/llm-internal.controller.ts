import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClientRegistry } from '@kedouai/agent-core';
import { AiAgentServiceKeyGuard } from './ai-agent-service-key.guard';
import { MemorySummaryRequestDto } from './dto/memory-summary-request.dto';

/**
 * ai-agent internal LLM 端点（服务间，不经 gateway）。
 *
 * 背景（#8229 架构修正，用户 2026-10-30 拍板）：LLM 调用统一走 ai-agent 的
 * AI 服务通道（ClientRegistry / TokenHub 托管模型），密钥由配置中心下发——
 * user-service 不直连 TokenHub、不持有 LLM 密钥，职责只到「存储摘要行 + 幂等 rebuild 编排」。
 *
 * 首个端点：用户记忆摘要生成。user-service 在 rebuild 时调用（x-service-key 鉴权）；
 * 调用失败/超时由 user-service 回落确定性模板聚合，本端点失败不阻断其链路。
 *
 * ⚠️ 回环说明：调用链为 ai-agent hook → user-service refresh → 本端点。
 * 本端点是一次无状态的 LLM 补全，不产生 run、不触发 PostRunHook（钩子只在
 * AgentRunner 对话轮次结束后触发），user-service rebuild 也不再回调 refresh
 * —— 回环深度恒为 1，无死循环风险。
 */
@ApiTags('internal')
@Controller('internal')
@UseGuards(AiAgentServiceKeyGuard)
export class LlmInternalController {
  private readonly logger = new Logger(LlmInternalController.name);

  /** 与用户记忆提炼（UserMemoryUpdateHook）同一模型：MEMORY_EXTRACT_MODEL */
  private readonly extractModel?: string;

  constructor(
    private readonly clientRegistry: ClientRegistry,
    configService: ConfigService,
  ) {
    this.extractModel = configService.get<string>('MEMORY_EXTRACT_MODEL');
  }

  @Post('llm/memory-summary')
  @ApiOperation({ summary: '用户记忆摘要生成（明细集 → 结构化画像文本）' })
  @HttpCode(HttpStatus.OK)
  async memorySummary(@Body() dto: MemorySummaryRequestDto) {
    const items = (dto.items ?? []).filter((it) => it && it.content?.trim());
    if (!items.length) {
      return { summary: '', model: null, itemCount: dto.itemCount ?? 0 };
    }
    const lines = items
      .map((d) => `- [${d.category}] ${d.content.trim()}`)
      .join('\n');
    const system =
      '你是用户记忆摘要生成器。把「记忆明细」压缩成一段结构化中文用户画像，要求：\n' +
      '1. 首行必须是「# 用户画像」；\n' +
      '2. 按事实/偏好/习惯分组，每行「- 分类：内容」，保留稳定事实，不逐条罗列对话细节；\n' +
      '3. 末尾加一行「- 统计：共 N 条记忆」，N 用给定明细数；\n' +
      '4. 总长不超过 450 字，不含与记忆无关的内容；只输出摘要正文。';
    const user = `明细数：${dto.itemCount ?? items.length}\n记忆明细：\n${lines}`;

    const client = this.clientRegistry.getOrFallback(this.extractModel);
    const text = await client.chat(
      [
        { role: 'system', content: system, ts: Date.now() },
        { role: 'user', content: user, ts: Date.now() },
      ],
      { temperature: 0.2, maxTokens: 800 },
    );
    this.logger.log(
      `记忆摘要生成: userId=${dto.userId ?? '?'} items=${items.length} model=${client.modelId} len=${text?.length ?? 0}`,
    );
    return { summary: (text ?? '').trim(), model: client.modelId, itemCount: dto.itemCount ?? items.length };
  }
}
