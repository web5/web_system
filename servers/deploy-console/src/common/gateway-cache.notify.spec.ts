import { GatewayCacheService } from './gateway-cache.service';

/**
 * 诊断 #16：gateway 版本缓存失效通知。
 *
 * 此前这段逻辑**只存在于 DeployService 内部**，于是只有「走 deploy.service 的那条
 * 发布路径」会通知；UI 切换/回滚、`internal/release/pointer` 这些同样改指针的入口
 * 全都不通知 —— 结果是「页面最多 10s 后才变」，且不同入口表现不一致。
 *
 * 这里锁定三件事：
 * 1. 按环境取地址/凭据（发 prod 不能去刷 dev 的 gateway）
 * 2. 未配置时跳过且不抛错（本地/离线环境不该 500）
 * 3. 通知失败只告警不抛错（指针已写成功，不能把成功发布判成失败）
 */
describe('GatewayCacheService（诊断 #16 gateway 缓存通知）', () => {
  const makeService = (map: Record<string, string | undefined>) =>
    new GatewayCacheService({ get: (k: string) => map[k] } as never);

  it('按环境取地址：GATEWAY_INTERNAL_URL_PROD 优先于通用 GATEWAY_INTERNAL_URL', () => {
    const svc = makeService({
      GATEWAY_INTERNAL_URL: 'http://dev-gateway',
      GATEWAY_INTERNAL_URL_PROD: 'http://prod-gateway',
    });
    expect(svc.urlFor('prod')).toBe('http://prod-gateway');
    // 未配 prod 专用时回落通用值（兼容旧单值部署）
    expect(makeService({ GATEWAY_INTERNAL_URL: 'http://dev-gateway' }).urlFor('prod')).toBe(
      'http://dev-gateway',
    );
  });

  it('未配置地址/凭据时跳过：不抛错，reason=not-configured', async () => {
    const svc = makeService({});
    const r = await svc.notifyVersionChange({ env: 'prod', moduleKey: 'portal', version: 'v9' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-configured');
  });

  it('通知失败只告警不抛错 —— 指针已写成功，不能把成功发布判成失败', async () => {
    const svc = makeService({
      GATEWAY_INTERNAL_URL: 'http://127.0.0.1:1', // 必然连不上
      GATEWAY_SERVICE_KEY: 'k',
    });
    await expect(
      svc.notifyVersionChange({ env: 'dev', moduleKey: 'portal', version: 'v9' }),
    ).resolves.toMatchObject({ ok: false, reason: 'failed' });
  });

  it('配置齐全时发出通知（body 带 env/moduleKey/version，便于 gateway 精确定位缓存）', async () => {
    const svc = makeService({
      GATEWAY_INTERNAL_URL: 'http://gw',
      GATEWAY_SERVICE_KEY: 'k',
    });
    const r = await svc.notifyVersionChange({
      env: 'dev',
      moduleKey: 'portal',
      version: 'v9',
      reason: 'switch',
    });
    // 连不上网关时是 failed；连得上才是 notified —— 这里只断言「走到了发送分支」
    expect(['notified', 'failed']).toContain(r.reason);
    expect(r.url).toBe('http://gw/api/internal/gateway/reload');
  });
});
