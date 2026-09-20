import { TargetResolver } from './target-resolver.service';

/**
 * TargetResolver 单测（双域重构 P0 · V3）
 *
 * 覆盖：
 * - 带前缀 targetRef（app: / svc:）
 * - **历史无前缀 key 的兜底解析顺序**（先 apps 后 services，FR-9.2）—— 保证历史流水线数据零改造
 * - 未命中 / 空值的错误路径
 */
describe('TargetResolver', () => {
  let appRepo: { findOne: jest.Mock };
  let serviceRepo: { findOne: jest.Mock };
  let resolver: TargetResolver;

  const APP_ADMIN = {
    key: 'admin',
    kind: 'micro-frontend',
    repoDir: 'apps/admin',
    deployMode: 'env-dir',
  };
  const SVC_AUTH = {
    key: 'auth-service',
    kind: 'nest',
    repoDir: 'servers/auth-service',
  };

  beforeEach(() => {
    appRepo = { findOne: jest.fn() };
    serviceRepo = { findOne: jest.fn() };
    resolver = new TargetResolver(appRepo as never, serviceRepo as never);
  });

  it('带 app: 前缀时直接解析为应用', async () => {
    appRepo.findOne.mockResolvedValue(APP_ADMIN);
    const r = await resolver.resolve('app:admin');
    expect(r).toMatchObject({
      ref: 'app:admin',
      domain: 'app',
      key: 'admin',
      kind: 'micro-frontend',
      repoDir: 'apps/admin',
      rootDir: 'apps',
      deployMode: 'env-dir',
    });
    expect(serviceRepo.findOne).not.toHaveBeenCalled();
  });

  it('带 svc: 前缀时直接解析为服务', async () => {
    serviceRepo.findOne.mockResolvedValue(SVC_AUTH);
    const r = await resolver.resolve('svc:auth-service');
    expect(r).toMatchObject({
      ref: 'svc:auth-service',
      domain: 'svc',
      key: 'auth-service',
      rootDir: 'servers',
      repoDir: 'servers/auth-service',
    });
    expect(appRepo.findOne).not.toHaveBeenCalled();
  });

  it('历史无前缀 key：优先解析为应用（FR-9.2）', async () => {
    appRepo.findOne.mockResolvedValue(APP_ADMIN);
    const r = await resolver.resolve('admin');
    expect(r).toMatchObject({ ref: 'app:admin', domain: 'app' });
    // 命中应用后不应再查服务表
    expect(serviceRepo.findOne).not.toHaveBeenCalled();
  });

  it('历史无前缀 key：应用未命中时回落到服务', async () => {
    appRepo.findOne.mockResolvedValue(null);
    serviceRepo.findOne.mockResolvedValue(SVC_AUTH);
    const r = await resolver.resolve('auth-service');
    expect(r).toMatchObject({ ref: 'svc:auth-service', domain: 'svc', rootDir: 'servers' });
  });

  it('两侧都未命中时抛错', async () => {
    appRepo.findOne.mockResolvedValue(null);
    serviceRepo.findOne.mockResolvedValue(null);
    await expect(resolver.resolve('not-exist')).rejects.toThrow('未找到发布目标：not-exist');
  });

  it('空值抛错（不查库）', async () => {
    await expect(resolver.resolve('')).rejects.toThrow('发布目标为空');
    await expect(resolver.resolve('   ')).rejects.toThrow('发布目标为空');
    expect(appRepo.findOne).not.toHaveBeenCalled();
  });

  it('resolveMany：未找到的返回 null 而不抛错', async () => {
    appRepo.findOne.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'admin' ? APP_ADMIN : null,
    );
    serviceRepo.findOne.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'auth-service' ? SVC_AUTH : null,
    );
    const list = await resolver.resolveMany(['app:admin', 'svc:auth-service', 'ghost']);
    expect(list.map((x) => x?.ref ?? null)).toEqual(['app:admin', 'svc:auth-service', null]);
  });
});
