/**
 * CLI 侧 MCP 执行器（可选能力）。
 *
 * 与服务端（ai-agent 的 McpService）职责相同，但保持零 Nest 依赖：
 * 直接 fetch mcp-gateway 的 `/mcp/tools/call` 端点。
 *
 * 设计约束：
 *  - **未配置 MCP_GATEWAY_URL 时完全不启用**，CLI 其余能力不受影响
 *  - 参数 schema 宽松（由网关侧校验），CLI 只维护工具名与用途描述
 *  - 长任务工具（publish_pipeline）按需启用 withLongRunning 插件，
 *    对 Agent 引擎表现为同步工具；不启用时原样返回 jobId
 */
import {
  McpToolAdapter,
  McpToolMeta,
  ToolRegistry,
  withLongRunning,
  JobStatus,
} from '@kedouai/agent-core';

export interface McpExecutorConfig {
  gatewayUrl: string;
  clientKey?: string;
  /** 单次 HTTP 超时（毫秒），默认 30s */
  timeoutMs?: number;
}

/** 发布模块工具（与 mcp-gateway 的 deploy 模块对齐，仅声明用途，参数由网关校验） */
const DEPLOY_TOOLS: Array<{
  name: string;
  description: string;
  longRunning?: boolean;
  maxWaitMs?: number;
}> = [
  {
    name: 'list_modules',
    description: '列出可发布模块（key/名称/类型）。发布前先用它确认模块标识，不要凭空猜测',
  },
  {
    name: 'get_current_versions',
    description: '查询指定环境各模块当前线上版本。参数：env（dev/staging/prod）',
  },
  {
    name: 'list_releases',
    description: '列出版本发布历史（回滚候选）。参数：env、component（均可选）',
  },
  {
    name: 'publish_pipeline',
    description:
      '提交发布流水线：构建→投递→写版本表→切指针→验证→清理。参数：env、moduleKey、mode（direct/grayscale，默认 direct）、versionTag（可选，默认当前 HEAD）、grayscaleRule（灰度时必填）、confirm（prod 必填 true）。返回 jobId，任务在后台执行',
    longRunning: true,
    maxWaitMs: 600_000,
  },
  {
    name: 'get_job_status',
    description: '查询任务状态/进度/日志/结果。参数：jobId',
  },
  {
    name: 'cancel_job',
    description: '取消运行中的任务（幂等）。参数：jobId',
  },
  {
    name: 'publish_version',
    description:
      '把模块指针切到指定历史版本（秒级生效，不重新构建）。参数：env、versionTag、confirm（prod 必填 true）',
  },
  {
    name: 'rollback',
    description: '回滚到指定版本（脚本级任务）。参数：env、versionTag、component（可选）',
  },
  {
    name: 'promote_release',
    description: '灰度转全量：切全量指针并禁用灰度规则。参数：pipelineId（灰度流水线的 jobId）',
  },
];

/** 从环境变量构造 MCP 执行器配置；未配置网关地址时返回 null（不启用） */
export function resolveMcpConfig(): McpExecutorConfig | null {
  const gatewayUrl = (process.env.MCP_GATEWAY_URL ?? '').trim();
  if (!gatewayUrl) return null;
  return {
    gatewayUrl: gatewayUrl.replace(/\/+$/, ''),
    clientKey: (process.env.MCP_CLIENT_KEY ?? '').trim() || undefined,
  };
}

/** 调用 MCP 网关的通用工具直调端点 */
async function callTool(
  config: McpExecutorConfig,
  module: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> {
  const resp = await fetch(`${config.gatewayUrl}/mcp/tools/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.clientKey ? { Authorization: `Bearer ${config.clientKey}` } : {}),
    },
    body: JSON.stringify({ module, tool, args }),
    signal: AbortSignal.timeout(timeoutMs ?? config.timeoutMs ?? 30_000),
  });
  if (!resp.ok) {
    throw new Error(`MCP 工具 ${tool} 调用失败: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { content?: string; data?: string };
  return json.content || json.data || JSON.stringify(json);
}

/**
 * 注册发布模块工具到 ToolRegistry。
 * 长任务工具按声明启用 withLongRunning 插件（对引擎表现为同步工具）。
 */
export function registerDeployTools(registry: ToolRegistry, config: McpExecutorConfig): void {
  for (const def of DEPLOY_TOOLS) {
    const meta: McpToolMeta = {
      name: def.name,
      module: 'deploy',
      description: def.description,
      inputSchema: { type: 'object', properties: {} },
    };
    const timeoutMs = config.timeoutMs ?? 30_000;
    const adapter = new McpToolAdapter(meta, {
      execute: async (m, args) => ({
        content: await callTool(config, m.module ?? 'deploy', m.name, args, timeoutMs),
      }),
    });

    const tool = def.longRunning
      ? withLongRunning(adapter, {
          fetchStatus: (jobId: string): Promise<JobStatus | string> =>
            callTool(config, 'deploy', 'get_job_status', { jobId }, timeoutMs),
          maxWaitMs: def.maxWaitMs ?? 600_000,
          intervalMs: 3000,
        })
      : adapter;

    registry.register(tool);
  }
}
