import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * 模型单价（Phase2.4）：provider+model 每 1K token 的输入/输出价格（CNY）。
 * run 落库时按 usage × 单价核算成本；无单价记录的模型成本按 0 并在 admin 提示补配。
 */
@Entity('model_pricing')
@Index('idx_model_pricing_provider_model', ['provider', 'model'], { unique: true })
export class ModelPricing extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '模型提供方（hy3 / tokenhub）' })
  provider: string;

  @Column({ type: 'varchar', length: 128, comment: '模型 id（如 deepseek-v4-flash）' })
  model: string;

  /** 输入每 1K token 价格 */
  @Column({ type: 'decimal', precision: 12, scale: 6, comment: '输入每 1K token 价格' })
  inputPricePer1k: string;

  /** 输出每 1K token 价格 */
  @Column({ type: 'decimal', precision: 12, scale: 6, comment: '输出每 1K token 价格' })
  outputPricePer1k: string;

  @Column({ type: 'varchar', length: 8, default: 'CNY', comment: '币种' })
  currency: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '更新人' })
  updatedBy: string | null;
}
