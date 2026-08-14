import { Controller, Get, Query } from '@nestjs/common';
import { FinnewsService } from './services/finnews.service';

/** 财经资讯 REST API（供 mcp-gateway 或其他系统调用） */
@Controller('api')
export class FinnewsController {
  constructor(private readonly finnewsService: FinnewsService) {}

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

  /** 某板块一周热门话题 */
  @Get('sector-hot')
  async sectorHot(@Query('sector') sector?: string, @Query('limit') limit?: string) {
    const hot = await this.finnewsService.searchNews(sector ?? '', {
      dateRange: '本周',
      limit: Number(limit) || 10,
    });
    return { sector: sector ?? '', count: hot.length, hot_topics: hot };
  }

  /** 市场情绪脉搏 */
  @Get('market-pulse')
  async marketPulse() {
    return this.finnewsService.getMarketPulse();
  }
}
