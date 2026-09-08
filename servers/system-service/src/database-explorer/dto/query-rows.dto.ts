import { IsOptional, IsInt, Min, Max, IsString, Matches, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

/** 分页查询表数据 */
export class QueryRowsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** 单页上限 200，与 SQL 控制台的 MAX_ROWS 对齐 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  /** 排序列：仅允许字母数字下划线，服务端还会校验其属于该表列 */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_]+$/, { message: '排序列名不合法' })
  sortField?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
