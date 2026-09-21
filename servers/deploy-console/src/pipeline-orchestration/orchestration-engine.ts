/**
 * 编排执行引擎（P2 调度器，specs/pipeline-step-task/design.md §3）。
 *
 * 纯依赖注入设计：脚本执行 / 审批等待 / 日志 / 取消检查全部以回调注入，
 * 不依赖 Nest 容器与 DB —— 执行语义可完整单测；P3 再接入主 run() 循环。
 *
 * 语义（§3 逐条对应）：
 * 1. 按 sort 遍历步骤；步骤间严格串行
 * 2. 步骤内：条件求值 —— 无条件恒执行；命中执行；未命中跳过（日志留痕）；非法 → 整体失败
 * 3. 步骤内「无条件 + 命中条件」的任务并行；任一失败 → 整体失败
 * 4. 任务内动作严格串行；任一动作失败 → 任务失败，后续动作不再执行
 * 5. 审核任务挂起等人批；拒绝/超时按 onReject / timeoutAction 处置
 * 6. 步骤有任务但全不命中（且无无条件）→ 该步骤失败（不静默猜）；无任务 = 纯分组占位，跳过
 * 7. env 合成：baseEnv（内置+流水线变量+配置中心）< 任务级 env（覆盖）
 */

import { evalCondition, type ConditionVars } from '../pipeline/steps/condition';

/** runTask 的取消信号（区别于失败原因） */
const CANCELED = '\u0000CANCELED';

/** 引擎消费的树节点（来自 getTree 或迁移快照；只取引擎关心的字段） */
export interface EngineStep {
  id: string;
  name: string;
  enabled?: boolean;
  tasks?: EngineTask[];
}

export interface EngineTask {
  id: string;
  kind: 'script' | 'approval';
  name: string;
  condition?: string | null;
  enabled?: boolean;
  env?: Record<string, string> | null;
  approval?: {
    approvers?: string[];
    timeoutSec?: number;
    timeoutAction?: 'skip' | 'fail';
    onReject?: 'fail' | 'skip';
  } | null;
  actions?: EngineAction[];
}

export interface EngineAction {
  id: string;
  name: string;
  script: string;
  enabled?: boolean;
}

export interface EngineContext {
  /** 条件求值变量（DEPLOY_ENV / MODULE_KEY / BRANCH…） */
  vars: ConditionVars;
  /** 动作进程基础环境（内置 + 流水线变量 + 配置中心注入）；任务级 env 在其上覆盖 */
  baseEnv: Record<string, string>;
  /**
   * 执行一段脚本；抛错 = 动作失败（错误信息进日志）。
   * baseEnv = 引擎启动时的基础环境（可能已过期，如 versionTag 回填前组装）；
   * taskEnv = 任务级覆盖增量。**调用方应惰性重组环境**（取回填后的最新值）再叠 taskEnv。
   */
  runScript: (
    action: EngineAction,
    baseEnv: Record<string, string>,
    taskEnv: Record<string, string>,
  ) => Promise<void>;
  /** 等待一次人工审批；返回处置结果。挂起实现可抛挂起信号异常（引擎原样透传） */
  waitApproval: (task: EngineTask) => Promise<'approved' | 'rejected' | 'timeout'>;
  /** 任务成功后的平台收尾（如 git 任务回填实际 commit） */
  afterTask?: (step: EngineStep, task: EngineTask) => Promise<void>;
  /** 日志输出（调用方负责写入运行实例 logs） */
  log: (line: string) => void;
  /** 取消检查（每步/每任务前调用一次）；true = 立即中止 */
  shouldAbort?: () => boolean;
}

export interface EngineOptions {
  /**
   * 挂起恢复：跳过该步骤（含）之前的所有步骤 —— 审批通过后
   * 「已完成的 shell 步骤不重跑」，从下一个步骤继续。
   */
  skipThroughStep?: string;
}

export interface EngineResult {
  status: 'succeeded' | 'failed' | 'aborted' | 'suspended';
  /** 失败/挂起定位：步骤名 / 任务名 */
  failedAt?: string;
  error?: string;
}

/** 挂起信号异常名（与主服务的 PipelineSuspended 对齐：引擎不吞挂起） */
const SUSPENDED_NAME = 'PipelineSuspended';

/**
 * 执行整棵编排树。任何失败立即返回（步骤内并行任务通过 Promise.all 语义整体失败）；
 * waitApproval 抛出的挂起信号异常原样透传给调用方（由主服务置 awaiting-approval 态）。
 */
