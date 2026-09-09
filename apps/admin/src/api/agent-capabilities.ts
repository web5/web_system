/**
 * Admin - Agent 能力资产总览（只读聚合）
 *
 * 后端：ai-service `GET /api/agent-defs/capabilities?agentId=`（gateway → ai-service /admin/agent-defs/capabilities）
 * 数据来自 DB 定义快照（唯一事实源），前端不扇出直连其它服务。
 */
import request from './request';

export interface CapTool {
  type: 'tool';
  name: string;
  source: string;
}

export interface CapMcp {
  type: 'mcp';
  ref: string;
  module: string;
  name: string;
  source: string;
  longRunning?: boolean;
}

export interface CapSkill {
  type: 'skill';
  code: string;
  name: string;
  description: string;
  source: string;
}

export interface CapKnowledge {
  type: 'knowledge';
  name: string;
}

export interface CapOverviewAgent {
  agentId: string;
  name: string;
  model: string;
  version: number;
  tools: CapTool[];
  mcp: CapMcp[];
  skills: CapSkill[];
  knowledge: CapKnowledge[];
  stats: { tools: number; mcp: number; skills: number; knowledge: number };
}

/** 获取能力资产总览（agentId 省略时返回全部已发布 agent 的聚合） */
export async function fetchAgentCapabilities(agentId?: string): Promise<CapOverviewAgent[]> {
  const res: unknown = await request.get('/agent-defs/capabilities', {
    params: agentId ? { agentId } : {},
  });
  const list = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data ?? [];
  return (Array.isArray(list) ? list : []) as CapOverviewAgent[];
}
