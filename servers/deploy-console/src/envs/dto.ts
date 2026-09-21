import { IsString, IsOptional, IsInt, IsBoolean, IsIn, Length, Matches, Min } from 'class-validator';

/**
 * 环境域 DTO（双域重构 P1）
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2 / §4.1
 */

/** 新建环境：envId 由系统自增，用户只填名称 + 归属站点（FR-3.2） */
export class CreateEnvDto {
  @IsString()
  @Length(1, 64)
  name: string;

  /** 归属站点 key */
  @IsString()
  @Matches(/^[a-z0-9_-]+$/, { message: '站点 key 只能是小写字母/数字/下划线/中划线' })
  siteKey: string;
}

/** 更新环境：**不允许改 envId 与 siteKey**（目录名与归属站点是稳定标识） */
export class UpdateEnvDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 更新某环境下某服务的"指向"（主机必填，防静默回落 localhost —— B4 / FR-3.7） */
export class UpdateServiceRouteDto {
  @IsString()
  @Length(1, 64)
  hostName: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  port?: number;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  upstreamUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  replicas?: number;

  @IsOptional()
  @IsIn(['pm2', 'docker'])
  runtime?: 'pm2' | 'docker';

  @IsOptional()
  @IsString()
  @Length(0, 128)
  healthPath?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 环境切换上报（Q110 审计） */
export class EnvSwitchLogDto {
  @IsString()
  @Length(1, 64)
  envId: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  siteKey?: string;
}
