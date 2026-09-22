import { Injectable, BadRequestException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { UploadFileEntity } from './upload-file.entity';
import { UPLOAD_ROOT } from './upload-root.token';

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

/** 一次落盘的结果（HTTP 上传与内部 store 共用同一形状） */
export interface StoredFile {
  /** 对外访问 URL（契约不变：`/api/uploads/<category>/<filename>`） */
  url: string;
  /** 落盘文件名 */
  filename: string;
  originalName: string;
  size: number;
  /** 磁盘分类（复数：avatars / drawing / bianbian / general） */
  category: string;
  mimetype: string | null;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  /**
   * 上传分类配置。
   *
   * 键 = **磁盘子目录名（复数）**，与 `buildUrl` 产出的 URL 段、`upload_files.storage_path`
   * 保持一致（历史 `CATEGORIES` 用单数 `avatar`、控制器却传 `avatars`，两处口径不一，已统一）。
   * 注意：`upload_files.category` 列的历史值仍是 `avatar`（单数），落库时由调用方映射，
   * 这里不改数据口径，避免历史数据与新数据割裂。
   */
  static readonly CATEGORIES: Record<string, UploadCategory> = {
    avatars: {
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

  /** MIME → 允许的扩展名（内部 store 只有文件名、没有 MIME 时的判定依据） */
  static readonly EXTENSIONS_BY_MIME: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
  };

  private uploadDir: string;

  constructor(
    // 上传根目录：启动期解析一次并注入（重启生效，见 src/upload/upload.module.ts）
    @Inject(UPLOAD_ROOT) uploadDir: string,
    @InjectRepository(UploadFileEntity)
    private uploadFileRepo: Repository<UploadFileEntity>,
  ) {
    this.uploadDir = path.resolve(uploadDir);
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

  /**
   * Multer 配置的**唯一实现**（按分类）。
   *
   * @param rootProvider 上传根目录的取值函数。装饰器求值时拿不到 DI，故用惰性函数：
   *                     HTTP 路由传进程内持有者，服务内部传 `this.uploadDir`。
   */
  static multerOptionsFor(
    category: string,
    rootProvider: () => string,
  ): MulterOptions {
    const categoryConfig = UploadService.CATEGORIES[category];
    if (!categoryConfig) {
      throw new BadRequestException(
        `不支持的上传类型: ${category}，可选值: ${Object.keys(UploadService.CATEGORIES).join(', ')}`,
      );
    }

    return {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const targetDir = path.join(rootProvider(), category);
          // 目录按需创建：根目录启动时已 ensure，分类子目录首次上传时建
          fs.mkdirSync(targetDir, { recursive: true });
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

  /** 获取指定分类的 Multer 配置（用本进程已生效的上传根目录） */
  getMulterOptions(category: string): MulterOptions {
    return UploadService.multerOptionsFor(category, () => this.uploadDir);
  }

  /** 该分类允许的扩展名（小写，含点） */
  static allowedExtensions(category: string): string[] {
    const config = UploadService.CATEGORIES[category];
    if (!config) return [];
    return config.allowedTypes.flatMap(
      (mime) => UploadService.EXTENSIONS_BY_MIME[mime] ?? [],
    );
  }

  /** 扩展名 → MIME（反查；未知返回 null） */
  static mimeForExtension(ext: string): string | null {
    const lower = ext.toLowerCase();
    for (const [mime, exts] of Object.entries(UploadService.EXTENSIONS_BY_MIME)) {
      if (exts.includes(lower)) return mime;
    }
    return null;
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

  /**
   * 把**内存里的文件**落盘到统一上传根（内部 store 用）。
   *
   * 与 HTTP 上传共用同一套分类限制与命名规约，差别只是内容来自内存而非 multipart 流。
   * 这是「唯一写入点」的落点：别的服务（如 ai-service 的生成图）不再自己拼路径、自己 mkdir，
   * 而是把字节交给这里（design §1.6）。
   */
  async storeBuffer(input: {
    category: string;
    originalName: string;
    buffer: Buffer;
    userId?: string | null;
    mimeType?: string | null;
  }): Promise<StoredFile> {
    const category = (input.category || '').trim();
    const config = UploadService.CATEGORIES[category];
    if (!config) {
      throw new BadRequestException(
        `不支持的上传类型: ${category || '(空)'}，可选值: ${Object.keys(UploadService.CATEGORIES).join(', ')}`,
      );
    }

    // 只取 basename：调用方给的名字可能带路径（`../../x.png`），绝不能当路径用
    const originalName = path.basename(input.originalName || '').trim();
    if (!originalName) {
      throw new BadRequestException('缺少原始文件名（filename）');
    }
    const ext = path.extname(originalName).toLowerCase();
    const allowed = UploadService.allowedExtensions(category);
    if (!ext || !allowed.includes(ext)) {
      throw new BadRequestException(
        `${config.name}仅支持 ${allowed.join(' / ')} 格式，收到「${originalName}」`,
      );
    }
    if (input.buffer.length === 0) {
      throw new BadRequestException('文件内容为空');
    }
    if (input.buffer.length > config.maxSize) {
      throw new BadRequestException(
        `文件超过 ${Math.round(config.maxSize / 1024 / 1024)}MB 限制（实际 ${input.buffer.length} 字节）`,
      );
    }

    const storageName = `${category}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const dir = this.getCategoryDir(category);
    this.ensureDir(dir);
    await fs.promises.writeFile(path.join(dir, storageName), input.buffer);

    const url = this.buildUrl(storageName, category);
    const mimetype = input.mimeType || UploadService.mimeForExtension(ext);
    try {
      await this.recordUpload({
        userId: input.userId ?? null,
        // 落库口径沿用历史值：avatars 记为 avatar（不改数据口径，见 CATEGORIES 注释）
        category: category === 'avatars' ? 'avatar' : category,
        originalName,
        storageName,
        dir: category,
        url,
        mimeType: mimetype ?? 'application/octet-stream',
        size: input.buffer.length,
      });
    } catch (e) {
      // 文件已落盘：元数据失败只告警，不把「写成功」变成调用方眼里的失败
      this.logger.warn(`记录上传元数据失败（文件已落盘）: ${(e as Error).message}`);
    }

    return {
      url,
      filename: storageName,
      originalName,
      size: input.buffer.length,
      category,
      mimetype,
    };
  }
}
