/** 声明式 HTTP→MCP 工具转换器（zod 版）

通过声明（base_url + tools）自动生成 MCP 工具，零代码接入后台 HTTP 服务。
*/
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HttpToolDef, HttpParamDef, HttpModuleConfig, McpModule } from './types';

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

/** 调用后台 HTTP API 的统一错误结构 */
export interface CallApiError {
  error: {
    type: 'http' | 'network' | 'timeout' | 'parse';
    status?: number;
    message: string;
    detail?: string;
  };
}

/** 把参数值序列化为字符串（修复 array/object 被 String() 压成 [object Object] 的 bug） */
function serializeParamValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** 是否值得重试：网络异常 / 超时 / 5xx 才重试，4xx 不重试 */
function isRetryable(status: number | undefined, err: unknown): boolean {
  if (err) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 调用后台 HTTP API（带重试、退避与统一错误结构） */
export async function callApi(
  moduleConfig: HttpModuleConfig,
  toolDef: HttpToolDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = (moduleConfig.base_url ?? '').replace(/\/$/, '');
  const method = (toolDef.method ?? 'GET').toUpperCase();
  const timeout = Number(moduleConfig.timeout ?? 30) * 1000;
  const maxRetries = Math.max(0, Number(moduleConfig.retries ?? 2));
  const backoffBase = Number(moduleConfig.retryBackoffMs ?? 300);
  let path = toolDef.path ?? '/';

  // 替换 path 参数
  const pathParams = extractPathParams(path);
  const queryOrBody: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (pathParams.includes(key)) {
      path = path.replace(`{${key}}`, encodeURIComponent(serializeParamValue(value)));
    } else {
      queryOrBody[key] = value;
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = moduleConfig.auth ?? {};
  if (auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${auth.token ?? ''}`;
  } else if (auth.type === 'basic') {
    const cred = `${auth.username ?? ''}:${auth.password ?? ''}`;
    headers['Authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`;
  } else if (auth.type === 'header') {
    headers[auth.key ?? 'Authorization'] = auth.value ?? '';
  }

  let lastErr: CallApiError['error'] | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let url = `${baseUrl}${path}`;
      const init: RequestInit = { method, headers, signal: controller.signal };

      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        init.body = JSON.stringify(queryOrBody);
      } else {
        const qs = new URLSearchParams(
          Object.entries(queryOrBody).map(
            ([k, v]) => [k, serializeParamValue(v)] as [string, string],
          ),
        );
        if (qs.toString()) url += `?${qs.toString()}`;
      }

      const resp = await fetch(url, init);
      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 500);
        lastErr = { type: 'http', status: resp.status, message: `HTTP ${resp.status}`, detail };
        // 5xx 进入重试；4xx 直接返回
        if (isRetryable(resp.status, null) && attempt < maxRetries) {
          await sleep(backoffBase * 2 ** attempt);
          continue;
        }
        return { error: lastErr };
      }
      try {
        return await resp.json();
      } catch {
        return { text: await resp.text() };
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError';
      lastErr = isAbort
        ? { type: 'timeout', message: `请求超时（>${timeout}ms）` }
        : { type: 'network', message: e instanceof Error ? e.message : String(e) };
      if (attempt < maxRetries) {
        await sleep(backoffBase * 2 ** attempt);
        continue;
      }
      return { error: lastErr };
    } finally {
      clearTimeout(timer);
    }
  }
  // 兜底（理论上循环至少执行一次并在末次 return）
  return { error: lastErr ?? { type: 'network', message: '未知错误' } };
}

/** 注册单个 HTTP 工具到 server */
function registerHttpTool(
  server: McpServer,
  moduleConfig: HttpModuleConfig,
  toolDef: HttpToolDef,
): void {
  const params = toolDef.params ?? [];
  const shape: Record<string, z.ZodType> = {};
  for (const p of params) {
    shape[p.name] = toZodSchema(p);
  }
  const inputSchema = z.object(shape);

  // 动态 schema 场景，registerTool 泛型推断会过深，用 any 绕过类型推断
  (server.registerTool as any)(
    toolDef.name,
    { description: toolDef.description ?? '', inputSchema },
    async (args: Record<string, unknown>) => {
      const result = await callApi(moduleConfig, toolDef, args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

/** 从声明创建一个 HTTP 模块 */
export function createHttpModule(
  name: string,
  moduleConfig: HttpModuleConfig,
): McpModule {
  return {
    name,
    register(server) {
      for (const toolDef of moduleConfig.tools) {
        try {
          registerHttpTool(server, moduleConfig, toolDef);
        } catch (e) {
          console.error(`[mcp-core] 工具 ${toolDef.name} 注册失败:`, e);
        }
      }
    },
  };
}
