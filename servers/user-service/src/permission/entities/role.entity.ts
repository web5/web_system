import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** 角色定义 */
@Entity('roles')
export class RoleEntity {
  /** 角色 code，如 admin/editor/viewer */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '角色 code' })
  code: string;

  /** 角色名 */
  @Column({ type: 'varchar', length: 64, comment: '角色名' })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '描述' })
  description: string | null;

  /** 内置角色（admin/editor/viewer）不可删除 */
  @Column({ type: 'boolean', default: false, comment: '内置角色不可删' })
  isSystem: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
