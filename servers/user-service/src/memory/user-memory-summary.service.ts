import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { UserMemorySummaryEntity } from './user-memory-summary.entity';
import { UserMemoryEntity } from './user-memory.entity';
import { AiAgentSummaryClient } from './ai-agent-summary.client';

/** 摘要正文的长度上限（验收判据 6：CHAR_LENGTH(summary) ≤ 500） */
const SUMMARY_MAX_CHARS = 500;

/** 摘要域缺省值（v1 只用 general，表已预留多域） */
export const DEFAULT_SUMMARY_NAMESPACE = 'general';

/** upsert 输入 */
export interface SummaryUpsertInput {
  userId: string;
  namespace?: string;
  summary: string;
  itemCount: number;
  sourceHash: string;
  lastItemAt: Date | null;
}

/** rebuild 结果 */
export interface RebuildResult {
  changed: boolean;
  /** false = 明细集与上次相同（source_hash 一致），幂等跳过 */
  skipped: boolean;
  row: UserMemorySummaryEntity | null;
}

/** 明细行的最小投影（rebuild 与指纹计算用） */
interface MemoryDetailRow {
  id: number;
  category: string;
  content: string;
  contentHash: string;
  createdAt: Date;
}

/**
 * 用户记忆摘要服务（#8229 批次1 卡1.2；架构修正：LLM 统一走 ai-agent）。
 *
 * 职责：
 *   - get：读某用户某域的摘要行（或 null）；
 *   - upsert：幂等写摘要行（source_hash 相同不产生新版本）；
 *   - rebuild：从明细层全量重算摘要（拍板②：明细写入后全量重算）。
 *
 * 摘要生成（架构修正，用户 2026-10-30 拍板）：
 *   - LLM 调用统一走 ai-agent internal 端点 /internal/llm/memory-summary
 *     （AiAgentSummaryClient，x-service-key 鉴权）；本服务**不直连 TokenHub、
 *     不持有任何 LLM 密钥**，模型与密钥都归 ai-agent（与记忆提炼同一模型）；
 *   - LLM 不可用 / 调用失败 / 超时 → 回落确定性模板聚合（分类小标题 + 明细原文），
 *     链路不阻断（降级 warn 日志）。
 */
@Injectable()
export class UserMemorySummaryService {
  private readonly logger = new Logger(UserMemorySummaryService.name);

  constructor(
    @InjectRepository(UserMemorySummaryEntity)
    private readonly repo: Repository<UserMemorySummaryEntity>,
    @InjectRepository(UserMemoryEntity)
    private readonly memoryRepo: Repository<UserMemoryEntity>,
    private readonly aiAgent: AiAgentSummaryClient,
  ) {}

  /** 读某用户某域的摘要行；没有返回 null */
  async get(userId: string, namespace = DEFAULT_SUMMARY_NAMESPACE): Promise<UserMemorySummaryEntity | null> {
    if (!userId) return null;
    return this.repo.findOne({ where: { userId, namespace } });
  }

  /**
   * 幂等写摘要行。
   * source_hash 与既有行一致 → 原样返回（不产生新版本）；
   * 否则 version = 既有 version + 1（首写为 1）。
   */
  async upsert(input: SummaryUpsertInput): Promise<{ changed: boolean; row: UserMemorySummaryEntity }> {
    const namespace = input.namespace || DEFAULT_SUMMARY_NAMESPACE;
    const existing = await this.repo.findOne({ where: { userId: input.userId, namespace } });

    if (existing && existing.sourceHash === input.sourceHash) {
      // 同一明细集指纹：幂等，不动版本号
      return { changed: false, row: existing };
    }

    const summary = truncate(input.summary, SUMMARY_MAX_CHARS);
    let row: UserMemorySummaryEntity;
    if (existing) {
      existing.summary = summary;
      existing.itemCount = input.itemCount;
      existing.sourceHash = input.sourceHash;
      existing.version = Number(existing.version) + 1;
      existing.lastItemAt = input.lastItemAt;
      row = await this.repo.save(existing);
    } else {
      row = await this.repo.save(
        this.repo.create({
          userId: input.userId,
          namespace,
          summary,
          itemCount: input.itemCount,
          sourceHash: input.sourceHash,
          version: 1,
          lastItemAt: input.lastItemAt,
        }),
      );
    }
    return { changed: true, row };
  }

