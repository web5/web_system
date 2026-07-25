import { Injectable, Logger } from '@nestjs/common';
import { DeepseekClient } from '../common/http/deepseek.client';
import { Hy3Client } from '../common/http/hy3.client';
import { ImageGenClient } from '../common/http/image-gen.client';
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk, ModelInfo } from '../common/http/base-ai.client';
import { ConversationService } from '../conversation/conversation.service';
import { ChatDto } from './dto/chat.dto';
import { ImageSubmitDto, ImageQueryDto } from './dto/image-gen.dto';

const SYSTEM_PROMPT = `你是科豆 AI 学习助手。你热情、友善、有耐心，像一位陪伴小朋友探索世界的好朋友。你的回答应当简洁易懂，适合少儿阅读。如果遇到不确定的问题，如实告诉小朋友，并鼓励他们保持好奇心。

【英语教学规则】当小朋友想要学英语或涉及英语内容时，你需要用中文解释，并把所有英语句子和英语短语用 [en]...[/en] 标记包裹起来。正确的示例：

[en]Hello![/en] 你好！[en]My name is Xiao Ming.[/en] 我的名字是小明。[en]I am 8 years old.[/en] 我今年 8 岁。[en]I like playing basketball and reading books.[/en] 我喜欢打篮球和看书。

注意：每个完整的英语句子或英语短语单独用一对 [en]...[/en] 包裹，标签内只放英语，不要混入中文。`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /** 模型客户端注册表 */
  private readonly clientRegistry: Map<string, BaseAiClient> = new Map();

  constructor(
    private readonly deepseekClient: DeepseekClient,
    private readonly hy3Client: Hy3Client,
    private readonly imageGenClient: ImageGenClient,
    private readonly conversationService: ConversationService,
  ) {
    this.buildRegistry();
  }

  /** 注册所有客户端 */
  private buildRegistry(): void {
    this.register(this.deepseekClient);
    this.register(this.hy3Client);
    this.logger.log(
      `AI clients registered: ${Array.from(this.clientRegistry.keys()).join(', ')}`,
    );
  }

  private register(client: BaseAiClient): void {
    this.clientRegistry.set(client.modelId, client);
  }

  /** 获取可用模型列表 */
  getAvailableModels(): ModelInfo[] {
    return Array.from(this.clientRegistry.values()).map((c) => c.getModelInfo());
  }

  /** 默认模型 ID（第一个可用的） */
  getDefaultModel(): string | null {
    const available = this.getAvailableModels().find((m) => m.available);
    if (!available) return null;

    // 优先 DeepSeek
    const deepseek = this.clientRegistry.get('deepseek-v4-flash');
    if (deepseek && deepseek.isAvailable()) return 'deepseek-v4-flash';

    return available.id;
  }

  /** 根据模型 ID 获取客户端，不存在或不可用时回退到默认 */
  private getClient(modelId?: string): { client: BaseAiClient; modelId: string } {
    if (modelId && this.clientRegistry.has(modelId)) {
      const client = this.clientRegistry.get(modelId)!;
      if (client.isAvailable()) {
        return { client, modelId };
      }
      this.logger.warn(`Requested model ${modelId} is not available, falling back to default`);
    }

    const defaultModel = this.getDefaultModel();
    if (!defaultModel) {
      throw new Error('没有可用的 AI 模型，请检查 API Key 配置');
    }

    const client = this.clientRegistry.get(defaultModel)!;
    return { client, modelId: defaultModel };
  }

  /** 构建消息列表 */
  private buildMessages(chatDto: ChatDto): ChatMessage[] {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(chatDto.messages || []).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];
  }

  private buildOptions(chatDto: ChatDto): ChatOptions {
    return {
      temperature: chatDto.temperature,
      maxTokens: chatDto.maxTokens,
    };
  }

  /** 非流式对话 */
  async chat(chatDto: ChatDto): Promise<{ content: string; model: string; conversationId: string }> {
    const { client, modelId } = this.getClient(chatDto.model);
    const messages = this.buildMessages(chatDto);
    const options = this.buildOptions(chatDto);

    this.logger.log(`Chat using model: ${modelId}`);
    const content = await client.chat(messages, options);

    // 保存对话（含全部消息历史 + AI 回复）
    const chatMessages: ChatMessage[] = (chatDto.messages || []).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));
    const allMessages: ChatMessage[] = [
      ...chatMessages,
      { role: 'assistant', content },
    ];
    const saved = await this.conversationService.saveConversation('1', allMessages, chatDto.conversationId);

    return { content, model: modelId, conversationId: saved.id };
  }

  /** 流式对话 */
  async chatStream(chatDto: ChatDto): Promise<{
    stream: AsyncGenerator<StreamChunk & { model?: string; conversationId?: string }>;
    fullReply: Promise<string>;
    conversationId: string;
  }> {
    const { client, modelId } = this.getClient(chatDto.model);
    const messages = this.buildMessages(chatDto);
    const options = this.buildOptions(chatDto);

    this.logger.log(`ChatStream using model: ${modelId}`);

    // --- 先创建或获取对话 ID，后续 SSE 中带上，前端不再依赖 loadConversations ---
    let conversationId = chatDto.conversationId;
    if (!conversationId) {
      // 新对话：先保存用户消息，拿到 conversationId 立即返回给前端
      const userMessages: ChatMessage[] = (chatDto.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }));
      const saved = await this.conversationService.saveConversation('1', userMessages);
      conversationId = saved.id;
    }

    let fullReplyContent = '';
    let resolveFullReply: (value: string) => void;
    const fullReplyPromise = new Promise<string>((resolve) => {
      resolveFullReply = resolve;
    });

    const sourceStream = client.chatStream(messages, options);

    const wrappedStream = async function* (): AsyncGenerator<StreamChunk & { model?: string; conversationId?: string }> {
      try {
        for await (const chunk of sourceStream) {
          if (chunk.content) fullReplyContent += chunk.content;
          yield { ...chunk, model: modelId, conversationId };
        }
      } catch (error) {
        Logger.error(`Stream error for model ${modelId}: ${error.message}`);
        yield { content: `\n\n[模型 ${modelId} 流式输出中断：${error.message}]`, done: true, model: modelId, conversationId };
      } finally {
        resolveFullReply(fullReplyContent);
      }
    };

    const stream = wrappedStream();

    // 流结束后，用完整的消息记录替换对话内容
    fullReplyPromise.then(async (fullReply) => {
      if (!fullReply) return;
      const chatMessages: ChatMessage[] = (chatDto.messages || []).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));
      const allMessages: ChatMessage[] = [
        ...chatMessages,
        { role: 'assistant', content: fullReply },
      ];
      await this.conversationService.saveConversation('1', allMessages, conversationId);
    });

    return { stream, fullReply: fullReplyPromise, conversationId };
  }

  /** 获取对话列表 */
  async getConversations(userId?: string) {
    return this.conversationService.getConversations(userId);
  }

  /** 获取对话详情 */
  async getConversation(id: string) {
    return this.conversationService.getConversation(id);
  }

  /** 删除对话 */
  async deleteConversation(id: string): Promise<void> {
    return this.conversationService.deleteConversation(id);
  }

  /** 提交图片生成任务 */
  async submitImage(submitDto: ImageSubmitDto) {
    const result = await this.imageGenClient.submit(submitDto.prompt);
    return {
      id: result.id,
      created: result.created,
    };
  }

  /** 查询图片生成结果 */
  async queryImage(queryDto: ImageQueryDto) {
    return this.imageGenClient.query(queryDto.id);
  }
}
