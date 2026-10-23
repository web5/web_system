/** 内容管道查询/配置服务——源、管线 CRUD + 采集历史查询 + 手动触发 + 公众号发布 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, IsNull } from 'typeorm';
import { ContentSourceEntity } from '../entities/content-source.entity';
import { ContentPipelineEntity } from '../entities/content-pipeline.entity';
import { ContentItemEntity } from '../entities/content-item.entity';
import { ContentPublicationEntity } from '../entities/content-publication.entity';
import { PipelineService } from './pipeline.service';
import { WechatMpPublisher } from '../publishers/wechat-mp/wechat-mp.publisher';
import { PublishPayload, publicationStatus } from '../publishers/publisher.interface';
import {
  buildDailyMarkdown,
  markdownToHtml,
  type RenderItem,
} from '../processors/render';
import { ListItemsQueryDto } from '../dto/content-quality.dto';
import { renderPlaceholders, renderTitle } from './title.util';
import { ContentAccountService } from './content-account.service';

/**
 * 预览里能看到的失败原因（#405）。**白名单三件，多一个字段都不给。**
 *
 * 为什么不直接透出 `detail.error`：那是给日志看的原始串，会带上 access_token、
 * 部署绝对路径、第三方接口返回体片段。后台是浏览器页面，仓库又是 PUBLIC，
 * 一次截图就散出去了。所以这里做「结构 + 脱敏」两道：
 *   1. 结构：只留 code / message / at，其余字段一律不出现；
 *   2. 脱敏：message 里命中的凭证模式替换成 `***`，并截断长度。
 *
 * 反向约束（已写进单测）：页面上**不得**出现任何原始 token 片段。
 */
export interface PublicationFailure {
  /** 微信 errcode 之类的机器码，抓不到为 null */
  code: string | null;
  /** 脱敏后的可读原因 */
  message: string;
  /** 失败时间（ISO），取记录的 updated_at */
  at: string | null;
}

/**
 * 凭证类参数：`access_token=xxx` / `secret: xxx` / `"key":"xxx"` 等，值一律抹掉。
 * 两侧 `\b` 是必须的 —— 否则 `monkey=` `design=` 这类字段会被 `key` / `sig` 顺带命中，
 * 把无关字段也抹成 ***，排障时反而看不出是哪个参数坏了。
 */
