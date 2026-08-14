/** MCP 核心类型定义 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** MCP 业务模块接口：每个模块实现 register 方法，把自己的工具注册到网关 */
export interface McpModule {
  name: string;
  register(server: McpServer): void | Promise<void>;
}

/** HTTP 工具声明（配置里的 tools 项） */
export interface HttpToolDef {
  name: string;
  description?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  params?: HttpParamDef[];
}

export interface HttpParamDef {
  name: string;
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  description?: string;
  /** path 参数显式标记；或由 path 模板 {xxx} 自动识别 */
  in?: 'path' | 'query' | 'body';
}

/** HTTP 模块配置（base_url + tools） */
export interface HttpModuleConfig {
  base_url: string;
  timeout?: number;
  auth?: Record<string, string>;
  tools: HttpToolDef[];
}
