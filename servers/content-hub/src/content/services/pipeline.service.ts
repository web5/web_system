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
import { summarizePaper, summarizeNews } from '../processors/llm';
import { detectAiCategories } from '../processors/categorize';
import { buildDailyMarkdown, markdownToHtml, RenderItem } from '../processors/render';
import { IPublisher } from '../publishers/publisher.interface';
import { TencentDocsPublisher } from '../publishers/tencent-docs.publisher';
import { WechatMpPublisher } from '../publishers/wechat-mp/wechat-mp.publisher';

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
    private readonly tencentDocsPublisher: TencentDocsPublisher,
    private readonly wechatMpPublisher: WechatMpPublisher,
  ) {
    // 采集器注册表（新增来源在此登记）
    this.collectors = {
      arxiv: new ArxivCollector(),
      rss: new RssCollector(),
      hackernews: new HackerNewsCollector(),
    };
    // 发布器注册表
    this.publishers = {
      tencent_docs: tencentDocsPublisher,
      wechat_mp: wechatMpPublisher,
    };
  }

  /** 执行一条管线：按类型采集匹配源 → 处理入库 → 渲染日报 → 发布 */
  async run(pipelineCode: string): Promise<RunResult> {
    const pipeline = await this.pipelineRepo.findOne({ where: { code: pipelineCode } });
    if (!pipeline || !pipeline.enabled) {
      throw new Error(`管线 ${pipelineCode} 不存在或未启用`);
    }

    // 管线类型 → 目标源领域：paper 只采「论文」，ai-news 只采「AI」
    const categoryByType: Record<string, string> = {
      paper: '论文',
      'ai-news': 'AI',
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
      const renderItems: RenderItem[] = items.map((it) => ({
        title: it.title,
        summary: it.summary ?? '',
        url: it.url ?? undefined,
        source_name: it.source_name ?? undefined,
      }));
      const title = pipeline.title_template ?? `日报（${pipeline.code}）`;
      const markdown = buildDailyMarkdown(title, renderItems);

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
        });
        await this.publicationRepo.save(
          this.publicationRepo.create({
            item_id: 0,
            pipeline_id: pipeline.id,
            target,
            status: result.success ? 'success' : 'failed',
            external_id: result.external_id ?? null,
            detail: result.error ? { error: result.error } : null,
          }),
        );
        if (result.success) published++;
      }
    }

    this.logger.log(
      `管线 ${pipelineCode} 完成: 采集 ${collected}，新增 ${newItems}，错误 ${errors}，发布 ${published}`,
    );
    return { pipeline: pipelineCode, collected, newItems, errors, published };
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

    if (pipeline.type === 'paper') {
      const p = await summarizePaper(raw.title, raw.content);
      summary = p ? `【${p.译名}】${p.核心贡献} 方法：${p.方法亮点} 应用：${p.潜在应用}` : raw.content.slice(0, 200);
    } else {
      const n = await summarizeNews(raw.title, raw.content);
      summary = n?.摘要 ?? raw.content.slice(0, 100);
      tags = n?.标签 ?? null;
      category = n?.分类 ?? null;
    }
    if (!category) {
      category = detectAiCategories(raw.title, raw.content)[0] ?? null;
    }

    await this.itemRepo.save(
      this.itemRepo.create({
        pipeline_id: pipeline.id,
        source_id: source.id,
        external_id: raw.external_id,
        title: raw.title,
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
}
