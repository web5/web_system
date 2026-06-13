import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('operation_logs')
export class OperationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 64 })
  operator: string;

  @Index()
  @Column({ length: 32 })
  type: string;

  @Column({ length: 255, nullable: true })
  target: string;

  @Column({ length: 64, nullable: true })
  ip: string;

  @CreateDateColumn()
  createdAt: Date;
}
