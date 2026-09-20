import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsIn,
  IsArray,
  ValidateNested,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * API 网关域 DTO（双域重构 P2）
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3 / §4.3
 */

export const SERVICE_KINDS = ['nest', 'express', 'mcp', 'static'] as const;
export const ENDPOINT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL'] as const;
export const ENDPOINT_AUTH_MODES = ['inherit', 'passthrough', 'jwt', 'service_key', 'none'] as const;
export const ROUTE_AUTH_MODES = ['passthrough', 'service_key', 'jwt'] as const;

/** 新建服务：key 创建后不可改（流水线历史记录与网关路由都按 key 关联） */
export class CreateServiceDto {
  @IsString()
  @Length(2, 64)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: '服务 key 只能是小写字母/数字/下划线/中划线，且以字母或数字开头',
  })
  key: string;

  @IsString()
  @Length(1, 128)
  name: string;

  @IsOptional()
  @IsIn(SERVICE_KINDS as unknown as string[])
  kind?: (typeof SERVICE_KINDS)[number];

  /** 仓库目录（servers/<dir>） */
  @IsString()
  @Length(1, 128)
  repoDir: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  pm2Name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultPort?: number;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  healthPath?: string;

  @IsOptional()
  @IsIn(['allow', 'deny'])
  unknownPolicy?: 'allow' | 'deny';

  @IsOptional()
  @IsIn(['managed', 'legacy'])
  deployChannel?: 'managed' | 'legacy';

  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;
}

/** 更新服务：**不含 key** */
export class UpdateServiceDto {
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
  pm2Name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultPort?: number;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  healthPath?: string;

  @IsOptional()
  @IsIn(['allow', 'deny'])
  unknownPolicy?: 'allow' | 'deny';

  @IsOptional()
  @IsIn(['managed', 'legacy'])
  deployChannel?: 'managed' | 'legacy';

  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 网关转发规则（前缀级） */
export class ServiceRouteDto {
  /** 空 = 全环境默认；有值 = 该环境覆盖 */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  envId?: string;

  @IsString()
  @Length(1, 128)
  @Matches(/^\//, { message: '路径前缀必须以 / 开头' })
  pathPrefix: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  stripPrefix?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  rewriteTo?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  upstreamOverride?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  timeoutMs?: number;

  @IsOptional()
  @IsIn(ROUTE_AUTH_MODES as unknown as string[])
  authMode?: (typeof ROUTE_AUTH_MODES)[number];

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 接口（方法 + 路径级） */
export class EndpointDto {
  @IsIn(ENDPOINT_METHODS as unknown as string[])
  method: (typeof ENDPOINT_METHODS)[number];

  @IsString()
  @Length(1, 255)
  @Matches(/^\//, { message: '接口路径必须以 / 开头' })
  pathPattern: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  summary?: string;

  @IsOptional()
  @IsIn(ENDPOINT_AUTH_MODES as unknown as string[])
  authMode?: (typeof ENDPOINT_AUTH_MODES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 128)
  permissionCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  rateLimitPerMin?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  timeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  deprecated?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 批量导入接口。
 * 语义：**UPSERT 只补空字段** —— 已存在且字段非空的一律保留（人工配置优先，FR-6.5）。
 */
export class ImportEndpointsDto {
  @IsOptional()
  @IsIn(['manual', 'openapi', 'scan'])
  source?: 'manual' | 'openapi' | 'scan';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EndpointDto)
  items: EndpointDto[];
}

/** 手动探活 */
export class ProbeHealthDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  envId?: string;
}

/**
 * 部署动作（**与「构建发布」分离**）：重启进程 + 探活。
 * 环境必填 —— 部署是**面向某个环境**的动作（不同环境指向不同主机/进程）。
 */
export class DeployServiceDto {
  @IsString()
  @Length(1, 64)
  envId: string;
}