  /**
   * 从明细层全量重算摘要（拍板②）。
   * 明细集指纹与既有摘要一致 → 幂等跳过（version 不变）；
   * 明细为空且从无摘要行 → 不产生空行。
   */
  async rebuild(userId: string, namespace = DEFAULT_SUMMARY_NAMESPACE): Promise<RebuildResult> {
    const details = await this.memoryRepo.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const sourceHash = this.computeSourceHash(details);
    const existing = await this.get(userId, namespace);

    // 幂等判据：同一 source_hash 重复 rebuild 不产生新版本
    if (existing && existing.sourceHash === sourceHash) {
      return { changed: false, skipped: true, row: existing };
    }
    // 无明细且从无摘要：不写空行（摘要行由首次有效明细触发）
    if (!existing && details.length === 0) {
      return { changed: false, skipped: true, row: null };
    }

    const lastItemAt = details.length
      ? details.reduce((acc, d) => (d.createdAt > acc ? d.createdAt : acc), details[0].createdAt)
      : null;
    const summary = await this.generateSummary(userId, namespace, details);
    const { changed, row } = await this.upsert({
      userId,
      namespace,
      summary,
      itemCount: details.length,
      sourceHash,
      lastItemAt: lastItemAt ?? null,
    });
    this.logger.log(
      `用户记忆摘要重算: userId=${userId} ns=${namespace} items=${details.length} version=${row.version} changed=${changed}`,
    );
    return { changed, skipped: false, row };
  }

  /**
   * 明细集指纹：按 id 升序 `id:contentHash` 竖线拼接后 sha256（hex 64）。
   * 明细去重唯一键 (user_id, category, content_hash) 保证集合稳定 → 指纹幂等。
   */
  private computeSourceHash(details: MemoryDetailRow[]): string {
    const joined = details
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((d) => `${d.id}:${d.contentHash}`)
      .join('|');
    return createHash('sha256').update(joined).digest('hex').slice(0, 64);
  }

  /**
   * 生成摘要正文：优先 LLM（拍板③），失败回落确定性模板（分类小标题 + 原文）。
   * 本方法不抛异常——摘要生成失败不能阻断 refresh 链路。
   */
  private async generateSummary(userId: string, namespace: string, details: MemoryDetailRow[]): Promise<string> {
    if (details.length === 0) {
      return '该用户暂无记忆明细';
    }
    try {
      const llm = await this.generateSummaryByLlm(userId, namespace, details);
      if (llm && llm.trim()) return llm.trim();
      this.logger.warn('摘要 LLM 返回空，回落模板聚合');
    } catch (e) {
      this.logger.warn(`摘要 LLM 生成失败，回落模板聚合: ${(e as Error).message}`);
    }
    return templateSummary(details);
  }

  /** 经 ai-agent internal 端点生成结构化摘要（LLM 统一通道，模型归 ai-agent） */
  private async generateSummaryByLlm(userId: string, namespace: string, details: MemoryDetailRow[]): Promise<string> {
    const items = details
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((d) => ({ category: d.category, content: d.content }));
    return this.aiAgent.summarize(userId, namespace, items, details.length);
  }
}

/** 超长截断（验收判据 6：≤500 字，超出截断并标「…」） */
function truncate(text: string, max: number): string {
  const t = (text ?? '').trim();
  if (Array.from(t).length <= max) return t;
  return Array.from(t)
    .slice(0, max - 1)
    .join('') + '…';
}

/**
 * 确定性模板聚合（LLM 不可用时的兜底，与 LLM 输出同格式：纯文本多行「· 分类：内容」）
 *
 * 格式口径（#8273）：前端摘要卡按 `{{ }}` 插值转义渲染、禁 v-html（防 LLM 半可信输入
 * 注入 HTML），markdown 不会被渲染，只会露出 `#`/`-`/`**`。故兜底模板与 ai-agent 侧
 * prompt 必须同口径输出纯文本；两处任一漏改，LLM 成功/失败切换时观感就会跳变。
 * 「条数 / 更新时间」由卡片 meta 单独展示，正文不重复。
 */
function templateSummary(details: MemoryDetailRow[]): string {
  const byCategory = new Map<string, string[]>();
  for (const d of details) {
    const list = byCategory.get(d.category) ?? [];
    list.push(d.content);
    byCategory.set(d.category, list);
  }
  const label: Record<string, string> = { fact: '事实', preference: '偏好', habit: '习惯' };
  const parts: string[] = [];
  for (const [cat, contents] of byCategory) {
    const name = label[cat] ?? cat;
    parts.push(`· ${name}：${contents.join('；')}`);
  }
  return parts.join('\n');
}
