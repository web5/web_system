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
 * 创建/更新环境 DTO（服务器连接信息已下沉到 servers，不再含 host/ssh）
 */
export class EnvironmentDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  publicUrl?: string;

  @IsOptional()
  ports?: Record<string, string>;

  @IsBoolean()
  @IsOptional()
  builtin?: boolean;
}

/**
 * 创建/更新模块 DTO（模块注册表）
 */
export class ModuleDto {
  @IsString()
  key: string;

  @IsString()
  name: string;

  /** backend | frontend | micro-frontend | mini-app */
  @IsString()
  type: string;

  @IsString()
  dir: string;

  @IsString()
  @IsOptional()
  pm2?: string;

  @IsString()
  @IsOptional()
  publicPath?: string;

  @IsString()
  @IsOptional()
  buildCmd?: string;

  /** 默认部署环境（发布/监控/诊断入口默认选中；可改） */
  @IsString()
  @IsOptional()
  defaultEnv?: string;

  @IsString()
  @IsOptional()
  entry?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * 发布指定版本 DTO（版本库任选，秒级切换）
 */
export class PublishVersionDto {
  @IsString()
  env: string;

  @IsString()
  versionTag: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

/**
 * 微前端模块发布 DTO
 */
export class PublishModuleDto {
  @IsString()
  env: string;

  @IsString()
  moduleKey: string;

  @IsString()
  @IsOptional()
  branch?: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

/**
 * 登录请求 DTO
 */
export class LoginDto {  @IsString()
  username: string;

  @IsString()
  password: string;
}

/**
 * 审计日志查询 DTO
 */
export class AuditQueryDto {  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}

/**
 * 服务器 DTO（serverName 服务器组，多台服务器共享同名）
 */
export class ServerDto {
  @IsString()
  serverName: string;

  @IsString()
  host: string;

  @IsString()
  sshUser: string;

  @IsString()
  @IsOptional()
  sshKeyPath?: string;

  @IsString()
  remoteDir: string;
}

/**
 * 环境服务路由 DTO（每环境独立定义「服务名 → serverName」）
 */
export class EnvServiceRouteDto {
  @IsString()
  envId: string;

  @IsString()
  serviceName: string;

  @IsString()
  serverName: string;

  @IsInt()
  @IsOptional()
  port?: number;
}
