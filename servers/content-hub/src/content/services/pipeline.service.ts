/** 通用管线编排：collect → dedup → process → render → publish → record */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentSourceEntity } from '../entities/content-source.entity';
import { ContentPipelineEntity } from '../entities/content-pipeline.entity';
import { ContentItemEntity } from '../entities/content-item.entity';
import { ContentPublicationEntity } from '../entities/content-publication.entity';
import { ICollector, RawItem } from '../collectors/collector.interface';
import { ArxivCollector } from '../collectors/arxiv.collector';
import { RssCollector } from '../collectors/rss.collector';
import { HackerNewsCollector } from '../collectors/hackernews.collector';
import { simhash } from '../../common/dedup';
import { detectLang, looksChinese } from '../../common/lang';
import { summarizePaper, summarizeNews, translateTitle } from '../processors/llm';
import { detectAiCategories } from '../processors/categorize';
import { buildDailyMarkdown, markdownToHtml, toRenderItem, RenderItem } from '../processors/render';
import { renderTitle } from './title.util';
import { IPublisher, publicationStatus } from '../publishers/publisher.interface';
import { WechatMpPublisher } from '../publishers/wechat-mp/wechat-mp.publisher';
import { ContentAccountService } from './content-account.service';
import { MediaService } from './media.service';

export interface RunResult {
  pipeline: string;
  collected: number;
  newItems: number;
  errors: number;
  published: number;
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private readonly collectors: Record<string, ICollector>;
  private readonly publishers: Record<string, IPublisher>;

  constructor(
    @InjectRepository(ContentSourceEntity)
    private readonly sourceRepo: Repository<ContentSourceEntity>,
    @InjectRepository(ContentPipelineEntity)
    private readonly pipelineRepo: Repository<ContentPipelineEntity>,
    @InjectRepository(ContentItemEntity)
    private readonly itemRepo: Repository<ContentItemEntity>,
    @InjectRepository(ContentPublicationEntity)
    private readonly publicationRepo: Repository<ContentPublicationEntity>,
    private readonly wechatMpPublisher: WechatMpPublisher,
    private readonly accountService: ContentAccountService,
    private readonly mediaService: MediaService,
  ) {
    // 采集器注册表（新增来源在此登记）
    this.collectors = {
      arxiv: new ArxivCollector(),
      rss: new RssCollector(),
      hackernews: new HackerNewsCollector(),
    };
    // 发布器注册表
    // 腾讯文档通道 2026-10-23 下线（A5），注册表只留公众号
    this.publishers = {
      wechat_mp: wechatMpPublisher,
    };
  }

