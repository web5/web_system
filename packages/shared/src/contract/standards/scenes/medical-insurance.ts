/**
 * 合同翻译官 — 医疗险/重疾险场景标准库
 */
import type { LegalStandard } from '../../types';

export const medicalInsuranceStandards: LegalStandard[] = [
  {
    id: 'insurance-waiting-period',
    scene: 'medical-insurance',
    level: 'warn',
    name: '等待期/免责条款',
    patterns: ['等待期', '观察期', '免责', '不承担', '除外', '既往症', '免赔额'],
    legalBasis: {
      law: '保险法原则 + 《健康保险管理办法》',
      article: '等待期约定',
      quote:
        '等待期条款若表述模糊、未尽提示义务，可能不被认定为有效。保险公司对免责条款未作明确说明的，该条款不产生效力。',
    },
    signalTitle: '等待期/免责条款表述模糊，需重点确认',
    plainText: '这份保险的等待期和免责范围可能不够清晰，建议签字前确认清楚保障边界。',
    actions: [
      '确认等待期时长（一般医疗险 30 天、重疾 90-180 天）',
      '逐条核对免责条款，确认是否包含你不期望的排除项',
      '对模糊表述要求保险公司书面明确',
    ],
    termExplain:
      '等待期是保单生效后、保险公司暂不承担责任的期限；免责条款是保险公司不赔的特定情形清单。',
  },
  {
    id: 'insurance-deductible',
    scene: 'medical-insurance',
    level: 'warn',
    name: '免赔额',
    patterns: ['免赔额', '起付线', '免赔', '自付', '1万', '一万元'],
    legalBasis: {
      law: '《健康保险管理办法》',
      article: '保险条款明确约定',
      quote:
        '免赔额需在条款中清晰载明，属于影响被保险人权益的重大条款，保险公司应履行说明义务。',
    },
    signalTitle: '存在免赔额 {deductible}，小额医疗费用需自付',
    plainText: '这份保单设置了免赔额，意味着低于该金额的医疗费用需自己承担，报销前请留意。',
    actions: [
      '确认免赔额金额及计算方式',
      '核算免赔额是否在你的预算承受范围内',
    ],
    termExplain:
      '免赔额是保险公司不赔的部分，比如免赔额 1 万，意味着 1 万以内的医疗费需自付，超过部分才按比例报销。',
  },
];
