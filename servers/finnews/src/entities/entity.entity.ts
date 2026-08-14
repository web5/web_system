import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 实体表——公司、人物、产品、板块等 */
@Entity('finnews_entities')
export class EntityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  @Index()
  name: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'json', nullable: true })
  aliases: string[] | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  stock_code: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sector: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: 0 })
  mention_count_7d: number;

  @Column({ default: 0 })
  mention_count_30d: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
