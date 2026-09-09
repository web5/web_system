import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { KnowledgeCollectionEntity } from './entities/knowledge-collection.entity';
import { KnowledgeDocEntity } from './entities/knowledge-doc.entity';
import { KnowledgeChunkEntity } from './entities/knowledge-chunk.entity';
import { TokenHubEmbeddingService } from './embedding.service';
import { chunkText, sha1hex } from './util';

export interface IngestResult {
  docId: string;
  title: string;
  status: 'parsing' | 'ready' | 'failed';
  chunkCount: number;
  duplicate: boolean;
  error: string | null;
}

@Injectable()
export class KnowledgeDocumentService {
  constructor(
    @InjectRepository(KnowledgeCollectionEntity)
    private readonly collectionRepo: Repository<KnowledgeCollectionEntity>,
    @InjectRepository(KnowledgeDocEntity)
    private readonly docRepo: Repository<KnowledgeDocEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly embeddingService: TokenHubEmbeddingService,
  ) {}

  /** 入库：校验集合启用 → 幂等去重 → 分块+向量化（失败落 failed + 明确错误，不静默） */
  async ingest(input: {
    collectionId: string;
    title: string;
    text: string;
    source?: string;
  }): Promise<IngestResult> {
    const collection = await this.collectionRepo.findOne({
      where: { id: input.collectionId },
    });
    if (!collection) {
      throw new BusinessException(`知识集合不存在: ${input.collectionId}`, 4040);
    }
    if (!collection.enabled) {
      throw new BusinessException(`知识集合已停用: ${collection.name}`);
    }

    const checksum = sha1hex(`${input.title}\n${input.text}`);
    const existing = await this.docRepo.findOne({
      where: { collectionId: input.collectionId, checksum },
    });
    if (existing) {
      return {
        docId: existing.id,
        title: existing.title,
        status: existing.status,
        chunkCount: existing.chunkCount,
        duplicate: true,
        error: existing.error,
      };
    }

    const doc = this.docRepo.create({
      collectionId: input.collectionId,
      title: input.title,
      source: input.source ?? null,
      rawText: input.text,
      status: 'parsing',
      checksum,
      chunkCount: 0,
      error: null,
      docMeta: null,
    });
    const saved = await this.docRepo.save(doc);

    try {
      const texts = chunkText(input.text);
      const embeddings = await this.embeddingService.embed(texts);
      const rows = texts.map((content, i) =>
        this.chunkRepo.create({
          docId: saved.id,
          collectionId: input.collectionId,
          seq: i,
          content,
          embedding: embeddings[i] ?? null,
          meta: null,
        }),
      );
      if (rows.length) {
        await this.chunkRepo.save(rows);
      }
      saved.status = 'ready';
      saved.chunkCount = rows.length;
      saved.error = null;
      await this.docRepo.save(saved);
      return {
        docId: saved.id,
        title: saved.title,
        status: saved.status,
        chunkCount: saved.chunkCount,
        duplicate: false,
        error: null,
      };
    } catch (e) {
      saved.status = 'failed';
      saved.error = e instanceof Error ? e.message : String(e);
      await this.docRepo.save(saved);
      throw new BusinessException(`文档向量化失败: ${saved.error}`, 4000);
    }
  }

  /** 文档列表（不含 rawText，轻量） */
  async list(
    collectionId?: string,
    status?: 'parsing' | 'ready' | 'failed',
  ): Promise<KnowledgeDocEntity[]> {
    return this.docRepo.find({
      where: {
        ...(collectionId ? { collectionId } : {}),
        ...(status ? { status } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async get(id: string): Promise<KnowledgeDocEntity> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new BusinessException(`文档不存在: ${id}`, 4040);
    return doc;
  }

  /** 文档详情 + 分块（调试器/run 回放展示用） */
  async detail(id: string): Promise<{ doc: KnowledgeDocEntity; chunks: KnowledgeChunkEntity[] }> {
    const doc = await this.get(id);
    const chunks = await this.chunkRepo.find({
      where: { docId: id },
      order: { seq: 'ASC' },
    });
    return { doc, chunks };
  }

  /** 解析状态（MCP knowledge_status） */
  async status(id: string): Promise<{ docId: string; title: string; status: string; chunkCount: number; error: string | null }> {
    const doc = await this.get(id);
    return {
      docId: doc.id,
      title: doc.title,
      status: doc.status,
      chunkCount: doc.chunkCount,
      error: doc.error,
    };
  }

  /** 级联删除文档 + 分块 */
  async removeDoc(docId: string): Promise<void> {
    await this.get(docId);
    await this.chunkRepo.delete({ docId });
    await this.docRepo.delete(docId);
  }
}
