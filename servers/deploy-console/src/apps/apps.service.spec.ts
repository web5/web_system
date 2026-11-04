import { AppsService } from './apps.service';

/**
 * Phase 2 去指针化（S7）：锁定 apps.service 的两处 CDN 分支。
 * - entryUrlFor：CDN 模式给一跳完整 URL（commit 归一化），legacy 保持两跳指针
 * - doSwitchVersion：CDN 模式不写磁盘指针，legacy 仍写
 * 其余依赖全部 `as never` 桩掉，只断言这两个可观察行为。
 */

type AppLike = { key: string; kind: string; deployMode: string };

const appOf = (deployMode: string, key = 'portal'): AppLike => ({ key, kind: 'micro-frontend', deployMode });

function makeSvc(env: Record<string, string>, deps: Record<string, unknown> = {}) {
  const configService = { get: (k: string) => env[k] };
  const svc = new AppsService(
    (deps.appRepo as never) ?? ({} as never),
    {} as never,
    {} as never,
    {} as never,
    (deps.envsService as never) ?? ({} as never),
    configService as never,
    {} as never,
    (deps.registry as never) ?? ({} as never),
    (deps.artifacts as never) ?? ({} as never),
    (deps.gatewayCache as never) ?? ({} as never),
    {} as never,
  );
  return svc as unknown as {
    entryUrlFor: (app: AppLike, envId: string, version: string | null) => string;
    doSwitchVersion: (
      appKey: string,
      envId: string,
      version: string,
      operator?: string,
      lockOwner?: string,
    ) => Promise<unknown>;
  };
}

describe('AppsService（Phase 2 去指针化）', () => {
  describe('entryUrlFor', () => {
    it('CDN 模式：env-dir 给一跳完整 URL，完整引用归一化为纯 commit', () => {
      const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: 'https://kedouai.com/cdn' });
      expect(svc.entryUrlFor(appOf('env-dir'), 'prod', 'default/624bfa46')).toBe(
        'https://kedouai.com/cdn/prod/portal/624bfa46/index.js',
      );
    });

    it('CDN 模式：site-version（shell）不进 CDN，仍按版本目录直出', () => {
      const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: 'https://kedouai.com/cdn' });
      expect(svc.entryUrlFor(appOf('site-version', 'shell'), 'prod', '624bfa46')).toBe(
        '/static/modules/shell/prod/624bfa46/index.html',
      );
    });

    it('CDN 模式：无 version 返回空串', () => {
      const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: 'https://kedouai.com/cdn' });
      expect(svc.entryUrlFor(appOf('env-dir'), 'prod', null)).toBe('');
    });

    it('CDN 模式：origin 未配返回空串（展示层不抛错）', () => {
      const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn' });
      expect(svc.entryUrlFor(appOf('env-dir'), 'prod', '624bfa46')).toBe('');
    });

    it('legacy 模式：env-dir 仍两跳指针 URL（零变化）', () => {
      const svc = makeSvc({});
      expect(svc.entryUrlFor(appOf('env-dir'), 'prod', '624bfa46')).toBe(
        '/static/modules/portal/prod/index.js',
      );
    });
  });

  describe('doSwitchVersion（去指针化）', () => {
    function doSwitchDeps(mode?: string) {
      const writePointer = jest.fn().mockResolvedValue({ js: '/x/index.js', css: null });
      const appRepo = {
        findOne: jest.fn().mockResolvedValue({ key: 'portal', kind: 'micro-frontend', deployMode: 'env-dir', deletedAt: null }),
      };
      const envsService = { getEnv: jest.fn().mockResolvedValue({ envId: 'prod' }) };
      const registry = {
        setAppEnvPointer: jest.fn().mockResolvedValue({ from: 'old', previous: 'prev', unchanged: false }),
      };
      const artifacts = {
        hasVersion: jest.fn().mockResolvedValue(true),
        writePointer,
        describeTarget: jest.fn(() => '本机 /x'),
      };
      const gatewayCache = { notifyVersionChange: jest.fn().mockResolvedValue(undefined) };
      const env: Record<string, string> = mode ? { CDN_LAYOUT_MODE: mode } : {};
      const svc = makeSvc(env, { appRepo, envsService, registry, artifacts, gatewayCache });
      return { svc, writePointer };
    }

    it('CDN 模式：不写磁盘指针（manifest 直接给完整 URL）', async () => {
      const { svc, writePointer } = doSwitchDeps('cdn');
      const r = (await svc.doSwitchVersion('portal', 'prod', 'new', 'op')) as {
        pointer: unknown;
      };
      expect(writePointer).not.toHaveBeenCalled();
      expect(r.pointer).toBeNull();
    });

    it('legacy 模式：仍写磁盘指针（零变化）', async () => {
      const { svc, writePointer } = doSwitchDeps();
      await svc.doSwitchVersion('portal', 'prod', 'new', 'op');
      expect(writePointer).toHaveBeenCalledWith('prod', 'portal', 'new');
    });
  });
});
