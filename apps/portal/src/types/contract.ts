/**
 * 合翻（合同体检）报告类型 — PC 端 portal
 *
 * 字段与小程序 `apps/kedou-ai-minigram/services/contract-api.ts` 的
 * `ContractReport` / `ContractSignal` / `ContractRight` / `OptimizeItem` 一一对应：
 * 两侧吃同一份 agent 输出（agentId=contract-risk），解析与渲染口径必须同源，
 * 改字段时两端一起改（PC 侧不渲染 loanPlan，故未纳入）。
 */
export interface LegalBasis {
  law: string;
  article: string;
  quote: string;
}

export interface ContractSignal {
  id: string;
  name: string;
  level: 'danger' | 'warn' | 'ok';
  /** 风险标题（可带具体数字：真实年化、违约金比例等） */
  signalTitle: string;
  /** 一句话大白话 */
  plainText: string;
  legalBasis: LegalBasis;
  actions: string[];
  termExplain?: string;
  /** 面向该风险点最可能追问的口语化问题 */
  askableQuestions: string[];
}

export interface ContractRight {
  id: string;
  title: string;
  description: string;
  amount?: number;
  legalBasis: LegalBasis;
  actions: string[];
  askableQuestions: string[];
}

export interface OptimizeItem {
  title: string;
  stage: '成交前' | '成交后' | '长期';
  plainText: string;
  actions: string[];
}

export interface KeyNumber {
  label: string;
  value: string;
}

export interface ContractReport {
  /** 合同类型（中文：消费贷款 / 购车融资 / 医疗保险 / 租房 等） */
  scene: string;
  /** 一句话结论 */
  conclusion: string;
  signals: ContractSignal[];
  rights: ContractRight[];
  optimize: OptimizeItem[];
  keyNumbers: KeyNumber[];
  disclaimer: string;
  /** 追问复用的会话 id（agent/run final 事件带回） */
  conversationId?: string | null;
  createdAt: number;
}
