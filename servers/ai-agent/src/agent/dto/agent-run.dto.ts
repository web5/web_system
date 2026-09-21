import { IsString, IsOptional, IsUUID, IsIn, MaxLength } from 'class-validator';

export class AgentRunDto {
  /**
   * 省略 / 传 'auto' = 由服务端意图路由决定（见 IntentService）。
   * 显式传入（如 'contract-risk'）时行为与改动前完全一致 —— 向后兼容。
   */
  @IsOptional()
  @IsString({ message: 'agentId 必须是字符串' })
  agentId?: string;

  @IsString({ message: 'userInput 必须是字符串' })
  @MaxLength(8000, { message: 'userInput 过长（上限 8000 字符）' })
  userInput: string;

  @IsOptional()
  @IsUUID('4', { message: 'conversationId 必须是 UUID' })
  conversationId?: string;

  /** 临时覆盖模型（仅本次运行生效，不修改 Agent 定义） */
  @IsOptional()
  @IsString({ message: 'model 必须是字符串' })
  @MaxLength(64, { message: 'model 过长' })
  model?: string;

  /**
   * 会话来源：主对话**不传**（默认 chat）；工具页（翻译 / 合同评估）传 'tool'。
   * 标记后该会话不会出现在「对话记录」列表 —— 工具页各有各的历史入口。
   */
  @IsOptional()
  @IsIn(['chat', 'tool'], { message: 'source 只能是 chat 或 tool' })
  source?: 'chat' | 'tool';
}
