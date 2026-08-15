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

  @Column({ comment: '所属模块 ID' })
  module_id: number;

  @ManyToOne(() => McpModuleEntity, (module) => module.tools, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'module_id' })
  module: McpModuleEntity;

  @Column({ comment: '工具名' })
  name: string;

  @Column({ default: '', comment: '工具描述' })
  description: string;

  @Column({ default: 'GET', comment: 'HTTP 方法' })
  method: string;

  @Column({ default: '/', comment: '请求路径（支持 {xxx} 占位）' })
  path: string;

  @Column({ type: 'json', nullable: true, comment: '参数定义数组' })
  params: any;

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 3, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
