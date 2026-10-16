/**
 * 论文摘要落库服务（p35 · CQO · 按 D1 裁决：落 `content_items`）。
 *
 * 🔴 **为什么这组代码必须在 M1 就做**：
 * 论文摘要由定时任务里的 AI 现场生成，产出原本只存在于腾讯文档 / 公众号草稿，
 * **不在库里**。若不落库，Phase 2 的三件事全部无从下手：
 *   · 100 条评测集无从抽样（产出不在库）
 *   · 按 prompt 版本对照无从筛选（没有 `prompt_version` 字段）
 *   · 幻觉率无法自动判定（「摘要里的数字能否在原文找到」需要摘要与原文都在库）
 *
 * 字段设计的关键取舍：
 *   · `content` 存 **arXiv 原文 summary**，不存中文摘要
 *     → 这是幻觉判定的比对基准。存中文就等于丢了「标准答案」
 *   · `summary` 存中文摘要（译名 / 核心贡献 / 方法亮点 / 潜在应用）
 *   · `meta.prompt_version` 记prompt 版本，评测抽样靠它
 *   · `meta.digest` 存结构化四字段，评测集标注直接引用
 *
 * 降级通道（`scripts/mcp-fallback/paper-fallback-publish.sh`）产出的摘要模板化、
 * 无 LLM 内容，若混入评测集会拉低幻觉率 —— 所以必须打 `fallback` 标记。
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { ContentItemEntity } from '../entities/content-item.entity';
import {
  QUALITY_STAGE,
  QUALITY_STATUS,
  type QualityStage,
  type QualityStatus,
} from '../quality/quality.enum';

/** 单篇论文的摘要产出（由定时任务的 AI 按 prompt 组装后 POST 上来） */
export interface ArxivDigestInput {
  /** arXiv 论文 id，如 2408.12345 */
  arxiv_id: string;
  /** 英文原标题 */
  title_en: string;
  /** arXiv 原文 summary —— 幻觉判定的比对基准，必填 */
  abstract: string;
  /** abs 链接 */
  abs_url?: string;
  /** 作者列表 */
  authors?: string[];
  /** arXiv 分类，如 cs.AI */
  category?: string;
  /** 论文提交时间（ISO 字符串） */
  published?: string;
  /** 中文译名 */
  title_zh?: string;
  /** 一句话核心贡献 */
  contribution?: string;
  /** 方法亮点 */
  method_highlight?: string;
  /** 潜在应用意义 */
  application?: string;
  /** 本次使用的 prompt 版本，如 v1（评测抽样按它筛） */
  prompt_version: string;
  /** 是否走降级通道产出 */
  degraded?: boolean;
  /** 关联管线（可空） */
  pipeline_id?: number | null;
}

export interface DigestPersistResult {
  arxiv_id: string;
  /** true = 新写入；false = 已采集过（唯一键命中） */
  inserted: boolean;
  item_id: number | null;
  quality_status: QualityStatus;
  quality_stage: QualityStage;
  /** 降级产物会被标为 partial + fallback */
  degraded: boolean;
}

@Injectable()
export class ArxivDigestService {
  private readonly logger = new Logger(ArxivDigestService.name);

  /** 统一的 source_name，评测抽样按它筛「AI 产出」 */
  static readonly SOURCE_NAME = 'arxiv_digest';

  constructor(
    @InjectRepository(ContentItemEntity)
    private readonly itemRepo: Repository<ContentItemEntity>,
  ) {}

