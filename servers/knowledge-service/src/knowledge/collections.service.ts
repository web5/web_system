import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { KnowledgeCollectionEntity } from './entities/knowledge-collection.entity';
import { KnowledgeDocEntity } from './entities/knowledge-doc.entity';
import { KnowledgeChunkEntity } from './entities/knowledge-chunk.entity';

export interface CollectionListItem {
  id: string;
  name: string;
  description: string | null;
  embedModel: string;
  enabled: boolean;
  docCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class KnowledgeCollectionService {
  constructor(
    @InjectRepository(KnowledgeCollectionEntity)
    private readonly collectionRepo: Repository<KnowledgeCollectionEntity>,
    @InjectRepository(KnowledgeDocEntity)
    private readonly docRepo: Repository<KnowledgeDocEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
  ) {}

  /** 管理列表：集合 + 文档数聚合 */
  async list(): Promise<CollectionListItem[]> {
    const rows = await this.collectionRepo.find({
      order: { createdAt: 'DESC' },
    });
    const counts = await this.countsByCollection();
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      embedModel: c.embedModel,
      enabled: c.enabled,
      docCount: counts.get(c.id) ?? 0,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : '',
      updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : '',
    }));
  }

  async get(id: string): Promise<KnowledgeCollectionEntity> {
    const row = await this.collectionRepo.findOne({ where: { id } });
    if (!row) throw new BusinessException(`知识集合不存在: ${id}`, 4040);
    return row;
  }

  /** 校验存在且启用；停用集合任何调用返回明确错误（R3.4） */
  async mustEnabled(id: string): Promise<KnowledgeCollectionEntity> {
    const row = await this.get(id);
    if (!row.enabled) throw new BusinessException(`知识集合已停用: ${row.name}`);
    return row;
  }

  async create(input: { name: string; description?: string; embedModel?: string; createdBy?: string }): Promise<KnowledgeCollectionEntity> {
    const row = this.collectionRepo.create({
      name: input.name,
      description: input.description ?? null,
      embedModel: input.embedModel ?? 'tokenhub',
      enabled: true,
      meta: null,
      createdBy: input.createdBy ?? null,
    });
    return this.collectionRepo.save(row);
  }

  async update(id: string, input: { name?: string; description?: string; embedModel?: string }): Promise<KnowledgeCollectionEntity> {
    const row = await this.get(id);
    if (input.name !== undefined) row.name = input.name;
    if (input.description !== undefined) row.description = input.description ?? null;
    if (input.embedModel !== undefined) row.embedModel = input.embedModel;
    return this.collectionRepo.save(row);
  }

  async toggle(id: string, enabled: boolean): Promise<KnowledgeCollectionEntity> {
    const row = await this.get(id);
    row.enabled = enabled;
    return this.collectionRepo.save(row);
  }

  /** 级联删除集合 + 其下文档与分块 */
  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    await this.chunkRepo.delete({ collectionId: row.id });
    await this.docRepo.delete({ collectionId: row.id });
    await this.collectionRepo.delete(row.id);
  }

  /** 文档数按集合聚合 */
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
