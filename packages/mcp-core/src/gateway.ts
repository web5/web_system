/** MCP 网关构建（框架无关） */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpModule } from './types';

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

/** 构建 MCP Server 并注册所有模块的工具 */
export async function buildServer(
  info: ServerInfo,
  modules: McpModule[],
): Promise<McpServer> {
  const server = new McpServer(
    { name: info.name, version: info.version },
    { instructions: info.instructions },
  );
  for (const m of modules) {
    await m.register(server);
  }
  return server;
}
