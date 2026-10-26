/**
 * 公众号素材库（封面）管理接口。
 *
 * 图片走 multipart 直传本服务 → 本服务转存 upload-service（唯一写入点）。
 * 不声明 `multer` 依赖：`FileInterceptor` 的默认 storage 就是内存，
 * 我们只需要拿到 buffer，不需要磁盘临时文件，也就省掉一个传递依赖和 @types。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { parseId } from './content.controller';
import { CoverAiService } from './services/cover-ai.service';
import { MediaService } from './services/media.service';

/** 上传文件的最小形状（multer 内存存储）；不引 @types/multer 只用到的这几个字段 */
interface UploadedImageFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/** 与 upload-service 的 covers 分类上限一致 */
const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** 前端传的 tags 可能是 `a,b` 字符串，也可能是数组 */
function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

@UseGuards(JwtAuthGuard)
@Controller('api/content/media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly coverAiService: CoverAiService,
  ) {}

  /** 列表（默认只回未删除的，最多 200 条） */
  @Get()
  list(
    @Query('keyword') keyword?: string,
    @Query('tag') tag?: string,
    @Query('source') source?: string,
    @Query('enabled') enabled?: string,
  ) {
    return this.mediaService.list({ keyword, tag, source, enabled });
  }

  /** 标签聚合，供筛选下拉 */
  @Get('tags')
  tags() {
    return this.mediaService.tagOptions();
  }

  /** 上传一张封面（multipart：file + name? + tags?） */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_COVER_BYTES } }))
  async upload(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body() body: { name?: string; tags?: string | string[] },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('缺少文件：请用 multipart 字段 file 上传图片');
    }
    return this.mediaService.createFromUpload(
      {
        buffer: file.buffer,
        originalname: file.originalname || 'cover.png',
        mimetype: file.mimetype || '',
      },
      body?.name,
      normalizeTags(body?.tags),
    );
  }

  /**
   * 按标题生成封面（AI）。
   *
   * 同步返回：生图 10~40s，前端需为该请求放宽超时；
   * 不走异步任务表是因为「生成一张封面」是一次性的交互动作，
   * 为它引入 job 表 + 轮询接口，复杂度远大于收益。
   */
  @Post('generate')
  generate(
    @Body()
    body: {
      title?: string;
      summary?: string;
      styleExtra?: string;
      name?: string;
      tags?: string | string[];
    },
  ) {
    if (!body?.title?.trim()) throw new BadRequestException('缺少 title，无法按标题生成封面');
    return this.coverAiService.generate({
      title: body.title,
      summary: body.summary,
      styleExtra: body.styleExtra,
      name: body.name,
      tags: normalizeTags(body.tags),
    });
  }

  /** 改名 / 改标签 / 启停 */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; tags?: string | string[]; enabled?: boolean },
  ) {
    return this.mediaService.update(parseId(id, '素材'), {
      name: body?.name,
      tags: body?.tags === undefined ? undefined : normalizeTags(body.tags),
      enabled: body?.enabled,
    });
  }

  /** 软删（被管线当默认封面时拒绝） */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mediaService.remove(parseId(id, '素材'));
  }

  /** 同步微信永久素材（force=1 可强制重传） */
  @Post(':id/sync-wechat')
  sync(@Param('id') id: string, @Query('account') account?: string, @Query('force') force?: string) {
    return this.mediaService.syncToWechat(
      parseId(id, '素材'),
      account?.trim() || 'default',
      force === '1',
    );
  }
}
