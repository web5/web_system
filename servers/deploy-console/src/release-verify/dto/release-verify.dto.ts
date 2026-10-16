import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/**
 * `verify_release` 入参校验。
 *
 * 字符集口径与 `release_plan` / 流水线提交保持一致（env 参与静态根配置键拼接、
 * moduleKey 对应产物目录、versionTag 会进 git 命令），不引入第二套约束。
 * 若此处收紧，就会出现"流水线能发的版本，verify 却说不合法"的割裂。
 */
const ENV_RE = /^[a-zA-Z0-9_-]+$/;
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
const VERSION_RE = /^[A-Za-z0-9._/-]{1,128}$/;
const JOB_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class ReleaseVerifyDto {
  @IsString()
  @Matches(ENV_RE, { message: 'env 仅允许字母、数字、下划线和连字符' })
  env: string;

  @IsString()
  @Matches(KEY_RE, { message: 'moduleKey 仅允许字母、数字、点、下划线和连字符' })
  moduleKey: string;

  /**
   * 目标版本。不传则回落为该环境当前线上指针 —— 那是"确认现状"而非"验证发布"，
   * 报告里的 `expected.source` 会标明，避免被误读成发布生效的证据。
   */
  @IsOptional()
  @IsString()
  @Matches(VERSION_RE, { message: 'versionTag 含非法字符' })
  versionTag?: string;

  /** 关联流水线；传了才会校验流水线状态这项 */
  @IsOptional()
  @IsString()
  @Matches(JOB_RE, { message: 'jobId 含非法字符' })
  jobId?: string;

  /** 严格模式：非核心项失败也判 failed。默认 false */
  @IsOptional()
  @IsBoolean()
  strict?: boolean;
}
