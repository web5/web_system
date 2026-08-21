/** 内容管道查询/配置服务——源、管线 CRUD + 采集历史查询 + 手动触发 + 公众号发布 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentSourceEntity } from '../entities/content-source.entity';
import { ContentPipelineEntity } from '../entities/content-pipeline.entity';
import { ContentItemEntity } from '../entities/content-item.entity';
import { ContentPublicationEntity } from '../entities/content-publication.entity';
import { PipelineService } from './pipeline.service';
import { WechatMpPublisher } from '../publishers/wechat-mp/wechat-mp.publisher';
import { PublishPayload } from '../publishers/publisher.interface';

/** 公众号发布/建稿入参 */
export interface WechatMpPublishDto {
  title: string;
  html: string;
  thumb_media_id?: string;
  digest?: string;
  source_url?: string;
  /** 关联内容条目 ID（发布记录用，可省略） */
  item_id?: number;
}

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(ContentSourceEntity)
    private readonly sourceRepo: Repository<ContentSourceEntity>,
    @InjectRepository(ContentPipelineEntity)
    private readonly pipelineRepo: Repository<ContentPipelineEntity>,
    @InjectRepository(ContentItemEntity)
    private readonly itemRepo: Repository<ContentItemEntity>,
    @InjectRepository(ContentPublicationEntity)
    private readonly publicationRepo: Repository<ContentPublicationEntity>,
    private readonly pipelineService: PipelineService,
    private readonly wechatMpPublisher: WechatMpPublisher,
  ) {}

  // ── 采集源 ──
  listSources() {
    return this.sourceRepo.find({ order: { id: 'ASC' } });
  }

  createSource(dto: Partial<ContentSourceEntity>) {
    return this.sourceRepo.save(this.sourceRepo.create(dto));
  }

  async updateSource(id: number, dto: Partial<ContentSourceEntity>) {
    await this.sourceRepo.update(id, dto as any);
    return this.sourceRepo.findOne({ where: { id } });
  }

  async deleteSource(id: number) {
    await this.sourceRepo.softDelete(id);
    return { ok: true };
  }

  // ── 管线 ──
  listPipelines() {
    return this.pipelineRepo.find({ order: { id: 'ASC' } });
  }

  createPipeline(dto: Partial<ContentPipelineEntity>) {
    return this.pipelineRepo.save(this.pipelineRepo.create(dto));
  }

  async updatePipeline(id: number, dto: Partial<ContentPipelineEntity>) {
    await this.pipelineRepo.update(id, dto as any);
    return this.pipelineRepo.findOne({ where: { id } });
  }

  async deletePipeline(id: number) {
    await this.pipelineRepo.softDelete(id);
    return { ok: true };
  }

  // ── 采集历史 ──
  async listItems(limit = 50, status?: string, pipelineCode?: string) {
    const qb = this.itemRepo
      .createQueryBuilder('item')
      .leftJoinAndMapOne('item.pipeline', ContentPipelineEntity, 'p', 'p.id = item.pipeline_id')
      .orderBy('item.created_at', 'DESC')
      .take(Math.min(limit, 200));
    if (status) qb.andWhere('item.status = :status', { status });
    if (pipelineCode) qb.andWhere('p.code = :pipelineCode', { pipelineCode });
    return qb.getMany();
  }

  // ── 发布记录 ──
  listPublications(limit = 50) {
    return this.publicationRepo.find({ order: { created_at: 'DESC' }, take: Math.min(limit, 200) });
  }

  // ── 手动触发 ──
  runPipeline(code: string) {
    return this.pipelineService.run(code);
  }

  // ── 公众号 ──

  /** 一键发布文章到公众号：建草稿 → freepublish 提交，落发布记录 */
  async publishWechatArticle(dto: WechatMpPublishDto) {
    const payload: PublishPayload = {
      title: dto.title,
      html: dto.html,
      thumb_media_id: dto.thumb_media_id,
      digest: dto.digest,
      source_url: dto.source_url,
    };
    const result = await this.wechatMpPublisher.publish(payload);
    await this.publicationRepo.save(
      this.publicationRepo.create({
        item_id: dto.item_id ?? 0,
        pipeline_id: null,
        target: 'wechat_mp',
        status: result.success ? 'success' : 'failed',
        external_id: result.external_id ?? null,
        detail: result.error ? { error: result.error } : null,
      }),
    );
    return result;
  }

  /** 只建草稿不发布（供预览/确认），返回 media_id */
  async createWechatDraft(dto: WechatMpPublishDto) {
    const payload: PublishPayload = {
      title: dto.title,
      html: dto.html,
      thumb_media_id: dto.thumb_media_id,
      digest: dto.digest,
      source_url: dto.source_url,
    };
    return this.wechatMpPublisher.createDraft(payload);
  }
}
