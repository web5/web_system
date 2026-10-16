import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 游资营业部名单（p35）—— 规则表，不硬编码。
 *
 * 为什么必须存表：`hot-money-tracker` 已明确记录「席位归属会随迁址变化，
 * 必须核对最新龙虎榜数据」。写死在代码里 = 每次迁址都要发版。
 *
 * 识别逻辑是**规则匹配**而非 AI 推断 —— 席位归属要可复现，
 * 「每次判断可能不同」会破坏龙虎榜数据的可比性。
 */
@Entity('hotmoney_seats')
@Index('idx_seat_active', ['is_active'])
@Index('uk_seat_name', ['seat_name'], { unique: true })
export class HotmoneySeatEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 128, comment: '营业部全称' })
  seat_name: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '常用简称，如章盟主' })
  alias: string | null;

  @Column({ type: 'varchar', length: 32, default: 'hotmoney', comment: '资金性质标记' })
  tag: string;

  @Column({ type: 'tinyint', default: 1, comment: '是否启用（席位迁址后可下线）' })
  is_active: number;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '备注' })
  note: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  created_at: Date;
}
