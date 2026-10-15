import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * `release_plan` 入参校验。
 *
 * 白名单口径刻意与流水线提交保持一致（env 参与静态根配置键拼接、moduleKey 与
 * 产物目录相关、versionTag 会进 git 命令），避免出现两个入口两套字符集约束。
 */
const ENV_RE = /^[a-zA-Z0-9_-]+$/;
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** 允许完整版本引用（`namespace/commit`）与纯 commit */
const VERSION_RE = /^[A-Za-z0-9._/-]{1,128}$/;

export const RELEASE_PLAN_MODES = ['direct', 'grayscale'] as const;

export class ReleasePlanDto {
  @IsString()
  @Matches(ENV_RE, { message: 'env 仅允许字母、数字、下划线和连字符' })
  env: string;

  @IsString()
  @Matches(KEY_RE, { message: 'moduleKey 仅允许字母、数字、点、下划线和连字符' })
  moduleKey: string;

  @IsOptional()
  @IsString()
  @Matches(VERSION_RE, { message: 'versionTag 含非法字符' })
  versionTag?: string;

  @IsOptional()
  @IsIn(RELEASE_PLAN_MODES, { message: `mode 只能是 ${RELEASE_PLAN_MODES.join('/')}` })
  mode?: string;

  @IsOptional()
  @IsString()
  grayscaleRule?: string;
}
