import { IsInt, IsIn, IsOptional, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 对话列表查询参数。
 *
 * source / agentId（2026-09-23 新增，见 specs/conversation-source-filter/design.md）：
 * 工具页（翻译 / 合翻）的会话以 source='tool' 落库（不进主对话流），
 * 读取侧需要按「来源 + 能力」各自取记录；默认 source='chat' 保持既有行为不变。
 */
export class ListConversationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  @Min(1, { message: 'page 最小为 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须是整数' })
  @Min(1, { message: 'pageSize 最小为 1' })
  @Max(50, { message: 'pageSize 最大为 50' })
  pageSize: number = 20;

  /** 会话来源：chat=主对话（默认） / tool=工具页 */
  @IsOptional()
  @IsIn(['chat', 'tool'], { message: 'source 只能是 chat 或 tool' })
  source: 'chat' | 'tool' = 'chat';

  /** 按能力过滤（如 translate / contract-risk）；空串按未传处理 */
  @IsOptional()
  @MaxLength(64, { message: 'agentId 长度不能超过 64' })
  agentId?: string;
}
