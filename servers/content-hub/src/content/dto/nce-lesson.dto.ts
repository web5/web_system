/** 课文只读接口的查询/路径参数 DTO（全局 ValidationPipe 已开 whitelist + transform）。 */
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListNceLessonsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  /** 课号或中英文标题模糊匹配 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  book?: string;
}

export class NceLessonIdDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(96)
  id: number;
}
