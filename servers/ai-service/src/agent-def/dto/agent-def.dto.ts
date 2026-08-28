import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class MemoryDto {
  @IsInt()
  @Min(1)
  compactionThreshold: number;

  @IsInt()
  @Min(1)
  keepRecent: number;

  @IsBoolean()
  enabled: boolean;
}

/** 新建 / 编辑 Agent 定义 */
export class SaveAgentDefDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  systemPrompt: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsArray()
  @IsString({ each: true })
  tools: string[];

  @IsInt()
  @Min(1)
  maxSteps: number;

  @IsOptional()
  @IsNumber()
  temperature?: number | null;

  @ValidateNested()
  @Type(() => MemoryDto)
  memory: MemoryDto;
}

/** 启用/停用 */
export class SetEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

/** 发布 */
export class PublishDto {
  @IsOptional()
  @IsString()
  changeNote?: string;
}

/** 回滚 */
export class RollbackDto {
  @IsString()
  @IsNotEmpty()
  versionId: string;
}
