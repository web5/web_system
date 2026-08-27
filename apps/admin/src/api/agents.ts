/**
 * Admin - Agent 对话记录（agents 模块）
 *
 * 后端：ai-service（统一管理 ai-service 自身 agent + ai-agent 推送过来的 run 记录）
 * 接口前缀：/api/agent-runs（gateway 剥 /api 后 → ai-service /agent-runs）
 *
 * 注意：request 拦截器已 unwrap {code,data,message}，返回的是 data 字段。
 * 但这里沿用 repo 现有约定（bianbian.ts），返回类型仍写 ApiResponse<T>，
 * 实际消费侧用 res: any 或断言为 T 取用。
 */
import request from './request';
import type { PageResponse } from '@web-system/types';

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface AgentRunListItem {
  id: string;
  agentId: string;
  agentName: string | null;
  userId: string;
  conversationId: string | null;
  status: 'ok' | 'error';
  error: string | null;
  durationMs: number | null;
  model: string | null;
  userInputPreview: string;
  finalAnswerPreview: string | null;
  stepCount: number;
  source: string;
  createdAt: string;
}

export interface AgentRunStep {
  type: string;
  name?: string;
  content?: string;
  args?: unknown;
  step?: number;
  ts: number;
}

export interface AgentRunDetail {
  id: string;
  agentId: string;
  agentName: string | null;
  userId: string;
  conversationId: string | null;
  userInput: string;
  systemPrompt: string;
  tools: string[] | null;
  model: string | null;
  steps: AgentRunStep[];
  finalAnswer: string | null;
  error: string | null;
  status: 'ok' | 'error';
  durationMs: number | null;
  source: string;
  createdAt: string;
}

export interface AgentSummary {
  agentId: string;
  agentName: string | null;
  total: number;
  errorCount: number;
  lastRunAt: string;
}

/** 聚合：每个 agent 一次概要 */
export function listAgents(): Promise<ApiResponse<AgentSummary[]>> {
  return request.get('/agent-runs/agents');
}

/** 分页列出 run 记录 */
export function listAgentRuns(params: {
  agentId?: string;
  userId?: string;
  status?: 'ok' | 'error';
  conversationId?: string;
  keyword?: string;
  startAt?: string;
  endAt?: string;
  page?: number;
  pageSize?: number;
}): Promise<ApiResponse<PageResponse<AgentRunListItem>>> {
  return request.get('/agent-runs', { params });
}

/** 一次 run 的完整原始数据（含 systemPrompt、userInput、steps、finalAnswer） */
export function getAgentRun(id: string): Promise<ApiResponse<AgentRunDetail>> {
  return request.get(`/agent-runs/${id}`);
}
