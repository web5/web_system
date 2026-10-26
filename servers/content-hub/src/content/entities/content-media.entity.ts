import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * 公众号素材库（封面为主）。
 *
 * 存在理由：发布器此前只有两条取封面路径 —— 正文首图 / 硬编码的通用封面
 * （`wechat-mp.publisher.ts` 的 FALLBACK_THUMB_MEDIA_ID），换图只能改环境变量，
 * 既不能挑、也不能预览、更不能复用。这里把「图」变成可管理的资产。
 *
 * 三个字段各管一段，别混：
 *   · `file_url` —— 源图，存在 upload-service（`/api/uploads/covers/*`），永远可重新拉取
 *   · `media_id` —— 微信永久素材 id，发布时 `draft/add` 要的就是它；上传一次缓存复用
 *   · `url`      —— 微信侧 CDN 地址，仅用于「已同步」的可视确认
 *
 * 🔴 原则：本服务**不写盘**。图片二进制一律交给 upload-service（唯一写入点），
 *    这里只存 URL 与元数据 —— 路径解析规则不扩散。
 */
@Entity('content_media')
@Index('idx_media_type', ['media_type'])
@Index('idx_media_kind', ['kind'])
export class ContentMediaEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  /** 素材用途：cover=封面（当前唯一用途，留 kind 便于以后放正文图/头图） */
  @Column({ type: 'varchar', length: 16, default: 'cover', comment: '用途 cover' })
  kind: string;

  /** 展示名。上传默认取文件名（去扩展名），AI 生成默认取文章标题 */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '素材名' })
  name: string | null;

  @Column({ type: 'varchar', length: 16, comment: 'image/thumb' })
  media_type: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '源文件 URL' })
  file_url: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '微信 media_id' })
  media_id: string | null;

  /**
   * 微信账号（default / kedouai …）。
   *
   * 🔴 `media_id` 是**按公众号隔离**的：同一个 id 在另一个号上无效。
   * 所以必须记清这条素材是往哪个号传的，否则多号场景会拿错 id 去建草稿，
   * 报的还是「invalid media_id」这种看不出根因的错。
   */
  @Column({ type: 'varchar', length: 32, default: 'default', comment: '所属微信账号' })
  account: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '微信 CDN url' })
  url: string | null;

  /** 像素宽高 —— 上传时取，用于「比例是否符合公众号封面」的提示，不做强拦 */
  @Column({ type: 'int', nullable: true, comment: '宽（px）' })
  width: number | null;

  @Column({ type: 'int', nullable: true, comment: '高（px）' })
  height: number | null;

  @Column({ type: 'int', nullable: true, comment: '文件字节数' })
  bytes: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'MIME' })
  mime: string | null;

  /** 标签，用于筛选（如「日报」「论文」「节日」） */
  @Column({ type: 'json', nullable: true, comment: '标签数组' })
  tags: string[] | null;

  /** 来源：upload=人工上传，ai=按标题生成 —— 便于日后比较哪类更常用 */
  @Column({ type: 'varchar', length: 16, default: 'upload', comment: '来源 upload | ai' })
  source: string;

  /** AI 生成时的提示词；人工上传为空。留着才能复现同风格 */
  @Column({ type: 'text', nullable: true, comment: 'AI 生成提示词' })
  prompt: string | null;

  /** 生成/同步失败的最近原因（成功时清空），避免「点了没反应」 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '最近一次失败原因' })
  last_error: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否可用（停用后不出现在选择器）' })
  enabled: boolean;

  @Column({ type: 'int', default: 0, comment: '被发布使用次数' })
  use_count: number;

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '最近使用时间' })
  last_used_at: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
