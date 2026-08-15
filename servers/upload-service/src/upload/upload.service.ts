import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { UploadFileEntity } from './upload-file.entity';

/**
 * 上传分类配置：不同场景的文件限制
 */
export interface UploadCategory {
  /** 上传类型名 */
  name: string;
  /** 允许的 MIME 类型 */
  allowedTypes: string[];
  /** 最大文件大小（字节） */
  maxSize: number;
}

@Injectable()
export class UploadService {
  /** 上传分类配置 */
  static readonly CATEGORIES: Record<string, UploadCategory> = {
    avatar: {
      name: '头像',
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxSize: 2 * 1024 * 1024, // 2MB
    },
    drawing: {
      name: '画板',
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxSize: 10 * 1024 * 1024, // 10MB
    },
    bianbian: {
      name: '变变',
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxSize: 10 * 1024 * 1024, // 10MB
    },
    general: {
      name: '通用',
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxSize: 5 * 1024 * 1024, // 5MB
    },
  };

  private uploadDir: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(UploadFileEntity)
    private uploadFileRepo: Repository<UploadFileEntity>,
  ) {
    this.uploadDir = path.resolve(
      this.configService.get('UPLOAD_DIR', 'uploads'),
    );
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  getCategoryDir(category: string): string {
    return path.join(this.uploadDir, category);
  }

  /** 确保上传目录存在 */
  ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** 获取指定分类的 Multer 配置 */
  getMulterOptions(category: string): MulterOptions {
    const categoryConfig = UploadService.CATEGORIES[category];
    if (!categoryConfig) {
      throw new BadRequestException(
        `不支持的上传类型: ${category}，可选值: ${Object.keys(UploadService.CATEGORIES).join(', ')}`,
      );
    }

    return {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const targetDir = this.getCategoryDir(category);
          this.ensureDir(targetDir);
          cb(null, targetDir);
        },
        filename: (_req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname);
          cb(null, `${category}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!categoryConfig.allowedTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `${categoryConfig.name}上传仅支持: ${categoryConfig.allowedTypes.map((t) => t.split('/')[1]).join('/')} 格式`,
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: categoryConfig.maxSize,
      },
    };
  }

  /** 构建文件访问 URL */
  buildUrl(filename: string, category: string): string {
    return `/api/uploads/${category}/${filename}`;
  }

  /** 获取所有支持的上传分类 */
  getCategories(): { key: string; name: string; maxSize: number; allowedTypes: string[] }[] {
    return Object.entries(UploadService.CATEGORIES).map(
      ([key, config]) => ({
        key,
        name: config.name,
        maxSize: config.maxSize,
        allowedTypes: config.allowedTypes,
      }),
    );
  }

  /**
   * 记录一次成功上传到 upload_files 表（仅元数据，文件本体仍在磁盘）。
   * @param dir 磁盘子目录（avatars/drawing/bianbian/general），与 storagePath 对应
   */
  async recordUpload(input: {
    userId: string | null;
    category: string;
    originalName: string;
    storageName: string;
    dir: string;
    url: string;
    mimeType: string;
    size: number;
  }): Promise<void> {
    const ext = path.extname(input.originalName);
    await this.uploadFileRepo.save({
      userId: input.userId,
      category: input.category,
      originalName: input.originalName,
      storageName: input.storageName,
      storagePath: `uploads/${input.dir}/${input.storageName}`,
      url: input.url,
      mimeType: input.mimeType,
      sizeBytes: input.size,
      extension: ext || null,
      status: 'uploaded',
    });
  }
}
