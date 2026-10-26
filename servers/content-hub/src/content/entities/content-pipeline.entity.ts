import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/** 内容管线配置——paper / ai-news 各一条，可扩展 */
@Entity('content_pipelines')
export class ContentPipelineEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '管线编码' })
  code: string;

  @Column({ type: 'varchar', length: 32, comment: '管线类型 paper | ai-news' })
  type: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '日报标题模板' })
  title_template: string | null;

  @Column({ type: 'varchar', length: 64, comment: 'cron 表达式' })
  cron: string;

  @Column({ type: 'text', nullable: true, comment: 'LLM prompt 模板' })
  llm_prompt: string | null;

  @Column({ type: 'json', nullable: true, comment: '发布目标列表' })
  publish_targets: string[] | null;

  /**
   * 发布模式（2026-10-23 新增）：publish=建草稿后直接发布，draft=只进草稿箱。
   *
   * 背景：公众号资质不够（未认证个人号 → 48001）时「直接发布」必然失败降级，
   * 每天定时跑出来的记录都是 drafted，看着像在报错。现在把它做成配置项：
   * 资质没到位就把管线设成 draft，出的是**预期结果**，不再是伪装成的失败。
   */
  @Column({ type: 'varchar', length: 16, default: 'publish', comment: '发布模式 publish | draft' })
  publish_mode: string;

  /**
   * 默认封面（`content_media.id`，2026-10-26）。
   *
   * 定时发布没人值守，不能靠人挑图 —— 管线绑一张，跑的时候自动用。
   * 单次发布想换图，走 `WechatMpPublishDto.thumb_media_id` 覆盖，不影响这里。
   *
   * 为什么存 id 而不是 media_id：微信 media_id 会因账号迁移/素材删除失效，
   * 存 id 才能在失效时重新上传刷新，而不是钉死一个死 id。
   */
  @Column({ type: 'bigint', nullable: true, comment: '默认封面素材 ID（content_media.id）' })
  default_cover_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '腾讯文档目标目录' })
  tencent_folder: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
