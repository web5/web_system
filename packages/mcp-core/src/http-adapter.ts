/** 声明式 HTTP→MCP 工具转换器（zod 版）

通过声明（base_url + tools）自动生成 MCP 工具，零代码接入后台 HTTP 服务。
*/
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  HttpToolDef,
  HttpParamDef,
  HttpModuleConfig,
  HttpJobToolDef,
  McpModule,
} from './types';

/**
 * 终态状态词集合。
 * 兼容两套命名：流水线用 succeeded/failed/cancelled，历史 deploy_tasks 用 success。
 */
const TERMINAL_STATUSES = new Set([
  'succeeded',
  'success',
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
]);

/** 任务是否进入终态（终态后无需继续轮询） */
export function isTerminalStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 按点路径取值：'data.jobId' → obj.data.jobId */
function extractByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** 参数类型 → zod schema */
function toZodSchema(param: HttpParamDef): z.ZodType {
  const type = param.type ?? 'string';
  let base: z.ZodType;
  switch (type) {
    case 'integer':
      base = z.number().int();
      break;
    case 'number':
      base = z.number();
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'array':
      base = z.array(z.unknown());
      break;
    case 'object':
      base = z.record(z.unknown());
      break;
    case 'string':
    default:
      base = z.string();
  }
  return param.required ? base : base.optional();
}

/** 从 path 模板提取 {xxx} 参数 */
function extractPathParams(path: string): string[] {
  const matches = path.matchAll(/\{(\w+)\}/g);
  return [...matches].map((m) => m[1]);
}

/**
 * 调用后台 HTTP API。
 * @param opts.passThroughToken 当前调用者的凭证（auth.type === 'pass-through' 时以 X-Mcp-Key 透传）
 */
