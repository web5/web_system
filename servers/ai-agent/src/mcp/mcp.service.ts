import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  McpToolAdapter,
  McpToolMeta,
  ToolRegistry,
} from '@kedouai/agent-core';

/**
 * MCP 工具接入服务 — 让 Agent 能以"一切皆插件"的方式调用 MCP 暴露的远程工具。
 *
 * 能力：
 * - registerMcpTool：把 MCP 工具注册为懒加载工具（首次使用才拉取/实例化）
 * - 通过 MCP 网关 HTTP 端点调用远程工具
 *
 * 复用 agent-core 的 McpToolAdapter（远程工具 → 统一 ToolDefinition 契约）。
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  /** MCP 网关地址（可选，未配置则 MCP 工具不可用） */
  private readonly mcpGatewayUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.mcpGatewayUrl = this.configService.get('MCP_GATEWAY_URL', '');
  }

  /** 是否已配置 MCP 网关 */
  isAvailable(): boolean {
    return !!this.mcpGatewayUrl.trim();
  }

  /**
   * 注册一个 MCP 工具到 ToolRegistry（懒加载）。
   * @param toolRegistry agent 的工具注册中心
   * @param meta MCP 工具元数据
   */
  registerMcpTool(toolRegistry: ToolRegistry, meta: McpToolMeta): void {
    if (!this.isAvailable()) {
      this.logger.warn(`MCP 网关未配置，跳过 MCP 工具注册: ${meta.name}`);
      return;
    }
    toolRegistry.registerLazy(meta.name, () => {
      const adapter = new McpToolAdapter(meta, {
        execute: async (m, args) => this.callMcpTool(m, args),
      });
      return adapter;
    });
    this.logger.log(`已注册 MCP 工具（懒加载）: ${meta.name}`);
  }

  /** 通过 MCP 网关调用远程工具 */
  private async callMcpTool(
    meta: McpToolMeta,
    args: Record<string, unknown>,
  ): Promise<{ content: string }> {
    if (!this.mcpGatewayUrl) {
      throw new Error('MCP 网关未配置，无法调用远程工具');
    }
    // 简化：POST 到网关的通用工具调用端点
    // 生产可改为 MCP streamable-http 协议的 tools/call
    const url = `${this.mcpGatewayUrl.replace(/\/+$/, '')}/mcp/tools/call`;
    const body = JSON.stringify({
      module: meta.module,
      tool: meta.name,
      args,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`MCP 工具 ${meta.name} 调用失败: HTTP ${response.status}`);
    }
    const result = await response.json() as { content?: string; data?: string; message?: string };
    return { content: result.content || result.data || JSON.stringify(result) };
  }
}
