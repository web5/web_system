import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

@Entity('operation_logs')
export class OperationLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '日志 ID' })
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 64, comment: '操作人' })
  operator: string;

  @Index()
  @Column({ type: 'varchar', length: 32, comment: '操作类型' })
  type: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '操作对象' })
  target: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'IP' })
  ip: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deletedAt: Date | null;
}
