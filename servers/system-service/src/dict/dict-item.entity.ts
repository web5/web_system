import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/** attrs 允许的值类型（禁 any，DTO 校验后落库） */
export type DictAttrValue = string | number | boolean | null;

/**
 * 字典项（维表数据行）。
 *
 * - `value` 是业务侧真正消费的原值（如网关 model id），保留为物理列以便建唯一索引；
 * - 其余自定义字段的值按 `dict_fields` 定义落在 `attrs` 里；
 * - 停用（enabled=false）比删除安全 —— 历史数据里已落库的 value 仍可解释。
 */
@Entity('dict_items')
@Index('uq_dict_items_type_value', ['typeCode', 'value'], { unique: true })
export class DictItem extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 所属字典编码（对应 dict_types.code） */
  @Column({ type: 'varchar', length: 64, comment: '字典编码' })
  typeCode: string;

  /** 字典项值（业务侧消费的原值） */
  @Column({ type: 'varchar', length: 128, comment: '字典项值' })
  value: string;

  /** 字典项标签（页面默认展示） */
  @Column({ type: 'varchar', length: 255, comment: '字典项标签' })
  label: string;

  /** 自定义字段值：{ [field.name]: value } */
  @Column({ type: 'json', nullable: true, comment: '自定义字段值' })
  attrs: Record<string, DictAttrValue> | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '备注' })
  remark: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'int', default: 0, comment: '排序（小的在前）' })
  sort: number;
}
