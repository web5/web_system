import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** 事实类型（与实体 FactKind 对齐；DTO 不引实体，避免接口层耦合 ORM） */
export const FACT_KINDS = ['version', 'dir', 'process', 'port'] as const;

/** env 参与静态根配置键拼接（`STATIC_PUBLIC_ROOT_<ENV>`），必须白名单 */
const ENV_RE = /^[a-zA-Z0-9_-]+$/;

export class FactQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ENV_RE, { message: 'env 仅允许字母、数字、下划线和连字符' })
  env?: string;

  @IsOptional()
  @IsIn(FACT_KINDS, { message: `kind 只能是 ${FACT_KINDS.join('/')}` })
  kind?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class FactCollectDto {
  @IsOptional()
  @IsString()
  @Matches(ENV_RE, { message: 'env 仅允许字母、数字、下划线和连字符' })
  env?: string;
}
