import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsIn,
  IsArray,
  Length,
  Matches,
} from 'class-validator';

/**
 * 应用域 DTO（双域重构 P1）
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2 / §4.2
 */

export const APP_KINDS = ['shell', 'micro-frontend', 'spa', 'mini-app'] as const;
export const APP_DEPLOY_MODES = ['env-dir', 'site-version'] as const;

/** 新建应用：key 创建后不可改（gateway manifest 依赖） */
export class CreateAppDto {
  @IsString()
  @Length(2, 64)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: '应用 key 只能是小写字母/数字/下划线/中划线，且以字母或数字开头',
  })
  key: string;

  @IsString()
  @Length(1, 128)
  name: string;

  @IsOptional()
  @IsIn(APP_KINDS as unknown as string[])
  kind?: (typeof APP_KINDS)[number];

  /** 父应用 key（子模块归属；仅分组展示用，不做强制层级） */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  parentKey?: string;

  @IsString()
  @Length(1, 128)
  repoDir: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  entry?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  publicPath?: string;

  @IsOptional()
  @IsArray()
  externals?: string[];

  @IsOptional()
  @IsIn(APP_DEPLOY_MODES as unknown as string[])
  deployMode?: (typeof APP_DEPLOY_MODES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;
}

/** 更新应用：**不含 key**（key 不可改） */
export class UpdateAppDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  repoDir?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  entry?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  publicPath?: string;

  @IsOptional()
  @IsArray()
  externals?: string[];

  @IsOptional()
  @IsIn(APP_DEPLOY_MODES as unknown as string[])
  deployMode?: (typeof APP_DEPLOY_MODES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** shell 挂载路由（保存只改配置、不触发发布） */
export class AppRouteDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^\//, { message: '挂载路径必须以 / 开头' })
  mountPath: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  activeRule?: string;

  @IsOptional()
  @IsBoolean()
  requireAuth?: boolean;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 投递并激活到某环境的某版本（构建产物取 apps/<repoDir>/dist） */
export class PublishAppDto {
  @IsString()
  @Length(1, 64)
  envId: string;

  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: '版本标签只允许字母/数字/._-' })
  version: string;
}

/** 切换版本（不重新构建，只改指针） */
export class SwitchEnvVersionDto {
  @IsString()
  @Length(1, 64)
  envId: string;

  @IsString()
  @Length(1, 128)
  version: string;
}

/** 回滚（不传 version 时回到 previousVersion） */
export class RollbackVersionDto {
  @IsString()
  @Length(1, 64)
  envId: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  version?: string;
}
