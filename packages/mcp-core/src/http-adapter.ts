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

/** 调用后台 HTTP API */
export async function callApi(
  moduleConfig: HttpModuleConfig,
  toolDef: HttpToolDef,
  args: Record<string, unknown>,
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
  if (auth.type === 'bearer') {
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
