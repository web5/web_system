import { Injectable, Logger } from '@nestjs/common';
import { Hy3Client, ChatMessage } from '../common/http/hy3.client';
import { ConversationService } from '../conversation/conversation.service';

export interface ChatResponse {
  conversationId: string;
  reply: string;
  timestamp: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly hy3Client: Hy3Client,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * 处理用户对话
   */
  async chat(chatDto: {
    message: string;
    conversationId?: string;
    messages?: ChatMessage[];
    userId?: string;
  }): Promise<ChatResponse> {
    const { message, conversationId, messages = [], userId = 'anonymous' } = chatDto;

    // 构建消息列表（如果客户端未提供历史，则只发送当前消息）
    let messageList: ChatMessage[] = [];
    
    if (messages && messages.length > 0) {
      // 使用客户端提供的历史消息
      messageList = messages;
    } else if (conversationId) {
      // 从数据库加载历史对话
      const conversation = await this.conversationService.getConversation(conversationId);
      messageList = conversation.messages;
    }

    // 添加当前用户消息
    messageList.push({
      role: 'user',
      content: message,
    });

    // 调用 Hy3 API
    const reply = await this.hy3Client.chat(messageList, {
      temperature: 0.7,
      maxTokens: 2000,
    });

    // 添加 AI 回复到消息列表
    const updatedMessages: ChatMessage[] = [
      ...messageList,
      {
        role: 'assistant',
        content: reply,
      },
    ];

    // 保存或更新对话记录
    const savedConversation = await this.conversationService.saveConversation(
      userId,
      updatedMessages,
      conversationId,
    );

    return {
      conversationId: savedConversation.id,
      reply,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取对话列表
   */
  async getConversations() {
    return this.conversationService.getConversations();
  }

  /**
   * 获取对话详情
   */
  async getConversation(id: string) {
    return this.conversationService.getConversation(id);
  }

  /**
   * 删除对话
   */
  async deleteConversation(id: string) {
    return this.conversationService.deleteConversation(id);
  }

  /**
   * 清空所有对话
   */
  async clearConversations() {
    return this.conversationService.clearConversations();
  }
}
