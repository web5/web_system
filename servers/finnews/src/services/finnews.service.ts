import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, MoreThanOrEqual } from 'typeorm';
import { TopicEntity } from '../entities/topic.entity';
import { NewsEntity } from '../entities/news.entity';
import { EntityEntity } from '../entities/entity.entity';
import { collectAll, RawNews } from '../collectors/collector';
import { simhash } from '../processors/dedup';
import { generateSummary, analyzeSentiment } from '../processors/llm';

@Injectable()
export class FinnewsService implements OnModuleInit {
  private readonly logger = new Logger(FinnewsService.name);

  constructor(
    @InjectRepository(TopicEntity)
    private readonly topicRepo: Repository<TopicEntity>,
    @InjectRepository(NewsEntity)
    private readonly newsRepo: Repository<NewsEntity>,
    @InjectRepository(EntityEntity)
    private readonly entityRepo: Repository<EntityEntity>,
  ) {}

  /** 启动后异步采集一次（不阻塞启动） */
  onModuleInit(): void {
    this.collectOnce()
      .then((r) => this.logger.log(`首次采集完成: ${JSON.stringify(r)}`))
      .catch((e) => this.logger.error(`首次采集失败: ${(e as Error).message}`));
  }

  /** 采集一次并处理入库 */
  async collectOnce(): Promise<{ total: number; newTopics: number; errors: number }> {
    const rawList = await collectAll();
    let newTopics = 0;
    let errors = 0;

    for (const raw of rawList) {
      try {
        const created = await this.processSingle(raw);
        if (created) newTopics++;
      } catch (e) {
        this.logger.error(`处理资讯失败 [${raw.title}]: ${(e as Error).message}`);
        errors++;
      }
    }

    this.logger.log(`采集完成: 共 ${rawList.length} 条，新增话题 ${newTopics}`);
    return { total: rawList.length, newTopics, errors };
  }

  /** 处理单条资讯：去重 → 摘要 → 情感 → 入库 */
  private async processSingle(raw: RawNews): Promise<boolean> {
    const text = `${raw.title}${raw.content}`;
    const fingerprint = simhash(text);

    // 去重：查最近已入库的 simhash
    const existing = await this.newsRepo.findOne({
      where: { simhash: fingerprint },
    });
    if (existing) return false;

    // LLM 摘要 + 情感
    const summary = await generateSummary(raw.title, raw.content);
    const sentiment = await analyzeSentiment(raw.title, raw.content);

    // 建话题（简化：每条资讯一个话题）
    const topic = await this.topicRepo.save(
      this.topicRepo.create({
        title: raw.title,
        summary,
        category: '财经',
        sentiment: sentiment.sentiment,
        sentiment_score: sentiment.score,
        news_count: 1,
        source_names: [raw.source_name],
        source_urls: [{ name: raw.source_name, url: raw.source_url }],
        entities: [],
        publish_date: raw.publish_date ?? new Date(),
      }),
    );

    // 建资讯记录
    await this.newsRepo.save(
      this.newsRepo.create({
        topic_id: topic.id,
        title: raw.title,
        content: raw.content,
        summary,
        source_name: raw.source_name,
        source_url: raw.source_url,
        source_type: raw.source_type,
        simhash: fingerprint,
        publish_date: raw.publish_date ?? new Date(),
        is_processed: true,
        is_aggregated: true,
      }),
    );

    return true;
  }

  /** 最新话题列表 */
  async getLatestTopics(limit = 10, category?: string): Promise<TopicEntity[]> {
    const where: any = { is_deleted: false };
    if (category && category !== '全部') where.category = category;
    return this.topicRepo.find({
      where,
      order: { publish_date: 'DESC' },
      take: Math.min(limit, 50),
    });
  }

  /** 搜索资讯 */
  async searchNews(
    query: string,
    options: { dateRange?: string; sentiment?: string; limit?: number } = {},
  ): Promise<TopicEntity[]> {
    const { dateRange = '今天', sentiment, limit = 20 } = options;
    const where: any = { is_deleted: false, title: Like(`%${query}%`) };
    if (sentiment && sentiment !== '全部') where.sentiment = sentiment;
    if (dateRange === '今天') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      where.publish_date = MoreThanOrEqual(today);
    } else if (dateRange === '本周') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      where.publish_date = MoreThanOrEqual(weekAgo);
    }
    return this.topicRepo.find({
      where,
      order: { publish_date: 'DESC' },
      take: Math.min(limit, 50),
    });
  }

  /** 市场情绪脉搏 */
  async getMarketPulse(): Promise<any> {
    const topics = await this.topicRepo.find({
      where: { is_deleted: false },
      order: { publish_date: 'DESC' },
      take: 100,
    });

    const sentiments: Record<string, number> = { 利好: 0, 利空: 0, 中性: 0 };
    const sectorsCount: Record<string, number> = {};
    for (const t of topics) {
      if (t.sentiment && t.sentiment in sentiments) sentiments[t.sentiment]++;
      for (const e of t.entities ?? []) {
        if (e.type === '板块' && e.name) {
          sectorsCount[e.name] = (sectorsCount[e.name] ?? 0) + 1;
        }
      }
    }

    const total = Object.values(sentiments).reduce((a, b) => a + b, 0) || 1;
    const positiveRatio = sentiments['利好'] / total;
    const sentimentIndex = Math.round(
      50 + positiveRatio * 50 - (sentiments['利空'] / total) * 50,
    );
    const label = sentimentIndex > 65 ? '乐观' : sentimentIndex < 35 ? '悲观' : '中性';

    const hotSectors = Object.entries(sectorsCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sector, count]) => ({ sector, count }));

    return {
      sentiment_index: sentimentIndex,
      sentiment_label: label,
      sentiment_distribution: sentiments,
      hot_sectors: hotSectors,
      news_volume_24h: topics.length,
      top_positive: topics.filter((t) => t.sentiment === '利好').slice(0, 3),
      top_negative: topics.filter((t) => t.sentiment === '利空').slice(0, 3),
    };
  }
}
