/**
 * 合同翻译官 — 市场基准库
 *
 * 用于"同类贷款对比"，给 contract-benchmark 工具返回确定性数据，
 * 避免 AI 自由编造"同类贷款利率区间"。
 *
 * 设计原则：能用规则算的绝不用 AI 算。基准为"市场参考区间"，非承诺利率。
 *
 * ⚠️ 数据治理：基准区间需定期复核（建议季度），数据来源与维护记录见
 *    docs/analysis/合同翻译官/standards/market-benchmark.md
 */
import type { MarketBenchmark } from '../types';

/** 全部市场基准 */
export const MARKET_BENCHMARKS: MarketBenchmark[] = [
  {
    type: '消费贷（银行）',
    typicalAprRange: '3.4%~12%',
    note: '信用记录良好的情况下，银行消费贷真实年化可低至 3.4% 左右。',
  },
  {
    type: '信用卡分期',
    typicalAprRange: '13%~18%',
    note: '信用卡分期表面"月费率"不高，但算上复利，真实年化普遍在 13%~18%。',
  },
  {
    type: '消费金融公司',
    typicalAprRange: '15%~24%',
    note: '头部消费金融平台（如招联、捷信等）常见真实年化区间。',
  },
  {
    type: '购车贷',
    typicalAprRange: '3.5%~9%',
    note: '厂商金融贴息后，购车贷真实年化常可控制在 3.5%~9%。',
  },
  {
    type: '小额贷/现金贷',
    typicalAprRange: '24%~36%',
    note: '小贷/现金贷常见高息，接近甚至触及 24% 法定保护线，务必谨慎。',
  },
];

/** 获取全部市场基准 */
export function getMarketBenchmarks(): MarketBenchmark[] {
  return MARKET_BENCHMARKS;
}

/** 按贷款类型关键词查找最匹配的基准（返回首条命中的，未命中返回 undefined） */
export function findBenchmarkByType(type: string): MarketBenchmark | undefined {
  if (!type) return undefined;
  const key = type.toLowerCase();
  // 关键词映射到基准
  if (key.includes('信用卡') || key.includes('分期')) return MARKET_BENCHMARKS[1];
  if (key.includes('购车') || key.includes('车贷') || key.includes('融资租赁')) return MARKET_BENCHMARKS[3];
  if (key.includes('小贷') || key.includes('现金贷') || key.includes('网贷')) return MARKET_BENCHMARKS[4];
  if (key.includes('消费金融') || key.includes('互金') || key.includes('平台')) return MARKET_BENCHMARKS[2];
  // 默认银行消费贷
  return MARKET_BENCHMARKS[0];
}
