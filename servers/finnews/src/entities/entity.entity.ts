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
  @PrimaryGeneratedColumn('uuid', { comment: '实体 ID' })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  @Index()
  name: string;

  @Column({ type: 'varchar', length: 50, comment: '实体类型' })
  type: string;

  @Column({ type: 'json', nullable: true, comment: '别名列表' })
  aliases: string[] | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  stock_code: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '板块' })
  sector: string | null;

  @Column({ type: 'text', nullable: true, comment: '描述' })
  description: string | null;

  @Column({ type: 'int', default: 0, comment: '近 7 日提及次数' })
  mention_count_7d: number;

  @Column({ type: 'int', default: 0, comment: '近 30 日提及次数' })
  mention_count_30d: number;

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3, comment: '更新时间' })
  updated_at: Date;
}