  /**
   * 落一条论文摘要产出。
   *
   * 幂等：`external_id = sha1(arxiv_id|prompt_version)`，靠
   * `uk_items_pipeline_external` 唯一索引保证同版本重复提交不产生重复行。
   */
  async persistDigest(input: ArxivDigestInput): Promise<DigestPersistResult> {
    // 降级产物：模板化摘要，没有 LLM 内容 → partial + fallback
    const degraded = input.degraded === true;
    const qualityStatus = degraded ? QUALITY_STATUS.PARTIAL : QUALITY_STATUS.OK;
    const qualityStage = degraded ? QUALITY_STAGE.FALLBACK : QUALITY_STAGE.LLM;

    const titleZh = input.title_zh?.trim() || input.title_en?.trim() || input.arxiv_id;
    const externalId = createHash('sha1')
      .update(`${input.arxiv_id}|${input.prompt_version}`)
      .digest('hex');

    // 中文摘要：四字段拼接，供 admin 查阅与评测标注
    const summaryParts = [
      input.title_zh ? `【中文译名】${input.title_zh}` : null,
      input.contribution ? `【核心贡献】${input.contribution}` : null,
      input.method_highlight ? `【方法亮点】${input.method_highlight}` : null,
      input.application ? `【潜在应用】${input.application}` : null,
    ].filter((s): s is string => !!s);

    const row: Partial<ContentItemEntity> = {
      pipeline_id: input.pipeline_id ?? null,
      external_id: externalId,
      // 译名是 admin 列表的主标识；无译名时退回英文标题
      title: titleZh.slice(0, 500),
      url: input.abs_url ?? null,
      // ⚠️ content存**原文 abstract**，不是中文摘要 —— 幻觉判定的比对基准
      content: input.abstract,
      summary: summaryParts.join('\n') || null,
      category: input.category ?? null,
      source_name: ArxivDigestService.SOURCE_NAME,
      publish_date: input.published ? new Date(input.published) : null,
      status: 'pending',
      quality_status: qualityStatus as QualityStatus,
      quality_stage: qualityStage as QualityStage,
      quality_issue: degraded ? '走降级通道，摘要为模板化产出（非 LLM 生成）' : null,
      raw_hash: createHash('sha256').update(input.abstract ?? '').digest('hex').slice(0, 64),
      meta: {
        arxiv_id: input.arxiv_id,
        title_en: input.title_en,
        authors: input.authors ?? [],
        abs_url: input.abs_url ?? null,
        // 评测抽样的核心字段：按它筛某一 prompt 版本的产出
        prompt_version: input.prompt_version,
        degraded,
        // 结构化四字段，评测集标注直接引用，不用再解析 summary 文本
        digest: {
          译名: input.title_zh ?? null,
          核心贡献: input.contribution ?? null,
          方法亮点: input.method_highlight ?? null,
          潜在应用: input.application ?? null,
        },
      },
    };

    try {
      await this.itemRepo.insert(row);
      return {
        arxiv_id: input.arxiv_id,
        inserted: true,
        item_id: null,
        quality_status: qualityStatus as QualityStatus,
        quality_stage: qualityStage as QualityStage,
        degraded,
      };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(err.message ?? '')) {
        // 同prompt 版本重复提交 —— 不是错误，静默跳过
        this.logger.debug(
          `论文摘要已存在跳过：arxiv_id=${input.arxiv_id} prompt_version=${input.prompt_version}`,
        );
        return {
          arxiv_id: input.arxiv_id,
          inserted: false,
          item_id: null,
          quality_status: qualityStatus as QualityStatus,
          quality_stage: qualityStage as QualityStage,
          degraded,
        };
      }
      throw e;
    }
  }

  /** 批量落库（一篇日报 10 条一起提交） */
  async persistBatch(
    inputs: ArxivDigestInput[],
  ): Promise<DigestPersistResult[]> {
    const results: DigestPersistResult[] = [];
    for (const input of inputs) {
      try {
        results.push(await this.persistDigest(input));
      } catch (e) {
        // 单条失败不打断整批
        this.logger.warn(
          `论文摘要落库失败 arxiv_id=${input.arxiv_id}: ${(e as Error).message}`,
        );
        results.push({
          arxiv_id: input.arxiv_id,
          inserted: false,
          item_id: null,
          quality_status: QUALITY_STATUS.FAIL,
          quality_stage: QUALITY_STAGE.LLM,
          degraded: input.degraded === true,
        });
      }
    }
    return results;
  }

  /**
   * 按 prompt 版本抽样（Phase 2 评测集用）。
   *
   * 等间隔抽样而非随机：真实数据里才有真实的脏东西（格式不统一、边缘 case、
   * 有问题的样本），造出来的数据测不出真问题。
   *
   * @param promptVersion 指定版本；不传则取全部 AI 产出
   * @param size          抽样条数（Phase 2 用 100）
   */
  async sampleForEval(
    promptVersion?: string,
    size = 100,
  ): Promise<ContentItemEntity[]> {
    const qb = this.itemRepo
      .createQueryBuilder('i')
      .where('i.source_name = :source', { source: ArxivDigestService.SOURCE_NAME })
      // 降级产出不进评测集：模板化摘要会拉低幻觉率，让基线不准
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(i.meta, '$.prompt_version')) = :pv", {
        pv: promptVersion ?? '',
      })
      .orderBy('i.publish_date', 'DESC')
      .addOrderBy('i.id', 'DESC');

    if (!promptVersion) {
      // 不指定版本时排除降级产物
      qb.andWhere("COALESCE(JSON_EXTRACT(i.meta, '$.degraded'), false) = false");
    }

    const total = await qb.getCount();
    if (total === 0) return [];

    // 等间隔抽样：步长 = total / size
    const step = Math.max(1, Math.floor(total / size));
    const rows: ContentItemEntity[] = [];
    for (let i = 0; i < total && rows.length < size; i += step) {
      const row = await qb.clone().offset(i).limit(1).getOne();
      if (row) rows.push(row);
    }
    return rows;
  }

  /** 各prompt 版本的产出条数（评测进度看板用） */
  async countByVersion(): Promise<Array<{ prompt_version: string; count: number }>> {
    const rows = await this.itemRepo
      .createQueryBuilder('i')
      .select("JSON_UNQUOTE(JSON_EXTRACT(i.meta, '$.prompt_version'))", 'prompt_version')
      .addSelect('COUNT(*)', 'count')
      .where('i.source_name = :source', { source: ArxivDigestService.SOURCE_NAME })
      .groupBy('prompt_version')
      .orderBy('prompt_version', 'ASC')
      .getRawMany<{ prompt_version: string; count: string }>();

    return rows.map((r) => ({
      prompt_version: r.prompt_version ?? '(未标记)',
      count: Number(r.count ?? 0),
    }));
  }
}
