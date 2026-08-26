/**
 * 合同翻译官 — 共享类型定义
 *
 * 收口到 @web-system/shared，禁止各端拷贝。
 * 供前端小程序（即时预览/展示）与后端 ai-service（判定/测算）共用。
 */

/** 合同场景 */
export type ContractScene =
  | 'consumer-loan'
  | 'car-loan'
  | 'medical-insurance'
  | 'car-insurance'
  | 'rental'
  | 'other';

/** 风险严重度 */
export type RiskLevel = 'danger' | 'warn' | 'ok';

/** 法定标准（尺子） */
export interface LegalStandard {
  /** 唯一标识，如 'usury-interest' */
  id: string;
  /** 所属场景 */
  scene: ContractScene;
  /** 风险严重度 */
  level: RiskLevel;
  /** 尺子名称（内部） */
  name: string;
  /** 识别特征：关键词，用于规则命中（AI 之前的第一道闸） */
  patterns: string[];
  /** 法定依据：条文引用 */
  legalBasis: {
    law: string;
    article: string;
    quote: string;
  };
  /** 用户话术：风险信号标题模板（可含 {placeholder}） */
  signalTitle: string;
  /** 一句话大白话结论 */
  plainText: string;
  /** 3 步操作 */
  actions: string[];
  /** 术语解释 */
  termExplain?: string;
}

/** 文本命中的结果 */
export interface StandardMatch {
  standard: LegalStandard;
  /** 命中的关键词 */
  matchedKeyword: string;
}

/** 贷款分期分析结果 */
export interface LoanAnalysis {
  /** 月费率（由月供反推，0~1） */
  monthlyRate: number;
  /** 实际年化（有效年利率，复利，百分比数值，如 36 表示 36%） */
  apr: number;
  /** 总还款额 */
  totalPayment: number;
  /** 总利息（含全部费用） */
  totalInterest: number;
  /** 实际到手本金（扣除前置费用后） */
  effectivePrincipal: number;
}

/** 贷款分析输入参数 */
export interface LoanParams {
  /** 名义借款本金 */
  principal: number;
  /** 前置费用（一次性，如服务费），0 表示无 */
  upfrontFee: number;
  /** 期数（月） */
  periods: number;
  /** 每期还款额 */
  monthlyPayment: number;
}
