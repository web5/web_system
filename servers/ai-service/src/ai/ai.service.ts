import { Injectable, Logger } from '@nestjs/common';
import { Hy3Client, ChatMessage } from '../common/http/hy3.client';
import { ImageGenClient } from '../common/http/image-gen.client';
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
    private readonly imageGenClient: ImageGenClient,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * 处理用户对话
   */
  // 少儿教育系统提示词
  private readonly SYSTEM_PROMPT: ChatMessage = {
    role: 'system',
    content: `你是科豆 AI 学习助手，专为 6-15 岁少儿提供教育辅导。
你的特点：
- 用简单易懂、生动有趣的语言回答问题
- 回答要耐心、鼓励性，多用比喻和例子
- 对于数学/科学问题，分步骤讲解
- 回答控制在 500 字以内，简洁明了
- 避免涉及暴力、政治、成人等不适合少儿的内容
- 如果问题涉及不适当内容，温和地引导到学习话题
- 适当使用 emoji 让对话更有趣
你的目标：激发孩子的学习兴趣，帮助他们爱上探索知识。`,
  };

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
      // 使用客户端提供的历史消息（但不重复添加 system prompt）
      messageList = messages;
      // 如果历史消息中没有 system prompt，在前面添加
      if (!messageList.some((m) => m.role === 'system')) {
        messageList = [this.SYSTEM_PROMPT, ...messageList];
      }
    } else if (conversationId) {
      // 从数据库加载历史对话
      const conversation = await this.conversationService.getConversation(conversationId);
      messageList = conversation.messages;
      // 如果历史消息中没有 system prompt，在前面添加
      if (!messageList.some((m) => m.role === 'system')) {
        messageList = [this.SYSTEM_PROMPT, ...messageList];
      }
    } else {
      // 新对话：添加 system prompt
      messageList = [this.SYSTEM_PROMPT];
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

  /**
   * 提交图片生成任务
   */
  async submitImageGeneration(prompt: string) {
    return this.imageGenClient.submit(prompt);
  }

  /**
   * 查询图片生成结果
   */
  async queryImageGeneration(id: string) {
    return this.imageGenClient.query(id);
  }
}
