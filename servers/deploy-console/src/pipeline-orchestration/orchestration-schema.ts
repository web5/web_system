/**
 * 编排树（步骤 → 任务 → 动作）的结构校验（specs/pipeline-step-task/design.md §5）。
 *
 * 纯函数：脚本语法检查以 `checkScript` 回调注入（生产传 bash -n，单测传 mock），
 * 其余全部同步可测。错误信息可直接作为 400 文案。
 */

import { validateCondition } from '../pipeline/steps/condition';

/**
 * 磁盘入口指针的确切路径形态（legacy env-dir 布局）：
 * `static/modules/<app>/<env>/index.js|index.css`（entry-pointer.ts 的 envArtifactsDir）。
 */
const POINTER_PATH_RE = /static\/modules\/[\w.-]+\/[\w.-]+\/index\.(?:js|css)/;
/** 从一行文本里取第一个盘指针路径（供错误文案回显） */
function pointerPathOf(line: string): string | null {
  const m = POINTER_PATH_RE.exec(line);
  return m ? m[0] : null;
}

/**
 * 半发布治理 F1-①：检出「脚本自写磁盘入口指针」（2026-11-12，05a 专项 P0-1）。
 *
 * 背景：11-09 portal 半发布 = 发布脚本自写盘指针却不落 `deploy_app_env_versions`，
 * 错位存活 2 天无判据发现。磁盘入口指针的**唯一写入口**是平台原子步
 * （`AppsService.switchVersion`，表→盘→云库镜像 + 失败补偿）；
 * 脚本要切指针必须调 `POST /internal/release/pointer`（env-dir 自动含盘写）
 * 或使用内置 pointer 步骤。
 *
 * 检出形态（白名单式，只认确切指针路径，避免误伤正常脚本）：
 *  1. 重定向 / heredoc 写入指针文件（`>` `>>`）；
 *  2. `tee` 写指针文件；
 *  3. `cp` / `mv` / `ln` 以指针文件为**目标**（最后一个参数）；
 *  4. `node -e` 直调 `writeEnvEntryPointer`。
 *
 * 已知盲区（静态分析无法覆盖，由三方对账巡检兜底发现漂移）：
 * 指针路径经变量拼接触盘（如 `cat > "$DIR/index.js"`，DIR 含 static/modules/...）。
 *
 * @returns 命中描述列表（含行号与路径），空数组 = 通过
 */
export function findSelfPointerWrites(script: string): string[] {
  const hits: string[] = [];
  const lines = script.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const where = `第 ${i + 1} 行`;

    // 形态 4：node -e 直调指针写函数（与路径形态无关，函数名即红线）
    if (/\bnode\s+(-[\w.]+\s+)*-e\b/.test(line) && line.includes('writeEnvEntryPointer')) {
      hits.push(`${where}：node -e 直调 writeEnvEntryPointer 写磁盘入口指针`);
      return;
    }

    const ptr = pointerPathOf(line);
    if (!ptr) return;

    // 形态 1：重定向写入（`>`/`>>` 目标含指针路径）
    if (/(?:^|[^>])>>?\s*"?'?[^"'|;&]*static\/modules\//.test(line) && />>?/.test(line)) {
      hits.push(`${where}：重定向写入磁盘入口指针（${ptr}）`);
      return;
    }
    // 形态 2：tee 写指针文件
    if (/\btee\b/.test(line) && POINTER_PATH_RE.test(line.slice(line.search(/\btee\b/)))) {
      hits.push(`${where}：tee 写入磁盘入口指针（${ptr}）`);
      return;
    }
    // 形态 3：cp/mv/ln 以指针文件为目标（按空白分词，目标 = 最后一个参数）
    if (/\b(cp|mv|ln)\b/.test(line)) {
      const tokens = line.split(/\s+/).filter(Boolean);
      const last = tokens[tokens.length - 1]?.replace(/^["']|["']$/g, '');
      if (POINTER_PATH_RE.test(last)) {
        hits.push(`${where}：cp/mv/ln 以磁盘入口指针为目标（${ptr}）`);
      }
    }
  });
  return hits;
}


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
  /** 已有步骤的 id：带 id = 更新（可改名，任务保留）；不带 = 新建 */
  id?: string;
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

/**
 * 变量引用存在性检查（pipeline-lint L4）。返回未声明变量名列表，空数组 = 通过。
 * 可选 —— 不传则不做该检查（单测与不需要变量门禁的调用方保持原行为）。
 */
export interface VarChecker {
  (script: string): string[];
}

/** 校验整棵树（steps 含各自 tasks/actions）；返回错误列表，空数组 = 通过 */
export function validateTree(
  steps: StepInput[],
  checkScript: ScriptChecker,
  checkVars?: VarChecker,
): string[] {
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
            // 半发布治理 F1-①：脚本自写磁盘入口指针 = 半发布直通车，保存即拒
            const ptrHits = findSelfPointerWrites(action.script);
            for (const hit of ptrHits) {
              errs.push(
                `${aPrefix}：禁止脚本自写磁盘入口指针（${hit}）—— ` +
                  '切指针请调 POST /internal/release/pointer（env-dir 应用由平台原子步自动含磁盘指针写入）或改用内置 pointer 步骤',
              );
            }
            if (checkVars) {
              const miss = checkVars(action.script);
              if (miss.length) {
                errs.push(
                  `${aPrefix}：引用了未声明变量 ${miss.join(', ')}（请在流水线变量或配置中心登记，或给默认值 ${'${X:-默认值}'}）`,
                );
              }
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
