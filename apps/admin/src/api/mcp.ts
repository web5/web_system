import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

const http = axios.create({
  baseURL: '/',
  timeout: 30000,
});

/**
 * 自动从 localStorage 的 user-store 注入 Authorization 头。
 * 避免与 admin/src/api/request.ts 的拦截器重复维护（两处 key 相同）。
 */
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  try {
    const raw = localStorage.getItem('user-store');
    const token = raw ? (JSON.parse(raw)?.token as string | undefined) : null;
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
  } catch {
    /* 忽略解析错误 */
  }
  return config;
});

/** MCP 模块类型 */
export interface McpModule {
  id: number;
  name: string;
  description: string;
  base_url: string;
  timeout: number;
  auth_type: string;
  auth_config: Record<string, string> | null;
  enabled: number;
  module_type?: string;
  code_key?: string | null;
  tools: McpTool[];
}

export interface McpTool {
  id?: number;
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}

/** 列出所有模块 */
export async function listModules(): Promise<McpModule[]> {
  const { data } = await http.get('/api/mcp/modules');
  return data.modules;
}

/** 创建模块 */
export async function createModule(dto: any): Promise<{ id: number }> {
  const { data } = await http.post('/api/mcp/modules', dto);
  return data;
}

/** 更新模块 */
export async function updateModule(id: number, dto: any): Promise<void> {
  await http.put(`/api/mcp/modules/${id}`, dto);
}

/** 删除模块 */
export async function deleteModule(id: number): Promise<void> {
  await http.delete(`/api/mcp/modules/${id}`);
}

/** 启停模块 */
export async function toggleModule(id: number, enabled: boolean): Promise<void> {
  await http.post(`/api/mcp/modules/${id}/toggle`, { enabled });
}

/** 调试验证 */
export async function debugCall(dto: {
  base_url: string;
  method: string;
  path: string;
  params?: Record<string, unknown>;
}): Promise<unknown> {
  const { data } = await http.post('/api/mcp/debug', dto);
  return data;
}

// ── API Key 运营 / 管理（经 gateway 代理 /api → user-service:3002）──
// 申请 / 签发流程已迁至 portal 用户中心（/profile），后台仅做 list / revoke
// 鉴权：登录态 JWT + admin 角色（不再使用 X-Admin-Key）
export async function listKeys(): Promise<any[]> {
  const { data } = await http.get('/api/keys');
  return data.keys;
}

export async function revokeKey(id: number): Promise<void> {
  await http.delete(`/api/keys/${id}`);
}
