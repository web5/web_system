import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean } from 'class-validator';

/** 新建 / 编辑技能 */
export class SaveSkillDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  version?: string;

  /** SKILL.md 正文 */
  @IsString()
  content: string;

  /** 依赖工具：本地工具名 或 mcp:module/tool */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredTools?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 导入 zip 后 frontmatter 解析结果 */
export interface ParsedSkillFile {
  code: string;
  name: string;
  description: string;
  version: string;
  content: string;
}
