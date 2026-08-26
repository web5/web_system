/**
 * 合同翻译官 — 标准库聚合入口
 *
 * 提供：
 * - getStandards()：全部标准
 * - getByScene(scene)：按场景过滤
 * - matchByText(text, scene?)：文本规则命中初判（AI 之前的第一道闸）
 */
import type { ContractScene, LegalStandard, StandardMatch } from '../types';
import { commonStandards } from './common';
import { medicalInsuranceStandards } from './scenes/medical-insurance';

/** 全部标准 */
export const ALL_STANDARDS: LegalStandard[] = [
  ...commonStandards,
  ...medicalInsuranceStandards,
];

/** 获取全部标准 */
export function getStandards(): LegalStandard[] {
  return ALL_STANDARDS;
}

/** 按场景过滤 */
export function getByScene(scene: ContractScene): LegalStandard[] {
  return ALL_STANDARDS.filter((s) => s.scene === scene || s.scene === 'other');
}

/** 文本规则命中初判（大小写不敏感、关键词包含匹配） */
export function matchByText(text: string, scene?: ContractScene): StandardMatch[] {
  if (!text) return [];
  const lowerText = text.toLowerCase();
  const pool = scene ? getByScene(scene) : ALL_STANDARDS;

  const matches: StandardMatch[] = [];
  for (const standard of pool) {
    for (const keyword of standard.patterns) {
      if (lowerText.includes(keyword.toLowerCase())) {
        matches.push({ standard, matchedKeyword: keyword });
        break; // 每个标准只命中一次
      }
    }
  }
  return matches;
}

/** 获取单个标准 */
export function getById(id: string): LegalStandard | undefined {
  return ALL_STANDARDS.find((s) => s.id === id);
}
