import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { BianbianRecord } from './entities/bianbian-record.entity';
import { ImageGenClient } from './image-gen.client';
import { TransformDto, TransformResponse } from './dto/transform.dto';

/** 每日变身次数限制 */
const DAILY_TRANSFORM_LIMIT = 3;

@Injectable()
export class BianbianService {
  private readonly logger = new Logger(BianbianService.name);

  constructor(
    @InjectRepository(BianbianRecord)
    private readonly recordRepository: Repository<BianbianRecord>,
    private readonly imageGenClient: ImageGenClient,
  ) {}

  /**
   * 执行变变变身
   */
  async transform(dto: TransformDto): Promise<TransformResponse> {
    const userId = dto.userId || 'anonymous';
    const startTime = Date.now();

    // 1. 检查今日配额
    const todayCount = await this.getTodayCount(userId);
    if (todayCount >= DAILY_TRANSFORM_LIMIT) {
      throw new Error(`今日变身次数已用完（${DAILY_TRANSFORM_LIMIT}次/天），明天再来吧～`);
    }

    // 2. 创建记录（pending）
    let record = this.recordRepository.create({
      userId,
      originalImage: dto.image,
      description: dto.description || null,
      style: dto.style || 'pixar-3d',
      outputSize: dto.outputSize || '1024x1024',
      status: 'processing',
    });
    record = await this.recordRepository.save(record);

    // 3. 调用 AI 图生图
    try {
      const genResult = await this.imageGenClient.generate({
        image: dto.image,
        description: dto.description,
        style: dto.style || 'pixar-3d',
        outputSize: dto.outputSize || '1024x1024',
      });

      // 4. 更新记录为成功
      record.aiImage = genResult.image;
      record.aiRequestId = genResult.requestId;
      record.processingTimeMs = genResult.processingTimeMs;
      record.status = 'success';
      await this.recordRepository.save(record);

      this.logger.log(
        `Bianbian transform success: userId=${userId}, recordId=${record.id}, time=${genResult.processingTimeMs}ms`,
      );

      const remaining = DAILY_TRANSFORM_LIMIT - todayCount - 1;

      return {
        id: record.id,
        aiImage: genResult.image,
        status: 'success',
        processingTimeMs: genResult.processingTimeMs,
        remainingToday: Math.max(0, remaining),
      };
    } catch (error) {
      // 5. 记录失败
      record.status = 'failed';
      record.errorMsg = error.message;
      await this.recordRepository.save(record);

      this.logger.error(
        `Bianbian transform failed: userId=${userId}, recordId=${record.id}, error=${error.message}`,
      );

      throw error;
    }
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
  async getRemainingToday(userId: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
  }> {
    const used = await this.getTodayCount(userId);
    return {
      used,
      limit: DAILY_TRANSFORM_LIMIT,
      remaining: Math.max(0, DAILY_TRANSFORM_LIMIT - used),
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
    const where: any = {};
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
}
