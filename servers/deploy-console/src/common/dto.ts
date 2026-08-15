import { IsString, IsBoolean, IsOptional, IsEnum, IsInt, Min } from 'class-validator';

/**
 * 环境枚举
 */
export type Env = 'dev' | 'prod';

/**
 * 构建请求 DTO
 */
export class BuildDto {
  @IsString()
  component: string;
}

/**
 * 部署请求 DTO
 * env 为环境 ID（dev/prod 或自定义），不再限定枚举
 */
export class DeployDto {
  @IsString()
  env: string;

  @IsString()
  component: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

/**
 * 回滚请求 DTO
 */
export class RollbackDto {
  @IsString()
  env: string;

  @IsString()
  tag: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

/**
 * 配置文件更新 DTO
 */
export class FileUpdateDto {
  @IsString()
  env: string;

  @IsString()
  name: string;

  @IsString()
  content: string;
}

/**
 * 创建/更新环境 DTO
 */
export class EnvironmentDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  host: string;

  @IsString()
  sshUser: string;

  @IsString()
  @IsOptional()
  sshKeyPath?: string;

  @IsString()
  remoteDir: string;

  @IsString()
  @IsOptional()
  publicUrl?: string;

  @IsOptional()
  ports?: Record<string, number>;

  @IsBoolean()
  @IsOptional()
  builtin?: boolean;
}

/**
 * 登录请求 DTO
 */
export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

/**
 * 审计日志查询 DTO
 */
export class AuditQueryDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}
