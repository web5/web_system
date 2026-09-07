/**
 * 合同翻译官 E2E · 样本正式清单（定稿后输入冻结）。
 *
 * 样本 id / 决策说明 / 草稿历史：见 fixtures/DRAFT-samples.md。
 * 合同正文：fixtures/texts/<id>.txt（本文件只声明元信息与 ground truth，正文由 loadManifest 读入）。
 * 修改规则：改样本 = 换基准 = 基线重置（README §6），须在报告头标注 new-baseline。
 *
 * 可选断言字段说明（每个都可单独开/关，方便调验证强度）：
 *   - truth.expectSignalIds          必须出现的信号 id（下集断言；缺一个 FAIL）
 *   - truth.expectSignalLevels       信号最低级别（如 usury-interest 必须 danger；不填只查出现）
 *   - truth.maxSignalLevel           报告整体最高允许级别（如 'ok' = 不允许 warn/danger）
 *   - truth.rightsMin                报告 rights 下限（默认 1 条通用权益）
 *   - truth.requireRightsMirror      rights 是否必须与 signals 一一对应（默认 false）
 *   - truth.loan                     贷款样本 IRR 对账参数（期望值判定时用 analyzeLoan 现算）
 *   - truth.redlineForbidden         合规禁词（任一文本命中即违规）
 *   - expectToolCalls                工具调用必须包含（防编数）
 *   - expectToolOrder                工具调用相对顺序（如 OCR: cleaner → rule）
 *   - requireToolUse                 是否要求发生过工具调用（默认 true）
 */

import { EvalManifest } from '../types';

/** 生成后的正式清单由 loadManifest 填充 contractText；此处只声明元信息 + truth */
export const evalManifest: EvalManifest = {
  version: 1,
  model: 'deepseek-v4-pro',
  samples: [
    // ── S1 消费贷款：高息(IRR 41.3%) + 砍头息 + 强制搭售 ────────────────────────────
    {
      id: 'consumer-loan-01',
      scene: '消费贷款',
      domain: 'loan',
      ocrNoisy: false,
      truth: {
        expectSignalIds: ['usury-interest', 'kickback-interest', 'force-bundling'],
        // 决策 A：核心风险卡级别。41.3% 超 36%，usury 必须 danger；其余只要求出现。
        // 想放松：把 force-bundling 移出列表，或给 expectSignalLevels 减条目。
        expectSignalLevels: { 'usury-interest': 'danger' },
        loan: { principal: 100000, upfrontFee: 5000, periods: 12, monthlyPayment: 9500 },
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算'],
      },
      expectToolCalls: ['contract-irr', 'contract-rule'],
    },

    // ── S2 购车贷款：提前还款违约金 + 锁定期 ─────────────────────────────────────────
    {
      id: 'car-loan-01',
      scene: '购车贷款',
      domain: 'loan',
      ocrNoisy: false,
      truth: {
        expectSignalIds: ['early-repay-penalty', 'prepay-timing'],
        // 隐式期望：agent 应全量扫描（若传 scene=car-loan，该场景无专属尺子会漏报 → 此样本暴露缺陷）
        loan: { principal: 150000, upfrontFee: 0, periods: 36, monthlyPayment: 5070 },
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算'],
      },
      expectToolCalls: ['contract-irr', 'contract-rule'],
    },

    // ── S3 购车融资租赁：格式条款 + 30% 违约金 + 留购价形态 ──────────────────────────
    {
      id: 'car-finlease-01',
      scene: '购车融资租赁',
      domain: 'loan',
      ocrNoisy: false,
      truth: {
        expectSignalIds: ['standard-clause', 'penalty-cap'],
        loan: { principal: 120000, upfrontFee: 4000, periods: 24, monthlyPayment: 5600 },
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算'],
      },
      expectToolCalls: ['contract-irr', 'contract-rule'],
    },

    // ── S4 医疗保险：等待期 + 免赔额（非贷款，不做 IRR）──────────────────────────────
    {
      id: 'medical-insurance-01',
      scene: '医疗保险',
      domain: 'insurance',
      ocrNoisy: false,
      truth: {
        expectSignalIds: ['insurance-waiting-period', 'insurance-deductible'],
        // 决策 E：保险也要求 ≥1 条通用权益（0 关闭）
        rightsMin: 1,
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算', '建议退保'],
      },
      expectToolCalls: ['contract-rule'],
    },

    // ── S5 租房：押金超 20% + 房东免责格式条款（非贷款，不做 IRR）────────────────────
    {
      id: 'rental-01',
      scene: '租房',
      domain: 'rental',
      ocrNoisy: false,
      truth: {
        expectSignalIds: ['deposit-cap', 'standard-clause'],
        rightsMin: 1,
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算'],
      },
      expectToolCalls: ['contract-rule'],
    },

    // ── S6 干净低息消费贷：对照组（不乱报 danger，仍给 ok 信号 + 通用权益）───────────
    {
      id: 'consumer-loan-clean-01',
      scene: '消费贷款',
      domain: 'loan',
      ocrNoisy: false,
      truth: {
        expectSignalIds: [],
        // 决策 C：整体最高级别 ok = 不允许 warn/danger（"为报而报"一票否决）
        maxSignalLevel: 'ok',
        // 决策 E：仍需 ≥1 条通用权益（证明 agent 知道"没坑也要给用户抓手"）
        rightsMin: 1,
        loan: { principal: 50000, upfrontFee: 0, periods: 12, monthlyPayment: 4340 },
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算'],
      },
      expectToolCalls: ['contract-irr'],
    },

    // ── S7 OCR 噪声版：与 S1 同合同，验证 cleaner 链路 ───────────────────────────────
    {
      id: 'consumer-loan-01-ocr',
      scene: '消费贷款',
      domain: 'loan',
      ocrNoisy: true,
      truth: {
        expectSignalIds: ['usury-interest', 'kickback-interest', 'force-bundling'],
        expectSignalLevels: { 'usury-interest': 'danger' },
        loan: { principal: 100000, upfrontFee: 5000, periods: 12, monthlyPayment: 9500 },
        redlineForbidden: ['建议购买', '推荐购买', '该不该买', '哪个划算'],
      },
      // 决策 D：OCR 样本必须先清洗再判定（子序列匹配，允许中间插其他工具）
      expectToolCalls: ['contract-irr', 'contract-rule'],
      expectToolOrder: ['contract-cleaner', 'contract-rule'],
    },
  ],
};
