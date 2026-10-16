/**
 * 内容质量工程（CQO）· 接口入参 DTO。
 *
 * 🔴 红线：`@Body()` / `@Query()` / `@Param()` 必须用 class-validator DTO，
 * 禁止裸 `Record<string, string>` 或 `any`。
 *
 * 现状说明：content-hub 现有 13 个路由**全部**是 `@Body() body: any`（历史遗留）。
 * 本文件只约束**新增接口**；存量 `any` 的清理见设计文档 §5.4（待拍板 D3）。
 */
import {
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  IsNumber,
  IsArray,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 质量状态取值（与 quality.enum 对齐；DTO 层用字符串字面量便于校验） */
export const QUALITY_STATUS_VALUES = ['ok', 'partial', 'fail', 'skip'] as const;
export const QUALITY_STAGE_VALUES = [
  'collect',
  'dedup',
  'llm',
  'fallback',
  'publish',
] as const;
export const COLLECT_TRIGGER_VALUES = ['schedule', 'manual'] as const;

/** 内容条目列表查询（FR-API-1：五维筛选 + 分页） */
export class ListItemsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  /** 现有状态机取值 */
  @IsOptional()
  @IsString()
  @MaxLength(24)
  status?: string;

  /** 质量结论（本期核心新增筛选维度） */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  quality_status?: string;

  /** 归因阶段 */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  quality_stage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pipeline?: number;

  /** 来源 ID（content_sources.id） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  source?: number;

  /** 关键词：搜标题 + 摘要 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  /** 日期范围起点（publish_date） */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date_from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  date_to?: string;

  /** 排序，默认 publish_date:desc */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort?: string;
}

/** 统计查询（FR-API-2） */
export class ItemStatsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date_from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  date_to?: string;

  /** 分组维度：source | status | quality_status | quality_stage */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  group_by?: string;
}

/** 手动触发采集（FR-API-5） */
export class TriggerCollectDto {
  /** 采集条数上限，服务端会再 clamp 一次 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** 采集器私有配置（如 window_days） */
  @IsOptional()
  @IsArray()
  config?: Record<string, unknown>[];
}

/** 采集批次日志查询（FR-API-6） */
export class CollectRunsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

/** 采集健康度查询（FR-API-7） */
export class CollectHealthQueryDto {
  /** 统计窗口天数，默认 7 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number = 7;
}

/** 单条论文摘要产出（FR-EVAL-2） */
export class ArxivDigestItemDto {
  @IsString()
  @MaxLength(64)
  arxiv_id: string;

  @IsString()
  @MaxLength(500)
  title_en: string;

  /**
   * arXiv 原文 summary —— **幻觉判定的比对基准，必填**。
   * 空的话 Phase 2 的幻觉率就自动判不了（没有「标准答案」可比）。
   */
  @IsString()
  @MaxLength(20000)
  abstract: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  abs_url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  published?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title_zh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contribution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  method_highlight?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  application?: string;

  /** prompt 版本，评测抽样按它筛——缺这个值 Phase 2 无法做版本对照 */
  @IsString()
  @MaxLength(16)
  prompt_version: string;

  /** 是否走降级通道产出（降级摘要模板化，会污染评测基线） */
  @IsOptional()
  @IsBoolean()
  degraded?: boolean = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pipeline_id?: number;
}

/** 批量提交论文摘要（一篇日报 10 条一起提交） */
export class ArxivDigestBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArxivDigestItemDto)
  items: ArxivDigestItemDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pipeline_id?: number;
}

/** 评测抽样查询（FR-EVAL-4） */
export class EvalSampleQueryDto {
  /** 指定 prompt 版本；不传则取全部非降级产出 */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  prompt_version?: string;

  /** 抽样条数，Phase 2 用 100 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  size?: number = 100;
}

/** 龙虎榜列表查询（FR-API-8） */
export class ListLhbQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  trade_date?: string;

  /** 资金性质：hotmoney | institution | retail */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
