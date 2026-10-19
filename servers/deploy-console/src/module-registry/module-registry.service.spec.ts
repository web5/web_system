import { NotFoundException } from '@nestjs/common';
import { ModuleRegistryService } from './module-registry.service';

describe('ModuleRegistryService.get', () => {
  const moduleRepo = { findOne: jest.fn() };
  const appRepo = { findOne: jest.fn() };
  const serviceRepo = { findOne: jest.fn() };
  let registry: ModuleRegistryService;

  beforeEach(() => {
    jest.resetAllMocks();
    moduleRepo.findOne.mockResolvedValue(null);
    appRepo.findOne.mockResolvedValue(null);
    serviceRepo.findOne.mockResolvedValue(null);
    registry = new ModuleRegistryService(moduleRepo as never, appRepo as never, serviceRepo as never);
  });

  it('模块缺失时返回 404 并保留已有错误文案', async () => {
    const result = registry.get('missing');
    await expect(result).rejects.toBeInstanceOf(NotFoundException);
    await expect(result).rejects.toMatchObject({ message: '模块不存在: missing' });
    await expect(result).rejects.toHaveProperty('status', 404);
  });

  it('底层查询失败不能伪装成模块缺失', async () => {
    const failure = new Error('database unavailable');
    serviceRepo.findOne.mockRejectedValue(failure);
    await expect(registry.get('admin')).rejects.toBe(failure);
    expect(appRepo.findOne).not.toHaveBeenCalled();
    expect(moduleRepo.findOne).not.toHaveBeenCalled();
  });

  it('服务记录优先于应用及旧表', async () => {
    serviceRepo.findOne.mockResolvedValue({ key: 'api', name: 'API', repoDir: 'api', pm2Name: 'api' });
    await expect(registry.get('api')).resolves.toMatchObject({ key: 'api', type: 'backend', pm2: 'api' });
    expect(appRepo.findOne).not.toHaveBeenCalled();
    expect(moduleRepo.findOne).not.toHaveBeenCalled();
  });

  it('新应用记录优先于旧表', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'admin', name: 'Admin', kind: 'micro-frontend', repoDir: 'admin' });
    await expect(registry.get('admin')).resolves.toMatchObject({ key: 'admin', type: 'micro-frontend' });
    expect(moduleRepo.findOne).not.toHaveBeenCalled();
  });

  it('新表无记录时仍兼容旧模块表', async () => {
    const legacy = { key: 'legacy', type: 'frontend' };
    moduleRepo.findOne.mockResolvedValue(legacy);
    await expect(registry.get('legacy')).resolves.toBe(legacy);
  });

  it('shell 兼容元数据保留站点入口类型', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'shell', name: 'Shell', kind: 'shell', repoDir: 'shell' });
    await expect(registry.get('shell')).resolves.toMatchObject({ type: 'frontend', isShell: true, entry: 'index.html' });
  });
});
