import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { McpModuleEntity } from './mcp-module.entity';

/** MCP 工具（模块下的一个 HTTP 接口声明） */
@Entity('mcp_tools')
export class McpToolEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '工具 ID' })
  id: number;

  @Column({ type: 'bigint', unsigned: true, comment: '所属模块 ID' })
  module_id: number;

  @ManyToOne(() => McpModuleEntity, (module) => module.tools, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'module_id' })
  module: McpModuleEntity;

  @Column({ comment: '工具名' })
  name: string;

  // ⚠️ 必须是 text 而不是默认 varchar(255)：工具声明里的 description 常写上千字
  // （例：deploy 模块的 release_verify，含判据说明与注意事项），
  // varchar(255) 会在 seed 阶段报 "Data too long for column 'description'" → 服务启动崩溃
  // → pm2 反复重启 → 发布探活永远不通过（2026-10-21 mcp-gateway 迁移实测）。
  // MySQL TEXT 不支持非空默认值，故不再声明 default，由调用方保证必传（工具声明 description 为必填字段）。
  @Column({ type: 'text', comment: '工具描述' })
  description: string;

  @Column({ default: 'GET', comment: 'HTTP 方法' })
  method: string;

  @Column({ default: '/', comment: '请求路径（支持 {xxx} 占位）' })
  path: string;

  @Column({ type: 'json', nullable: true, comment: '参数定义数组' })
  params: any;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
