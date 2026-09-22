import {
  Controller,
  Post,
  Get,
  Req,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { UploadService } from './upload.service';
import { AuthGuard } from '../auth/auth.guard';
import { createUploadInterceptor } from './upload-multer';

/**
 * 用户上传入口。
 *
 * ⚠️ 本控制器**不再持有任何磁盘逻辑**（目录、命名、mime 限制、大小限制）：
 * 全部来自 `UploadService.multerOptionsFor`（唯一实现，上传根目录来自系统配置）。
 * 历史问题是这里另写了一份 `diskStorage`，destination 用 `process.cwd()/uploads`
 * 与 service 里的 `uploadDir` 口径不一 —— 那正是「目录不可配」的根因。
 */
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
  @UseInterceptors(createUploadInterceptor('avatars'))
  async uploadAvatar(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    return this.respond(file, 'avatars', 'avatar', req);
  }

  /**
   * 上传画板照片
   */
  @Post('drawing')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传画板照片（10MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createUploadInterceptor('drawing'))
  async uploadDrawing(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    return this.respond(file, 'drawing', 'drawing', req);
  }

  /**
   * 上传变变照片
   */
  @Post('bianbian')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传变变照片（10MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createUploadInterceptor('bianbian'))
  async uploadBianbian(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    return this.respond(file, 'bianbian', 'bianbian', req);
  }

  /**
   * 通用上传（任何场景均可使用）
   */
  @Post('general')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '通用文件上传（5MB，支持 JPG/PNG/GIF/WEBP）' })
  @UseInterceptors(createUploadInterceptor('general'))
  async uploadGeneral(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片文件');
    }
    return this.respond(file, 'general', 'general', req);
  }

  /**
   * 统一响应（四个分类只差参数，避免四份几乎相同的返回体）。
   *
   * @param dir      磁盘分类（复数）
   * @param category 落库口径（历史值：avatars 记为 avatar）
   */
  private async respond(
    file: Express.Multer.File,
    dir: string,
    category: string,
    req: Request,
  ) {
    const data = {
      url: this.uploadService.buildUrl(file.filename, dir),
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      category,
    };
    await this.persist(file, dir, category, req);
    return { code: 200, data };
  }

  /** 落库上传记录（失败仅告警，不影响上传结果） */
  private async persist(
    file: Express.Multer.File,
    dir: string,
    category: string,
    req: Request,
  ): Promise<void> {
    const userId = (req as Request & { user?: { sub?: string; id?: string } }).user;
    try {
      await this.uploadService.recordUpload({
        userId: userId?.sub ?? userId?.id ?? null,
        category,
        originalName: file.originalname,
        storageName: file.filename,
        dir,
        url: this.uploadService.buildUrl(file.filename, dir),
        mimeType: file.mimetype,
        size: file.size,
      });
    } catch (e) {
      // 文件已落盘：元数据失败只告警，不让上传在用户眼里失败
      console.warn(`[upload] 记录上传元数据失败: ${(e as Error).message}`);
    }
  }
}