export async function callApi(
  moduleConfig: HttpModuleConfig,
  toolDef: Pick<HttpToolDef, 'method' | 'path' | 'params'>,
  args: Record<string, unknown>,
  opts?: { passThroughToken?: string },
): Promise<unknown> {
  const baseUrl = (moduleConfig.base_url ?? '').replace(/\/$/, '');
  const method = (toolDef.method ?? 'GET').toUpperCase();
  const timeout = Number(moduleConfig.timeout ?? 30) * 1000;
  let path = toolDef.path ?? '/';

  // 替换 path 参数
  const pathParams = extractPathParams(path);
  const queryOrBody: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (pathParams.includes(key)) {
      path = path.replace(`{${key}}`, String(value));
    } else {
      queryOrBody[key] = value;
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = moduleConfig.auth ?? {};
  if (auth.type === 'pass-through') {
    // 透传调用者凭证：优先取本次调用上下文，回退宿主注入的 provider
    const token = opts?.passThroughToken ?? moduleConfig.credentialProvider?.();
    if (token) headers['X-Mcp-Key'] = token;
  } else if (auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${auth.token ?? ''}`;
  } else if (auth.type === 'basic') {
    const cred = `${auth.username ?? ''}:${auth.password ?? ''}`;
    headers['Authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`;
  } else if (auth.type === 'header') {
    headers[auth.key ?? 'Authorization'] = auth.value ?? '';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let url = `${baseUrl}${path}`;
    const init: RequestInit = { method, headers, signal: controller.signal };

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      init.body = JSON.stringify(queryOrBody);
    } else {
      const qs = new URLSearchParams(
        Object.entries(queryOrBody).map(([k, v]) => [k, String(v)] as [string, string]),
      );
      if (qs.toString()) url += `?${qs.toString()}`;
    }

    const resp = await fetch(url, init);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}`, detail: (await resp.text()).slice(0, 500) };
    }
    try {
      return await resp.json();
    } catch {
      return { text: await resp.text() };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 参数声明 → zod shape */
function buildShape(params: HttpParamDef[] | undefined): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const p of params ?? []) {
    shape[p.name] = toZodSchema(p);
  }
  return shape;
}

/** 注册单个 HTTP 工具到 server */
function registerHttpTool(
  server: McpServer,
  moduleConfig: HttpModuleConfig,
  toolDef: HttpToolDef,
): void {
  const inputSchema = z.object(buildShape(toolDef.params));

  // 动态 schema 场景，registerTool 泛型推断会过深，用 any 绕过类型推断
  (server.registerTool as any)(
    toolDef.name,
    { description: toolDef.description ?? '', inputSchema },
    async (args: Record<string, unknown>) => {
      const token = moduleConfig.credentialProvider?.();
      const result = await callApi(moduleConfig, toolDef, args, { passThroughToken: token });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

/** 任务型工具的执行结果（MCP content 结构） */
export interface JobExecutionResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * 执行任务型工具（提交 + 可选同步等待）。
 *
 * T3 混合语义：
 *  - 未配 `waitTimeoutSec`（或传 0）：提交后立即返回 jobId
 *  - 配了 `waitTimeoutSec > 0`：阻塞轮询 status 到终态；超时返回 jobId + 转异步提示（任务不丢）
 *
 * 抽成独立函数是为了让「MCP 工具注册」与「网关直调端点 /mcp/tools/call」复用同一套语义。
 */
export async function executeJob(
  moduleConfig: HttpModuleConfig,
  jobDef: HttpJobToolDef,
  args: Record<string, unknown>,
): Promise<JobExecutionResult> {
  const waitParam = jobDef.waitTimeoutParam ?? 'waitTimeoutSec';
  const intervalMs = jobDef.poll?.intervalMs ?? 2000;

  // 等待时长可由调用方覆盖；该参数不下发给后端
  const { [waitParam]: waitOverride, ...submitArgs } = args;
  const waitSec =
    waitOverride !== undefined ? Number(waitOverride) : Number(jobDef.waitTimeoutSec ?? 0);

  const token = moduleConfig.credentialProvider?.();
  const submitRes = await callApi(
    moduleConfig,
    { method: jobDef.submit.method, path: jobDef.submit.path, params: jobDef.submit.params },
    submitArgs,
    { passThroughToken: token },
  );

  const rawJobId = extractByPath(submitRes, jobDef.resultPath ?? 'jobId');
  const jobId = typeof rawJobId === 'string' ? rawJobId : undefined;
  if (!jobId) {
    // 提交即失败（参数校验/鉴权/后端异常），原样返回，便于调用方定位
    return {
      content: [{ type: 'text', text: JSON.stringify(submitRes, null, 2) }],
      isError: true,
    };
  }

  // 通知宿主记录 jobId → module 映射（通用 get_job_status 依赖该映射路由）
  await moduleConfig.onJobSubmitted?.({
    jobId,
    toolName: jobDef.name,
    codeKey: moduleConfig.codeKey,
  });

  // 异步模式：立即返回 jobId
  if (waitSec <= 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              jobId,
              status: (submitRes as { status?: string } | undefined)?.status ?? 'pending',
              hint: '任务已提交，调用 get_job_status 查询进度',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // 同步模式：轮询至终态或超时
  const deadline = Date.now() + waitSec * 1000;
  let last: unknown = submitRes;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const st = await callApi(
      moduleConfig,
      { method: jobDef.status.method, path: jobDef.status.path },
      { jobId },
      { passThroughToken: token },
    );
    last = st;
    if (isTerminalStatus((st as { status?: unknown } | undefined)?.status)) {
      return { content: [{ type: 'text', text: JSON.stringify(st, null, 2) }] };
    }
  }

  // 同步等待超时：转异步，任务仍在后端运行，不报错
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            jobId,
            status: (last as { status?: string } | undefined)?.status ?? 'running',
            message: `同步等待 ${waitSec}s 未结束，任务仍在运行，请用 get_job_status 继续查询`,
            last,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * 注册任务型工具（长任务，T3 混合模式），并按需注册 `<name>_cancel` 取消工具。
 * 执行逻辑见 executeJob。
 */
function registerJobTool(
  server: McpServer,
  moduleConfig: HttpModuleConfig,
  jobDef: HttpJobToolDef,
): void {
  const waitParam = jobDef.waitTimeoutParam ?? 'waitTimeoutSec';
  const inputSchema = z.object({
    ...buildShape(jobDef.submit.params),
    [waitParam]: z.number().int().min(0).optional(),
  });

  (server.registerTool as any)(
    jobDef.name,
    { description: jobDef.description ?? '', inputSchema },
    async (args: Record<string, unknown>) => executeJob(moduleConfig, jobDef, args),
  );

  if (jobDef.cancel) {
    const cancelDef = jobDef.cancel;
    (server.registerTool as any)(
      `${jobDef.name}_cancel`,
      {
        description: `取消由 ${jobDef.name} 提交的任务（幂等）`,
        inputSchema: z.object({ jobId: z.string() }),
      },
      async (args: Record<string, unknown>) => {
        const token = moduleConfig.credentialProvider?.();
        const result = await callApi(moduleConfig, cancelDef, args, {
          passThroughToken: token,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }
}

/** 任务路由结果：jobId 属于哪个模块的哪个任务工具 */
export interface JobRoute {
  codeKey?: string;
  toolName?: string;
}

/**
 * 通用任务查询模块：注册跨模块的 `get_job_status` / `cancel_job` 工具。
 *
 * jobId → 模块的路由策略由宿主注入（例如查 mcp_jobs 索引表、或按 jobId 前缀判定），
 * mcp-core 不关心存储细节。
 */
export function createJobStatusModule(opts: {
  modules: Array<{ codeKey: string; config: HttpModuleConfig }>;
  resolveModule: (jobId: string) => Promise<JobRoute | undefined>;
}): McpModule {
  const locate = async (jobId: string) => {
    const route = await opts.resolveModule(jobId);
    if (!route?.codeKey) {
      return { error: `未知任务: ${jobId}（未找到 jobId 与模块的映射）` };
    }
    const mod = opts.modules.find((m) => m.codeKey === route.codeKey);
    if (!mod) return { error: `模块 ${route.codeKey} 未加载` };
    const jobs = mod.config.jobs ?? [];
    const jobDef =
      (route.toolName ? jobs.find((j) => j.name === route.toolName) : undefined) ?? jobs[0];
    if (!jobDef) return { error: `模块 ${route.codeKey} 未声明任务型工具` };
    return { mod, jobDef };
  };

  return {
    name: 'job-status',
    register(server) {
      (server.registerTool as any)(
        'get_job_status',
        {
          description:
            '查询长任务状态：返回 status/progress/logs/result。jobId 由任务型工具（如 publish_pipeline）提交时返回',
          inputSchema: z.object({ jobId: z.string() }),
        },
        async (args: Record<string, unknown>) => {
          const jobId = String(args.jobId ?? '');
          const found = await locate(jobId);
          if ('error' in found) {
            return { content: [{ type: 'text' as const, text: JSON.stringify(found) }], isError: true };
          }
          const { mod, jobDef } = found;
          const token = mod.config.credentialProvider?.();
          const st = await callApi(
            mod.config,
            { method: jobDef.status.method, path: jobDef.status.path },
            { jobId },
            { passThroughToken: token },
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(st, null, 2) }] };
        },
      );

      (server.registerTool as any)(
        'cancel_job',
        {
          description: '取消运行中的长任务（幂等；任务声明了 cancel 接口才支持）',
          inputSchema: z.object({ jobId: z.string() }),
        },
        async (args: Record<string, unknown>) => {
          const jobId = String(args.jobId ?? '');
          const found = await locate(jobId);
          if ('error' in found) {
            return { content: [{ type: 'text' as const, text: JSON.stringify(found) }], isError: true };
          }
          const { mod, jobDef } = found;
          if (!jobDef.cancel) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: `任务工具 ${jobDef.name} 不支持取消` }),
                },
              ],
              isError: true,
            };
          }
          const token = mod.config.credentialProvider?.();
          const res = await callApi(mod.config, jobDef.cancel, { jobId }, { passThroughToken: token });
          return { content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }] };
        },
      );
    },
  };
}

/** 从声明创建一个 HTTP 模块（同步工具 + 任务型工具） */
export function createHttpModule(
  name: string,
  moduleConfig: HttpModuleConfig,
): McpModule {
  return {
    name,
    register(server) {
      for (const toolDef of moduleConfig.tools ?? []) {
        try {
          registerHttpTool(server, moduleConfig, toolDef);
        } catch (e) {
          console.error(`[mcp-core] 工具 ${toolDef.name} 注册失败:`, e);
        }
      }
      for (const jobDef of moduleConfig.jobs ?? []) {
        try {
          registerJobTool(server, moduleConfig, jobDef);
        } catch (e) {
          console.error(`[mcp-core] 任务型工具 ${jobDef.name} 注册失败:`, e);
        }
      }
    },
  };
}