  /** 执行一条管线：按类型采集匹配源 → 处理入库 → 渲染日报 → 发布 */
  async run(pipelineCode: string): Promise<RunResult> {
    const pipeline = await this.pipelineRepo.findOne({ where: { code: pipelineCode } });
    if (!pipeline || !pipeline.enabled) {
      throw new Error(`管线 ${pipelineCode} 不存在或未启用`);
    }

    // 管线类型 → 目标源领域：paper 只采「论文」，ai-news 只采「AI」，hot-news 只采「热点」
    const categoryByType: Record<string, string> = {
      paper: '论文',
      'ai-news': 'AI',
      'hot-news': '热点',
    };
    const targetCategory = categoryByType[pipeline.type];
    const allSources = await this.sourceRepo.find({ where: { enabled: true } });
    const sources = targetCategory
      ? allSources.filter((s) => s.category === targetCategory)
      : allSources;
    let collected = 0;
    let newItems = 0;
    let errors = 0;

    for (const source of sources) {
      const collector = this.collectors[source.type];
      if (!collector) {
        this.logger.warn(`无采集器 ${source.type}，跳过源 ${source.code}`);
        continue;
      }
      try {
        const rawList = await collector.collect(source.config ?? {}, 10);
        for (const raw of rawList) {
          collected++;
          const created = await this.processItem(pipeline, source, raw);
          if (created) newItems++;
        }
      } catch (e) {
        this.logger.error(`源 ${source.code} 采集失败: ${(e as Error).message}`);
        errors++;
      }
    }

    // 渲染日报（取该管线最近入库、未发布的条目）
    let published = 0;
    const items = await this.itemRepo.find({
      where: { pipeline_id: pipeline.id },
      order: { created_at: 'DESC' },
      take: 20,
    });
    if (items.length > 0) {
      const renderItems: RenderItem[] = items.map(toRenderItem);
      // 与「重新发布 / 成文预览」路径共用同一渲染函数，避免 {{date}} 漏替换
      const title = renderTitle(pipeline.title_template, `日报（${pipeline.code}）`);
      const markdown = buildDailyMarkdown(title, renderItems);

      /**
       * 封面：管线绑了默认封面就解析成 `thumb_media_id`；没绑或同步失败都返回 undefined，
       * 交给发布器继续走「正文首图 → 通用兜底封面」。封面环节绝不能把发布卡死。
       */
      let thumbMediaId: string | undefined;
      let usedCoverId: number | null = null;
      if (pipeline.default_cover_id) {
        const coverId = Number(pipeline.default_cover_id);
        const mediaId = await this.mediaService.ensureWechatMediaId(coverId, 'default');
        if (mediaId) {
          thumbMediaId = mediaId;
          usedCoverId = coverId;
        } else {
          this.logger.warn(
            `管线 ${pipeline.code} 的默认封面 #${coverId} 不可用，本次退回兜底封面`,
          );
        }
      }

      for (const target of pipeline.publish_targets ?? []) {
        const publisher = this.publishers[target];
        if (!publisher) {
          this.logger.warn(`无发布器 ${target}，跳过`);
          continue;
        }
        const result = await publisher.publish({
          title,
          markdown,
          // 公众号通道：日报 markdown 转 HTML（图片已由发布器处理）
          html: target === 'wechat_mp' ? markdownToHtml(markdown) : undefined,
          folder: pipeline.tencent_folder ?? undefined,
          // 封面只在公众号通道有用（腾讯文档没有封面概念）
          ...(target === 'wechat_mp' && thumbMediaId ? { thumb_media_id: thumbMediaId } : {}),
          // 发布模式只对公众号生效（腾讯文档没有草稿概念），未配置按 publish
          mode:
            target === 'wechat_mp' && pipeline.publish_mode === 'draft' ? 'draft' : 'publish',
        });
        // 账号快照：主体类型决定这条成文在后台显示成「草稿」还是「待发布」
        const account = await this.resolveAccount(target);
        await this.publicationRepo.save(
          this.publicationRepo.create({
            item_id: 0,
            pipeline_id: pipeline.id,
            target,
            status: publicationStatus(result),
            external_id: result.external_id ?? null,
            account_code: account?.account_code ?? null,
            account_type: account?.account_type ?? null,
            // 封面快照：素材日后被改名/换图，这条记录仍要能说明当时用的是哪张
            cover_media_id: target === 'wechat_mp' ? usedCoverId : null,
            detail: {
              ...(result.error ? { error: result.error } : {}),
              ...(result.media_id ? { media_id: result.media_id } : {}),
              // p40：留存成文 payload，供「重新发布 / 成文预览」复用（无 payload 的历史记录靠聚合重建）
              payload: {
                title,
                markdown,
                ...(target === 'wechat_mp' ? { html: markdownToHtml(markdown) } : {}),
                ...(target === 'wechat_mp' && thumbMediaId
                  ? { thumb_media_id: thumbMediaId }
                  : {}),
                folder: pipeline.tencent_folder ?? undefined,
              },
            },
          }),
        );
        // 用一次记一次，便于日后判断「哪张封面真的在用」
        if (usedCoverId && target === 'wechat_mp' && (result.success || result.drafted)) {
          await this.mediaService.markUsed(usedCoverId);
        }
        // 草稿不算「已发布」：它停在草稿箱，读者还看不到
        if (result.success && !result.drafted) published++;
      }
    }

    this.logger.log(
      `管线 ${pipelineCode} 完成: 采集 ${collected}，新增 ${newItems}，错误 ${errors}，发布 ${published}`,
    );
    return { pipeline: pipelineCode, collected, newItems, errors, published };
  }

