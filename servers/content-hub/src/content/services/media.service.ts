import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ContentMediaEntity } from '../entities/content-media.entity';
import { ContentPipelineEntity } from '../entities/content-pipeline.entity';
import { WechatMpPublisher } from '../publishers/wechat-mp/wechat-mp.publisher';
import { coverRatioHint, readImageSize } from '../../common/image-size';
import { UploadStoreClient } from './upload-store.client';

/** upload-service 的 covers 分类上限（5MB），这里同值，避免前端用「看起来能传」的大小去撞墙 */
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface MediaVO {
  id: number;
  name: string | null;
  kind: string;
  file_url: string | null;
  media_id: string | null;
  wechat_url: string | null;
  account: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  tags: string[];
  source: string;
  prompt: string | null;
  last_error: string | null;
  enabled: boolean;
  use_count: number;
  last_used_at: Date | null;
  created_at: Date;
  /** 比例提示：给人看的，不参与任何判断逻辑 */
  ratio_hint: { ok: boolean; ratio: string; hint: string };
  /** 是否已同步微信（有 media_id 才算） */
  synced: boolean;
}

export interface CreateMediaInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string | null;
}

/**
 * 公众号素材库（封面）。
 *
 * 一句话职责：**图片二进制交给 upload-service，元数据留在这里，微信 media_id 只做缓存**。
 *
 * 两个必须守住的规矩：
 *  1. 删除只做软删，且被管线引用时拒绝 —— 管线定时发布会因为一张被删的图静默退回兜底封面，
 *     表现出来是「昨天还好好的封面今天变了」，很难查。
 *  2. `media_id` 一定要连 `account` 一起存 —— 换号后同一个 id 无效（见实体注释）。
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(ContentMediaEntity)
    private readonly mediaRepo: Repository<ContentMediaEntity>,
    @InjectRepository(ContentPipelineEntity)
    private readonly pipelineRepo: Repository<ContentPipelineEntity>,
    private readonly uploadStore: UploadStoreClient,
    private readonly wechatPublisher: WechatMpPublisher,
  ) {}

  async list(query: {
    keyword?: string;
    tag?: string;
    source?: string;
    enabled?: string;
  } = {}): Promise<MediaVO[]> {
    const qb = this.mediaRepo
      .createQueryBuilder('m')
      .where('m.deleted_at IS NULL')
      .orderBy('m.created_at', 'DESC')
      .limit(200);

    if (query.keyword?.trim()) {
      qb.andWhere('(m.name LIKE :kw OR m.prompt LIKE :kw)', { kw: `%${query.keyword.trim()}%` });
    }
    // 标签是 JSON 列，MySQL 5.7/8 都支持 JSON_CONTAINS；用 LIKE 会误命中「日报2」
    if (query.tag?.trim()) {
      qb.andWhere('JSON_CONTAINS(m.tags, :tag)', { tag: JSON.stringify(query.tag.trim()) });
    }
    if (query.source?.trim()) {
      qb.andWhere('m.source = :source', { source: query.source.trim() });
    }
    if (query.enabled === '0' || query.enabled === '1') {
      qb.andWhere('m.enabled = :enabled', { enabled: query.enabled === '1' });
    }
    const rows = await qb.getMany();
    return rows.map((r) => this.toVO(r));
  }

  /** 全部标签（前端筛选下拉用）；从现有多条记录里聚合，避免再维护一张标签表 */
  async tagOptions(): Promise<{ tag: string; count: number }[]> {
    const rows = await this.mediaRepo
      .createQueryBuilder('m')
      .select('m.tags', 'tags')
      .where('m.deleted_at IS NULL')
      .getRawMany<{ tags: string | null }>();
    const counter = new Map<string, number>();
    for (const r of rows) {
      const tags = this.parseTags(r.tags);
      for (const t of tags) counter.set(t, (counter.get(t) ?? 0) + 1);
    }
    return [...counter.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** 人工上传：校验 → 转存 upload-service → 落库 */
  async createFromUpload(file: UploadedImage, name?: string, tags?: string[]): Promise<MediaVO> {
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME.includes(mime)) {
      throw new BadRequestException(
        `封面仅支持 JPG / PNG / WebP（收到 ${mime || '未知类型'}）。动图上传到微信后只剩首帧，所以不收 GIF`,
      );
    }
    if (!file.buffer?.length) throw new BadRequestException('文件内容为空');
    if (file.buffer.length > MAX_COVER_BYTES) {
      throw new BadRequestException(
        `封面不能超过 5MB（当前 ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB）`,
      );
    }

    const stored = await this.uploadStore.storeImage({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: mime,
      category: 'covers',
    });
    const size = readImageSize(file.buffer);

    const row = this.mediaRepo.create({
      kind: 'cover',
      name: name?.trim() || this.defaultName(file.originalname),
      media_type: 'image',
      file_url: stored.url,
      width: size?.width ?? null,
      height: size?.height ?? null,
      bytes: stored.size,
      mime: mime,
      tags: tags?.length ? tags : null,
      source: 'upload',
      enabled: true,
    });
    const saved = await this.mediaRepo.save(row);
    this.logger.log(`封面入库 #${saved.id} ${stored.url} (${stored.size} 字节)`);
    return this.toVO(saved);
  }

  /**
   * 保存一张已落盘的图片（AI 生成走后端直接产出字节，跳过"浏览器上传"这一步）。
   * 与 `createFromUpload` 的区别只有来源与提示词，其余校验一致。
   */
  async createFromBuffer(input: {
    buffer: Buffer;
    filename: string;
    mime: string;
    name?: string;
    tags?: string[];
    prompt?: string;
  }): Promise<MediaVO> {
    const mime = (input.mime || '').toLowerCase();
    if (!ALLOWED_MIME.includes(mime)) {
      throw new BadRequestException(`AI 返回的图片格式不支持：${mime || '未知'}`);
    }
    const stored = await this.uploadStore.storeImage({
      buffer: input.buffer,
      filename: input.filename,
      mimeType: mime,
      category: 'covers',
    });
    const size = readImageSize(input.buffer);
    const saved = await this.mediaRepo.save(
      this.mediaRepo.create({
        kind: 'cover',
        name: input.name?.trim() || this.defaultName(input.filename),
        media_type: 'image',
        file_url: stored.url,
        width: size?.width ?? null,
        height: size?.height ?? null,
        bytes: stored.size,
        mime,
        tags: input.tags?.length ? input.tags : null,
        source: 'ai',
        prompt: input.prompt?.slice(0, 4000) ?? null,
        enabled: true,
      }),
    );
    this.logger.log(`AI 封面入库 #${saved.id} ${stored.url}`);
    return this.toVO(saved);
  }

  async update(
    id: number,
    dto: { name?: string; tags?: string[]; enabled?: boolean },
  ): Promise<MediaVO> {
    const row = await this.mustGet(id);
    if (dto.name !== undefined) row.name = dto.name.trim().slice(0, 128) || null;
    if (dto.tags !== undefined) row.tags = dto.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20);
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.toVO(await this.mediaRepo.save(row));
  }

  /**
   * 软删。被管线当默认封面时拒绝 —— 静默删掉会让那条管线下次发布
   * 退回兜底封面，而人只会看到「封面怎么变了」。
   */
  async remove(id: number): Promise<{ ok: true }> {
    const row = await this.mustGet(id);
    const usedBy = await this.pipelineRepo.find({
      where: { default_cover_id: id, deleted_at: IsNull() },
      select: ['id', 'code'],
    });
    if (usedBy.length > 0) {
      throw new BadRequestException(
        `这张图是管线「${usedBy.map((p) => p.code).join(' / ')}」的默认封面，先把管线换掉再删`,
      );
    }
    await this.mediaRepo.softDelete(row.id);
    return { ok: true };
  }

  /**
   * 同步到微信永久素材库。
   *
   * 已同步则直接回缓存值 —— 微信图片素材上限 5000，重复上传很快会撞满，
   * 而且每次上传都是一次外网往返（几百毫秒到几秒）。
   */
  async syncToWechat(id: number, account = 'default', force = false): Promise<MediaVO> {
    const row = await this.mustGet(id);
    if (!row.file_url) throw new BadRequestException('该素材没有源图地址，无法同步微信');
    if (row.media_id && row.account === account && !force) {
      return this.toVO(row);
    }
    try {
      const result = await this.wechatPublisher.uploadCoverToWechat(row.file_url, account);
      row.media_id = result.media_id;
      row.url = result.url;
      row.account = account;
      row.last_error = null;
      return this.toVO(await this.mediaRepo.save(row));
    } catch (e) {
      // 失败要留痕：否则前端只看得到「同步按钮点了没反应」
      row.last_error = (e as Error).message.slice(0, 255);
      await this.mediaRepo.save(row);
      throw new BadRequestException(`同步微信失败：${(e as Error).message}`);
    }
  }

  /**
   * 发布前取可用的 `thumb_media_id`：没有就同步一次。
   *
   * 这里**不抛错**，失败返回 null 让发布继续走兜底封面 ——
   * 封面没传成不该把整篇文章卡住，那是本末倒置。
   */
  async ensureWechatMediaId(id: number, account = 'default'): Promise<string | null> {
    const row = await this.mediaRepo.findOne({ where: { id } });
    if (!row || !row.enabled || !row.file_url) {
      this.logger.warn(`封面 #${id} 不存在/已停用/无源图，发布将退回兜底封面`);
      return null;
    }
    if (row.media_id && row.account === account) return row.media_id;
    try {
      const synced = await this.syncToWechat(id, account);
      return synced.media_id;
    } catch (e) {
      this.logger.warn(`封面 #${id} 同步微信失败，退回兜底封面: ${(e as Error).message}`);
      return null;
    }
  }

  /** 发布成功后记账：用一次加一次，便于识别「哪张图真的在用」 */
  async markUsed(id: number): Promise<void> {
    await this.mediaRepo
      .createQueryBuilder()
      .update(ContentMediaEntity)
      .set({ use_count: () => 'use_count + 1', last_used_at: new Date() })
      .where('id = :id', { id })
      .execute();
  }

  private async mustGet(id: number): Promise<ContentMediaEntity> {
    const row = await this.mediaRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`素材 #${id} 不存在`);
    return row;
  }

  private defaultName(filename: string): string {
    return filename.replace(/\.[^.]+$/, '').slice(0, 128) || '未命名封面';
  }

  private parseTags(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private toVO(row: ContentMediaEntity): MediaVO {
    return {
      id: Number(row.id),
      name: row.name,
      kind: row.kind,
      file_url: row.file_url,
      media_id: row.media_id,
      wechat_url: row.url,
      account: row.account ?? 'default',
      width: row.width,
      height: row.height,
      bytes: row.bytes,
      mime: row.mime,
      tags: this.parseTags(row.tags),
      source: row.source,
      prompt: row.prompt,
      last_error: row.last_error,
      enabled: row.enabled,
      use_count: row.use_count ?? 0,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      ratio_hint: coverRatioHint(row.width, row.height),
      synced: !!row.media_id,
    };
  }
}
