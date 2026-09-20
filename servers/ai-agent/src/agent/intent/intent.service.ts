/**
 * 意图路由编排（Nest 侧）。
 *
 * 职责：读会话锁定 → 调分类器 → 判定是否允许切换 → 写回 `agent_conversations.agent_id`。
 * 分类器本身是纯 TS（packages/agent-core/src/core/intent-classifier.ts），这里只做编排与落库。
 *
 * ⚠️ 灰度开关 `INTENT_ROUTING_ENABLED` **默认关**：
 * 意图路由强依赖后台那 6 个 agent 已配置并 publish；agent 没配好时开开关，
 * 结果是所有输入都落兜底 agent —— 比不开更糟。开关应与「agent 配置完成」绑定上线。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgentRegistry,
  ClientRegistry,
  IntentClassifier,
  IntentResult,
} from '@kedouai/agent-core';
import { AgentConversation } from '../memory/agent-conversation.entity';

export interface ResolvedIntent extends IntentResult {
  /** 是否从上一任 agent 切换过来（供前端提示 / 埋点） */
  switched: boolean;
  previousAgentId?: string;
}

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  private readonly enabled: boolean;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly fallbackAgentId: string;

  constructor(
    @InjectRepository(AgentConversation)
    private readonly convRepo: Repository<AgentConversation>,
    private readonly registry: AgentRegistry,
    private readonly clientRegistry: ClientRegistry,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<string>('INTENT_ROUTING_ENABLED', 'false') === 'true';
    this.modelId = this.config.get<string>('INTENT_MODEL', 'deepseek-v4-flash');
    this.timeoutMs = Number(this.config.get<string>('INTENT_TIMEOUT_MS', '1200')) || 1200;
    this.fallbackAgentId = this.config.get<string>('INTENT_FALLBACK_AGENT_ID', 'general');
  }

  /**
   * 解析本轮该由哪个 agent 作答。
   *
   * 优先级：显式传入 > 会话锁定 > 规则 > LLM > 兜底。
   * 失败/超时一律回落兜底，**绝不阻塞主对话**。
   */
  async resolve(params: {
    agentId?: string;
    userInput: string;
    conversationId?: string;
    userId: string;
  }): Promise<ResolvedIntent> {
    // 候选集实时取自注册表：后台增删 agent 后无需改代码、无需发版
    const candidates = this.registry.list().map((a) => a.id);
    const fallback = candidates.includes(this.fallbackAgentId)
      ? this.fallbackAgentId
      : candidates[0] ?? this.fallbackAgentId;

    // 1) 显式传入（非 auto）→ 不分类，直接走（老调用 contract-risk 一行都不用改）
    if (params.agentId && params.agentId !== 'auto' && candidates.includes(params.agentId)) {
      await this.lock(params.conversationId, params.agentId, 'explicit');
      return { agentId: params.agentId, confidence: 1, via: 'explicit', switched: false };
    }

    // 2) 开关关闭 → 不分类，直接用兜底（与改动前行为一致：无分类延迟、无误判风险）
    if (!this.enabled) {
      return { agentId: fallback, confidence: 1, via: 'fallback', switched: false };
    }

    // 3) 读会话锁定（DB 异常时按「未锁定」处理，绝不阻塞对话）
    let locked: string | undefined;
    if (params.conversationId) {
      try {
        const conv = await this.convRepo.findOne({ where: { id: params.conversationId } });
        locked = conv?.agentId ?? undefined;
      } catch (e) {
        this.logger.warn(`读取会话锁定失败（按未锁定处理）: ${(e as Error)?.message}`);
      }
    }

    const classifier = new IntentClassifier(
      // ⚠️ getOrFallback 而非 get：模型未注册时回落到默认客户端，不抛错（文档 §4 修正点）
      this.clientRegistry.getOrFallback(this.modelId),
      this.timeoutMs,
      this.fallbackAgentId,
    );
    const r = await classifier.classify(params.userInput, { candidates, lockedAgentId: locked });

    // 4) 切换判定：仅显式 / 高置信规则(≥.88) / 高置信 LLM(≥.75) 才允许切；兜底不切
    const shouldSwitch =
      !locked ||
      r.via === 'explicit' ||
      (r.via === 'rule' && r.confidence >= 0.88) ||
      (r.via === 'llm' && r.confidence >= 0.75);
    const finalAgentId = shouldSwitch ? r.agentId : locked!;
    const switched = !!locked && finalAgentId !== locked;

    if (!candidates.includes(finalAgentId)) {
      return {
        agentId: locked ?? fallback,
        confidence: 0.3,
        via: 'fallback',
        switched: false,
        previousAgentId: locked,
      };
    }

    await this.lock(params.conversationId, finalAgentId, r.via);
    return { ...r, agentId: finalAgentId, switched, previousAgentId: locked };
  }

  /** 写回会话锁定 + 追加判定流水（首轮无 conversationId 时跳过） */
  private async lock(conversationId: string | undefined, agentId: string, via: string): Promise<void> {
    if (!conversationId) return;
    try {
      await this.convRepo.update(conversationId, { agentId });
      await this.convRepo.query(
        `UPDATE agent_conversations
            SET intent_history = JSON_ARRAY_APPEND(
                  COALESCE(intent_history, JSON_ARRAY()), '$',
                  CAST(JSON_OBJECT('agentId', ?, 'via', ?, 'ts', NOW()) AS JSON))
          WHERE id = ?`,
        [agentId, via, conversationId],
      );
    } catch (e) {
      // 落库失败不影响本轮对话（最多是下一轮重新分类）
      this.logger.warn(`意图锁定写回失败（不阻塞对话）: ${(e as Error)?.message}`);
    }
  }
}
