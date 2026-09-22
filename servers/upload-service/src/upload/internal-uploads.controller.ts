import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { InternalGuard } from '../auth/internal.guard';
import { StoreUploadDto } from './dto/store-upload.dto';
import { UploadService } from './upload.service';
import { getUploadRootInfo } from './upload-root';

/**
 * 内部上传接口（服务间调用，`x-internal-key: INTERNAL_API_KEY`）。
 *
 * 存在的理由（design §1.6）：A3 之后 upload-service 是**唯一写入点**，
 * ai-service 的生成图等不再本地落盘，而是把字节交到这里；这样路径解析、
 * 命名规约、分类限制、元数据落库都只有一份实现，磁盘目录也不会扩散到各服务。
 */
@ApiTags('上传（内部）')
@Controller('internal')
@UseGuards(InternalGuard)
export class InternalUploadsController {
  /** 内部 store 的请求体上限：略高于最大分类（10MB）留出 multipart 头部开销 */
  private static readonly MAX_BYTES = 12 * 1024 * 1024;

  constructor(private readonly uploadService: UploadService) {}

  /**
   * 落盘一个文件到统一上传根。
   *
   * 支持两种传法（同一路由，multer 对非 multipart 请求直接放行）：
   * - `multipart/form-data`：`file` + `category`（推荐，无 body 尺寸问题）；
   * - `application/json`：`{ category, filename, dataBase64 }`。
   */
  @Post('uploads/store')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: '服务间写入上传文件（返回与前台一致的 URL）' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: InternalUploadsController.MAX_BYTES },
    }),
  )
  async store(
    @Body() dto: StoreUploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let buffer: Buffer;
    let originalName: string;

    if (file?.buffer?.length) {
      buffer = file.buffer;
      originalName = file.originalname || dto.filename || '';
    } else if (dto.dataBase64) {
      buffer = Buffer.from(dto.dataBase64, 'base64');
      originalName = dto.filename || '';
      if (buffer.length > InternalUploadsController.MAX_BYTES) {
        throw new BadRequestException('文件超过内部接口上限（12MB）');
      }
    } else {
      throw new BadRequestException(
        '缺少文件内容：请用 multipart 字段 file，或 JSON 的 dataBase64',
      );
    }

    const stored = await this.uploadService.storeBuffer({
      category: dto.category,
      originalName,
      buffer,
      userId: dto.userId ?? null,
      mimeType: file?.mimetype ?? null,
    });
    return { code: 0, data: stored };
  }

  /**
   * 读取**本进程当前实际生效**的上传根目录（内存值）。
   *
   * 与 system-service 的 `GET /internal/storage/path`（权威配置值）配对使用：
   * 前者是「现在真正往哪写」，后者是「配置说该往哪写」——已保存未重启时两者不同。
   */
  @Get('storage/path')
  @ApiOperation({ summary: '读取本进程实际生效的上传根目录' })
  getStoragePath() {
    const info = getUploadRootInfo();
    return {
      code: 0,
      data: {
        path: info.path,
        source: info.source,
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      },
    };
  }
}
