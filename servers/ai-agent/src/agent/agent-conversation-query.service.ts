import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentConversation } from './memory/agent-conversation.entity';

/** 对话列表项（轻量列，不含 messages/report 全量，避免大字段拖慢列表） */
export interface ConversationListItem {
  id: string;
  title: string | null;
  meta: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationListResult {
  list: ConversationListItem[];
  total: number;
}

/**
 * 对话读取查询服务（C 端历史列表/详情）。
 * 越权防护：所有查询都强制带 userId（JWT），他人会话按"不存在"处理，不泄露存在性。
 */
@Injectable()
export class AgentConversationQueryService {
  constructor(
    @InjectRepository(AgentConversation)
    private readonly repo: Repository<AgentConversation>,
  ) {}

  /**
   * 当前用户对话列表（updatedAt 倒序，分页；只查轻量列）。
   *
   * source / agentId（2026-09-23，见 specs/conversation-source-filter/design.md）：
   * - 默认 `source='chat'` —— 只返回主对话，工具页（翻译 / 合同）会话各有自己的历史入口，
   *   混进来会干扰主对话浏览（既有行为不变）
   * - 工具页传 `source='tool' + agentId='translate'|'contract-risk'`，各取各的记录
   */
  async listConversations(
    userId: string,
    page: number,
    pageSize: number,
    source: 'chat' | 'tool' = 'chat',
    agentId?: string,
  ): Promise<ConversationListResult> {
    const agentIdFilter = agentId?.trim();
    const [rows, total] = await this.repo.findAndCount({
      where: {
        userId,
        source,
        ...(agentIdFilter ? { agentId: agentIdFilter } : {}),
      },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'meta', 'createdAt', 'updatedAt'],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list: rows, total };
  }

  /** 标记会话来源（工具页调用；带 userId 条件，防止改到他人会话） */
  async markSource(userId: string, conversationId: string, source: 'chat' | 'tool'): Promise<void> {
    await this.repo.update({ id: conversationId, userId }, { source });
  }

  /** 详情：仅当会话属于该用户时返回，否则 null（controller 转 404） */
  async getConversation(userId: string, conversationId: string): Promise<AgentConversation | null> {
    return this.repo.findOne({ where: { id: conversationId, userId } });
  }

  /**
   * 删除会话：仅会话所属用户可删（带 userId 条件，防止删到他人会话）。
   * 他人会话 / 不存在统一按 0 行处理（controller 转 404），不泄露存在性。
   */
  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const result = await this.repo.delete({ id: conversationId, userId });
    return (result.affected ?? 0) > 0;
  }
}
