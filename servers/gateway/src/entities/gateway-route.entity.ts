import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/**
 * 网关路由配置：将 proxy.service.ts 中硬编码的路由表外置为可配置数据。
 * 字段与 createProxy 的 target / pathRewrite / timeout 一一对应。
 * 接入方式（后续）：ProxyService 启动时从本表加载路由，替换硬编码常量。
 */
@Entity('gateway_routes')
export class GatewayRouteEntity extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '路由 ID' })
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, comment: '路由内部编码，如 auth/users/ai/mcp/finnews' })
  routeCode: string;

  @Column({ type: 'varchar', length: 64, comment: '匹配路径前缀，如 /api/auth' })
  pathPrefix: string;

  /** 上游服务标识，用于关联配置中的目标地址 */
  @Column({ type: 'varchar', length: 32, comment: '上游服务 auth/user/ai/system/todo/upload/mcp/finnews' })
  targetService: string;

  /** 显式上游地址，填了则覆盖环境变量中的 *_SERVICE_URL；NULL 表示用默认 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '显式上游 URL，NULL=使用 *_SERVICE_URL 环境变量' })
  targetUrl: string | null;

  /** 转发时剥离的前缀正则，如 ^/api 或 ^/api/mcp；NULL=不剥 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'pathRewrite 剥离前缀，如 ^/api' })
  stripPrefix: string | null;

  /** 剥离后重写到的目标前缀，如 /api（mcp 场景）；NULL=直接剥掉 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '重写目标前缀，如 /api' })
  rewriteTo: string | null;

  @Column({ type: 'int', unsigned: true, default: 30000, comment: '代理超时（毫秒）' })
  timeoutMs: number;

  /** passthrough 透传（下游自校验）/ service_key 网关校验 FINNEWS_SERVICE_KEY */
  @Column({ type: 'varchar', length: 16, default: 'passthrough', comment: '网关鉴权模式 passthrough/service_key' })
  authMode: 'passthrough' | 'service_key';

  @Column({ type: 'boolean', default: true, comment: '是否启用该路由' })
  enabled: boolean;

  @Column({ type: 'int', default: 0, comment: '匹配优先级，数值小优先' })
  priority: number;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '备注' })
  description: string | null;
}
