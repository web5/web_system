/** 内容管道 REST API（供网关 /api/content-hub/* 或管理台调用） */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ContentService, WechatMpPublishDto } from './services/content.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { Public } from '../auth/public.decorator';
import { ListItemsQueryDto } from './dto/content-quality.dto';

/**
 * 采集源 / 管线 / 条目的管理接口，默认走运营后台（admin）用户 JWT。
 * 例外是公众号建稿/发布（wechat/*）：服务间接口（mcp-gateway wechat_mp 模块 +
 * SSH 运维 skill 直连），用 @Public() 跳过用户 JWT + @UseGuards(InternalKeyGuard)
 * 校验 Bearer <CONTENT_HUB_SERVICE_KEY>。
 */
/**
 * 解析路径 ID：非正整数一律抛 400。
 * 存在的意义是**兜底防 NaN 进 SQL**（2026-10-22 事故）——通配路由 `:id` 会吃到
 * 字面量路径（如曾经的 `sources/last-collect`），`Number()` 后变 NaN，
 * TypeORM 会把它当列名生成 SQL，最终是 500 而不是可读的 400。
 */
export function parseId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`${label} ID 非法：${raw}`);
  }
  return id;
}

@UseGuards(JwtAuthGuard)
@Controller('api/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  // ── 采集源 ──
  @Get('sources')
  sources() {
    return this.contentService.listSources();
  }

  /**
   * 🔴 ID 必须是正整数，**不做校验会让 NaN 进 SQL**（2026-10-22 事故）：
   *    `sources/:id` 是通配路由，`GET sources/last-collect` 这类路径会命中这里，
   *    `Number('last-collect')` = NaN → TypeORM 把 NaN 当列名 →
   *    `Unknown column 'NaN' in 'where clause'` → 500（而非 400）。
   *    路由改名（collect/last）是根治，这里是**兜底**：任何落到本路由的非数字 ID
   *    都返回 400，不再产生 500，也不再让调用方 `Promise.all` 整页崩掉。
   */
  @Get('sources/:id(\\d+)')
  source(@Param('id') id: string) {
    return this.contentService.getSource(parseId(id, '采集源'));
  }

  @Post('sources')
  createSource(@Body() body: any) {
    return this.contentService.createSource(body);
  }

  @Patch('sources/:id(\\d+)')
  updateSource(@Param('id') id: string, @Body() body: any) {
    return this.contentService.updateSource(parseId(id, '采集源'), body);
  }

  @Delete('sources/:id(\\d+)')
  deleteSource(@Param('id') id: string) {
    return this.contentService.deleteSource(parseId(id, '采集源'));
  }

  // ── 管线 ──
  @Get('pipelines')
  pipelines() {
    return this.contentService.listPipelines();
  }

  @Get('pipelines/:id(\\d+)')
  pipeline(@Param('id') id: string) {
    return this.contentService.getPipeline(parseId(id, '管线'));
  }

  @Post('pipelines')
  createPipeline(@Body() body: any) {
    return this.contentService.createPipeline(body);
  }

  @Patch('pipelines/:id(\\d+)')
  updatePipeline(@Param('id') id: string, @Body() body: any) {
    return this.contentService.updatePipeline(parseId(id, '管线'), body);
  }

  @Delete('pipelines/:id(\\d+)')
  deletePipeline(@Param('id') id: string) {
    return this.contentService.deletePipeline(parseId(id, '管线'));
  }

  // ── 采集历史 / 发布记录 ──

  /**
   * 采集明细列表（p40：五维筛选 + 服务端分页）。
   * ⚠️ `items/stats` 必须声明在 `items/:id` 之前，否则 'stats' 会被当成 id 匹配。
   */
  @Get('items/stats')
  itemStats() {
    return this.contentService.itemStats();
  }

  @Get('items')
  items(@Query() query: ListItemsQueryDto) {
    return this.contentService.listItems(query);
  }

  /** 单条明细详情（含关联管线 / 源 / 发布记录） */
  @Get('items/:id(\\d+)')
  itemDetail(@Param('id') id: string) {
    return this.contentService.getItemDetail(parseId(id, '明细'));
  }

  /** 成文发布记录列表（目标 / 状态筛选 + 分页 + 关联条目标题） */
  @Get('publications')
  publications(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('target') target?: string,
    @Query('status') status?: string,
  ) {
    return this.contentService.listPublications({
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
      target,
      status,
    });
  }

  /** 成文预览（Q5：文章级聚合，payload 直渲染 / 历史记录按管线+当日重建） */
  @Get('publications/:id(\\d+)/preview')
  publicationPreview(@Param('id') id: string) {
    return this.contentService.publicationPreview(parseId(id, '发布记录'));
  }

  /**
   * 重新发布（Q3：failed 成文一键重发，产生新记录）。
   *
   * `?mode=draft` 只进草稿箱（公众号资质不足时的正常操作），默认 publish 直接发。
   */
  @Post('publications/:id(\\d+)/republish')
  republish(@Param('id') id: string, @Query('mode') mode?: string) {
    return this.contentService.republishPublication(
      parseId(id, '发布记录'),
      mode === 'draft' ? 'draft' : 'publish',
    );
  }

  // ── 手动触发 ──
  @Post('run/:pipeline')
  run(@Param('pipeline') pipeline: string) {
    return this.contentService.runPipeline(pipeline);
  }

  // ── 公众号发布（服务间：mcp-gateway wechat_mp 模块 + SSH 运维 skill 直连）──
  /**
   * 只建草稿不发布（MCP create_wechat_draft 对应接口）。
   * @Public() 跳过用户 JWT（服务间调用不带用户凭证），
   * InternalKeyGuard 校验 Bearer <CONTENT_HUB_SERVICE_KEY>。
   */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Post('wechat/draft')
  createWechatDraft(@Body() body: WechatMpPublishDto) {
    return this.contentService.createWechatDraft(body);
  }

  /**
   * 一键发布到公众号（MCP publish_to_wechat 对应接口）。
   * body.mode=draft 时只建草稿（等价于 wechat/draft，但会落发布记录）。
   * 鉴权同 wechat/draft。
   */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Post('wechat/publish')
  publishWechat(@Body() body: WechatMpPublishDto) {
    return this.contentService.publishWechatArticle(body);
  }
}
