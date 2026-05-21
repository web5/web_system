import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string;

  @Column({ type: 'jsonb' })
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  @Index()
  updatedAt: Date;
}
