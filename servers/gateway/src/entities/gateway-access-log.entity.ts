import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/**
 * 网关访问日志：网关作为唯一入口，记录每次请求的方法/路径/上游状态/耗时，用于可观测与排障。
 * 高写入量、只追加；建议异步落库（fire-and-forget），并按时间分表或定期归档。
 * 接入方式（后续）：在 proxy.controller 各路由方法里异步写入一条。
 */
@Entity('gateway_access_logs')
export class GatewayAccessLogEntity extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '访问日志 ID' })
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '链路追踪 ID' })
  traceId: string | null;

  @Column({ type: 'varchar', length: 8, comment: 'HTTP 方法 GET/POST/...' })
  method: string;

  @Index()
  @Column({ type: 'varchar', length: 512, comment: '请求路径' })
  path: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '命中的路由编码' })
  routeCode: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '客户端 IP' })
  clientIp: string | null;

  /** 来自 JWT 的 sub（用户 ID），字符串以兼容 mysql2 BIGINT 返回；匿名为 NULL */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '用户 ID（JWT sub），匿名为 NULL' })
  userId: string | null;

  @Column({ type: 'int', nullable: true, comment: '上游服务返回的 HTTP 状态' })
  upstreamStatus: number | null;

  @Column({ type: 'int', comment: '网关最终返回的 HTTP 状态' })
  gatewayStatus: number;

  @Column({ type: 'int', unsigned: true, comment: '请求耗时（毫秒）' })
  latencyMs: number;

  @Index()
  @Column({ type: 'datetime', precision: 6, comment: '请求接收时间' })
  requestAt: Date;
}
