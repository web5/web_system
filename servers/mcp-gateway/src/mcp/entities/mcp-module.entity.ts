import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { McpToolEntity } from './mcp-tool.entity';

/** MCP 模块（一个后台 HTTP 服务的注册） */
@Entity('mcp_modules')
export class McpModuleEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '模块 ID' })
  id: number;

  @Column({ unique: true, comment: '模块名' })
  name: string;

  @Column({ default: '', comment: '模块描述' })
  description: string;

  @Column({ comment: '后台服务地址' })
  base_url: string;

  @Column({ default: 30, comment: '超时秒数' })
  timeout: number;

  @Column({ default: 'bearer', comment: '鉴权类型 bearer/basic/header' })
  auth_type: string;

  @Column({ type: 'json', nullable: true, comment: '鉴权配置' })
  auth_config: Record<string, string> | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 32, default: 'http', comment: '模块类型 http=声明式HTTP code=代码内置' })
  module_type: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '代码模块标识（如 finnews）' })
  code_key: string | null;

  @OneToMany(() => McpToolEntity, (tool) => tool.module, {
    cascade: true,
    eager: true,
  })
  tools: McpToolEntity[];

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 3, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
