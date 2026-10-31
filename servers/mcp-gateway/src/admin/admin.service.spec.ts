/**
 * 回归锁：模块更新必须是「未提供则保留」（fix/mcp-admin-auth-mask）
 *
 * 事故链（prod 实测）：`mcp_modules` 里 `paper` 模块 `auth_type=''`、`auth_config=null`
 * → 网关转发不带 `Authorization` → content-hub 返回 401。
 * 成因就是这里的 `update()`：旧实现无条件写 `dto.auth_type ?? ''` / `dto.auth_config ?? null`，
 * 前端只提交部分字段（比如只改个 description）就把鉴权配置清空了；
 * 工具侧更狠——无条件「先删后插」，不传 tools 就直接把工具清空。
 *
 * 本 spec 的断言刻意打在「落库的 patch 实参」上（而不是返回值），
 * 因为事故是**写坏了数据**，返回值一直是 void。
 */
import { AdminService, AUTH_CONFIG_KEEP } from './admin.service';

/** 事故现场：paper 模块的原始状态（鉴权已配好） */
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
};

function makeService(existing: any = PAPER) {
  const moduleRepo = {
    findOne: jest.fn(async () => existing),
    update: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
  };
  const toolRepo = {
    delete: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
  };
  const mcpService = { invalidateCache: jest.fn() } as any;
  const service = new AdminService(moduleRepo as any, toolRepo as any, mcpService);
  return { service, moduleRepo, toolRepo };
}

/** 取唯一一次 moduleRepo.update 的 patch 实参 */
function patchOf(moduleRepo: { update: jest.Mock }, id = 7) {
  const call = moduleRepo.update.mock.calls.find((c) => c[0] === id);
  if (!call) throw new Error('moduleRepo.update 未被调用');
  return call[1] as Record<string, any>;
}

describe('update 局部更新：未提供的字段保留原值', () => {
  it('V1 只传 name → auth_type / auth_config 与改前完全一致（prod paper 事故的回归锁）', async () => {
    const { service, moduleRepo } = makeService();

    await service.update(7, { name: 'paper-renamed' });

    const patch = patchOf(moduleRepo);
    expect(patch.name).toBe('paper-renamed');
    // 这三行是本次修复的核心：旧实现这里会是 '' / null
    expect(patch.auth_type).toBe('bearer');
    expect(patch.auth_config).toEqual({ token: 's3cr3t-real-token' });
    // 其余字段也不许被默认值盖掉
    expect(patch.description).toBe(PAPER.description);
    expect(patch.base_url).toBe(PAPER.base_url);
    expect(patch.timeout).toBe(PAPER.timeout);
  });

  it('V1b 只传 description → 连 name / base_url 也不变', async () => {
    const { service, moduleRepo } = makeService();

    await service.update(7, { description: '新描述' });

    const patch = patchOf(moduleRepo);
    expect(patch.description).toBe('新描述');
    expect(patch.name).toBe('paper');
    expect(patch.base_url).toBe('http://content-hub:6007');
    expect(patch.auth_type).toBe('bearer');
  });

  it('V2 auth_config 传哨兵 __KEEP__ → 保留原值，绝不写成 "***" 之类占位符', async () => {
    const { service, moduleRepo } = makeService();

    await service.update(7, { name: 'paper', auth_config: AUTH_CONFIG_KEEP });

    const patch = patchOf(moduleRepo);
    expect(patch.auth_config).toEqual({ token: 's3cr3t-real-token' });
    expect(JSON.stringify(patch)).not.toContain('***');
  });

  it('V2b auth_config 显式传 null → 视为「显式清空」（null 有语义，不是"未提供"）', async () => {
    const { service, moduleRepo } = makeService();

    await service.update(7, { auth_config: null });

    expect(patchOf(moduleRepo).auth_config).toBeNull();
  });

  it('V2c auth_config 传新值 → 覆盖', async () => {
    const { service, moduleRepo } = makeService();

    await service.update(7, { auth_config: { token: 'new-token' } });

    expect(patchOf(moduleRepo).auth_config).toEqual({ token: 'new-token' });
  });

  it('V3 不传 tools → 原工具一条都不删（旧实现是无条件先删后插）', async () => {
    const { service, toolRepo } = makeService();

    await service.update(7, { name: 'paper-renamed' });

    expect(toolRepo.delete).not.toHaveBeenCalled();
    expect(toolRepo.save).not.toHaveBeenCalled();
  });

  it('V3b 显式传 tools: [] → 明确要清空，才删', async () => {
    const { service, toolRepo } = makeService();

    await service.update(7, { tools: [] });

    expect(toolRepo.delete).toHaveBeenCalledWith({ module_id: 7 });
    expect(toolRepo.save).not.toHaveBeenCalled();
  });

  it('V3c 传了新 tools → 先删后插，且带上 module_id', async () => {
    const { service, toolRepo } = makeService();

    await service.update(7, {
      tools: [{ name: 'get_paper', method: 'GET', path: '/api/papers/:id' } as any],
    });

    expect(toolRepo.delete).toHaveBeenCalledWith({ module_id: 7 });
    expect(toolRepo.save).toHaveBeenCalledTimes(1);
    expect(toolRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ module_id: 7, name: 'get_paper', path: '/api/papers/:id' }),
    );
  });

  it('V4 模块不存在 → 不写库、不删工具（旧实现会写出半截行）', async () => {
    const { service, moduleRepo, toolRepo } = makeService(null as any);

    await service.update(999, { name: 'ghost' });

    expect(moduleRepo.update).not.toHaveBeenCalled();
    expect(toolRepo.delete).not.toHaveBeenCalled();
  });
});
