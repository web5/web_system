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
  type IntentDegradeReason,
  type IntentRoutingHint,
} from '@kedouai/agent-core';
import { AgentConversation } from '../memory/agent-conversation.entity';
import { IntentStats } from './intent-stats';

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
  /** 兜底比例统计（进程内滑动窗口，口径见 intent-stats.ts 头注释） */
  private readonly stats: IntentStats;

  constructor(
    @InjectRepository(AgentConversation)
    private readonly convRepo: Repository<AgentConversation>,
    private readonly registry: AgentRegistry,
    private readonly clientRegistry: ClientRegistry,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<string>('INTENT_ROUTING_ENABLED', 'false') === 'true';
    // 默认值与 prod llm_models 字典、内置清单逐字一致；未注册的 id 会回退 hy3。
    // DB 字典同步会整体重建 ClientRegistry，不能只在内置清单里补另一个别名。
    this.modelId = this.config.get<string>('INTENT_MODEL', 'deepseek-v4-flash');
    this.timeoutMs = Number(this.config.get<string>('INTENT_TIMEOUT_MS', '3000')) || 3000;
    this.fallbackAgentId = this.config.get<string>('INTENT_FALLBACK_AGENT_ID', 'general');
    // 兜底比例告警线：窗口内 fallback 占比达到该值时打 warn（默认 50%，样本 ≥30 才判）
    const warnRatio = Number(this.config.get<string>('INTENT_FALLBACK_WARN_RATIO', '0.5'));
    this.stats = new IntentStats({ warnRatio: warnRatio > 0 && warnRatio <= 1 ? warnRatio : 0.5 });

    // 启动即打印灰度真实状态（2026-10-15 加）
    //
    // 为什么必须可观测：意图路由是**静默降级**的 —— 开关一关，不报错、不告警，
    // 只是所有输入都落兜底 agent。前端侧表现为「翻译官不出现了 / 历史卡片判定退化」，
    // 排查时很容易误判成代码 bug，而根因只是一行环境变量没配。
    // 而该变量**只存在于部署机的 .env**（仓库 .env 不含、.env.example 是 false），
    // 环境漂移 / 新机器 / 容器重建都可能悄悄回到默认值 —— 所以启动时必须留痕。
    //
    // ⚠️ 这里只打印、不改 enabled：默认值保持 false 是**有意的**
    //   （见文件头注释：agent 未配置就开开关，全部落兜底比不开更糟）。
    //   本条只解决「不知道它开着还是关着」，不改变灰度策略本身。
    this.logger.log(
      `意图路由：${this.enabled ? '已开启' : '未开启（灰度关闭）'}` +
        ` · 分类模型 ${this.modelId}` +
        ` · 兜底 ${this.fallbackAgentId}` +
        ` · 超时 ${this.timeoutMs}ms` +
        (this.enabled ? '' : '  ← 历史消息卡片归属将退化为文本启发式（utils/history-cards.ts 降级路径）'),
    );
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

    // 0) `@agentId` 前缀显式指定：**开关关闭时也必须生效**（否则用户唯一的手动纠偏手段失效）。
    //    这里先于 enabled 判定处理，且不调 LLM —— 零延迟、零误判。
    const at = params.userInput.match(/^@([a-z0-9-]+)[\s:：]*/i);
    if (at && candidates.includes(at[1])) {
      await this.lock(params.conversationId, at[1], 'explicit');
      return { agentId: at[1], confidence: 1, via: 'explicit', switched: false };
    }

    // 1) 显式传入（非 auto）→ 不分类，直接走（老调用 contract-risk 一行都不用改）
    if (params.agentId && params.agentId !== 'auto' && candidates.includes(params.agentId)) {
      await this.lock(params.conversationId, params.agentId, 'explicit');
      return { agentId: params.agentId, confidence: 1, via: 'explicit', switched: false };
    }

    // 2) 开关关闭 → 不分类，直接用兜底（与改动前行为一致：无分类延迟、无误判风险）
    if (!this.enabled) {
      // 带上 disabled 原因，便于上游区分「开关关闭」与「真兜底」；不计入兜底比例统计。
      return { agentId: fallback, confidence: 1, via: 'fallback', switched: false, degradeReason: 'disabled' };
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
    const r = await classifier.classify(params.userInput, {
      candidates,
      lockedAgentId: locked,
      // 路由线索实时取自注册表：关键词 + 用途说明都由后台定义提供
      // （写死在本服务的历史版本即是 2026-09-28「100% 兜底」事故的根因）
      routingHints: this.routingHints(),
    });

    // 4) 切换判定：仅显式 / 高置信规则(≥.88) / 高置信 LLM(≥.75) 才允许切；兜底不切
    const shouldSwitch =
      !locked ||
      r.via === 'explicit' ||
      (r.via === 'rule' && r.confidence >= 0.88) ||
      (r.via === 'llm' && r.confidence >= 0.75);
    const finalAgentId = shouldSwitch ? r.agentId : locked!;
    const switched = !!locked && finalAgentId !== locked;

    if (!candidates.includes(finalAgentId)) {
      // 此路径过去既不写判定流水、也无任何痕迹 —— 是「兜底」却统计不到（2026-10-19 补）。
      // 只追加流水，**不能**走 lock()：lock 会把会话的 agentId 改写成兜底 agent，改变既有行为。
      this.observe('fallback', 'not_candidate');
      await this.appendHistory(params.conversationId, locked ?? fallback, 'fallback', 'not_candidate');
      return {
        agentId: locked ?? fallback,
        confidence: 0.3,
        via: 'fallback',
        switched: false,
        previousAgentId: locked,
        degradeReason: 'not_candidate',
      };
    }

    this.observe(r.via, r.degradeReason);
    await this.lock(params.conversationId, finalAgentId, r.via, r.degradeReason);
    return { ...r, agentId: finalAgentId, switched, previousAgentId: locked };
  }

  /**
   * 从注册表实时生成路由线索（关键词 + 用途说明）。
   *
   * ⚠️ 必须实时取：后台改了某个 agent 的关键词后，下一轮对话就该按新口径路由，
   * 中间不能有「回代码里改一张硬编码表」这一步（那张表迟早会和真注册表漂移）。
   */
  private routingHints(): IntentRoutingHint[] {
    return this.registry.list().map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      keywords: a.keywords,
    }));
  }

  /**
   * 记入兜底比例统计；达到告警线时打 warn（同一时间窗内只打一次，防刷屏）。
   * 注意这是**进程内**窗口：重启清零、多实例各算各的 —— 它负责「发现异常」，不替代监控平台。
   */
  private observe(via: IntentResult['via'], reason?: IntentDegradeReason): void {
    this.stats.record(via, reason);
    if (this.stats.shouldWarn()) {
      const s = this.stats.snapshot();
      this.logger.warn(
        `意图路由兜底比例偏高：${(s.fallbackRatio * 100).toFixed(0)}%（最近 ${s.total} 次）` +
          ` via=${JSON.stringify(s.byVia)} 降级原因=${JSON.stringify(s.byReason)}` +
          ` —— 先查事实源（agent 注册表是否发布、关键词/候选是否漂移），再查分类模型。`,
      );
    }
  }

  /** 写回会话锁定 + 追加判定流水（首轮无 conversationId 时跳过） */
  private async lock(
    conversationId: string | undefined,
    agentId: string,
    via: string,
    reason?: IntentDegradeReason,
  ): Promise<void> {
    if (!conversationId) return;
    try {
      await this.convRepo.update(conversationId, { agentId });
    } catch (e) {
      // 落库失败不影响本轮对话（最多是下一轮重新分类）
      this.logger.warn(`意图锁定写回失败（不阻塞对话）: ${(e as Error)?.message}`);
      return;
    }
    await this.appendHistory(conversationId, agentId, via, reason);
  }

  /**
   * 只追加判定流水，不改会话的 agentId。
   * 只有出现降级时才写 reason 字段，正常记录的 JSON 形状与之前完全一致（向后兼容）。
   */
  private async appendHistory(
    conversationId: string | undefined,
    agentId: string,
    via: string,
    reason?: IntentDegradeReason,
  ): Promise<void> {
    if (!conversationId) return;
    try {
      const entry = reason
        ? "JSON_OBJECT('agentId', ?, 'via', ?, 'reason', ?, 'ts', NOW())"
        : "JSON_OBJECT('agentId', ?, 'via', ?, 'ts', NOW())";
      const params = reason ? [agentId, via, reason, conversationId] : [agentId, via, conversationId];
      await this.convRepo.query(
        `UPDATE agent_conversations
            SET intent_history = JSON_ARRAY_APPEND(
                  COALESCE(intent_history, JSON_ARRAY()), '
}
,
                  CAST(${entry} AS JSON))
          WHERE id = ?`,
        params,
      );
    } catch (e) {
      this.logger.warn(`意图判定流水写入失败（不阻塞对话）: ${(e as Error)?.message}`);
    }
  }
}
