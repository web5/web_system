/** 内容管道 REST API（供网关 /api/content-hub/* 或管理台调用） */
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
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
@UseGuards(JwtAuthGuard)
@Controller('api/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  // ── 采集源 ──
  @Get('sources')
  sources() {
    return this.contentService.listSources();
  }

  @Get('sources/:id')
  source(@Param('id') id: string) {
    return this.contentService.getSource(Number(id));
  }

  @Post('sources')
  createSource(@Body() body: any) {
    return this.contentService.createSource(body);
  }

  @Patch('sources/:id')
  updateSource(@Param('id') id: string, @Body() body: any) {
    return this.contentService.updateSource(Number(id), body);
  }

  @Delete('sources/:id')
  deleteSource(@Param('id') id: string) {
    return this.contentService.deleteSource(Number(id));
  }

  // ── 管线 ──
  @Get('pipelines')
  pipelines() {
    return this.contentService.listPipelines();
  }

  @Get('pipelines/:id')
  pipeline(@Param('id') id: string) {
    return this.contentService.getPipeline(Number(id));
  }

  @Post('pipelines')
  createPipeline(@Body() body: any) {
    return this.contentService.createPipeline(body);
  }

  @Patch('pipelines/:id')
  updatePipeline(@Param('id') id: string, @Body() body: any) {
    return this.contentService.updatePipeline(Number(id), body);
  }

  @Delete('pipelines/:id')
  deletePipeline(@Param('id') id: string) {
    return this.contentService.deletePipeline(Number(id));
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
  @Get('items/:id')
  itemDetail(@Param('id') id: string) {
    return this.contentService.getItemDetail(Number(id));
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
  @Get('publications/:id/preview')
  publicationPreview(@Param('id') id: string) {
    return this.contentService.publicationPreview(Number(id));
  }

  /** 重新发布（Q3：failed 成文一键重发，产生新记录） */
  @Post('publications/:id/republish')
  republish(@Param('id') id: string) {
    return this.contentService.republishPublication(Number(id));
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
   * 鉴权同 wechat/draft。
   */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Post('wechat/publish')
  publishWechat(@Body() body: WechatMpPublishDto) {
    return this.contentService.publishWechatArticle(body);
  }
}
