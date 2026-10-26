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

  /**
   * 运行场景（N3 装配侧过滤，2026-10-26）：
   * - 'c-end'（缺省）：C 端无 HITL 确认 UI，requiresConfirm 工具不进工具清单
   * - 'admin'：调试台有确认 UI，不过滤
   *
   * 安全侧默认：不传按 c-end 处理（宁可过滤掉工具，也不要「调了才发现要确认」挂 60s）。
   */
  @IsOptional()
  @IsIn(['c-end', 'admin'], { message: 'scene 只能是 c-end 或 admin' })
  scene?: 'c-end' | 'admin';
}
