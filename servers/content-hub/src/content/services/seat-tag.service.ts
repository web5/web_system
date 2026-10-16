/**
 * 席位资金性质打标服务（p35 · CQO）。
 *
 * ⚠️ **规则匹配，不是 AI 推断** —— 这是关键设计决策。
 *
 *   方案 A 规则表匹配（名单 + 关键词）→ 采用
 *   方案 B AI 推断（让 LLM 从席位名判断）→ 不做
 *
 * 理由：席位归属要**可复现**。AI 每次判断可能不同，会让「同一只票今天算游资、
 * 明天算散户」，龙虎榜数据失去可比性 —— 而这份数据是要进 A 股投研决策的。
 *
 * 这是「候选池确定性锁定」精神的延续：解法不是让 AI 更准，
 * 而是给 AI 一个确定性的输入边界。
 *
 * 名单存 `hotmoney_seats` 表而非硬编码：席位归属会随营业部迁址变化，
 * 硬编码 = 每次迁址都要发版。
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HotmoneySeatEntity } from '../entities/hotmoney-seat.entity';
import { SEAT_TAG } from '../quality/quality.enum';

/** 席位明细（与 lhb-record.entity.ts 的 LhbSeatDetail 同构，此处按需声明） */
export interface SeatInput {
  name: string;
  buy?: number;
  sell?: number;
}

/** 打标结果 */
export interface SeatTagResult {
  /** 去重后的标签数组（hotmoney / institution / retail） */
  tags: string[];
  /** 逐席位的判定结果，供 admin 详情页展示「为什么判成游资」 */
  details: Array<{
    name: string;
    tag: string;
    /** 命中的别名（如章盟主系），未命中为 null */
    matched_alias: string | null;
    /** 判定依据说明 */
    reason: string;
  }>;
}

@Injectable()
export class SeatTagService {
  private readonly logger = new Logger(SeatTagService.name);
  /** 席位名（小写去空格）→ 席位记录，进程内缓存 */
  private cache: Map<string, HotmoneySeatEntity> | null = null;

  constructor(
    @InjectRepository(HotmoneySeatEntity)
    private readonly seatRepo: Repository<HotmoneySeatEntity>,
  ) {}

  /** 清空名单缓存（名单维护后调用） */
  invalidateCache(): void {
    this.cache = null;
  }

  private async loadSeats(): Promise<Map<string, HotmoneySeatEntity>> {
    if (this.cache) return this.cache;
    try {
      const rows = await this.seatRepo.find({ where: { is_active: 1 } });
      const map = new Map<string, HotmoneySeatEntity>();
      for (const r of rows) map.set(this.normalize(r.seat_name), r);
      this.cache = map;
    } catch (e) {
      this.logger.warn(`读hotmoney_seats 失败：${(e as Error).message}（本批不打游资标）`);
      this.cache = new Map();
    }
    return this.cache;
  }

  /** 归一化：去空格 + 转小写，避免「XX证券  上海分公司」这类空格差异漏匹配 */
  private normalize(name: string): string {
    return String(name ?? '').replace(/\s+/g, '').toLowerCase();
  }

  /** 判定单个席位的资金性质 */
  async tagOne(seat: SeatInput): Promise<SeatTagResult['details'][number]> {
    const raw = String(seat.name ?? '').trim();
    const normalized = this.normalize(raw);

    // 规则 1：命中游资名单
    const seats = await this.loadSeats();
    const hit = seats.get(normalized);
    if (hit) {
      return {
        name: raw,
        tag: SEAT_TAG.HOTMONEY,
        matched_alias: hit.alias,
        reason: `命中游资名单（别名：${hit.alias ?? '无'}）`,
      };
    }

    // 规则 2：机构专用 / 沪深股通
    if (/机构专用|沪股通专用|深股通专用/.test(raw)) {
      return {
        name: raw,
        tag: SEAT_TAG.INSTITUTION,
        matched_alias: null,
        reason: '机构/互联互通专用席位',
      };
    }

    // 规则 3：其余营业部按散户处理
    return {
      name: raw,
      tag: SEAT_TAG.RETAIL,
      matched_alias: null,
      reason: '未命中游资名单且非机构席位，按散户处理',
    };
  }

  /** 批量打标：返回去重标签数组 + 逐席位明细 */
  async tagSeats(seats: SeatInput[]): Promise<SeatTagResult> {
    if (!seats.length) return { tags: [], details: [] };

    const details: SeatTagResult['details'] = [];
    for (const seat of seats) {
      if (!seat?.name) continue;
      details.push(await this.tagOne(seat));
    }

    const tags = Array.from(new Set(details.map((d) => d.tag)));
    return { tags, details };
  }

  /** 按标签取席位明细（admin 龙虎榜页展开席位用） */
  filterByTag(seats: SeatInput[], tag: string): SeatInput[] {
    // 同步版本：仅按名称粗筛（不含名单匹配），精确展示走 tagSeats 的 details
    return seats.filter((s) => {
      const name = String(s.name ?? '');
      if (tag === SEAT_TAG.INSTITUTION) {
        return /机构专用|沪股通专用|深股通专用/.test(name);
      }
      return false;
    });
  }
}
