import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * 知识集合（RAG 顶级单元）。
 * 集合与 agent 的绑定 = agent 定义 capabilities 里 config:{collectionId} 显式引用（开放决策 7 = C），
 * 因此本表不设 agentIds 白名单列。
 */
@Entity('knowledge_collections')
export class KnowledgeCollectionEntity extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, comment: '集合名称' })
  name: string;

  @Column({ type: 'text', nullable: true, comment: '集合描述' })
  description: string | null;

  @Column({ type: 'varchar', length: 64, default: 'tokenhub', comment: 'embedding 提供方' })
  embedModel: string;

  @Column({ type: 'boolean', default: true, comment: '启用：停用后所有 knowledge 调用返回明确错误' })
  enabled: boolean;

  @Column({ type: 'json', nullable: true, comment: '扩展元数据' })
  meta: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '创建人 user id' })
  createdBy: string | null;
}
