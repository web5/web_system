/**
 * 长任务插件（可选装饰器）。
 *
 * 解决的问题：部分工具（发布流水线、批量分析、MCP 远程长任务等）不会立即返回结果，
 * 而是返回 `{ jobId }` 让调用方自行轮询。Agent 引擎的工具契约是同步的
 * （`execute() → Promise<ToolResult>`），直接把 jobId 回给模型会导致它"不知道还要等"。
 *
 * 用法：本插件把一个"返回 jobId 的工具"包装成"自动轮询到终态的同步工具"，
 * 对 Agent 引擎完全透明。
 *
 * 设计约束（与 McpToolAdapter 一致）：
 *  - **不绑定 MCP**：状态从哪查由注入的 `fetchStatus` 决定，可以是 MCP / HTTP / DB / 内存
 *  - **可选启用**：不调用 withLongRunning 就是原工具，零副作用
 *  - **零外部依赖**：agent-core 保持纯 TS
 */
import type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolSchema,
} from '../interfaces/tool.interface';

/** 任务状态（后端返回，字段宽松） */
export interface JobStatus {
  status?: string;
  progress?: { current?: number; total?: number; message?: string };
  logs?: string[];
  result?: unknown;
  error?: string;
}

/**
 * 状态查询器：由调用方注入。
 * 返回状态对象，或已序列化好的状态字符串。
 */
export type JobStatusFetcher = (jobId: string) => Promise<JobStatus | string>;

/** 任务识别器：从工具结果中提取 jobId；返回 null 表示不是任务型结果 */
export type JobIdDetector = (result: ToolResult) => string | null;

export interface LongRunningOptions {
  /** 状态查询器（必填） */
  fetchStatus: JobStatusFetcher;
  /** 任务识别器（默认从 JSON content 中取 jobId） */
  detect?: JobIdDetector;
  /** 轮询间隔（毫秒），默认 2000 */
  intervalMs?: number;
  /** 最长等待（毫秒），默认 600000（10 分钟） */
  maxWaitMs?: number;
  /** 进度回调（可用于推送流式事件） */
  onProgress?: (progress: JobStatus['progress'], status: JobStatus) => void | Promise<void>;
}

/** 成功终态 */
const SUCCESS_STATUSES = new Set(['succeeded', 'success']);
/** 取消终态 */
const CANCEL_STATUSES = new Set(['cancelled', 'canceled']);
/** 全部终态（含失败） */
const TERMINAL_STATUSES = new Set([
  ...SUCCESS_STATUSES,
  ...CANCEL_STATUSES,
  'failed',
  'failure',
  'error',
]);

/** 任务是否进入终态 */
export function isTerminalJobStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 默认识别器：从 JSON 结果中取 jobId（兼容 { jobId } 与 { data: { jobId } }） */
function defaultDetect(result: ToolResult): string | null {
  if (!result.success) return null;
  try {
    const parsed: unknown = JSON.parse(result.content);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.jobId === 'string') return obj.jobId;
      const data = obj.data;
      if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).jobId === 'string') {
        return (data as Record<string, unknown>).jobId as string;
      }
    }
  } catch {
    // 非 JSON：不是任务型结果
  }
  return null;
}

/** 归一化状态查询结果为对象 */
function toStatus(raw: JobStatus | string): JobStatus {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' ? parsed : {}) as JobStatus;
  } catch {
    return {};
  }
}

/**
 * 把工具包装成"自动轮询长任务"的工具。
 *
 * 行为：
 *  - 执行原工具；若未识别到 jobId，原样返回（等价于未启用插件）
 *  - 识别到 jobId 后按 intervalMs 轮询，直到终态 / 超过 maxWaitMs
 *  - 成功终态：把 result（或完整状态）序列化后作为 content 返回
 *  - 失败/取消终态：success=false，error 带上后端错误
 *  - 等待超时：success=false，error 保留 jobId 与最后状态，便于上层继续查询或决策重试
 */
export function withLongRunning(
  tool: ToolDefinition,
  opts: LongRunningOptions,
): ToolDefinition {
  const detect = opts.detect ?? defaultDetect;
  const intervalMs = opts.intervalMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? 600_000;

  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,

    toSchema(): ToolSchema {
      return tool.toSchema();
    },

    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const first = await tool.execute(args, ctx);
      const jobId = detect(first);
      if (!jobId) return first;

      const deadline = Date.now() + maxWaitMs;
      let last: JobStatus = {};

      while (Date.now() < deadline) {
        await sleep(intervalMs);
        let status: JobStatus;
        try {
          status = toStatus(await opts.fetchStatus(jobId));
        } catch (e) {
          return {
            success: false,
            content: '',
            error: `查询任务 ${jobId} 状态失败: ${(e as Error).message}`,
          };
        }
        last = status;

        if (opts.onProgress) {
          await opts.onProgress(status.progress, status);
        }

        if (!isTerminalJobStatus(status.status)) continue;

        if (SUCCESS_STATUSES.has(String(status.status))) {
          const payload = status.result !== undefined ? status.result : status;
          return {
            success: true,
            content: typeof payload === 'string' ? payload : JSON.stringify(payload),
          };
        }

        if (CANCEL_STATUSES.has(String(status.status))) {
          return {
            success: false,
            content: '',
            error: `任务 ${jobId} 已取消`,
          };
        }

        return {
          success: false,
          content: '',
          error: `任务 ${jobId} 失败: ${status.error ?? JSON.stringify(status).slice(0, 500)}`,
        };
      }

      // 等待超时：任务仍在运行，保留 jobId 让 Agent 决策（重试 / 继续查 / 放弃）
      return {
        success: false,
        content: JSON.stringify({ jobId, status: last.status ?? 'running', last }),
        error: `任务 ${jobId} 在 ${Math.round(maxWaitMs / 1000)}s 内未结束（最后状态: ${
          last.status ?? 'running'
        }），可稍后用 get_job_status 继续查询`,
      };
    },
  };
}
