import { Column, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * Agent 定义历史版本表（支持回滚）
 *
 * 每次 publish 把当前快照写入一行（version 递增），可回滚到任意历史版本。
 */
@Entity('agent_definition_versions')
@Index('idx_agent_def_ver_agent', ['agentId'])
export class AgentDefinitionVersionEntity extends AbstractEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  /** agent id */
  @Column({ type: 'varchar', length: 64, comment: 'agent id' })
  agentId: string;

  /** 版本号（同一 agent 内唯一递增） */
  @Column({ type: 'int', comment: '版本号' })
  version: number;

  @Column({ type: 'varchar', length: 128, comment: 'Agent 名称' })
  name: string;

  @Column({ type: 'mediumtext', comment: 'systemPrompt' })
  systemPrompt: string;

  @Column({ type: 'varchar', length: 64, comment: '模型 id' })
  model: string;

  @Column({ type: 'json', comment: '工具名数组' })
  tools: string[];

  @Column({ type: 'int', default: 10, comment: '最大步数' })
  maxSteps: number;

  @Column({ type: 'float', nullable: true, comment: '采样温度' })
  temperature: number | null;

  @Column({ type: 'json', comment: '记忆配置' })
  memory: {
    compactionThreshold: number;
    keepRecent: number;
    enabled: boolean;
  };

  /** 变更说明（便于排查） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '变更说明' })
  changeNote: string | null;

  /** 发布人 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '发布人' })
  createdBy: string | null;
}
