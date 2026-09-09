import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { KnowledgeCollectionEntity } from './entities/knowledge-collection.entity';
import { KnowledgeDocEntity } from './entities/knowledge-doc.entity';
import { KnowledgeChunkEntity } from './entities/knowledge-chunk.entity';
import { TokenHubEmbeddingService } from './embedding.service';
import { cosine } from './util';

export interface SearchHit {
  chunkId: string;
  content: string;
  docId: string;
  docTitle: string;
  seq: number;
  score: number;
}

export interface McpCollectionItem {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  docCount: number;
}

@Injectable()
export class KnowledgeSearchService {
  constructor(
    @InjectRepository(KnowledgeCollectionEntity)
    private readonly collectionRepo: Repository<KnowledgeCollectionEntity>,
    @InjectRepository(KnowledgeDocEntity)
    private readonly docRepo: Repository<KnowledgeDocEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly embeddingService: TokenHubEmbeddingService,
  ) {}

  /** 检索：集合校验(enabled) → query 向量 → 该集合全部分块余弦 → topK */
  async search(collectionId: string, query: string, topK = 5): Promise<SearchHit[]> {
    const collection = await this.collectionRepo.findOne({ where: { id: collectionId } });
    if (!collection) throw new BusinessException(`知识集合不存在: ${collectionId}`, 4040);
    if (!collection.enabled) throw new BusinessException(`知识集合已停用: ${collection.name}`);

    const chunks = await this.chunkRepo.find({
      where: { collectionId, embedding: Not(IsNull()) },
      select: ['id', 'docId', 'seq', 'content', 'embedding'],
    });
    if (!chunks.length) return [];

    const qVec = (await this.embeddingService.embed([query]))[0];
    const docTitles = await this.docTitles(collectionId);

    const scored = chunks
      .map((c) => ({
        chunkId: c.id,
        content: c.content,
        docId: c.docId,
        docTitle: docTitles.get(c.docId) ?? c.docId,
        seq: c.seq,
        score: cosine(qVec, c.embedding ?? []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
  }

  /** MCP knowledge_list：集合与可见性 */
  async mcpList(): Promise<McpCollectionItem[]> {
    const collections = await this.collectionRepo.find({
      order: { createdAt: 'ASC' },
    });
    const counts = await this.countsByCollection();
    return collections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      enabled: c.enabled,
      docCount: counts.get(c.id) ?? 0,
    }));
  }

  private async docTitles(collectionId: string): Promise<Map<string, string>> {
    const docs = await this.docRepo.find({
      where: { collectionId },
      select: ['id', 'title'],
    });
    return new Map(docs.map((d) => [d.id, d.title]));
  }

  private async countsByCollection(): Promise<Map<string, number>> {
    const raw = await this.docRepo
      .createQueryBuilder('d')
      .select('d.collectionId', 'collectionId')
      .addSelect('COUNT(*)', 'docCount')
      .groupBy('d.collectionId')
      .getRawMany<{ collectionId: string; docCount: string }>();
    const map = new Map<string, number>();
    for (const r of raw) map.set(r.collectionId, Number(r.docCount));
    return map;
  }
}
