import { Transform, Type } from 'class-transformer';
import { IsOptional, IsNumber, IsIn, IsString } from 'class-validator';

// 把空字符串转为 undefined（class-validator @IsOptional 默认不跳过空串）
const EmptyToUndef = () =>
  ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class QueryTodoDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pageSize?: number = 20;

  @IsOptional()
  @Transform(EmptyToUndef())
  @IsIn(['pending', 'in_progress', 'completed', 'overdue', 'cancelled'])
  status?: string;

  @IsOptional()
  @Transform(EmptyToUndef())
  @IsIn(['low', 'medium', 'high'])
  priority?: string;

  @IsOptional()
  @Transform(EmptyToUndef())
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(EmptyToUndef())
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  sortBy?: string = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