  /** 解析发布账号（查不到就当未登记，不阻断发布） */
  private async resolveAccount(platform: string) {
    try {
      return await this.accountService.resolveForPublish(platform);
    } catch (e) {
      this.logger.warn(`解析发布账号失败（按未登记处理）：${(e as Error).message}`);
      return null;
    }
  }

  /** 处理单条：去重 → LLM 摘要 → 入库 */
  private async processItem(
    pipeline: ContentPipelineEntity,
    source: ContentSourceEntity,
    raw: RawItem,
  ): Promise<boolean> {
    const text = `${raw.title}${raw.content}`;
    const fingerprint = simhash(text);

    // 去重：同管线同源内不重复
    const existing = await this.itemRepo.findOne({
      where: { pipeline_id: pipeline.id, external_id: raw.external_id },
    });
    if (existing) return false;

    let summary = '';
    let category: string | null = null;
    let tags: string[] | null = null;
    /** 摘要阶段顺带给出的中文标题（prompt 里的 `标题` / 论文的 `译名`） */
    let promptTitle: string | null = null;

    if (pipeline.type === 'paper') {
      const p = await summarizePaper(raw.title, raw.content, pipeline.llm_prompt);
      summary = p
        ? `【${p.译名}】${p.核心贡献} 方法：${p.方法亮点} 应用：${p.潜在应用}`
        : raw.content.slice(0, 200);
      // 论文的「译名」本质就是中文标题，此前只拼进 summary 前缀就丢掉了
      promptTitle = p?.译名 ?? null;
    } else {
      // ai-news / hot-news 共用 summarizeNews；pipeline.llm_prompt 为空时走内置默认
      const n = await summarizeNews(raw.title, raw.content, pipeline.llm_prompt);
      summary = n?.摘要 ?? raw.content.slice(0, 100);
      tags = n?.标签 ?? null;
      category = n?.分类 ?? null;
      promptTitle = n?.标题 ?? null;
    }
    if (!category) {
      category = detectAiCategories(raw.title, raw.content)[0] ?? null;
    }

    // 加工阶段的最后一步：标题中文化（中文源直接跳过，不烧调用）
    const titleZh = await this.localizeTitle(raw.title, promptTitle);

    await this.itemRepo.save(
      this.itemRepo.create({
        pipeline_id: pipeline.id,
        source_id: source.id,
        external_id: raw.external_id,
        title: raw.title,
        title_zh: titleZh,
        source_lang: detectLang(raw.title),
        url: raw.url ?? null,
        content: raw.content,
        summary,
        category,
        tags,
        simhash: fingerprint,
        source_name: source.name,
        publish_date: raw.publish_date ?? null,
        status: 'processed',
      }),
    );
    return true;
  }

  /**
   * 标题中文化——三层兜底，任何一层成功都算过；全失败返回 null（渲染回落原文）。
   *
   *   ① 原文本来就是中文       → 返回 null，**不消耗任何调用**（中文源占多数，这条是省钱的）
   *   ② 摘要 prompt 顺带给了译名 → 直接用（主路径，零额外成本）
   *   ③ 前两层都没有           → 单独调 `translateTitle()` 补一次
   *
   * 第②层要再用 `looksChinese` 验一遍：LLM 有时把 `标题` 原样返回成英文
   * （尤其 prompt 被改短时），不验就会把英文标题写进 `title_zh`，
   * 渲染时「中文标题优先」反而把原文顶掉了——比不翻更糟。
   */
  private async localizeTitle(
    rawTitle: string,
    promptTitle?: string | null,
  ): Promise<string | null> {
    if (looksChinese(rawTitle)) return null;

    const candidate = promptTitle?.trim();
    if (candidate && looksChinese(candidate)) return candidate.slice(0, 500);

    const translated = await translateTitle(rawTitle);
    return translated ? translated.slice(0, 500) : null;
  }
}
