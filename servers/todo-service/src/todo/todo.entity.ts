import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/** 任务状态 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

/** 任务优先级 */
export type TodoPriority = 'low' | 'medium' | 'high';

/** 任务分类 */
export type TodoCategory = 'creative' | 'study' | 'sport' | 'music' | 'other';

@Entity('todo_tasks')
export class Todo {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '任务 ID' })
  id: number;

  @Column({ type: 'varchar', length: 255, comment: '标题' })
  title: string;

  @Column({ type: 'text', nullable: true, comment: '描述' })
  description?: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    comment: '状态 pending/in_progress/completed/overdue/cancelled',
  })
  status: TodoStatus;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'medium',
    comment: '优先级 low/medium/high',
  })
  priority: TodoPriority;

  @Column({ type: 'json', nullable: true, comment: '分类列表' })
  category?: TodoCategory[];

  @Column({ type: 'datetime', nullable: true, comment: '截止时间' })
  due_date?: Date;

  @Column({ type: 'datetime', nullable: true, comment: '完成时间' })
  completed_at?: Date;

  /** 所属用户 ID，关联 users.id（统一为 BIGINT） */
  @Column({ type: 'bigint', unsigned: true, comment: '用户 ID，关联 users.id' })
  @Index()
  user_id: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at?: Date;
}
