import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CapabilityRef, ThinkingOption } from '@kedouai/agent-core';

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

/**
 * 思考预算覆盖（C7 生成参数）。
 * 与 `temperature` 的互斥不在这里判（class-validator 跨字段校验写起来别扭），
 * 由 `AgentDefService.assertTuningParams()` 统一给出中文报错。
 */
class ThinkingDto implements ThinkingOption {
  @IsString()
  @IsIn(['enabled', 'disabled'])
  type: 'enabled' | 'disabled';

  /** type='enabled' 时的思考 token 上限 */
  @IsOptional()
  @IsInt()
  @Min(1)
  budget_tokens?: number;
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

  /**
   * 路由线索：适用场景描述（AgentDefService 会落 description 列）。
   *
   * 🔴 白名单陷阱：main.ts 的 ValidationPipe 是 `whitelist + forbidNonWhitelisted`，
   * DTO 没声明的字段会被拒成 400。admin 表单 `defaultAgentForm()` 恒定带
   * `description: ''` / `keywords: []`，所以这两个字段必须在此声明，
   * 否则「新建 / 保存草稿」两条路径 100% 返回 code 4000。
   */
  @IsOptional()
  @IsString()
  description?: string | null;

  /** 路由线索：触发关键词（落 keywords 列；空数组 = 清空） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[] | null;

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

  /** 采样温度；与 topP 互斥（同填会被 service 层拒绝） */
  @IsOptional()
  @IsNumber()
  temperature?: number | null;

  /** 输出 token 上限（防跑飞） */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTokens?: number | null;

  /** 核采样 top_p；与 temperature 互斥 */
  @IsOptional()
  @IsNumber()
  topP?: number | null;

  /** 思考预算覆盖（null / 不传 = 沿用客户端默认） */
  @IsOptional()
  @ValidateNested()
  @Type(() => ThinkingDto)
  thinking?: ThinkingOption | null;

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
