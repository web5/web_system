/**
 * 合同翻译官 — 共享模块聚合入口
 */
export type {
  ContractScene,
  RiskLevel,
  LegalStandard,
  StandardMatch,
  LoanAnalysis,
  LoanParams,
  RepaymentType,
  LoanPlan,
  MarketBenchmark,
} from './types';

export {
  npv,
  calculateIRR,
  analyzeLoan,
} from './irr';

export {
  ALL_STANDARDS,
  getStandards,
  getByScene,
  matchByText,
  getById,
  MARKET_BENCHMARKS,
  getMarketBenchmarks,
  findBenchmarkByType,
} from './standards';
