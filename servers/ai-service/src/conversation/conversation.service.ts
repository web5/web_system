import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { ChatMessage } from '../common/http/base-ai.client';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  /**
   * 保存或更新对话
   */
  async saveConversation(
    userId: string,
    messages: ChatMessage[],
    conversationId?: string,
  ): Promise<Conversation> {
    // 生成对话标题（取第一条用户消息的前20个字符）
    const title = messages
      .filter((m) => m.role === 'user')
      .slice(0, 1)
      .map((m) => m.content.substring(0, 20))
      .pop() || '新对话';

    if (conversationId) {
      // 更新现有对话
      const conversation = await this.conversationRepository.findOne({
        where: { id: conversationId },
      });

      if (conversation) {
        conversation.messages = messages as Conversation['messages'];
        conversation.updatedAt = new Date();
        return this.conversationRepository.save(conversation);
      }
    }

    // 创建新对话
    const newConversation = this.conversationRepository.create({
      userId,
      title,
      messages: messages as Conversation['messages'],
    } as Conversation);

    return this.conversationRepository.save(newConversation as Conversation);
  }

  /**
   * 获取对话列表
   */
  async getConversations(userId?: string) {
    const where: FindOptionsWhere<Conversation> = {};
    if (userId) {
      where.userId = userId;
    }

    const conversations = await this.conversationRepository.find({
      where,
      order: { updatedAt: 'DESC' },
      take: 100,
    });

    return {
      list: conversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        messageCount: conv.messages.length,
        updatedAt: conv.updatedAt,
      })),
      total: conversations.length,
    };
  }

  /**
   * 获取对话详情
   */
  async getConversation(id: string): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id },
    });

    if (!conversation) {
      throw new Error(`Conversation ${id} not found`);
    }

    return conversation;
  }

  /**
   * 删除对话
   */
  async deleteConversation(id: string): Promise<void> {
    const result = await this.conversationRepository.delete(id);
    
    if (result.affected === 0) {
      throw new Error(`Conversation ${id} not found`);
    }
  }

  /**
   * 清空所有对话
   */
  async clearConversations(userId?: string): Promise<void> {
    const where: FindOptionsWhere<Conversation> = {};
    if (userId) {
      where.userId = userId;
    }
    await this.conversationRepository.delete(where);
  }

  // ============ Agent 记忆专用（摘要压缩） ============

  /** 读取 Agent 记忆：返回 summary 与近期原始消息 */
  async loadAgentMemory(
    userId: string,
    conversationId: string,
  ): Promise<{
    summary: string | null;
    recentMessages: Conversation['recentMessages'];
    summarizedCount: number;
  }> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    return {
      summary: conversation.summary ?? null,
      recentMessages: (conversation.recentMessages ?? []) as Conversation['recentMessages'],
      summarizedCount: conversation.summarizedCount ?? 0,
    };
  }

  /**
   * 保存一次 Agent run 的结果。
   * @param recentMessages 压缩后保留的近期消息
   * @param summary 压缩生成的新摘要（null 表示未触发压缩）
   */
  async saveAgentMemory(
    userId: string,
    conversationId: string | undefined,
    recentMessages: Conversation['recentMessages'],
    summary: string | null,
    summarizedCount: number,
    firstUserText: string,
  ): Promise<string> {
    // 新会话：标题取首条用户消息前 20 字
    if (!conversationId) {
      const newConv = this.conversationRepository.create({
        userId,
        title: firstUserText.substring(0, 20) || '新对话',
        recentMessages,
        summary,
        summarizedCount,
      } as Conversation);
      const saved = await this.conversationRepository.save(newConv as Conversation);
      return saved.id;
    }

    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    conversation.recentMessages = recentMessages;
    if (summary !== null) {
      conversation.summary = summary;
      conversation.summarizedCount = summarizedCount;
    }
    conversation.updatedAt = new Date();
    const saved = await this.conversationRepository.save(conversation);
    return saved.id;
  }
}
