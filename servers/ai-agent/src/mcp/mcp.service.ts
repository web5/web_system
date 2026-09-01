import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  McpToolAdapter,
  McpToolMeta,
  ToolRegistry,
  withLongRunning,
  JobStatus,
} from '@kedouai/agent-core';

/** MCP 工具运行时配置（来自 Agent 能力声明的 config 字段） */
export interface McpToolRuntimeConfig {
  /**
   * 长任务：工具返回 jobId 后自动轮询到终态，对 Agent 引擎表现为同步工具。
   * 不启用时原样透传 jobId（由调用方自行决定如何处理）。
   */
  longRunning?: boolean;
  /** 单次 HTTP 请求超时（毫秒），默认 30s */
  timeoutMs?: number;
  /** 长任务最长等待（毫秒），默认 600s */
  maxWaitMs?: number;
  /** 轮询间隔（毫秒），默认 3000 */
  intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_WAIT_MS = 600_000;
const DEFAULT_INTERVAL_MS = 3_000;

/**
 * MCP 工具接入服务 — 让 Agent 能以"一切皆插件"的方式调用 MCP 暴露的远程工具。
 *
 * 能力：
 * - registerMcpTool：把 MCP 工具注册为懒加载工具（首次使用才实例化）
 * - 通过 MCP 网关 HTTP 端点调用远程工具（超时可按工具配置，不再固定 30s）
 * - 可选启用长任务插件：把"返回 jobId 的工具"包装成"自动轮询到终态的同步工具"
 *
 * 长任务插件是**按需启用**的（由各 Agent 的能力声明 config.longRunning 决定），
 * agent-core 本身不内置任何 MCP 语义。
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  /** MCP 网关地址（可选，未配置则 MCP 工具不可用） */
  private readonly mcpGatewayUrl: string;
  /** 网关共享密钥（与 mcp-gateway 的 MCP_CLIENT_KEY 一致） */
  private readonly mcpClientKey: string;

  constructor(private readonly configService: ConfigService) {
    this.mcpGatewayUrl = this.configService.get('MCP_GATEWAY_URL', '');
    this.mcpClientKey = this.configService.get('MCP_CLIENT_KEY', '');
  }

  /** 是否已配置 MCP 网关 */
  isAvailable(): boolean {
    return !!this.mcpGatewayUrl.trim();
  }

  /**
   * 注册一个 MCP 工具到 ToolRegistry（懒加载）。
   * @param config 运行时配置；传 longRunning 时启用长任务自动轮询
   */
  registerMcpTool(
    toolRegistry: ToolRegistry,
    meta: McpToolMeta,
    config?: McpToolRuntimeConfig,
  ): void {
    if (!this.isAvailable()) {
      this.logger.warn(`MCP 网关未配置，跳过 MCP 工具注册: ${meta.name}`);
      return;
    }
    const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const executor = {
      execute: (m: McpToolMeta, args: Record<string, unknown>) => this.callMcpTool(m, args, timeoutMs),
    };

    toolRegistry.registerLazy(meta.name, () => {
      const adapter = new McpToolAdapter(meta, executor);
      if (!config?.longRunning) return adapter;
      return withLongRunning(adapter, {
        fetchStatus: (jobId: string) => this.fetchJobStatus(jobId, timeoutMs),
        maxWaitMs: config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
        intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
      });
    });

    this.logger.log(
      `已注册 MCP 工具（懒加载）: ${meta.name}${config?.longRunning ? ` [长任务, maxWait=${config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS}ms]` : ''}`,
    );
  }

  /**
   * 查询任务状态（供长任务插件轮询）。
   * get_job_status 是网关的跨模块通用工具，这里借用 deploy 模块作为路由入口。
   */
  private async fetchJobStatus(jobId: string, timeoutMs: number): Promise<JobStatus | string> {
    const res = await this.callMcpTool(
      { name: 'get_job_status', module: 'deploy' },
      { jobId },
      timeoutMs,
    );
    return res.content;
  }

  /** 通过 MCP 网关调用远程工具 */
  private async callMcpTool(
    meta: McpToolMeta,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<{ content: string }> {
    if (!this.mcpGatewayUrl) {
      throw new Error('MCP 网关未配置，无法调用远程工具');
    }
    const url = `${this.mcpGatewayUrl.replace(/\/+$/, '')}/mcp/tools/call`;
    const body = JSON.stringify({
      module: meta.module,
      tool: meta.name,
      args,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.mcpClientKey ? { Authorization: `Bearer ${this.mcpClientKey}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`MCP 工具 ${meta.name} 调用失败: HTTP ${response.status}`);
    }
    const result = (await response.json()) as { content?: string; data?: string };
    return { content: result.content || result.data || JSON.stringify(result) };
  }
}
