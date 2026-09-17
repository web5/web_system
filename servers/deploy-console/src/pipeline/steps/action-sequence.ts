import { StepAction } from '../../entities/deploy-pipeline-step-command.entity';

/**
 * 节点内「多操作顺序执行」的语义（纯编排，依赖全部注入，便于单测）。
 *
 * 为什么抽出来：这段逻辑原先内联在 `PipelineService.runStageCommand` 里，
 * 直接 `spawn('bash', …)` —— 全仓没有 mock 手段，**该路径零测试**。
 * 而它是 shell 节点的核心行为：顺序、失败即停、continueOnError 放行、
 * 超时、以及 `WS_RESULT_FILE` 的前后操作传递。抽成纯函数后：
 *  - 生产：runner = 真实 shell 执行通道；
 *  - 测试：runner = 假实现，返回预设退出码，无需真跑子进程。
 */

/** 一次 shell 调用 */
export interface ActionShellInvocation {
  /** 脚本正文（bash -c 执行） */
  code: string;
  /** 进程环境（已含平台变量 + 配置中心 + WS_RESULT_FILE） */
  env: Record<string, string>;
  /** 超时秒数（操作级优先，缺省用节点级） */
  timeoutSec?: number;
}

export interface RunActionsDeps {
  /** 节点 key（日志前缀） */
  stage: string;
  /** 操作序列（调用方已过滤 enabled=false） */
  actions: StepAction[];
  /** 注入进程的基础变量（平台变量 + 配置中心） */
  baseEnv: Record<string, string>;
  /** 结果回传文件路径（v4 C1：`$WS_RESULT_FILE`） */
  resultFile: string;
  /** 节点级默认超时（秒）；操作未配超时时用它 */
  defaultTimeoutSec?: number;
  /** 执行 shell，resolve 退出码（0=成功） */
  runShell: (inv: ActionShellInvocation) => Promise<number>;
  /**
   * 执行 service 操作（design §3：平台能力 = action）。
   * 由调用方按 `a.tool` 分派到内置执行体；不传则 service 操作登记后跳过。
   */
  runService?: (a: StepAction, op: string) => Promise<void>;
  /** 操作结束后读取结果文件（按 key 合并；不含受保护字段） */
  readResult: (op: string) => Record<string, unknown>;
  /** 日志（逐行写流水线 logs） */
  onLog: (line: string) => void;
  /** 取消检查（每个操作执行前调用） */
  assertNotCancelled?: () => void;
}

export interface RunActionsResult {
  /** 各操作回传结果的合并（按 key 合并，非整段覆盖） */
  merged: Record<string, unknown>;
  /** 失败但被 continueOnError 放过的操作名 */
  tolerated: string[];
  /** 真正执行过的 shell 操作数（service 操作不计） */
  executed: number;
}

/** 操作失败（且未声明 continueOnError）—— 节点失败信号 */
export class ActionFailedError extends Error {
  constructor(
    readonly action: StepAction,
    readonly exitCode: number,
    readonly op: string,
  ) {
    super(`[${op}] ${action.name} 执行失败（exit ${exitCode}），详见日志`);
    this.name = 'ActionFailedError';
  }
}

/** 操作级超时：优先操作自身，其次节点级 */
export function resolveActionTimeout(a: StepAction, defaultTimeoutSec?: number): number | undefined {
  return a.timeoutSec && a.timeoutSec > 0 ? a.timeoutSec : defaultTimeoutSec;
}

/**
 * 顺序执行一个节点内的全部操作。
 *
 * 语义（T4 验收）：
 *  - 严格顺序，前一个结束才跑下一个；
 *  - 退出码非 0 且未声明 `cont` ⇒ 抛 `ActionFailedError`，**后续操作不再执行**；
 *  - `cont=true` ⇒ 记录失败并继续（护栏类操作用）；
 *  - `WS_RESULT_FILE` 贯穿全部操作：前序写入、后续可读；
 *  - 每个操作执行前检查取消。
 */
export async function runActionSequence(deps: RunActionsDeps): Promise<RunActionsResult> {
  const merged: Record<string, unknown> = {};
  const tolerated: string[] = [];
  let executed = 0;

  for (let i = 0; i < deps.actions.length; i++) {
    const a = deps.actions[i];
    const op = `op${i + 1}`;
    deps.assertNotCancelled?.();

    // service 操作：调用平台内置能力（design §3：平台能力 = action，不再是节点类型）。
    // 未注入 runService（或 tool 无法识别）时保持旧行为：登记后跳过、不阻断节点。
    if (a.type === 'service') {
      if (!deps.runService) {
        deps.onLog(`[${deps.stage}/${op}] 引用工具 ${a.tool ?? '—'}（未接入执行器，跳过）`);
        continue;
      }
      try {
        await deps.runService(a, op);
        deps.onLog(`[${deps.stage}/${op}] 工具 ${a.tool} 完成`);
      } catch (e) {
        const msg = (e as Error).message;
        if (a.cont) {
          deps.onLog(`[${deps.stage}/${op}] 工具 ${a.tool} 失败（${msg}），continueOnError=是，继续执行`);
          tolerated.push(a.name);
          continue;
        }
        throw e;
      }
      continue;
    }

    deps.onLog(`[${deps.stage}/${op}] ${a.name} $ ${a.code ?? ''}`);
    const code = await deps.runShell({
      code: a.code ?? '',
      env: { ...deps.baseEnv, WS_RESULT_FILE: deps.resultFile },
      timeoutSec: resolveActionTimeout(a, deps.defaultTimeoutSec),
    });
    executed += 1;

    // 结果回传：按 key 合并（脚本可写 $WS_RESULT_FILE 供后续操作与平台读取）
    const got = deps.readResult(op);
    for (const [k, v] of Object.entries(got)) merged[k] = v;

    if (code !== 0) {
      if (a.cont) {
        deps.onLog(
          `[${deps.stage}/${op}] ${a.name} 失败（exit ${code}），continueOnError=是，继续执行`,
        );
        tolerated.push(a.name);
        continue;
      }
      throw new ActionFailedError(a, code, op);
    }
    deps.onLog(`[${deps.stage}/${op}] ${a.name} 完成`);
  }

  return { merged, tolerated, executed };
}
