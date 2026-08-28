/**
 * Admin - Agent 定义管理（agents 模块）
 *
 * 后端：ai-service
 * 接口前缀：/api/agent-defs（gateway pathRewrite → ai-service /admin/agent-defs）
 */
import request from './request';

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface AgentDef {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  maxSteps: number;
  temperature: number | null;
  memory: { compactionThreshold: number; keepRecent: number; enabled: boolean };
  version: number;
  status: 'published' | 'draft';
  enabled: boolean;
  publishedAt: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDefVersion {
  id: string;
  agentId: string;
  version: number;
  changeNote: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SaveAgentDefPayload {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  maxSteps: number;
  temperature?: number | null;
  memory: { compactionThreshold: number; keepRecent: number; enabled: boolean };
}

/** 列所有定义 */
export function listAgentDefs(): Promise<ApiResponse<AgentDef[]>> {
  return request.get('/agent-defs');
}

/** 详情 */
export function getAgentDef(id: string): Promise<ApiResponse<AgentDef>> {
  return request.get(`/agent-defs/${id}`);
}

/** 新建（草稿） */
export function createAgentDef(payload: SaveAgentDefPayload): Promise<ApiResponse<AgentDef>> {
  return request.post('/agent-defs', payload);
}

/** 保存草稿（不发布） */
export function updateAgentDef(id: string, payload: SaveAgentDefPayload): Promise<ApiResponse<AgentDef>> {
  return request.put(`/agent-defs/${id}`, payload);
}

/** 发布 */
export function publishAgentDef(id: string, changeNote?: string): Promise<ApiResponse<AgentDef>> {
  return request.post(`/agent-defs/${id}/publish`, { changeNote });
}

/** 启用/停用 */
export function setAgentDefEnabled(id: string, enabled: boolean): Promise<ApiResponse<AgentDef>> {
  return request.post(`/agent-defs/${id}/enabled`, { enabled });
}

/** 历史版本 */
export function listAgentDefVersions(id: string): Promise<ApiResponse<AgentDefVersion[]>> {
  return request.get(`/agent-defs/${id}/versions`);
}

/** 回滚到指定版本 */
export function rollbackAgentDef(id: string, versionId: string): Promise<ApiResponse<AgentDef>> {
  return request.post(`/agent-defs/${id}/rollback`, { versionId });
}

/** 删除 */
export function removeAgentDef(id: string): Promise<ApiResponse<{ ok: boolean }>> {
  return request.delete(`/agent-defs/${id}`);
}
