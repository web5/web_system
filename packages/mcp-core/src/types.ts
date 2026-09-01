/** MCP 核心类型定义 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** MCP 业务模块接口：每个模块实现 register 方法，把自己的工具注册到网关 */
export interface McpModule {
  name: string;
  register(server: McpServer): void | Promise<void>;
}

/** HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** HTTP 工具声明（配置里的 tools 项） */
export interface HttpToolDef {
  name: string;
  description?: string;
  method?: HttpMethod;
  path?: string;
  params?: HttpParamDef[];
}

/** 终态任务状态（非终态：pending / running） */
export type TerminalJobStatus = 'succeeded' | 'failed' | 'cancelled';

/** 任务状态响应体（后端 status 接口返回，字段尽量宽松） */
export interface JobStatusPayload {
  status?: string;
  progress?: { current?: number; total?: number; message?: string };
  logs?: string[];
  result?: unknown;
  error?: string;
}

/**
 * 任务型工具声明（长任务）。
 *
 * 一次工具调用 = 提交 + （可选）轮询到终态：
 *  - 未配 `waitTimeoutSec` 或为 0：提交后立即返回 jobId（异步模式）
 *  - 配了 `waitTimeoutSec > 0`：阻塞轮询到终态；超时则返回 jobId + 提示转异步（T3 混合）
 */
export interface HttpJobToolDef {
  name: string;
  description?: string;
  /** 提交任务 */
  submit: {
    method: HttpMethod;
    path: string;
    params?: HttpParamDef[];
  };
  /** 查询任务状态，path 支持 {jobId} 占位 */
  status: {
    method: HttpMethod;
    path: string;
  };
  /** 取消任务（可选），path 支持 {jobId} 占位 */
  cancel?: {
    method: HttpMethod;
    path: string;
  };
  /** 从 submit 响应中提取 jobId 的点路径，默认 'jobId'（支持 'data.jobId'） */
  resultPath?: string;
  /** 轮询参数 */
  poll?: {
    intervalMs?: number;
    maxWaitMs?: number;
  };
  /** 同步等待上限（秒）。>0 才启用同步等待；未配则纯异步 */
  waitTimeoutSec?: number;
  /**
   * 调用方可覆盖等待时长的入参名（默认 'waitTimeoutSec'）。
   * 传入则覆盖工具声明值；传 0 表示强制异步返回 jobId。
   * 该参数不会透传给后端 submit 接口。
   */
  waitTimeoutParam?: string;
  /** 标记长任务，供 agent-core 等调用方识别并自动轮询 */
  longRunning?: boolean;
}

export interface HttpParamDef {
  name: string;
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  description?: string;
  /** path 参数显式标记；或由 path 模板 {xxx} 自动识别 */
  in?: 'path' | 'query' | 'body';
}

/** HTTP 模块配置（base_url + tools + jobs） */
export interface HttpModuleConfig {
  base_url: string;
  timeout?: number;
  auth?: Record<string, string>;
  tools?: HttpToolDef[];
  /** 任务型工具（长任务） */
  jobs?: HttpJobToolDef[];
  /**
   * 凭证透传提供者：返回当前调用者的 Bearer token。
   * 由宿主（mcp-gateway）用 AsyncLocalStorage 注入；mcp-core 不感知传输细节。
   * 仅当 auth.type === 'pass-through' 时生效。
   */
  credentialProvider?: () => string | undefined;
  /** 模块标识（任务路由用，如 'deploy'） */
  codeKey?: string;
  /**
   * 任务提交成功后的回调：宿主可据此记录 jobId → module 映射（如 mcp_jobs 索引表）。
   * 通用 get_job_status 依赖该映射把 jobId 路由回正确的后端。
   */
  onJobSubmitted?: (job: {
    jobId: string;
    toolName: string;
    codeKey?: string;
  }) => void | Promise<void>;
}
