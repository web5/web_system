/** 内容管道 REST API（供网关 /api/content-hub/* 或管理台调用） */
import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ContentService, WechatMpPublishDto } from './services/content.service';

@Controller('api/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  // ── 采集源 ──
  @Get('sources')
  sources() {
    return this.contentService.listSources();
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
  @Get('items')
  items(@Query('limit') limit?: string, @Query('status') status?: string, @Query('pipeline') pipeline?: string) {
    return this.contentService.listItems(Number(limit) || 50, status, pipeline);
  }

  @Get('publications')
  publications(@Query('limit') limit?: string) {
    return this.contentService.listPublications(Number(limit) || 50);
  }

  // ── 手动触发 ──
  @Post('run/:pipeline')
  run(@Param('pipeline') pipeline: string) {
    return this.contentService.runPipeline(pipeline);
  }

  // ── 公众号发布 ──
  /** 只建草稿不发布（MCP create_wechat_draft 对应接口） */
  @Post('wechat/draft')
  createWechatDraft(@Body() body: WechatMpPublishDto) {
    return this.contentService.createWechatDraft(body);
  }

  /** 一键发布到公众号（MCP publish_to_wechat 对应接口） */
  @Post('wechat/publish')
  publishWechat(@Body() body: WechatMpPublishDto) {
    return this.contentService.publishWechatArticle(body);
  }
}
