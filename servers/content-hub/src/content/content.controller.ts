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
import { ContentAccountService } from './services/content-account.service';
import { PipelineRunService } from './services/pipeline-run.service';
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
  constructor(
    private readonly contentService: ContentService,
    private readonly contentAccountService: ContentAccountService,
    private readonly pipelineRunService: PipelineRunService,
  ) {}

  // ── 自媒体账号（只读注册表；凭据只回掩码，密文不出接口）──
  @Get('accounts')
  accounts(@Query('platform') platform?: string) {
    return this.contentAccountService.list(platform);
  }

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

  /**
   * 按当前渲染器重建成文（#431：存量记录洗白）。
   *
   * 与上面 republish 的区别是**不投递**：只把 `detail.payload` 里的标题 + HTML
   * 按当前渲染器重算一遍。所以不发外网请求、不产生新记录，也不受公众号资质限制
   * —— 纯粹是修预览（存量记录的 `payload.html` 是发布当时渲染的，渲染器升级对它无效）。
   */
  @Post('publications/:id(\\d+)/rebuild')
  rebuild(@Param('id') id: string) {
    return this.contentService.rebuildPublication(parseId(id, '发布记录'));
  }

  // ── 手动触发（异步：受理即返回 job_id，前端轮询 job 拿结果）──
  /**
   * 🔴 这里**故意不等管线跑完**。
   * 一次完整运行 30 秒起步，而链路上三道超时依次是 前端 10s / 网关 30s / nginx 60s，
   * 同步等的结果是调用方先被掐断、看到「网络错误」，而后端仍在跑、内容仍会投出去
   * ——比报错更糟：用户以为没跑成，于是再点一次，草稿箱就多一条重复内容。
   * 异步化后本接口毫秒级返回，执行由 PipelineRunService 在后台完成。
   */
  @Post('run/:pipeline')
  run(@Param('pipeline') pipeline: string) {
    return this.pipelineRunService.start(pipeline, 'manual');
  }

  /** 查询一次运行的结果（轮询终点：status 变成 ok / failed） */
  @Get('run/job/:id(\\d+)')
  runJob(@Param('id') id: string) {
    return this.pipelineRunService.getJob(parseId(id, '运行任务'));
  }

  /** 最近运行记录 —— 解决"刚才那次到底跑了没 / 跑了多久"只能靠猜 */
  @Get('run/recent')
  runRecent(@Query('pipeline') pipeline?: string, @Query('take') take?: string) {
    const n = Number(take ?? 10);
    return this.pipelineRunService.listRecent(
      pipeline,
      Number.isInteger(n) && n > 0 && n <= 50 ? n : 10,
    );
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
