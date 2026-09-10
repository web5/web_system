import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/** 字段类型（决定表单控件与值校验方式） */
export type DictFieldType = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'date';

export const DICT_FIELD_TYPES: readonly DictFieldType[] = [
  'string',
  'text',
  'number',
  'boolean',
  'enum',
  'date',
] as const;

/** 各类型的物理长度上限（防御异常值把 JSON 撑爆） */
export const DICT_FIELD_MAX_LENGTH: Record<DictFieldType, number> = {
  string: 1024,
  text: 4096,
  number: 20,
  boolean: 1,
  enum: 256,
  date: 32,
};

/**
 * 字典字段定义（列元数据）。
 *
 * 字段的值落在 `dict_items.attrs[name]`，本表描述它**是什么、怎么渲染、限制多少**。
 * `length` 是应用层强校验的“物理长度”（JSON 列无法做列级 varchar(n)），
 * 写入前由 DictService.validateAttrs() 卡住，超额返回 400 并指明字段名。
 */
@Entity('dict_fields')
@Index('uq_dict_fields_type_name', ['typeCode', 'name'], { unique: true })
export class DictField extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 所属字典编码 */
  @Column({ type: 'varchar', length: 64, comment: '字典编码' })
  typeCode: string;

  /** 字段名（attrs 内的 key，小写字母/数字/下划线） */
  @Column({ type: 'varchar', length: 64, comment: '字段名' })
  name: string;

  /** 展示标签（表头 / 表单 label） */
  @Column({ type: 'varchar', length: 128, comment: '展示标签' })
  label: string;

  /** 字段类型，决定渲染控件与校验规则 */
  @Column({ type: 'varchar', length: 16, comment: '字段类型 string/text/number/boolean/enum/date' })
  type: DictFieldType;

  /** 长度上限（string/text=字符数，number=总位数；其余类型忽略） */
  @Column({ type: 'int', nullable: true, comment: '长度上限' })
  length: number | null;

  @Column({ type: 'boolean', default: false, comment: '是否必填' })
  required: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '默认值' })
  defaultValue: string | null;

  /** enum 类型的候选值（JSON 字符串数组） */
  @Column({ type: 'json', nullable: true, comment: '枚举候选值' })
  options: string[] | null;

  @Column({ type: 'int', default: 0, comment: '排序（小的在前）' })
  sort: number;
}
