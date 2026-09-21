/**
 * 步骤任务（分支）选择 —— 纯函数，便于单测。
 *
 * 执行语义（specs/pipeline-step-branch/design.md §4）：
 *   1. 按 sort 升序逐个求值 condition，命中第一个为真的任务
 *   2. 全不命中 → 用**默认任务**（condition 为空的那条）兑底
 *   3. 无默认任务且全不命中 → 无命中（调用方按 fail-fast 处理）
 *   4. 条件表达式非法 → 抛错（调用方让步骤失败，不静默放行）
 */

import { evalCondition, validateCondition, type ConditionVars } from './condition';

export interface StepBranchLike {
  name: string;
  label?: string | null;
  condition?: string | null;
  script: string;
  sort?: number;
  enabled?: boolean;
}

export interface BranchPickOk {
  ok: true;
  branch: StepBranchLike;
  /** 是否走的是默认任务（兑底） */
  fallback: boolean;
  /** 匹配到的条件（默认任务为空） */
  matched: string;
}

export interface BranchPickNone {
  ok: false;
  reason: string;
}

/** 选择本次执行的任务；无命中返回 ok=false（含人类可读原因） */
export function pickStepBranch(
  branches: StepBranchLike[] | null | undefined,
  vars: ConditionVars,
): BranchPickOk | BranchPickNone {
  const list = (branches ?? [])
    .filter((b) => b && b.enabled !== false)
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!list.length) return { ok: false, reason: '无步骤任务' };

  for (const b of list) {
    const cond = String(b.condition ?? '').trim();
    if (!cond) continue; // 默认任务不参与条件匹配，只在兜底时使用
    if (evalCondition(cond, vars)) {
      return { ok: true, branch: b, fallback: false, matched: cond };
    }
  }

  const fallback = list.find((b) => !String(b.condition ?? '').trim());
  if (fallback) return { ok: true, branch: fallback, fallback: true, matched: '' };

  const names = list.map((b) => b.name).join('、');
  return {
    ok: false,
    reason: `未命中任何步骤任务（${names}），且未配置默认任务；请在步骤任务里补充对应条件的任务或设置默认任务`,
  };
}

/** 校验任务集合（保存前调用）：语法、重名、多个默认任务 */
export function validateStepBranches(branches: StepBranchLike[]): string[] {
  const errs: string[] = [];
  if (!branches?.length) return errs;
  const seen = new Set<string>();
  let defaults = 0;
  branches.forEach((b, i) => {
    const at = `任务#${i + 1}`;
    if (!b.name?.trim()) errs.push(`${at} 缺少名称`);
    else if (seen.has(b.name)) errs.push(`${at} 名称重复: ${b.name}`);
    else seen.add(b.name);
    if (!b.script?.trim()) errs.push(`${at} 脚本为空`);
    const cond = String(b.condition ?? '').trim();
    if (!cond) defaults += 1;
    else {
      const check = validateCondition(cond);
      if (!check.ok) errs.push(`${at} 匹配条件非法：${check.reason}`);
    }
  });
  if (defaults > 1) errs.push(`默认任务（不配条件）最多一个，当前 ${defaults} 个`);
  return errs;
}
