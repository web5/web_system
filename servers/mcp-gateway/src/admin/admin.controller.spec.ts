/**
 * 回归锁：GET /api/modules 响应脱敏（fix/mcp-admin-auth-mask）
 *
 * 背景：`auth_config` 里放的是转发给下游服务用的凭据（token / 账号 / header 名）。
 * 运营后台浏览器只需要知道「配没配」，拿到明文只有泄露面没有收益 ——
 * 而且一旦前端把明文回传（PUT），就会出现「占位符覆盖真密钥」的事故（同批 update 修复）。
 *
 * 口径：**整字段摘除 + `auth_configured: boolean`**，不逐键掩码。
 */
import { AdminController, toAdminModuleView } from './admin.controller';

const PAPER = {
  id: 7,
  name: 'paper',
  description: '论文检索',
  base_url: 'http://content-hub:6007',
  timeout: 30,
  auth_type: 'bearer',
  auth_config: { token: 's3cr3t-real-token' },
  enabled: true,
  tools: [{ id: 1, name: 'search_papers', description: '', method: 'GET', path: '/api/papers' }],
} as any;

const OPEN_MODULE = {
  id: 8,
  name: 'public-demo',
  description: '',
  base_url: 'http://demo:9000',
  timeout: 30,
  auth_type: '',
  auth_config: null,
  enabled: true,
  tools: [],
} as any;

function makeController(modules: any[]) {
  const adminService = { list: jest.fn(async () => modules) };
  return new AdminController(adminService as any);
}

describe('GET /api/modules 脱敏', () => {
  it('V1 响应里没有 auth_config 字段，任何一处都没有', async () => {
    const res = await makeController([PAPER, OPEN_MODULE]).list();

    expect(res.modules).toHaveLength(2);
    for (const m of res.modules as any[]) {
      expect(m).not.toHaveProperty('auth_config');
    }
    // 整包序列化也不能残留密钥（防止某层 interceptor 把原对象又带出来）
    expect(JSON.stringify(res)).not.toContain('s3cr3t-real-token');
  });

  it('V2 配了鉴权 → auth_configured=true；没配 → false', async () => {
    const res = await makeController([PAPER, OPEN_MODULE]).list();
    const [paper, open] = res.modules as any[];

    expect(paper.auth_configured).toBe(true);
    expect(open.auth_configured).toBe(false);
  });

  it('V3 auth_config 是空对象 → 视为未配置（配了个空壳不算配了）', () => {
    expect(toAdminModuleView({ ...PAPER, auth_config: {} }).auth_configured).toBe(false);
  });

  it('V4 其余字段一个都不能少（脱敏只摘 auth_config，别把页面搞白屏）', async () => {
    const res = await makeController([PAPER]).list();
    const paper = (res.modules as any[])[0];

    expect(paper).toMatchObject({
      id: 7,
      name: 'paper',
      description: '论文检索',
      base_url: 'http://content-hub:6007',
      timeout: 30,
      auth_type: 'bearer',
      enabled: true,
    });
    expect(paper.tools).toHaveLength(1);
    expect(paper.tools[0].name).toBe('search_papers');
  });

  it('V5 auth_type 保留（前端要显示「用哪种鉴权方式」，只有值敏感）', async () => {
    const res = await makeController([PAPER]).list();
    expect((res.modules as any[])[0].auth_type).toBe('bearer');
  });
});
