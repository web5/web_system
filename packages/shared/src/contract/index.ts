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
} from './standards';