const SECRET_PARAM = /\b((?:access[_-]?token|refresh[_-]?token|token|secret|app[_-]?secret|api[_-]?key|key|signature|sig)\b"?\s*[:=]\s*"?)([^&"'\s,}]{4,})/gi;
/** `Authorization: Bearer xxx` */
const BEARER = /(Bearer\s+)[\w.\-+/=]{8,}/gi;
/** 部署绝对路径（macOS / Linux / Windows），泄露服务器结构 */
const ABS_PATH = /(?:\/(?:Users|home|root|opt|var|data)\/[^\s"'<>)]{2,}|[A-Za-z]:\\[^\s"'<>)]{2,})/g;
/** 单条消息上限：够排障，不够拖库 */
const FAILURE_MAX = 400;

/**
 * 把原始错误串洗成可展示的失败原因。纯函数，导出以便单测直接钉死脱敏规则。
 */
export function redactFailure(raw: unknown, at?: Date | string | null): PublicationFailure | null {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const trimmed = text.trim();
  if (!trimmed) return null;

  const message = trimmed
    .replace(SECRET_PARAM, '$1***')
    .replace(BEARER, '$1***')
    .replace(ABS_PATH, '***')
    .replace(/\s+/g, ' ')
    .slice(0, FAILURE_MAX);

  // 机器码：优先 `[48001]`，其次 `errcode=48001` / `error_code: 48001`
  const code =
    message.match(/\[(\d{3,6})\]/)?.[1] ??
    message.match(/(?:err|error)[_-]?code\s*[:=]\s*(\d{1,6})/i)?.[1] ??
    null;

  const when = at == null ? null : new Date(at);
  return {
    code,
    message,
    at: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
  };
}

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
  /** 发布模式：draft=只进草稿箱，publish=直接发布（默认 publish） */
  mode?: 'draft' | 'publish';
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

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
    private readonly accountService: ContentAccountService,
  ) {}

  /**
   * 发布前解析账号快照（编码 + 主体类型）。
   *
   * 失败不能阻断发布：账号表还没 seed 时只是"不知道是谁发的"，
   * 内容照样要发出去、记录照样要落。所以这里吞掉异常，返回 null。
   */
  private async accountSnapshot(platform: string) {
    try {
      return await this.accountService.resolveForPublish(platform);
    } catch (e) {
      this.logger?.warn?.(`解析发布账号失败（按未登记处理）：${(e as Error).message}`);
      return null;
    }
  }

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
  async republishPublication(id: number, mode: 'draft' | 'publish' = 'publish') {
    const pub = await this.publicationRepo.findOne({ where: { id } });
    if (!pub) throw new NotFoundException(`发布记录 ${id} 不存在`);

    const detail = pub.detail as { payload?: PublishPayload & { markdown?: string; folder?: string } } | null;
    const payload = detail?.payload;
    if (!payload?.title) {
      throw new BadRequestException(
        '该发布记录未留存成文内容（2026-10-22 前的历史记录），无法重发；请重跑对应发布管线',
      );
    }

    // 存量记录的 payload.title 可能是未渲染的模板（2026-10-23 前的定时发布漏了替换，
    // 落库成「AI 资讯日报 ｜ {{date}}」）。重发前必须再渲染一次，否则会把原始模板
    // 发到微信端。日期沿用该条记录的创建日，保持与原发布一致。
    const title = renderTitle(payload.title, payload.title, pub.created_at);

    // 腾讯文档通道已于 2026-10-23 下线（A5）：库里可能仍有 target=tencent_docs 的历史记录，
    // 重发这类记录要给明确错误，而不是"找不到发布器"的 undefined 崩溃。
    if (pub.target !== 'wechat_mp') {
      throw new BadRequestException(
        `发布目标 ${pub.target} 已下线，仅支持 wechat_mp（腾讯文档通道 2026-10-23 下线）`,
      );
    }
    const result = await this.wechatMpPublisher.publish({
      title,
      html: payload.html ?? '',
      thumb_media_id: payload.thumb_media_id,
      digest: payload.digest,
      source_url: payload.source_url,
      account: payload.account,
      mode,
    });

    // 新记录里也存渲染后的标题，避免再次重发时重复踩同一个坑
    const renderedPayload = { ...payload, title };

    // 账号快照落在**重发时**：重发可能换到另一个主体类型的账号上，语义以这一次为准
    const account = await this.accountSnapshot(pub.target);

    const saved = await this.publicationRepo.save(
      this.publicationRepo.create({
        item_id: pub.item_id,
        pipeline_id: pub.pipeline_id,
        target: pub.target,
        status: publicationStatus(result),
        external_id: result.external_id ?? null,
        account_code: account?.account_code ?? null,
        account_type: account?.account_type ?? null,
        detail: {
          republish_of: Number(pub.id),
          ...(result.error ? { error: result.error } : {}),
          ...(result.media_id ? { media_id: result.media_id } : {}),
          mode,
          payload: renderedPayload,
        },
      }),
    );
    return {
      ok: result.success,
      success: result.success,
      publication_id: Number(saved.id),
      status: saved.status,
      external_id: result.external_id ?? null,
      media_id: result.media_id ?? null,
      error: result.error ?? null,
    };
  }

  /**
   * 按当前渲染器重建成文（#431：存量记录洗白）。
   *
   * 为什么做成显式动作，而不是在 `publicationPreview` 里顺手重建：stored 分支
   * 直传 `payload.html`，那是**发布当时**渲染好的产物，渲染器升级（#399 的裸 URL
   * 链接化、`{{date}}` 替换）对它完全无效。把改写塞进只读接口，等于让「看到的内容」
   * 随部署版本漂移、出现差异也无从归因 —— 所以做成写动作：运营点了才洗，留 rebuilt_at。
   *
   * 重建源头是 `payload.markdown`（`pipeline.service` 落库时同时存 markdown 与 html），
   * 因此这是**重新渲染**而不是给旧 HTML 打补丁：渲染器以后再怎么改，再点一次就是
   * 最新语义。不投递 —— 不发外网请求、不产生新记录（那是 republishPublication 的活）。
   */
  async rebuildPublication(id: number) {
    const pub = await this.publicationRepo.findOne({ where: { id } });
    if (!pub) throw new NotFoundException(`发布记录 ${id} 不存在`);

    const detail = (pub.detail ?? {}) as {
      payload?: PublishPayload & { markdown?: string; folder?: string };
    };
    const payload = detail.payload;
    if (!payload?.title) {
      throw new BadRequestException(
        '该发布记录未留存成文内容（2026-10-22 前的历史记录），无法重建；请重跑对应发布管线',
      );
    }
    // 只有 html 没有 markdown：成品反推不回源，重建等于把旧串又抄一遍，必须拒绝
    if (!payload.markdown) {
      throw new BadRequestException(
        '该记录只留存了 HTML 成品、没有 markdown 源，无法按当前渲染器重建；请重跑对应发布管线',
      );
    }

    // 与 republishPublication 同一套口径：日期沿用记录创建日，保持与原发布一致。
    // markdown 也要过一遍占位符：**存量记录的 markdown 是旧代码落的**（当时定时发布
    // 漏了 renderTitle），首行 `# 日报 ｜ {{date}}` 会原样进 h2 —— 只重渲 title
    // 修不掉正文里的这处，必须连 markdown 一起洗。
    const markdown = renderPlaceholders(payload.markdown, pub.created_at);
    const title = renderTitle(payload.title, payload.title, pub.created_at);
    const html = markdownToHtml(markdown);

    await this.publicationRepo.update(pub.id, {
      detail: {
        ...detail,
        payload: { ...payload, title, markdown, html },
        /** 洗白痕迹：谁在何时重算过，出问题可倒查 */
        rebuilt_at: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      id: Number(pub.id),
      title,
      /**
       * 两个 changed 让前端能区分「真变了」和「本来就新」：重复点不再假装成功，
       * 也顺带成为验证项（同一记录连点两次，第二次两个 false）。
       */
      title_changed: title !== payload.title,
      html_changed: html !== (payload.html ?? null),
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

    const detail = pub.detail as { error?: unknown } | null;

    /**
     * 失败原因（#405）：`status=failed` 时后台只能看到红叉、原因得去查库。
     * 这里脱敏后透出，三条返回路径共用 `base`，所以只写一次。
     *
     * 只对 failed 透出：`drafted` 记录里也有 error，但那是「已进草稿箱待发布」的
     * 提示语，不是失败 —— 挂成 failure 会让后台把它当错误展示，语义又反过来。
     */
    const failure =
      pub.status === 'failed'
        ? redactFailure(detail?.error, pub.updated_at ?? pub.created_at)
        : null;

    const base = {
      id: Number(pub.id),
      target: pub.target,
      status: pub.status,
      external_id: pub.external_id,
      published_at: pub.created_at,
      // 主体类型快照：抽屉里的状态文案（草稿 / 待发布）要跟列表保持一致
      account_code: pub.account_code ?? null,
      account_type: pub.account_type ?? null,
      failure,
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
      /**
       * 账号与主体类型快照（2026-10-23）：决定前端怎么呈现这条成文的状态。
       * 空 = 本功能上线前的历史记录，前端按「未登记」处理，不臆造类型。
       */
      account_code: p.account_code ?? null,
      account_type: p.account_type ?? null,
      detail: p.detail,
      /** 草稿 media_id：detail.media_id（草稿箱定位 + 后台按它搜） */
      media_id: (p.detail as { media_id?: string } | null)?.media_id ?? null,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  // ── 手动触发 ──
  runPipeline(code: string) {
    return this.pipelineService.run(code);
  }

  // ── 公众号 ──

  /**
   * 一键发布文章到公众号，落发布记录。
   *
   * mode 决定终点：`publish`（默认）建草稿后 freepublish 提交；
   * `draft` 只建草稿，落 status=drafted，可在后台对这条记录再点「正式发布」。
   */
  async publishWechatArticle(dto: WechatMpPublishDto) {
    const payload: PublishPayload = {
      title: dto.title,
      html: dto.html,
      thumb_media_id: dto.thumb_media_id,
      digest: dto.digest,
      source_url: dto.source_url,
      account: dto.account,
      mode: dto.mode ?? 'publish',
    };
    const result = await this.wechatMpPublisher.publish(payload);
    const account = await this.accountSnapshot('wechat_mp');
    const saved = await this.publicationRepo.save(
      this.publicationRepo.create({
        item_id: dto.item_id ?? 0,
        pipeline_id: null,
        target: 'wechat_mp',
        status: publicationStatus(result),
        external_id: result.external_id ?? null,
        account_code: account?.account_code ?? null,
        account_type: account?.account_type ?? null,
        detail: {
          ...(result.error ? { error: result.error } : {}),
          ...(result.media_id ? { media_id: result.media_id } : {}),
          mode: payload.mode,
          // p40：留存成文 payload，供「重新发布 / 成文预览」复用（无 payload 的历史记录只能靠聚合重建）
          payload,
        },
      }),
    );
    return {
      // success 保留：MCP 工具 create_wechat_draft / publish_to_wechat 的调用方按它判成败
      success: result.success,
      ok: result.success,
      publication_id: Number(saved.id),
      status: saved.status,
      external_id: result.external_id ?? null,
      media_id: result.media_id ?? null,
      error: result.error ?? null,
    };
  }

  /**
   * 只建草稿不发布，返回 media_id，**并落一条发布记录**。
   *
   * 之前草稿不落库，后台完全看不到、也没法对草稿再点发布——草稿成了黑洞。
   * 现在统一走 publish({mode:'draft'})，与正式发布共用落库与预览/重发链路。
   */
  async createWechatDraft(dto: WechatMpPublishDto) {
    return this.publishWechatArticle({ ...dto, mode: 'draft' });
  }
}
