import axios from 'axios';
const http = axios.create({
    baseURL: '/',
    timeout: 30000,
});
/** 列出所有模块 */
export async function listModules() {
    const { data } = await http.get('/api/mcp/modules');
    return data.modules;
}
/** 创建模块 */
export async function createModule(dto) {
    const { data } = await http.post('/api/mcp/modules', dto);
    return data;
}
/** 更新模块 */
export async function updateModule(id, dto) {
    await http.put(`/api/mcp/modules/${id}`, dto);
}
/** 删除模块 */
export async function deleteModule(id) {
    await http.delete(`/api/mcp/modules/${id}`);
}
/** 启停模块 */
export async function toggleModule(id, enabled) {
    await http.post(`/api/mcp/modules/${id}/toggle`, { enabled });
}
/** 调试验证 */
export async function debugCall(dto) {
    const { data } = await http.post('/api/mcp/debug', dto);
    return data;
}
