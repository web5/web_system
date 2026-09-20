import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * 接口清单（API 网关域，方法 + 路径级）★ 本次新增核心
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3
 * - 粒度：HTTP 方法 + 路径模式（支持 `:id` 占位符，FR-6.2）
 * - 与转发规则解耦：改本表**不改变转发行为**（FR-6.6）
 * - 导入幂等依据：UNIQUE(serviceKey, method, pathPattern)（FR-6.5）
 */
@Entity('deploy_endpoints')
@Unique(['serviceKey', 'method', 'pathPattern'])
export class DeployEndpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '服务 key' })
  @Index()
  serviceKey: string;

  @Column({
    type: 'varchar',
    length: 8,
    comment: 'HTTP 方法 GET/POST/PUT/PATCH/DELETE/ALL',
  })
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';

  /** 路径模式（如 /api/todo/:id） */
  @Column({ type: 'varchar', length: 255, comment: '路径模式' })
  pathPattern: string;

  /** 业务码（可选） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '业务码' })
  code?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '摘要' })
  summary?: string | null;

  /** 鉴权模式（inherit = 继承服务默认） */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'inherit',
    comment: '鉴权模式 inherit/passthrough/jwt/service_key/none',
  })
  authMode: 'inherit' | 'passthrough' | 'jwt' | 'service_key' | 'none';

  /** 权限码（对接 @web-system/types） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '权限码' })
  permissionCode?: string | null;

  @Column({ type: 'int', nullable: true, comment: '限流（次/分）' })
  rateLimitPerMin?: number | null;

  @Column({ type: 'int', nullable: true, comment: '超时覆盖（毫秒）' })
  timeoutMs?: number | null;

  @Column({ type: 'boolean', default: false, comment: '是否废弃' })
  deprecated: boolean;

  /** 来源（便于导入时不覆盖人工配置） */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'manual',
    comment: '来源 manual/openapi/scan',
  })
  source: 'manual' | 'openapi' | 'scan';

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
