import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CapabilityRef } from '@kedouai/agent-core';

class CapabilityDto implements CapabilityRef {
  @IsString()
  @IsNotEmpty()
  type: 'tool' | 'mcp' | 'skill';

  @IsString()
  @IsNotEmpty()
  ref: string;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

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

  /** 能力数组（tool/mcp/skill）。可选：不传时后端从 tools 派生（兼容旧前端） */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapabilityDto)
  capabilities?: CapabilityRef[];

  @IsInt()
  @Min(1)
  maxSteps: number;

  @IsOptional()
  @IsNumber()
  temperature?: number | null;

  @ValidateNested()
  @Type(() => MemoryDto)
  memory: MemoryDto;

  /** 是否流式输出（默认 true） */
  @IsOptional()
  @IsBoolean()
  streaming?: boolean;
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
