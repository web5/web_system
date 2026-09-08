import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * CI/CD 触发端点的发布意图。
 *
 * 只承载「发什么、发到哪」，**不含任何脚本或命令** ——
 * 执行体始终由平台流水线决定（保留锁 / 审批 / 审计 / 回滚），
 * CI 侧无权指定执行内容，避免绕过发布治理。
 */
export class ReleaseHookDto {
  /** 幂等键：GitHub 用 X-GitHub-Delivery，其它系统自生成唯一 ID */
  @IsString()
  @MaxLength(128)
  deliveryId: string;

  @IsIn(['local', 'dev', 'staging', 'prod'])
  env: string;

  /** 模块 key：与发布白名单一致（禁空格/引号/分号，防命令注入） */
  @Matches(/^[A-Za-z0-9._-]{1,64}$/)
  moduleKey: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._/-]{1,128}$/)
  branch?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{4,64}$/)
  commitId?: string;

  @IsOptional()
  @IsIn(['direct', 'grayscale'])
  mode?: string;

  @IsOptional()
  @IsIn(['local', 'remote'])
  target?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  event?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  source?: string;
}
