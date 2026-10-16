import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 龙虎榜原始快照（p35）。
 *
 * 为什么不全塞 `content_items`：
 *   · 数值字段需要 decimal 才能算净额 / 排序（塞 content_items 只能进 meta 的 json）
 *   · 唯一键不同（content_items 是 pipeline_id+external_id；这里是 date+code+reason）
 *   · 查询模式不同（这里查「某交易日全部上榜」，那边查「最近 N 条」）
 *
 * 采集器：EastmoneyLhbCollector（复用 institution.service.ts 已验证的
 * `RPT_DAILYBILLBOARD_DETAILSNEW` 路径，补齐该实现缺的 seats / limit_up / is_st）。
 */
@Entity('lhb_records')
@Index('idx_lhb_date', ['trade_date'])
@Index('idx_lhb_item', ['item_id'])
@Index('uk_lhb_date_code', ['trade_date', 'stock_code', 'reason'], { unique: true })
export class LhbRecordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'date', comment: '交易日' })
  trade_date: string;

  @Column({ type: 'varchar', length: 16, comment: '股票代码' })
  stock_code: string;

  @Column({ type: 'varchar', length: 64, comment: '股票名称' })
  stock_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '上榜原因' })
  reason: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true, comment: '买入额' })
  buy_amount: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true, comment: '卖出额' })
  sell_amount: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true, comment: '净额' })
  net_amount: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, comment: '换手率' })
  turnover_rate: string | null;

  @Column({ type: 'tinyint', default: 0, comment: '是否 ST' })
  is_st: number;

  @Column({ type: 'tinyint', default: 0, comment: '是否涨停' })
  limit_up: number;

  /**
   * 席位明细：`[{ name, buy, sell, type }]`，type ∈ buy|sell|both。
   * 用具名接口而非 `Record<string, unknown>` —— json 字段写成 Record 会让
   * 消费方失去类型保护，且 JSON_EXTRACT 的键拼错不会报错。
   */
  @Column({ type: 'json', nullable: true, comment: '席位明细数组' })
  seats: LhbSeatDetail[] | null;

  /** 资金性质标记：hotmoney / institution / retail 的混合数组 */
  @Column({ type: 'json', nullable: true, comment: '资金性质标记' })
  tags: string[] | null;

  @Column({ type: 'bigint', nullable: true, comment: '关联 content_sources.id' })
  source_id: number | null;

  @Column({ type: 'bigint', nullable: true, comment: '关联 content_items.id' })
  item_id: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  created_at: Date;
}

/** 单个席位明细 */
export interface LhbSeatDetail {
  /** 营业部全称 */
  name: string;
  /** 买入额（元） */
  buy: number;
  /** 卖出额（元） */
  sell: number;
  /** 买卖方向 */
  type: 'buy' | 'sell' | 'both';
}
