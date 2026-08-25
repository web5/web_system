import { Controller, Get, Query } from '@nestjs/common';
import { FinnewsService } from './services/finnews.service';
import { ArxivCollector } from './content/collectors/arxiv.collector';

/** 财经资讯 REST API（供 mcp-gateway 或其他系统调用） */
@Controller('api')
export class FinnewsController {
  private readonly arxivCollector = new ArxivCollector();

  constructor(private readonly finnewsService: FinnewsService) {}

  /** 拉取 arXiv 论文（论文学习 MCP 数据源） */
  @Get('papers')
  async papers(
    @Query('categories') categories?: string,
    @Query('max_results') maxResults?: string,
  ) {
    const config = categories ? { categories } : {};
    const list = await this.arxivCollector.collect(config, Number(maxResults) || 10);
    return { count: list.length, papers: list };
  }

  /** 最新话题列表 */
  @Get('topics')
  async topics(@Query('limit') limit?: string, @Query('category') category?: string) {
    const topics = await this.finnewsService.getLatestTopics(
      Number(limit) || 10,
      category,
    );
    return { count: topics.length, topics };
  }

  /** 搜索资讯 */
  @Get('search')
  async search(
    @Query('query') query?: string,
    @Query('date_range') date_range?: string,
    @Query('sentiment') sentiment?: string,
    @Query('limit') limit?: string,
  ) {
    const results = await this.finnewsService.searchNews(query ?? '', {
      dateRange: date_range ?? '今天',
      sentiment,
      limit: Number(limit) || 20,
    });
    return { query: query ?? '', count: results.length, results };
  }

  /** 某只股票相关资讯 */
  @Get('stock-news')
  async stockNews(@Query('stock_code') stock_code?: string, @Query('limit') limit?: string) {
    const news = await this.finnewsService.searchNews(stock_code ?? '', {
      limit: Number(limit) || 10,
      dateRange: '本周',
    });
    return { stock: stock_code ?? '', count: news.length, news };
  }

  /** 某板块一周热门话题（基于 entities.type==='板块' 过滤） */
  @Get('sector-hot')
  async sectorHot(@Query('sector') sector?: string, @Query('limit') limit?: string) {
    const hot = await this.finnewsService.getSectorHot(sector ?? '', Number(limit) || 10);
    return { sector: sector ?? '', count: hot.length, hot_topics: hot };
  }

  /** 市场情绪脉搏 */
  @Get('market-pulse')
  async marketPulse() {
    return this.finnewsService.getMarketPulse();
  }

  /** 板块实体库（枚举当前可查板块及各板块热度） */
  @Get('sectors')
  async sectors() {
    return this.finnewsService.getSectorLibrary();
  }
}
