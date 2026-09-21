/**
 * 编排树（步骤 → 任务 → 动作）的结构校验（specs/pipeline-step-task/design.md §5）。
 *
 * 纯函数：脚本语法检查以 `checkScript` 回调注入（生产传 bash -n，单测传 mock），
 * 其余全部同步可测。错误信息可直接作为 400 文案。
 */

import { validateCondition } from '../pipeline/steps/condition';

export interface ActionInput {
  name: string;
  script: string;
  managed?: boolean;
  sort?: number;
  enabled?: boolean;
}

export interface TaskInput {
  kind: 'script' | 'approval';
  name: string;
  condition?: string | null;
  env?: Record<string, string> | null;
  approval?: {
    approvers: string[];
    timeoutSec?: number;
    timeoutAction?: 'skip' | 'fail';
    onReject?: 'fail' | 'skip';
  } | null;
  sort?: number;
  enabled?: boolean;
  actions?: ActionInput[];
}

export interface StepInput {
  name: string;
  description?: string | null;
  sort?: number;
  enabled?: boolean;
  tasks?: TaskInput[];
}

export interface ScriptChecker {
  /** 抛错 = 语法不通过（错误信息应含 stderr） */
  (script: string): void;
}

/** 校验整棵树（steps 含各自 tasks/actions）；返回错误列表，空数组 = 通过 */
export function validateTree(steps: StepInput[], checkScript: ScriptChecker): string[] {
  const errs: string[] = [];
  const stepNames = new Set<string>();

  if (!Array.isArray(steps)) return ['steps 必须是数组'];

  steps.forEach((step, si) => {
    const stepLabel = step?.name || `第 ${si + 1} 个步骤`;
    if (!step?.name?.trim()) {
      errs.push(`第 ${si + 1} 个步骤：名称不能为空`);
    } else if (stepNames.has(step.name)) {
      errs.push(`步骤名重复: ${step.name}`);
    } else {
      stepNames.add(step.name);
    }

    const tasks = Array.isArray(step?.tasks) ? step.tasks : [];
    const taskNames = new Set<string>();
    tasks.forEach((task, ti) => {
      const taskLabel = task?.name || `第 ${ti + 1} 个任务`;
      const prefix = `步骤 ${stepLabel} / 任务 ${taskLabel}`;

      if (!task?.name?.trim()) {
        errs.push(`${prefix}：任务名不能为空`);
      } else if (taskNames.has(task.name)) {
        errs.push(`步骤 ${stepLabel}：任务名重复: ${task.name}`);
      } else {
        taskNames.add(task.name);
      }

      // 执行条件语法
      if (task.condition != null && task.condition.trim()) {
        const check = validateCondition(task.condition);
        if (!check.ok) errs.push(`${prefix}：${check.reason}`);
      }

      if (task.kind === 'approval') {
        // 审核任务：审批字段完整；明确不携带动作与环境变量
        const approvers = task.approval?.approvers;
        if (!Array.isArray(approvers) || !approvers.length || approvers.some((a) => !a?.trim())) {
          errs.push(`${prefix}：审核任务必须配置至少一个审批人`);
        }
        if (task.actions?.length) errs.push(`${prefix}：审核任务不能携带动作`);
        if (task.env && Object.keys(task.env).length) errs.push(`${prefix}：审核任务不能携带环境变量`);
      } else if (task.kind === 'script') {
        // 脚本任务：1..N 动作，动作名唯一、脚本非空且过语法检查
        const actions = Array.isArray(task.actions) ? task.actions : [];
        if (!actions.length) {
          errs.push(`${prefix}：脚本任务至少需要一个动作`);
        }
        const actionNames = new Set<string>();
        actions.forEach((action, ai) => {
          const actionLabel = action?.name || `第 ${ai + 1} 个动作`;
          const aPrefix = `${prefix} / 动作 ${actionLabel}`;
          if (!action?.name?.trim()) {
            errs.push(`${prefix}：第 ${ai + 1} 个动作名称不能为空`);
          } else if (actionNames.has(action.name)) {
            errs.push(`${prefix}：动作名重复: ${action.name}`);
          } else {
            actionNames.add(action.name);
          }
          if (!action?.script?.trim()) {
            errs.push(`${aPrefix}：脚本不能为空`);
          } else {
            try {
              checkScript(action.script);
            } catch (e) {
              errs.push(`${aPrefix}：脚本语法错误：${(e as Error).message.replace(/^shell 语法错误：/, '')}`);
            }
          }
        });
      } else {
        errs.push(`${prefix}：kind 必须是 script 或 approval`);
      }
    });
  });

  return errs;
}
