import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { DataSource, Repository, MoreThanOrEqual, FindOptionsWhere } from 'typeorm';
import { API_TIMEOUT } from '@web-system/shared';
import { firstValueFrom } from 'rxjs';
import * as path from 'path';
import * as fs from 'fs';
import { BianbianRecord } from './entities/bianbian-record.entity';
import { BusinessException } from '../common/exceptions/business.exception';
import { ImageGenClient } from './image-gen.client';
import { TransformDto, TransformResponse } from './dto/transform.dto';

/** 默认每日变身次数限制 */
const DEFAULT_DAILY_TRANSFORM_LIMIT = 3;
/** admin 用户免次数限制 */
const ADMIN_UNLIMITED_ROLES = new Set(['admin', 'superadmin']);
/** 动态配置缓存 TTL（毫秒），30 秒刷新一次 */
const SETTINGS_CACHE_TTL_MS = 30_000;

@Injectable()
export class BianbianService {
  private readonly logger = new Logger(BianbianService.name);
  /** 动态配置缓存 */
  private settingsCache = new Map<string, { value: string; ts: number }>();
  /** 临时图片存储目录（延迟初始化） */
  private tempImagesDir: string | null = null;

  constructor(
    @InjectRepository(BianbianRecord)
    private readonly recordRepository: Repository<BianbianRecord>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly imageGenClient: ImageGenClient,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /** 微服务地址（统一从 ConfigService 读取，兼容 localhost/Docker/生产环境） */
  private get systemServiceUrl(): string {
    return this.configService.get('SYSTEM_SERVICE_URL', 'http://localhost:6004');
  }
  private get userServiceUrl(): string {
    return this.configService.get('USER_SERVICE_URL', 'http://localhost:6002');
  }

  /**
   * 执行变变变身（事务保护，防并发超限）
   */
  async transform(dto: TransformDto): Promise<TransformResponse> {
    const userId = dto.userId || 'anonymous';
    const isUnlimited = this.isUnlimitedRoles(dto.roles);
    const dailyLimit = isUnlimited
      ? Number.MAX_SAFE_INTEGER
      : await this.getDailyTransformLimit(userId);

    const startTime = Date.now();

    // 在事务中原子性地检查配额 + 创建记录
    let usedToday = 0;
    let record: BianbianRecord;
    try {
      record = await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 注：不能对 COUNT 聚合加 FOR UPDATE（PostgreSQL 会报
        // "FOR UPDATE is not allowed with aggregate functions"），
        // 改为 SELECT ... FOR UPDATE 锁住今日成功记录后再计数。
        const todayRecords = await manager.find(BianbianRecord, {
          where: {
            userId,
            status: 'success',
            createdAt: MoreThanOrEqual(today),
          },
          // 使用悲观写锁防止并发
          lock: { mode: 'pessimistic_write' },
        });
        const todayCount = todayRecords.length;

        if (!isUnlimited && todayCount >= dailyLimit) {
          throw new BusinessException(
            `今日变身次数已用完（${dailyLimit}次/天），明天再来吧～`,
            4001,
          );
        }

        const newRecord = manager.create(BianbianRecord, {
          userId: userId ?? 'anonymous',
          originalImage: dto.image,
          description: dto.description || undefined,
          style: dto.style || 'pixar-3d',
          outputSize: dto.outputSize || '1024x1024',
          status: 'processing',
        });

        usedToday = todayCount;
        return manager.save(newRecord);
      });
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }
      this.logger.error(`Transaction failed: ${error.message}`);
      throw new BusinessException('变身创建失败，请重试', 4002);
    }

    // 3. 将 base64 原画保存为临时文件，生成公开 URL 供 MaaS 读取
    let imageUrl: string | undefined;
    let tempFilename: string | undefined;
    if (dto.image && dto.image.startsWith('data:image/')) {
      try {
        const result = await this.saveTempImage(dto.image);
        imageUrl = result.url;
        tempFilename = result.filename;
        this.logger.log(`参考图已保存为公开URL: ${imageUrl}`);
      } catch (saveError) {
        this.logger.warn(`参考图保存失败，将回退到纯文本生图: ${saveError.message}`);
      }
    }

    // 4. 调用 AI 图生图（任务式 MaaS 接口）
    try {
      this.logger.log(`开始调用 MaaS 图生图, imageUrl=${imageUrl || '无'}, desc=${dto.description?.slice(0, 30)}`);
      const genResult = await this.imageGenClient.generate({
        imageUrl,
        description: dto.description || '',
        style: dto.style || 'pixar-3d',
        outputSize: dto.outputSize || '1024x1024',
      });

      // MaaS 已下载参考图，清理临时文件
      if (tempFilename) {
        this.cleanupTempImage(tempFilename).catch(() => {});
      }

      // 5. 下载 AI 生成图片到本地 /uploads/bianbian/，存本地路径到数据库
      let localImagePath: string;
      try {
        localImagePath = await this.downloadAndSaveImage(genResult.image, record.id);
        this.logger.log(`AI 生成图片已落盘: ${localImagePath}`);
      } catch (downloadError) {
        this.logger.warn(`AI 图片下载失败，回退存远程 URL: ${downloadError.message}`);
        localImagePath = genResult.image;
      }

      // 6. 更新记录为成功
      record.aiImage = localImagePath;
      record.aiRequestId = genResult.requestId;
      record.processingTimeMs = genResult.processingTimeMs;
      record.status = 'success';
      await this.recordRepository.save(record);

      this.logger.log(
        `Bianbian transform success: userId=${userId}, recordId=${record.id}, time=${genResult.processingTimeMs}ms`,
      );

      const remainingToday = isUnlimited
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, dailyLimit - usedToday - 1);

      return {
        id: record.id,
        aiImage: record.aiImage,
        originalImageUrl: imageUrl,
        status: 'success',
        processingTimeMs: record.processingTimeMs,
        remainingToday,
      };
    } catch (error) {
      // 清理临时文件
      if (tempFilename) {
        this.cleanupTempImage(tempFilename).catch(() => {});
      }

      // 7. 记录失败；持久化异常不能掩盖原始图片生成错误
      record.status = 'failed';
      record.errorMsg = (error?.message || String(error)).slice(0, 500);
      try {
        await this.recordRepository.save(record);
      } catch (saveError) {
        this.logger.error(`保存变身失败记录出错: ${saveError?.message || String(saveError)}`);
      }

      this.logger.error(
        `Bianbian transform failed: userId=${userId}, recordId=${record.id}, error=${error?.message || String(error)}`,
      );

      throw error;
    }
  }

  /**
   * 读取用户的每日变身次数限制
   * 优先级：用户个人配额 > 全局后台设置 > 环境变量 > 默认值（3）
   * 全局设置带 30 秒缓存
   */
  private async getDailyTransformLimit(userId: string): Promise<number> {
    // 1. 先查用户个人配额
    const personalLimit = await this.fetchUserDailyLimit(userId);
    if (personalLimit !== null) return personalLimit;

    // 2. 查全局设置（带缓存）
    const cacheKey = 'bianbian_daily_transform_limit';

    const cached = this.settingsCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SETTINGS_CACHE_TTL_MS) {
      const parsed = parseInt(cached.value, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }

    try {
      const res = await firstValueFrom(
        this.httpService.get(`${this.systemServiceUrl}/admin/settings/public/${cacheKey}`, {
          timeout: API_TIMEOUT.UPSTREAM.INTERNAL,
        }),
      );
      const value = res.data?.data;
      if (value !== null && value !== undefined) {
        this.settingsCache.set(cacheKey, { value: String(value), ts: now });
        const parsed = parseInt(String(value), 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    } catch (err) {
      this.logger.debug(`动态读取变变每日限制失败，使用缓存/兜底值: ${err.message}`);
    }

    // 3. 兜底：环境变量
    const envValue = this.configService.get<string>('BIANBIAN_DAILY_TRANSFORM_LIMIT');
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }

    return DEFAULT_DAILY_TRANSFORM_LIMIT;
  }

  /**
   * 查询用户个人每日限额，返回 null 表示未设置
   */
  private async fetchUserDailyLimit(userId: string): Promise<number | null> {
    try {
      const res = await firstValueFrom(
        this.httpService.get(`${this.userServiceUrl}/users/${userId}`, {
          timeout: API_TIMEOUT.UPSTREAM.INTERNAL,
        }),
      );
      const user = res.data;
      // 兼容 user-service 返回格式 { dailyTransformLimit: 5 } 或 { data: { dailyTransformLimit: 5 } }
      const limit = user?.dailyTransformLimit ?? user?.data?.dailyTransformLimit;
      if (limit !== null && limit !== undefined) {
        const parsed = parseInt(String(limit), 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    } catch (err) {
      this.logger.debug(`查询用户 ${userId} 个人配额失败: ${err.message}`);
    }
    return null;
  }

  private isUnlimitedRoles(roles?: string[]): boolean {
    return Boolean(roles && roles.some((r) => ADMIN_UNLIMITED_ROLES.has(r)));
  }

  /**
   * 获取用户当日变身次数
   */
  async getTodayCount(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.recordRepository.count({
      where: {
        userId,
        status: 'success',
        createdAt: MoreThanOrEqual(today),
      },
    });
  }

  /**
   * 获取用户当日剩余次数
   */
  async getRemainingToday(
    userId: string,
    roles?: string[],
  ): Promise<{
    used: number;
    limit: number;
    remaining: number;
  }> {
    const used = await this.getTodayCount(userId);
    const isUnlimited = this.isUnlimitedRoles(roles);
    const dailyLimit = isUnlimited ? Number.MAX_SAFE_INTEGER : await this.getDailyTransformLimit(userId);
    return {
      used,
      limit: dailyLimit,
      remaining: isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, dailyLimit - used),
    };
  }

  /**
   * 获取用户的变身记录列表
   */
  async getUserRecords(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{
    list: Array<{
      id: string;
      originalImage: string;
      aiImage: string | null;
      description: string;
      status: string;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [records, total] = await this.recordRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      list: records.map((r) => ({
        id: r.id,
        originalImage: r.originalImage,
        aiImage: r.aiImage,
        description: r.description || '',
        status: r.status,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 删除一条记录
   */
  async deleteRecord(id: string, userId: string): Promise<void> {
    const result = await this.recordRepository.delete({ id, userId });
    if (result.affected === 0) {
      throw new Error('记录不存在或无权删除');
    }
  }

  /**
   * 获取素材列表
   * 优先从 system-service 获取（管理后台维护的素材库），失败时抛出异常由 controller 处理后备
   */
  async getMaterials(): Promise<Array<{ id: string; category: string; name: string; icon: string; type?: string; content?: string }>> {
    try {
      const res = await firstValueFrom(
        this.httpService.get(`${this.systemServiceUrl}/admin/bianbian/materials`, {
          params: { pageSize: 200 },
          timeout: API_TIMEOUT.UPSTREAM.INTERNAL,
        }),
      );
      if (res.data?.code === 0 && Array.isArray(res.data.data?.list)) {
        return res.data.data.list.map((m: any) => ({
          id: m.id,
          category: m.category,
          name: m.name,
          icon: m.content || m.icon, // 兼容新旧数据
          type: m.type || 'emoji',
          content: m.type === 'color' ? m.content : undefined,
        }));
      }
    } catch (err) {
      this.logger.warn(`从 system-service 获取素材失败: ${err.message}`);
    }
    throw new Error('素材获取失败');
  }

  // ========== 管理员接口 ==========

  /**
   * 变变数据总览（管理员）
   */
  async getAdminStats(): Promise<{
    totalTransforms: number;
    todayTransforms: number;
    successRate: number;
    activeUsers: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, todayCount, successCount, activeUsersResult] = await Promise.all([
      this.recordRepository.count(),
      this.recordRepository.count({
        where: { createdAt: MoreThanOrEqual(today) },
      }),
      this.recordRepository.count({ where: { status: 'success' } }),
      this.recordRepository
        .createQueryBuilder('r')
        .select('COUNT(DISTINCT r.userId)', 'count')
        .getRawOne(),
    ]);

    return {
      totalTransforms: total,
      todayTransforms: todayCount,
      successRate: total > 0 ? Math.round((successCount / total) * 100) : 0,
      activeUsers: activeUsersResult ? parseInt(activeUsersResult.count, 10) : 0,
    };
  }

  /**
   * 变身记录列表（管理员，跨用户）
   */
  async getAdminRecords(
    page = 1,
    pageSize = 20,
    userId?: string,
  ): Promise<{
    list: Array<{
      id: string;
      userId: string;
      description: string;
      status: string;
      style: string;
      outputSize: string;
      processingTimeMs: number | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: FindOptionsWhere<BianbianRecord> = {};
    if (userId) {
      where.userId = userId;
    }

    const [records, total] = await this.recordRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      list: records.map((r) => ({
        id: r.id,
        userId: r.userId,
        description: r.description || '',
        status: r.status,
        style: r.style,
        outputSize: r.outputSize,
        processingTimeMs: r.processingTimeMs,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ========== 临时图片管理 ==========

  /** 将 base64 原画保存为临时文件，返回公开 URL 及文件名（用于后续清理） */
  private async saveTempImage(base64DataUrl: string): Promise<{ url: string; filename: string }> {
    const matches = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) throw new Error('非法的 base64 图片格式');

    const ext = matches[1].split('/')[1] === 'png' ? 'png' : 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');
    const filename = `bb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    await this.ensureTempDir();
    await fs.promises.writeFile(path.join(this.tempImagesDir!, filename), buffer);

    return { url: this.getPublicUrl(filename), filename };
  }

  /** 删除临时图片文件（MaaS 下载完成后调用） */
  private async cleanupTempImage(filename: string): Promise<void> {
    await this.ensureTempDir();
    const filePath = path.join(this.tempImagesDir!, filename);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // 文件可能已被删除或不存在，忽略
    }
  }

  /** 确保临时图片目录存在 */
  private async ensureTempDir(): Promise<void> {
    if (!this.tempImagesDir) {
      this.tempImagesDir = path.join(process.cwd(), 'temp-images');
    }
    if (!fs.existsSync(this.tempImagesDir)) {
      await fs.promises.mkdir(this.tempImagesDir, { recursive: true });
    }
  }

  /** 根据文件名构造临时图片的公网 URL */
  private getPublicUrl(filename: string): string {
    const publicBase =
      this.configService.get('BIANBIAN_PUBLIC_BASE_URL') ||
      this.configService.get('PUBLIC_URL');
    if (!publicBase) {
      throw new Error('BIANBIAN_PUBLIC_BASE_URL 或 PUBLIC_URL 未配置，无法生成临时图片公网 URL');
    }
    return `${publicBase.replace(/\/$/, '')}/api/bianbian/temp-image/${filename}`;
  }

  // ========== AI 生成图片落盘 ==========

  /**
   * 下载 AI 生成的图片并保存到本地 /uploads/bianbian/ 目录
   * 遵循最佳实践：AI 生成图片落盘到 /api/uploads/ 静态资源目录
   */
  private async downloadAndSaveImage(imageUrl: string, _recordId: string): Promise<string> {
    // 如果已经是本地路径，直接返回
    if (imageUrl.startsWith('/api/uploads/')) {
      return imageUrl;
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'bianbian');
    if (!fs.existsSync(uploadsDir)) {
      await fs.promises.mkdir(uploadsDir, { recursive: true });
    }

    // 从 URL 推断扩展名
    const urlExt = imageUrl.split('?')[0].split('.').pop()?.toLowerCase();
    const ext = urlExt && ['jpg', 'jpeg', 'png', 'webp'].includes(urlExt) ? urlExt : 'jpg';
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
    const filename = `bianbian-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${normalizedExt}`;
    const filePath = path.join(uploadsDir, filename);

    // 下载图片
    const response = await firstValueFrom(
      this.httpService.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: API_TIMEOUT.GATEWAY.AI_TASK,
      }),
    );

    if (response.status !== 200) {
      throw new Error(`下载图片失败: HTTP ${response.status}`);
    }

    await fs.promises.writeFile(filePath, Buffer.from(response.data));

    return `/api/uploads/bianbian/${filename}`;
  }
}
