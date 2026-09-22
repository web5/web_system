import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { UserMemoryEntity } from './user-memory.entity';

/** internal 写入的单项 */
export interface MemoryItem {
  category: string;
  content: string;
  confidence?: number;
  action?: 'add' | 'remove';
}

/** 列表项（去掉内部字段） */
export interface MemoryListItem {
  id: number;
  category: string;
  content: string;
  confidence: number;
  createdAt: Date;
}

@Injectable()
export class UserMemoryService {
  constructor(
    @InjectRepository(UserMemoryEntity)
    private readonly repo: Repository<UserMemoryEntity>,
  ) {}

  private hashOf(content: string): string {
    const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 64);
  }

  /**
   * 批量应用 AI 提炼的记忆项（internal 写入口）。
   * action='remove' 按 (userId, category, contentHash) 删除；否则 upsert（已存在则提高置信度，不重复插）。
   */
  async applyItems(userId: string, items: MemoryItem[], sourceConversationId?: string): Promise<void> {
    for (const it of items ?? []) {
      const category = String(it.category ?? '').trim();
      const content = String(it.content ?? '').trim();
      if (!category || !content) continue;

      if (it.action === 'remove') {
        await this.removeByContent(userId, category, content);
        continue;
      }
      await this.upsert(userId, category, content, it.confidence, sourceConversationId);
    }
  }

  private async upsert(
    userId: string,
    category: string,
    content: string,
    confidence: number | undefined,
    sourceConversationId?: string,
  ): Promise<void> {
    const contentHash = this.hashOf(content);
    const conf = confidence == null ? 1 : Math.max(0, Math.min(1, Number(confidence) || 0));
    const existed = await this.repo.findOne({ where: { userId, category, contentHash } });
    if (existed) {
      // 重复记忆：取更高置信度，更新时间戳
      if (conf > Number(existed.confidence)) {
        existed.confidence = conf;
        await this.repo.save(existed);
      }
      return;
    }
    const row = this.repo.create({
      userId,
      category,
      content,
      contentHash,
      confidence: conf,
      sourceConversationId: sourceConversationId ?? null,
    });
    await this.repo.save(row);
  }

  private async removeByContent(userId: string, category: string, content: string): Promise<void> {
    const contentHash = this.hashOf(content);
    await this.repo.delete({ userId, category, contentHash });
  }

  /** 当前用户记忆列表（createdAt 倒序） */
  async list(userId: string, page = 1, pageSize = 50): Promise<{ list: MemoryListItem[]; total: number }> {
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 50;
    const [rows, total] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    });
    return {
      list: rows.map((r) => ({
        id: r.id,
        category: r.category,
        content: r.content,
        confidence: Number(r.confidence),
        createdAt: r.createdAt,
      })),
      total,
    };
  }

  /** 删除：仅本人可删；他人/不存在统一返回 false（controller 转 404） */
  async remove(userId: string, id: number): Promise<boolean> {
    const result = await this.repo.delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }
}
