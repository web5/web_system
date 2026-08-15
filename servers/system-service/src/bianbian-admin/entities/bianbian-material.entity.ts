/**
 * 变变 — 素材数据库实体
 * 存储所有可用的拼贴素材
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

@Entity('bianbian_materials')
export class BianbianMaterial {
  @PrimaryGeneratedColumn('uuid', { comment: '素材 ID' })
  id: string;

  /** 素材名称 */
  @Column({ type: 'varchar', length: 100, comment: '素材名称' })
  name: string;

  /** 素材标签（逗号分隔，用于前端搜索匹配） */
  @Column({ type: 'varchar', length: 255, default: '', comment: '标签（逗号分隔）' })
  tags: string;

  /** 分类：sticker/shape/animal/nature/face/bg */
  @Column({ type: 'varchar', length: 50, comment: '分类 sticker/shape/animal/nature/face/bg' })
  @Index()
  category: string;

  /** 内容（emoji / 颜色值 hex / SVG URL） */
  @Column({ type: 'varchar', length: 255, comment: '内容 emoji/svg/color' })
  content: string;

  /** 类型：emoji/svg/color */
  @Column({ type: 'varchar', length: 20, default: 'emoji', comment: '类型 emoji/svg/color' })
  type: string;

  /** 分类展示图标（用于管理后台分类 tab 显示） */
  @Column({ type: 'varchar', length: 10, default: 'default', comment: '展示图标' })
  icon: string;

  /** 素材来源：system（系统内置）/ custom（管理员自定义） */
  @Column({ type: 'varchar', length: 20, default: 'system', comment: '来源 system/custom' })
  source: string;

  /** 排序序号 */
  @Column({ type: 'int', default: 0, comment: '排序序号' })
  sortOrder: number;

  /** 描述说明 */
  @Column({ type: 'varchar', length: 500, default: '', comment: '描述' })
  description: string;

  /** 是否启用（关闭后用户端不可见） */
  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deletedAt: Date | null;
}
