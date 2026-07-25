import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity'; // 需要引用 users 表

/** 任务状态 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

/** 任务优先级 */
export type TodoPriority = 'low' | 'medium' | 'high';

/** 任务分类 */
export type TodoCategory = 'creative' | 'study' | 'sport' | 'music' | 'other';

@Entity('todo_tasks')
export class Todo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'in_progress', 'completed', 'overdue', 'cancelled'],
    default: 'pending',
  })
  status: TodoStatus;

  @Column({
    type: 'enum',
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  })
  priority: TodoPriority;

  @Column('simple-json', { nullable: true })
  category?: TodoCategory[];

  @Column({ type: 'datetime', nullable: true })
  due_date?: Date;

  @Column({ type: 'datetime', nullable: true })
  completed_at?: Date;

  @Index()
  @Column()
  user_id: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'datetime', nullable: true })
  deleted_at?: Date;
}