export async function runOrchestration(
  steps: EngineStep[],
  ctx: EngineContext,
  opts?: EngineOptions,
): Promise<EngineResult> {
  try {
    let skipping = !!opts?.skipThroughStep;
    for (const step of steps) {
      if (skipping) {
        ctx.log(`[step] ${step.name} 已完成（挂起恢复），跳过`);
        if (step.name === opts!.skipThroughStep) skipping = false;
        continue;
      }
      if (step.enabled === false) {
        ctx.log(`[step] ${step.name} 已停用，跳过`);
        continue;
      }
      if (ctx.shouldAbort?.()) return { status: 'aborted', failedAt: step.name };

      const tasks = (step.tasks ?? []).filter((t) => t.enabled !== false);
      if (!tasks.length) {
        ctx.log(`[step] ${step.name} 无任务（分组占位），跳过`);
        continue;
      }

      // ── 条件过滤（§3.2/3.3）：非法 → fail-fast；未命中 → 跳过留痕 ──
      const toRun: EngineTask[] = [];
      let hasEnabled = false;
      for (const task of tasks) {
        const label = `${step.name} / ${task.name}`;
        if (!task.condition?.trim()) {
          toRun.push(task);
          continue;
        }
        let hit: boolean;
        try {
          hit = evalCondition(task.condition, ctx.vars);
        } catch (e) {
          return { status: 'failed', failedAt: label, error: (e as Error).message };
        }
        if (hit) toRun.push(task);
        else ctx.log(`[task] ${label} 条件不满足（${task.condition.trim()}），已跳过`);
      }

      if (!toRun.length) {
        // 有任务但全不命中（含全部被条件跳过）→ 步骤失败（不静默猜，§3 多选一原则）
        return {
          status: 'failed',
          failedAt: step.name,
          error: `步骤「${step.name}」所有任务的条件均未命中（提交参数：DEPLOY_ENV=${String(ctx.vars.DEPLOY_ENV ?? '')}），步骤失败——请为该环境显式配置任务`,
        };
      }

      // ── 步骤内并行（无条件 + 命中条件的任务同批）──
      const results = await Promise.all(
        toRun.map((task) => runTask(step, task, ctx).then((r) => ({ task, r }))),
      );
      const failure = results.find((x) => x.r !== null);
      if (failure) {
        const label = `${step.name} / ${failure.task.name}`;
        if (failure.r === CANCELED) return { status: 'aborted', failedAt: label };
        return {
          status: 'failed',
          failedAt: label,
          error: `任务「${label}」${failure.r}`,
        };
      }
    }
    return { status: 'succeeded' };
  } catch (e) {
    // 挂起信号（审批挂起）不是失败 —— 原样透传给主服务置 awaiting-approval
    if ((e as { name?: string })?.name === SUSPENDED_NAME) throw e;
    return { status: 'failed', error: (e as Error).message };
  }
}

/** 单任务执行；返回 null = 成功，字符串 = 失败原因（语义化，供定位） */
async function runTask(step: EngineStep, task: EngineTask, ctx: EngineContext): Promise<string | null> {
  const label = `${step.name} / ${task.name}`;
  if (ctx.shouldAbort?.()) return CANCELED;

  if (task.kind === 'approval') {
    ctx.log(`[task] ${label} 等待审批（审批人：${(task.approval?.approvers ?? []).join('、') || '未配置'}）`);
    const outcome = await ctx.waitApproval(task);
    if (outcome === 'approved') {
      ctx.log(`[task] ${label} 审批通过`);
      return null;
    }
    if (outcome === 'timeout') {
      const action = task.approval?.timeoutAction ?? 'fail';
      ctx.log(`[task] ${label} 审批超时，按配置${action === 'fail' ? '失败' : '跳过'}`);
      return action === 'fail' ? '审批超时' : null;
    }
    // rejected
    const action = task.approval?.onReject ?? 'fail';
    ctx.log(`[task] ${label} 审批拒绝，按配置${action === 'fail' ? '失败' : '跳过'}`);
    return action === 'fail' ? '审批被拒绝' : null;
  }

  // script：动作严格串行，任一失败即断
  const actions = (task.actions ?? []).filter((a) => a.enabled !== false);
  if (!actions.length) return '脚本任务没有可执行的动作';
  const taskEnv = task.env ?? {};
  for (const action of actions) {
    ctx.log(`[action] ${label} / ${action.name} 开始执行`);
    try {
      await ctx.runScript(action, ctx.baseEnv, taskEnv);
      ctx.log(`[action] ${label} / ${action.name} 执行成功`);
    } catch (e) {
      const msg = (e as Error).message;
      ctx.log(`[action] ${label} / ${action.name} 执行失败：${msg}`);
      return `动作「${action.name}」失败：${msg}（后续动作已停止）`;
    }
  }
  // 任务成功后的平台收尾（如 git 任务回填实际 commit；失败同样视为任务失败）
  if (ctx.afterTask) {
    try {
      await ctx.afterTask(step, task);
    } catch (e) {
      ctx.log(`[task] ${label} 平台收尾失败：${(e as Error).message}`);
      return `平台收尾失败：${(e as Error).message}`;
    }
  }
  return null;
}
