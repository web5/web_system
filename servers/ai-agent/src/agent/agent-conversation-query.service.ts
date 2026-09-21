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
   * 只返回**主对话**（source='chat'）—— 工具页（翻译 / 合同）产生的会话各有自己的历史入口，
   * 混进来会干扰主对话浏览。
   */
  async listConversations(userId: string, page: number, pageSize: number): Promise<ConversationListResult> {
    const [rows, total] = await this.repo.findAndCount({
      where: { userId, source: 'chat' },
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
}
