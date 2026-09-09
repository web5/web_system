import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/** 知识文档（一次入库 = 一行；解析分块+向量化后 ready） */
@Entity('knowledge_docs')
@Index('idx_knowledge_docs_collection', ['collectionId'])
@Index('idx_knowledge_docs_checksum', ['collectionId', 'checksum'])
export class KnowledgeDocEntity extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '所属集合 id' })
  collectionId: string;

  @Column({ type: 'varchar', length: 255, comment: '文档标题' })
  title: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '来源（调用方）' })
  source: string | null;

  @Column({ type: 'mediumtext', comment: '原始文本' })
  rawText: string;

  /** parsing（入库中，通常瞬时）/ ready（可检索）/ failed（向量化失败，error 字段有原因） */
  @Column({ type: 'varchar', length: 16, default: 'parsing', comment: '解析状态' })
  status: 'parsing' | 'ready' | 'failed';

  @Column({ type: 'char', length: 32, nullable: true, comment: '内容校验和（幂等去重）' })
  checksum: string | null;

  @Column({ type: 'int', default: 0, comment: '分块数' })
  chunkCount: number;

  @Column({ type: 'text', nullable: true, comment: '失败原因' })
  error: string | null;

  @Column({ type: 'json', nullable: true, comment: '文档扩展元数据' })
  docMeta: Record<string, unknown> | null;
}
