import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';

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
    messages: Array<{ role: string; content: string; timestamp?: string }>,
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
        conversation.messages = messages;
        conversation.updatedAt = new Date();
        return this.conversationRepository.save(conversation);
      }
    }

    // 创建新对话
    const newConversation = this.conversationRepository.create({
      userId,
      title,
      messages,
    });

    return this.conversationRepository.save(newConversation);
  }

  /**
   * 获取对话列表
   */
  async getConversations(userId?: string) {
    const where: any = {};
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
    const where: any = {};
    if (userId) {
      where.userId = userId;
    }

    await this.conversationRepository.delete(where);
  }
}
