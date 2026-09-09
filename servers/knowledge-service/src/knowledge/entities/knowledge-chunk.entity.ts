import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * 知识分块。embedding 存 MySQL JSON(float 数组)，检索为应用层余弦 top-k
 * （开放决策 2：不引入 PG/pgvector，内部千级 chunk 量级够用）。
 */
@Entity('knowledge_chunks')
@Index('idx_knowledge_chunks_doc', ['docId'])
@Index('idx_knowledge_chunks_collection', ['collectionId'])
export class KnowledgeChunkEntity extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '所属文档 id' })
  docId: string;

  @Column({ type: 'varchar', length: 64, comment: '所属集合 id' })
  collectionId: string;

  @Column({ type: 'int', comment: '文档内分块序号' })
  seq: number;

  @Column({ type: 'text', comment: '分块文本' })
  content: string;

  @Column({ type: 'json', nullable: true, comment: 'embedding 向量(float[])' })
  embedding: number[] | null;

  @Column({ type: 'json', nullable: true, comment: '分块扩展元数据' })
  meta: Record<string, unknown> | null;
}
