import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/**
 * 音乐播放渠道配置表（一期：QQ音乐小程序跳转）。
 *
 * 设计动机：跳转目标 / 插件 appid 一旦写死在代码里，换一次渠道就要改代码 + 提审。
 * 做成配置行后，下线渠道只需 enabled=0（`list_music_providers` 不再下发），
 * 换渠道只需 UPDATE 一行。风格对齐 content_sources（code + json 私有配置 + enabled + 软删除）。
 */
@Entity('music_providers')
export class MusicProvider extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  /** 渠道编码：qqmusic / kugou_plugin；工具的 providerCode 与之对应 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, comment: '渠道编码：qqmusic / kugou_plugin' })
  code: string;

  /** 按钮文案里的平台名，如「QQ音乐」 */
  @Column({ type: 'varchar', length: 128, comment: '展示名，用于按钮文案「去 XX 听」' })
  name: string;

  /**
   * 目标小程序 appid / 小程序插件 appid。
   * 未真机确认前写占位值 PENDING_QQMUSIC：此时卡片降级为「复制歌名去搜索」，不报错。
   */
  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '目标小程序 appid / 插件 appid，未确认时为占位 PENDING_QQMUSIC',
  })
  appId: string | null;

  /** 入口类型：mini_program=跳转小程序 / plugin=小程序插件（站内播放）/ h5=外链 */
  @Column({
    type: 'varchar',
    length: 32,
    default: 'mini_program',
    comment: '入口类型：mini_program=跳转小程序 / plugin=插件 / h5=外链',
  })
  entryType: string;

  /** 定位模板，含 {keyword} 占位，如 pages/search/search?keyword={keyword} */
  @Column({
    type: 'varchar',
    length: 512,
    nullable: true,
    comment: '定位模板，含 {keyword} 占位',
  })
  searchTemplate: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '渠道图标' })
  icon: string | null;

  @Column({ type: 'int', default: 100, comment: '排序，越小越优先' })
  sort: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用；关闭后不下发给 Agent' })
  enabled: boolean;
}
