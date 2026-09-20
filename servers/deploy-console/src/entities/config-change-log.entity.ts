import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/**
 * 配置变更日志：管理台修改环境配置文件（.env）时留痕，便于审计与回滚。
 * 配合 config.service 的 saveFile 调用写入（旧值/新值/差异摘要）。
 */
@Entity('config_change_logs')
export class ConfigChangeLogEntity extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '变更日志 ID' })
  id: number;

  /** dev | prod | common */
  @Column({ type: 'varchar', length: 16, comment: '环境 dev/prod/common' })
  @Index()
  env: string;

  /** 被修改的配置文件名，如 servers.env / prod.env */
  @Column({ type: 'varchar', length: 255, comment: '配置文件名' })
  fileName: string;

  /** created | updated | deleted */
  @Column({ type: 'varchar', length: 16, comment: '变更类型 created/updated/deleted' })
  changeType: 'created' | 'updated' | 'deleted';

  /** 操作人（来自 JWT sub 或管理台登录态） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  operator?: string;

  /** 修改前内容（全量，便于回滚）；新建为 NULL */
  @Column({ type: 'text', nullable: true, comment: '修改前内容' })
  oldContent?: string;

  /** 修改后内容（全量）；删除为 NULL */
  @Column({ type: 'text', nullable: true, comment: '修改后内容' })
  newContent?: string;

  /** 差异摘要（如 +PORT=6008 / -DEBUG=true） */
  @Column({ type: 'varchar', length: 512, nullable: true, comment: '差异摘要' })
  diffSummary?: string;
}
