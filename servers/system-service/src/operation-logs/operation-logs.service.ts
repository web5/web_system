import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { OperationLog } from '../config/operation-log.entity';

interface LogInput {
  operator: string;
  type: string;
  target?: string;
  ip?: string;
}

interface LogQuery {
  page?: number;
  pageSize?: number;
  operator?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
}

@Injectable()
export class OperationLogsService {
  constructor(
    @InjectRepository(OperationLog)
    private repo: Repository<OperationLog>,
  ) {}

  async log(input: LogInput): Promise<OperationLog> {
    const entry = this.repo.create(input);
    return this.repo.save(entry);
  }

  async query(params: LogQuery) {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const where: any = {};

    if (params.operator) where.operator = params.operator;
    if (params.type) where.type = params.type;
    if (params.startTime || params.endTime) {
      const start = params.startTime ? new Date(params.startTime) : new Date(0);
      const end = params.endTime ? new Date(params.endTime) : new Date();
      where.createdAt = Between(start, end);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /** 清理超过 days 天的旧日志 */
  async cleanOld(days = 90): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.repo.delete({ createdAt: LessThanOrEqual(cutoff) } as any);
    return result.affected || 0;
  }
}
