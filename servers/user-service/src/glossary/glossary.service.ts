import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { createHash } from 'crypto';
import { GlossaryEntryEntity } from './glossary-entry.entity';
import { CreateGlossaryDto } from './dto/create-glossary.dto';

/** 收藏结果 */
export interface CollectResult {
  id: number;
  created: boolean;
  existed: boolean;
}

/** 列表项（去掉内部字段） */
export interface GlossaryListItem {
  id: number;
  sourceType: string;
  sourceText: string | null;
  enMain: string;
  note: string | null;
  meta: unknown;
  createdAt: Date;
}

@Injectable()
export class GlossaryService {
  constructor(
    @InjectRepository(GlossaryEntryEntity)
    private readonly repo: Repository<GlossaryEntryEntity>,
  ) {}

  /** enMain 归一化哈希：trim + 小写 + 压缩空白 → sha256 截 64 */
  private hashOf(enMain: string): string {
    const normalized = enMain.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 64);
  }

  /** 收藏（幂等）：同一用户同一译文已存在则返回已存在，不重复插入 */
  async collect(userId: string, dto: CreateGlossaryDto): Promise<CollectResult> {
    const contentHash = this.hashOf(dto.enMain);
    const existed = await this.repo.findOne({ where: { userId, contentHash } });
    if (existed) {
      return { id: existed.id, created: false, existed: true };
    }

    const entry = this.repo.create({
      userId,
      contentHash,
      sourceType: dto.sourceType,
      sourceText: dto.sourceText ?? null,
      enMain: dto.enMain,
      note: dto.note ?? null,
      meta: dto.meta ?? null,
      conversationId: dto.conversationId ?? null,
    });
    const saved = await this.repo.save(entry);
    return { id: saved.id, created: true, existed: false };
  }

  /** 当前用户收藏列表（createdAt 倒序，keyword 模糊 enMain/sourceText） */
  async list(userId: string, page = 1, pageSize = 20, keyword?: string): Promise<{ list: GlossaryListItem[]; total: number }> {
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 20;
    const kw = keyword?.trim();

    const [rows, total] = await this.repo.findAndCount({
      where: kw
        ? { userId, enMain: ILike(`%${kw}%`) }
        : { userId },
      order: { createdAt: 'DESC' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    });

    const list: GlossaryListItem[] = rows.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceText: r.sourceText,
      enMain: r.enMain,
      note: r.note,
      meta: r.meta,
      createdAt: r.createdAt,
    }));
    return { list, total };
  }

  /** 删除：仅本人可删；他人/不存在统一返回 false（controller 转 404，不泄露存在性） */
  async remove(userId: string, id: number): Promise<boolean> {
    const result = await this.repo.delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }
}
