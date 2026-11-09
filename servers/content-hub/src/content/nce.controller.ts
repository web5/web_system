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
}
