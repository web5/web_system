import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AuditLogEntity, AuditChangeItem } from '../entities/audit-log.entity';

/**
 * 审计日志条目结构（接口层）
 */
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  env?: string;
  component?: string;
  status: string;
  detail: string;
  /** 字段级前后 diff（可选，配置类写操作提供） */
  changes?: AuditChangeItem[];
}

/**
 * 求两个对象之间的字段级 diff（纯函数，便于单测）。
 *
 * 约定：
 * - 对比键为两个对象键的并集，值以 JSON.stringify 判等（对象/数组按整体对比）；
 * - 值相等不输出；键只出现在 before（被删除）或只出现在 after（新增）都会输出；
 * - before/after 原样保留（脚本/JSON 等长值交给前端按字段折叠展示）。
 */
export function diffObject(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditChangeItem[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const out: AuditChangeItem[] = [];
  for (const field of keys) {
    const b = (before as Record<string, unknown> | undefined)?.[field];
    const a = (after as Record<string, unknown> | undefined)?.[field];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ field, before: b, after: a });
  }
  return out;
}

/**
 * 审计日志服务
 * 同时写入 MySQL（audit_logs，结构化查询）与本地 JSONL 文件（备份）
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly logPath: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {
    this.logPath = this.configService.get<string>('AUDIT_LOG_PATH') || '/data/env_config/deploy-audit.log';
    this.ensureLogDir();
  }

  private ensureLogDir() {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        this.logger.warn(`无法创建审计日志目录 ${dir}: ${err.message}`);
      }
    }
  }

  /**
   * 记录审计日志（落库 + 文件备份）。
   * entry.changes 为字段级前后 diff（可选），null/空数组不写入。
   */
  async log(entry: Partial<AuditLogEntry>): Promise<void> {
    const ts = new Date();
    const entity = {
      id: crypto.randomUUID(),
      timestamp: ts,
      user: entry.user || 'unknown',
      action: entry.action || 'unknown',
      env: entry.env,
      component: entry.component,
      status: entry.status || 'unknown',
      detail: entry.detail || '',
      changes: entry.changes?.length ? entry.changes : null,
    };

    // 写入 MySQL
    try {
      await this.repo.save(entity);
    } catch (err) {
      this.logger.error(`写入审计日志(MySQL)失败: ${err.message}`);
    }

    // 写入本地 JSONL 备份
    const line = JSON.stringify({ ...entity, timestamp: ts.toISOString() }) + '\n';
    try {
      fs.appendFileSync(this.logPath, line, 'utf-8');
    } catch (err) {
      this.logger.warn(`写入审计日志(文件)失败: ${err.message}`);
    }
  }

  /**
   * 分页查询审计日志（读 DB）
   */
  async list(page: number = 1, limit: number = 20): Promise<{
    data: AuditLogEntry[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [rows, total] = await this.repo.findAndCount({
      order: { timestamp: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data: AuditLogEntry[] = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
      user: r.user,
      action: r.action,
      env: r.env,
      component: r.component,
      status: r.status,
      detail: r.detail,
      changes: r.changes ?? undefined,
    }));

    return { data, total, page, limit };
  }
}
