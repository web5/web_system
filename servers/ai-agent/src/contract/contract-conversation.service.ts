import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentConversation } from '../agent/memory/agent-conversation.entity';
import { parseContractReport, ContractReportSnapshot } from './contract-report.parser';

/** 对话卡片元信息（meta 列） */
export interface ConversationMeta {
  scene?: string;
  danger: number;
  warn: number;
  ok: number;
}

/**
 * 合同分析报告快照服务。
 *
 * 职责：agent_conversations 是"对话即报告"的唯一真相源——合同分析的 final 输出（结构化报告）
 * 除作为普通消息进入 messages 外，另落一份到 report 快照列，**独立于摘要压缩**，保证历史回放
 * 不因消息被压缩而丢失。追问文本无法 parse 成报告 → no-op，天然不覆盖既有快照。
 */
@Injectable()
export class ContractConversationService {
  private readonly logger = new Logger(ContractConversationService.name);

  constructor(
    @InjectRepository(AgentConversation)
    private readonly repo: Repository<AgentConversation>,
  ) {}

  /**
   * 尝试把一次 run 的最终输出写成该对话的报告快照。
   * @param userId 对话所属用户
   * @param conversationId 对话 id
   * @param finalContent agent final 事件 content
   */
  async snapshotReport(userId: string, conversationId: string, finalContent: string): Promise<void> {
    if (!userId || !conversationId || !finalContent) return;
    const report = parseContractReport(finalContent);
    if (!report) return; // 追问回复 / 非报告结构 → 不覆盖既有快照

    const patch: {
      report: ContractReportSnapshot;
      meta: ConversationMeta;
      title?: string;
    } = {
      report,
      meta: this.buildMeta(report),
    };
    if (report.scene) {
      patch.title = `合同体检 · ${report.scene}`;
    }

    try {
      // repo.create + save：仅更新本 patch 提供的列（report/meta/title），
      // messages 等未提供列不受影响（避免与记忆 persist 互相覆盖）
      const patchEntity = this.repo.create({
        id: conversationId,
        userId,
        report: patch.report,
        meta: patch.meta,
        ...(patch.title ? { title: patch.title } : {}),
      });
      await this.repo.save(patchEntity);
      this.logger.log(
        `[快照] 合同报告快照已写入会话 ${conversationId}（scene=${report.scene}）`,
      );
    } catch (e) {
      // 快照是辅助能力，失败不阻塞对话主链路
      this.logger.warn(`[快照] 报告快照写入失败: ${(e as Error).message}`);
    }
  }

  /** 从报告统计 signals 分级计数 */
  private buildMeta(report: ContractReportSnapshot): ConversationMeta {
    const signals = Array.isArray(report.signals) ? report.signals : [];
    const count = (lv: string) =>
      signals.filter((s) => (s && typeof s === 'object' ? s.level === lv : false)).length;
    const meta: ConversationMeta = {
      danger: count('danger'),
      warn: count('warn'),
      ok: count('ok'),
    };
    if (report.scene) meta.scene = report.scene;
    return meta;
  }
}
