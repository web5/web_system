/**
 * 内容质量枚举（CQO·v2.0 定稿）。
 *
 * ⚠️ 必须用这里的常量，禁止在业务代码里写自由字符串 —— 否则统计 SQL 会漏数据。
 *
 * ── 定稿说明（v1.0 方案文档两处口径不一致，此处为准） ──────────────────
 *   v1.0 的 02 文档写 3 值（ok/partial/fail），00/03 文档写 4 值（多 skip）。
 *   定为 4 值：`skip` 有真实语义 —— SimHash 去重命中时既不是成功也不是失败，是「跳过」。
 *
 *   `quality_stage` 的 `fallback` 为 v2.0 新增：降级脚本产出的摘要是**模板化**的，
 *   不单独标记会被 Phase 1.4 的成功率统计算成「正常」，并在 Phase 2 评测中拉低幻觉率
 *   （模板没内容，自然没幻觉）。
 *
 * 与 web_system B0（agent_runs 的 outcome / fail_stage）方法论同构：
 * 把「失败」从笼统的 status 拆成「结论 + 卡在哪一步」，让失败可归因。
 */

/** 质量结论 */
export const QUALITY_STATUS = {
  /** 完整走完采集→去重→LLM→发布全流程 */
  OK: 'ok',
  /** 部分成功（如摘要生成成功但分类失败） */
  PARTIAL: 'partial',
  /** 失败 */
  FAIL: 'fail',
  /** 主动跳过（如 SimHash 去重命中，内容已被采集过） */
  SKIP: 'skip',
} as const;

export type QualityStatus = (typeof QUALITY_STATUS)[keyof typeof QUALITY_STATUS];

export const QUALITY_STATUS_VALUES: QualityStatus[] = Object.values(QUALITY_STATUS);

/** 归因阶段：卡在哪一步 */
export const QUALITY_STAGE = {
  /** 采集阶段失败（源不可达 / 解析失败 / 返回空） */
  COLLECT: 'collect',
  /** 去重阶段（SimHash 命中导致跳过） */
  DEDUP: 'dedup',
  /** LLM 处理阶段（摘要 / 情感 / 分类） */
  LLM: 'llm',
  /** 走了降级通道，产出模板化内容（v2.0 新增） */
  FALLBACK: 'fallback',
  /** 发布阶段（腾讯文档 / 公众号草稿） */
  PUBLISH: 'publish',
} as const;

export type QualityStage = (typeof QUALITY_STAGE)[keyof typeof QUALITY_STAGE];

export const QUALITY_STAGE_VALUES: QualityStage[] = Object.values(QUALITY_STAGE);

/** 采集批次状态（collect_runs.status） */
export const COLLECT_RUN_STATUS = {
  OK: 'ok',
  FAILED: 'failed',
} as const;

export type CollectRunStatus = (typeof COLLECT_RUN_STATUS)[keyof typeof COLLECT_RUN_STATUS];

/** 采集触发方式（collect_runs.trigger_type） */
export const COLLECT_TRIGGER = {
  /** 定时任务 */
  SCHEDULE: 'schedule',
  /** 人工在 admin 触发 */
  MANUAL: 'manual',
} as const;

export type CollectTrigger = (typeof COLLECT_TRIGGER)[keyof typeof COLLECT_TRIGGER];

/** 席位资金性质（lhb_records.tags / seats[].type） */
export const SEAT_TAG = {
  /** 游资席位（命中 hotmoney_seats 表） */
  HOTMONEY: 'hotmoney',
  /** 机构专用 / 沪深股通 */
  INSTITUTION: 'institution',
  /** 其他营业部（散户） */
  RETAIL: 'retail',
} as const;

export type SeatTag = (typeof SEAT_TAG)[keyof typeof SEAT_TAG];

export const SEAT_TAG_VALUES: SeatTag[] = Object.values(SEAT_TAG);

/** 单个席位的买卖方向（lhb_records.seats[].type） */
export const SEAT_TRADE_TYPE = {
  BUY: 'buy',
  SELL: 'sell',
  BOTH: 'both',
} as const;

export type SeatTradeType = (typeof SEAT_TRADE_TYPE)[keyof typeof SEAT_TRADE_TYPE];
