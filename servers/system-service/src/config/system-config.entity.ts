import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_configs')
export class SystemConfig {
  @PrimaryColumn({ length: 64 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
