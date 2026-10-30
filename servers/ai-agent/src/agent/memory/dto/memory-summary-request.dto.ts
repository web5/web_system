import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** 单条记忆明细（生成摘要的原料） */
export class MemorySummaryItemDto {
  @IsString()
  category: string;

  @IsString()
  content: string;
}

/** POST /internal/llm/memory-summary 入参 */
export class MemorySummaryRequestDto {
  /** 调用方为服务间（无用户态），仅用于日志追踪 */
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  namespace?: string;

  /** 明细总条数（写入摘要「统计」行的口径，由调用方保证与 items 一致） */
  @IsInt()
  itemCount: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemorySummaryItemDto)
  items: MemorySummaryItemDto[];
}
