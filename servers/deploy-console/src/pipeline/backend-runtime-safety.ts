import { ConflictException } from '@nestjs/common';
import type { EngineStep } from '../pipeline-orchestration/orchestration-engine';
import { evalCondition } from './steps/condition';

export function assertBackendRuntimePlan(input: {
  env: string;
  moduleKey: string;
  gitBranch?: string;
  orchestration?: EngineStep[] | null;
}): void {
  if (input.env === 'local' || !input.orchestration?.length) return;
  const variables = { DEPLOY_ENV: input.env, MODULE_KEY: input.moduleKey, BRANCH: input.gitBranch || 'master' };
  for (const step of input.orchestration) {
    if (step.enabled === false) continue;
    for (const task of step.tasks ?? []) {
      if (task.enabled === false || task.kind !== 'script') continue;
      let inactive = false;
      for (const term of task.condition?.split('&&') ?? []) {
        const variable = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:==|!=)/.exec(term)?.[1];
        if (variable && variable in variables) {
          try { if (!evalCondition(term, variables)) inactive = true; } catch {}
        }
      }
      if (inactive) continue;
      for (const action of task.actions ?? []) {
        if (action.enabled === false) continue;
        if (/\bRROOT\b/.test(action.script) && /git\s+(?:reset\s+--hard|checkout\s+-B)/.test(action.script)) {
          throw new ConflictException(`后端运行目录安全门：${step.name}/${task.name}/${action.name} 仍会重置运行仓库；请先迁移到隔离运行产物，不执行旧同步脚本`);
        }
      }
    }
  }
}
