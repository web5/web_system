/** 内容管道查询/配置服务——源、管线 CRUD + 采集历史查询 + 手动触发 + 公众号发布 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, IsNull } from 'typeorm';
import { ContentSourceEntity } from '../entities/content-source.entity';
import { ContentPipelineEntity } from '../entities/content-pipeline.entity';
import { ContentItemEntity } from '../entities/content-item.entity';
import { ContentPublicationEntity } from '../entities/content-publication.entity';
import { PipelineService } from './pipeline.service';
import { WechatMpPublisher } from '../publishers/wechat-mp/wechat-mp.publisher';
import { TencentDocsPublisher } from '../publishers/tencent-docs.publisher';
import { PublishPayload } from '../publishers/publisher.interface';
import {
  buildDailyMarkdown,
  markdownToHtml,
  type RenderItem,
} from '../processors/render';
import { ListItemsQueryDto } from '../dto/content-quality.dto';
import { renderTitle } from './title.util';

/** 公众号发布/建稿入参 */
export interface WechatMpPublishDto {
  title: string;
  html: string;
  thumb_media_id?: string;
  digest?: string;
  source_url?: string;
  /** 关联内容条目 ID（发布记录用，可省略） */
  item_id?: number;
  /** 公众号账号：不传用默认号（大橙子社区），传 kedouai 用科豆AI 号 */
  account?: string;
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
    private readonly tencentDocsPublisher: TencentDocsPublisher,
  ) {}

  // ── 采集源 ──
  listSources() {
    return this.sourceRepo.find({ order: { id: 'ASC' } });
  }

  /** 单条采集源（编辑页回显） */
  getSource(id: number) {
    return this.sourceRepo.findOne({ where: { id } });
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

  /** 单条管线（编辑页回显） */
  getPipeline(id: number) {
    return this.pipelineRepo.findOne({ where: { id } });
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

  /**
   * 采集明细列表（p40：五维筛选 + 服务端分页，admin「采集明细」页）。
   *
   * 筛选维度与 ListItemsQueryDto 对齐：status / quality_status / quality_stage /
   * pipeline / source / keyword / date_from ~ date_to。分页用 take/skip，
   * 总量 getManyAndCount 一次查出。
   */
  async listItems(query: ListItemsQueryDto = {}) {
    const limit = Math.min(query.limit ?? 20, 200);
    const offset = query.offset ?? 0;

    const qb = this.itemRepo
      .createQueryBuilder('item')
      .leftJoinAndMapOne(
        'item.pipeline',
        ContentPipelineEntity,
        'p',
        'p.id = item.pipeline_id',
      )
      .orderBy('item.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.status) qb.andWhere('item.status = :status', { status: query.status });
    if (query.quality_status) {
      qb.andWhere('item.quality_status = :qs', { qs: query.quality_status });
    }
    if (query.quality_stage) {
      qb.andWhere('item.quality_stage = :qst', { qst: query.quality_stage });
    }
    if (query.pipeline) {
      qb.andWhere('item.pipeline_id = :pipeline', { pipeline: query.pipeline });
    }
    if (query.source) {
      qb.andWhere('item.source_id = :source', { source: query.source });
    }
    if (query.keyword) {
      qb.andWhere('(item.title LIKE :kw OR item.summary LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    if (query.date_from) {
      qb.andWhere('item.publish_date >= :df', { df: query.date_from });
    }
    if (query.date_to) {
      // date_to 是日期串（yyyy-MM-dd），补到当天末刻，否则当天的记录会被漏掉
      qb.andWhere('item.publish_date <= :dt', { dt: `${query.date_to} 23:59:59` });
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      total,
      items: rows.map((it) => this.toItemVO(it, (it as { pipeline?: ContentPipelineEntity }).pipeline)),
    };
  }

  /** 明细统计行（admin「采集明细」页顶部四卡） */
  async itemStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [todayNew, todayDedup, abnormal, intoArticle] = await Promise.all([
      this.itemRepo.count({ where: { created_at: Between(todayStart, new Date()) } }),
      this.itemRepo.count({
        where: { quality_status: 'skip', created_at: Between(todayStart, new Date()) },
      }),
      this.itemRepo
        .createQueryBuilder('item')
        // ⚠️ 曾写成 'IN (:...qs'（缺右括号 + 多写 ...），生成的 SQL 未闭合 →
        //    MySQL 报 "syntax error near '' at line 1"，整页 500。改这里务必跑 content.service.spec。
        .where('item.quality_status IN (:qs)', { qs: ['fail', 'partial'] })
        .andWhere('item.created_at >= :since', { since: weekAgo })
        .getCount(),
      this.itemRepo
        .createQueryBuilder('item')
        .where('item.pipeline_id IS NOT NULL')
        .andWhere('item.created_at >= :since', { since: weekAgo })
        .getCount(),
    ]);

    return { today_new: todayNew, today_dedup: todayDedup, quality_abnormal_7d: abnormal, into_article_7d: intoArticle };
  }

  /** 单条明细详情（含关联管线 / 源 / 发布记录） */
  async getItemDetail(id: number) {
    const item = await this.itemRepo.findOne({ where: { id } });
    if (!item) return null;

    const [pipeline, source, publications] = await Promise.all([
      item.pipeline_id
        ? this.pipelineRepo.findOne({ where: { id: item.pipeline_id } })
        : Promise.resolve(null),
      item.source_id
        ? this.sourceRepo.findOne({ where: { id: item.source_id } })
        : Promise.resolve(null),
      this.publicationRepo.find({
        where: { item_id: id },
        order: { created_at: 'DESC' },
      }),
    ]);

    return {
      item: this.toItemVO(item, pipeline),
      pipeline: pipeline ? { id: Number(pipeline.id), code: pipeline.code, type: pipeline.type } : null,
      source: source ? { id: Number(source.id), code: source.code, name: source.name, type: source.type } : null,
      publications: publications.map((p) => this.toPublicationVO(p)),
    };
  }

  /** 条目 → 前端 VO（bigint 转 number，补管线编码） */
  private toItemVO(it: ContentItemEntity, pipeline?: ContentPipelineEntity | null) {
    return {
      id: Number(it.id),
      external_id: it.external_id,
      title: it.title,
      url: it.url,
      summary: it.summary,
      content: it.content,
      category: it.category,
      tags: it.tags,
      source_id: it.source_id ? Number(it.source_id) : null,
      source_name: it.source_name,
      pipeline_id: it.pipeline_id ? Number(it.pipeline_id) : null,
      pipeline_code: pipeline?.code ?? null,
      publish_date: it.publish_date,
      status: it.status,
      quality_status: it.quality_status,
      quality_stage: it.quality_stage,
      quality_issue: it.quality_issue,
      collect_duration_ms: it.collect_duration_ms,
      simhash: it.simhash,
      meta: it.meta,
      error: it.error,
      created_at: it.created_at,
      updated_at: it.updated_at,
    };
  }

  // ── 发布记录 ──

  /**
   * 成文发布记录列表（p40：目标/状态筛选 + 服务端分页 + 关联条目标题，
   * admin「公众号成文」页）。一条发布记录 = 一次投递动作（支持失败重发，
   * 重发会产生新记录，republish_of 指向原记录）。
   */
  async listPublications(
    query: { limit?: number; offset?: number; target?: string; status?: string } = {},
  ) {
    const limit = Math.min(query.limit ?? 20, 200);
    const qb = this.publicationRepo
      .createQueryBuilder('pub')
      .leftJoinAndMapOne('pub.item', ContentItemEntity, 'i', 'i.id = pub.item_id')
      .orderBy('pub.created_at', 'DESC')
      .take(limit)
      .skip(query.offset ?? 0);
    if (query.target) qb.andWhere('pub.target = :target', { target: query.target });
    if (query.status) qb.andWhere('pub.status = :status', { status: query.status });

    const [rows, total] = await qb.getManyAndCount();
    return {
      total,
      items: rows.map((p) =>
        this.toPublicationVO(p, (p as { item?: ContentItemEntity }).item),
      ),
    };
  }

  /**
   * 重新发布（Q3：failed 成文一键重发）。
   *
   * 依赖发布时留存在 detail.payload 里的成文内容（p40 起才有）；
   * 2026-10-22 前的历史记录没有 payload，重发会报错引导重跑管线。
   * 重发产生**新记录**（不覆盖原失败记录，保留审计痕迹）。
   */
  async republishPublication(id: number) {
    const pub = await this.publicationRepo.findOne({ where: { id } });
    if (!pub) throw new NotFoundException(`发布记录 ${id} 不存在`);

    const detail = pub.detail as { payload?: PublishPayload & { markdown?: string; folder?: string } } | null;
    const payload = detail?.payload;
    if (!payload?.title) {
      throw new BadRequestException(
        '该发布记录未留存成文内容（2026-10-22 前的历史记录），无法重发；请重跑对应发布管线',
      );
    }

    const result =
      pub.target === 'wechat_mp'
        ? await this.wechatMpPublisher.publish({
            title: payload.title,
            html: payload.html ?? '',
            thumb_media_id: payload.thumb_media_id,
            digest: payload.digest,
            source_url: payload.source_url,
            account: payload.account,
          })
        : await this.tencentDocsPublisher.publish({
            title: payload.title,
            markdown: payload.markdown ?? '',
            folder: payload.folder,
          });

    const saved = await this.publicationRepo.save(
      this.publicationRepo.create({
        item_id: pub.item_id,
        pipeline_id: pub.pipeline_id,
        target: pub.target,
        status: result.success ? 'success' : 'failed',
        external_id: result.external_id ?? null,
        detail: {
          republish_of: Number(pub.id),
          ...(result.error ? { error: result.error } : {}),
          payload,
        },
      }),
    );
    return {
      ok: result.success,
      publication_id: Number(saved.id),
      status: saved.status,
      external_id: result.external_id ?? null,
      error: result.error ?? null,
    };
  }

  /**
   * 成文预览（Q5：按文章级聚合，不加新表）。
   *
   * 两条路径：
   *   1. p40 起发布的记录：detail.payload 里存了标题 + 成文，直接渲染；
   *   2. 历史记录：按「管线 + 发布当日」聚合 content_items（meta.digest 四字段
   *      已在 summary 里），用日报渲染器重建文章。
   */
  async publicationPreview(id: number) {
    const pub = await this.publicationRepo.findOne({ where: { id } });
    if (!pub) return null;

    const base = {
      id: Number(pub.id),
      target: pub.target,
      status: pub.status,
      external_id: pub.external_id,
      published_at: pub.created_at,
    };

    const payload = (pub.detail as { payload?: { title?: string; html?: string; markdown?: string } } | null)
      ?.payload;
    if (payload?.title && (payload.html || payload.markdown)) {
      return {
        ...base,
        title: payload.title,
        html: payload.html ?? markdownToHtml(payload.markdown ?? ''),
        item_count: null,
        source: 'stored' as const,
      };
    }

    if (!pub.pipeline_id) {
      return {
        ...base,
        title: '（无成文内容）',
        html: '<p>该发布记录未留存成文内容，且不归属任何管线，无法重建预览。</p>',
        item_count: 0,
        source: 'none' as const,
      };
    }

    // 历史记录：管线 + 发布当日聚合
    const pipeline = await this.pipelineRepo.findOne({ where: { id: pub.pipeline_id } });
    const dayStart = new Date(pub.created_at);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(pub.created_at);
    dayEnd.setHours(23, 59, 59, 999);

    const items = await this.itemRepo
      .createQueryBuilder('item')
      .where('item.pipeline_id = :pid', { pid: pub.pipeline_id })
      .andWhere('item.created_at BETWEEN :s AND :e', { s: dayStart, e: dayEnd })
      .orderBy('item.created_at', 'ASC')
      .take(50)
      .getMany();

    // 与定时发布路径共用同一渲染函数（pub.created_at = 该次发布日期，非当前时间）
    const title = renderTitle(
      pipeline?.title_template,
      `日报（${pipeline?.code ?? ''}）`,
      pub.created_at,
    );
    const renderItems: RenderItem[] = items.map((it) => ({
      title: it.title,
      summary: it.summary ?? '',
      url: it.url ?? undefined,
      source_name: it.source_name ?? undefined,
    }));
    const markdown = buildDailyMarkdown(title, renderItems);
    return {
      ...base,
      title,
      html: markdownToHtml(markdown),
      item_count: items.length,
      source: 'aggregated' as const,
    };
  }

  /** 发布记录 → 前端 VO（关联条目标题供成文列表展示） */
  private toPublicationVO(p: ContentPublicationEntity, item?: ContentItemEntity | null) {
    return {
      id: Number(p.id),
      item_id: Number(p.item_id),
      item_title: item?.title ?? null,
      pipeline_id: p.pipeline_id ? Number(p.pipeline_id) : null,
      target: p.target,
      status: p.status,
      external_id: p.external_id,
      detail: p.detail,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
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
      account: dto.account,
    };
    const result = await this.wechatMpPublisher.publish(payload);
    await this.publicationRepo.save(
      this.publicationRepo.create({
        item_id: dto.item_id ?? 0,
        pipeline_id: null,
        target: 'wechat_mp',
        status: result.success ? 'success' : 'failed',
        external_id: result.external_id ?? null,
        detail: {
          ...(result.error ? { error: result.error } : {}),
          // p40：留存成文 payload，供「重新发布 / 成文预览」复用（无 payload 的历史记录只能靠聚合重建）
          payload,
        },
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
      account: dto.account,
    };
    return this.wechatMpPublisher.createDraft(payload);
  }
}
