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
  Index,
} from 'typeorm';

@Entity('bianbian_materials')
export class BianbianMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 素材名称 */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 素材标签（逗号分隔，用于前端搜索匹配） */
  @Column({ type: 'varchar', length: 255, default: '' })
  tags: string;

  /** 分类：sticker/shape/animal/nature/face/bg */
  @Column({ type: 'varchar', length: 50 })
  @Index()
  category: string;

  /** 内容（emoji / 颜色值 hex / SVG URL） */
  @Column({ type: 'varchar', length: 255 })
  content: string;

  /** 类型：emoji/svg/color */
  @Column({ type: 'varchar', length: 20, default: 'emoji' })
  type: string;

  /** 分类展示图标（用于管理后台分类 tab 显示，如 ⭐ 🐱 🌿 😊 🖼️） */
  @Column({ type: 'varchar', length: 10, default: '📦' })
  icon: string;

  /** 素材来源：system（系统内置）/ custom（管理员自定义） */
  @Column({ type: 'varchar', length: 20, default: 'system' })
  source: string;

  /** 排序序号 */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /** 描述说明 */
  @Column({ type: 'varchar', length: 500, default: '' })
  description: string;

  /** 是否启用（关闭后用户端不可见） */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  @Index()
  updatedAt: Date;
}
