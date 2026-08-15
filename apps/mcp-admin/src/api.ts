import axios from 'axios';

const http = axios.create({
  baseURL: '/',
  timeout: 30000,
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

// ── API Key 申请 / 管理（经 gateway 代理 /api/mcp → mcp-gateway:6006）──
export async function applyKey(email: string): Promise<void> {
  await http.post('/api/mcp/keys/apply', { email });
}

export async function verifyKey(
  email: string,
  code: string,
  name?: string,
): Promise<{ key: string; prefix: string }> {
  const { data } = await http.post('/api/mcp/keys/verify', { email, code, name });
  return data;
}

export async function listKeys(adminKey: string): Promise<any[]> {
  const { data } = await http.get('/api/mcp/keys', { headers: { 'X-Admin-Key': adminKey } });
  return data.keys;
}

export async function revokeKey(id: number, adminKey: string): Promise<void> {
  await http.delete(`/api/mcp/keys/${id}`, { headers: { 'X-Admin-Key': adminKey } });
}
