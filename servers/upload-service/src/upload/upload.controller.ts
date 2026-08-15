import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { UploadService } from './upload.service';
import { AuthGuard } from '../auth/auth.guard';

/**
 * 允许的图片 MIME 类型
 */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/**
 * 按分类获取文件大小限制
 */
function getMaxSize(category: string): number {
  const limits: Record<string, number> = {
    avatar: 2 * 1024 * 1024,   // 头像 2MB
    drawing: 10 * 1024 * 1024,  // 画板 10MB
    bianbian: 10 * 1024 * 1024, // 变变 10MB
  };
  return limits[category] || 5 * 1024 * 1024; // 默认 5MB
}

/**
 * 创建 Multer 文件拦截器配置（按分类）
 */
function createMulterInterceptor(category: string) {
  const maxSize = getMaxSize(category);

  return FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', category);
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const uniqueSuffix =
          Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `${category}-${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(
          new BadRequestException('仅支持 JPG/PNG/GIF/WEBP 图片格式'),
          false,
        );
      }
      cb(null, true);
    },
    limits: { fileSize: maxSize },
  });
}

@ApiTags('文件上传')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /** 获取支持的上传分类信息（无需鉴权，供前端参考） */
  @Get('categories')
  @ApiOperation({ summary: '获取支持的分类及限制' })
  getCategories() {
    return {
      code: 200,
      data: this.uploadService.getCategories(),
    };
  }

  /**
   * 上传头像 — 对应个人中心头像上传
   */
  @Post('avatar')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传头像（2MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createMulterInterceptor('avatars'))
  async uploadAvatar(@Req() req: Request, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    const data = { url: this.uploadService.buildUrl(file.filename, 'avatars'), filename: file.filename, size: file.size, mimetype: file.mimetype, category: 'avatar' };
    await this.persist(file, 'avatars', req);
    return { code: 200, data };
  }

  /**
   * 上传画板照片
   */
  @Post('drawing')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传画板照片（10MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createMulterInterceptor('drawing'))
  async uploadDrawing(@Req() req: Request, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    const data = { url: this.uploadService.buildUrl(file.filename, 'drawing'), filename: file.filename, size: file.size, mimetype: file.mimetype, category: 'drawing' };
    await this.persist(file, 'drawing', req);
    return { code: 200, data };
  }

  /**
   * 上传变变照片
   */
  @Post('bianbian')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传变变照片（10MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createMulterInterceptor('bianbian'))
  async uploadBianbian(@Req() req: Request, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    const data = { url: this.uploadService.buildUrl(file.filename, 'bianbian'), filename: file.filename, size: file.size, mimetype: file.mimetype, category: 'bianbian' };
    await this.persist(file, 'bianbian', req);
    return { code: 200, data };
  }

  /**
   * 通用上传（任何场景均可使用）
   */
  @Post('general')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '通用文件上传（5MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createMulterInterceptor('general'))
  async uploadGeneral(@Req() req: Request, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    const data = { url: this.uploadService.buildUrl(file.filename, 'general'), filename: file.filename, size: file.size, mimetype: file.mimetype, category: 'general' };
    await this.persist(file, 'general', req);
    return { code: 200, data };
  }

  /** 落库上传记录（失败仅告警，不影响上传结果） */
  private async persist(file: any, dir: string, req: Request): Promise<void> {
    const userId = (req as any).user?.sub ?? null;
    try {
      await this.uploadService.recordUpload({
        userId,
        category: dir === 'avatars' ? 'avatar' : dir,
        originalName: file.originalname,
        storageName: file.filename,
        dir,
        url: this.uploadService.buildUrl(file.filename, dir),
        mimeType: file.mimetype,
        size: file.size,
      });
    } catch (e) {
      this.uploadService && console.warn(`[upload] 记录上传元数据失败: ${(e as Error).message}`);
    }
  }
}
