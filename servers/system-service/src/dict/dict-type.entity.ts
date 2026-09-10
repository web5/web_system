import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * 字典类型（维表头）。
 *
 * 一个「字典」= 1 个 type + N 个 field（字段定义）+ N 个 item（数据行），例如 `llm_models`。
 * builtin=true 的类型由模块启动时补齐，页面不可删除，避免把依赖它的业务链路删空。
 */
@Entity('dict_types')
@Index('uq_dict_types_code', ['code'], { unique: true })
export class DictType extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 字典编码（业务侧引用，如 llm_models） */
  @Column({ type: 'varchar', length: 64, comment: '字典编码' })
  code: string;

  /** 字典名称（页面展示） */
  @Column({ type: 'varchar', length: 128, comment: '字典名称' })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '字典描述' })
  description: string | null;

  /** 内置字典：启动时自动补齐，不可删除 */
  @Column({ type: 'boolean', default: false, comment: '内置字典不可删除' })
  builtin: boolean;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'int', default: 0, comment: '排序（小的在前）' })
  sort: number;
}
