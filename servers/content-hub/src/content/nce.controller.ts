/**
 * 新概念英语课文 · 三端共用只读接口。
 *
 * 通道：gateway `/api/content-admin/*` → pathRewrite `^/api/content-admin` → `/api`，
 * 所以前端请求 `/api/content-admin/nce/lessons` 会落到本 controller 的 `/api/nce/lessons`。
 * 该通道不校验 service key、用户 JWT 原样透传；本 controller 只提供公开只读内容，
 * 因此不挂 JwtAuthGuard —— admin / PC portal / 小程序三个端都能读同一份数据。
 *
 * 响应体统一 `{ code: 0, data, message }`：admin/portal 的 axios 拦截器会拆出 data，
 * 小程序 services/nce.ts 的 Wrapped<T> 则取 `res.data`，两边都兼容。
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListNceLessonsDto, NceLessonIdDto } from './dto/nce-lesson.dto';
import { NceLessonService } from './services/nce-lesson.service';
import { loadDailyQuotesPool, type DailyQuotesPool } from './daily-quotes.data';

function ok<T>(data: T): { code: number; data: T; message: string } {
  return { code: 0, data, message: 'ok' };
}

@Controller('api/nce')
export class NceController {
  constructor(private readonly nceLessons: NceLessonService) {}

  /** 教材与入库进度（?book=NCE2|NCE3|NCE4，缺省 NCE2） */
  @Get('meta')
  async meta(@Query('book') book?: string) {
    return ok(await this.nceLessons.meta(book));
  }

  /** 课文目录（分页 + 课号/标题搜索） */
  @Get('lessons')
  async list(@Query() query: ListNceLessonsDto) {
    return ok(await this.nceLessons.list(query));
  }

  /** 单课全文（?book= 指定册别，缺省 NCE2） */
  @Get('lessons/:id(\\d+)')
  async detail(@Param() params: NceLessonIdDto, @Query('book') book?: string) {
    return ok(await this.nceLessons.detail(params.id, book));
  }

  /**
   * 今日一句精选池（阶段③ S4）：只读冻结 JSON 资产，无任何生成逻辑、不调 LLM。
   * 静态段 'daily-quotes' 与上方 'lessons/:id(\\d+)' 无同前缀 :param 抢匹配。
   * 可选 ?version 仅条件请求留痕：非法值（非整数）忽略、不 500；资产当前恒返回整池。
   */
  @Get('daily-quotes')
  dailyQuotes(@Query('version') version?: string): { code: number; data: DailyQuotesPool; message: string } {
    // 强校验但仅留痕：非法 version 忽略（undefined），合法亦不改变返回（冻结资产单版本）
    const parsed = version !== undefined && /^\d+$/.test(version) ? Number(version) : undefined;
    void parsed;
    return ok(loadDailyQuotesPool());
  }
}
