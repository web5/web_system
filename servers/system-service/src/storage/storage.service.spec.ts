import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import {
  BROWSE_MAX_DEPTH,
  BROWSE_MAX_ENTRIES,
  DEFAULT_UPLOAD_DIR,
  StorageService,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_ALLOWED_ROOTS_KEY,
  STORAGE_BROWSE_ENABLED_KEY,
  STORAGE_TEMP_DIR_ENV,
  STORAGE_TEMP_DIR_KEY,
  STORAGE_UPLOAD_DIR_KEY,
  STORAGE_UPLOAD_DIR_ENV,
  TEMP_DIR_SEGMENT,
} from './storage.service';

/** 配置表桩：只实现本次用到的 get / getBoolean / set */
function settingsStub(init: Record<string, string> = {}) {
  const store: Record<string, string> = { ...init };
  return {
    store,
    get: jest.fn(async (key: string) => store[key] ?? null),
    getBoolean: jest.fn(async (key: string, def = false) =>
      key in store ? store[key] === '1' || store[key] === 'true' : def,
    ),
    set: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
  };
}

describe('StorageService（A2：存储配置读写 / 校验 / 安全目录浏览）', () => {
  let tmp: string;
  let settings: ReturnType<typeof settingsStub>;
  let service: StorageService;
  const envBackup: Record<string, string | undefined> = {};

  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in envBackup)) envBackup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-svc-'));
    // 默认允许根是家目录，而测试目录在 tmp 下 → 用白名单显式放开（顺带覆盖白名单能力）
    setEnv(STORAGE_ALLOWED_ROOTS_ENV, tmp);
    setEnv(STORAGE_UPLOAD_DIR_ENV, undefined);
    settings = settingsStub();
    service = new StorageService(settings as unknown as SettingsService);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('resolveConfiguredUploadDir：三级优先级（design §1.2）', () => {
    it('system_configs 优先于 env', async () => {
      const configured = path.join(tmp, 'from-db');
      settings.store[STORAGE_UPLOAD_DIR_KEY] = configured;
      setEnv(STORAGE_UPLOAD_DIR_ENV, path.join(tmp, 'from-env'));

      await expect(service.resolveConfiguredUploadDir()).resolves.toEqual({
        path: path.resolve(configured),
        source: 'system_configs',
      });
    });

    it('配置缺失 → env 兜底', async () => {
      setEnv(STORAGE_UPLOAD_DIR_ENV, path.join(tmp, 'from-env'));
      const r = await service.resolveConfiguredUploadDir();
      expect(r).toEqual({ path: path.resolve(tmp, 'from-env'), source: 'env' });
    });

    it('都没有 → 跨平台默认 ~/web_system/uploads', async () => {
      await expect(service.resolveConfiguredUploadDir()).resolves.toEqual({
        path: path.resolve(DEFAULT_UPLOAD_DIR),
        source: 'default',
      });
    });

    it('配置指向允许根之外 → 400 且带稳定错误码（穿越防护）', async () => {
      settings.store[STORAGE_UPLOAD_DIR_KEY] = '/etc';
      await expect(service.resolveConfiguredUploadDir()).rejects.toThrow(BadRequestException);
      await expect(service.resolveConfiguredUploadDir()).rejects.toMatchObject({
        response: { code: 'UPLOAD_DIR_OUT_OF_SCOPE' },
      });
    });
  });

  describe('resolveConfiguredTempDir：三级优先级 + 派生默认', () => {
    /** 上传根目录固定为 <tmp>/uploads，则派生默认 = <tmp>/temp-images（**同级**，不是 uploads 之下） */
    const uploads = () => path.join(tmp, 'uploads');

    beforeEach(() => {
      setEnv(STORAGE_TEMP_DIR_ENV, undefined);
      settings.store[STORAGE_UPLOAD_DIR_KEY] = uploads();
    });

    it('配置键优先 → source=system_configs，且标记为「已显式配置」', async () => {
      const configured = path.join(tmp, 'temp-from-db');
      settings.store[STORAGE_TEMP_DIR_KEY] = configured;

      await expect(service.resolveConfiguredTempDir()).resolves.toEqual({
        path: path.resolve(configured),
        source: 'system_configs',
        configured: true,
        derivedBase: null,
      });
    });

    it('配置缺失 → env 兜底（source=env，仍算「未显式配置」）', async () => {
      setEnv(STORAGE_TEMP_DIR_ENV, path.join(tmp, 'temp-from-env'));
      const r = await service.resolveConfiguredTempDir();
      expect(r.path).toBe(path.resolve(tmp, 'temp-from-env'));
      expect(r.source).toBe('env');
      expect(r.configured).toBe(false);
      expect(r.derivedBase).toBe(path.dirname(uploads()));
    });

    it('都没配 → 派生默认 = 上传根目录的**同级** temp-images', async () => {
      const r = await service.resolveConfiguredTempDir();
      expect(r).toEqual({
        path: path.join(tmp, TEMP_DIR_SEGMENT),
        source: 'default',
        configured: false,
        derivedBase: tmp,
      });
    });

    it('未配置时派生默认随上传根目录变化（页面必须显示「未配置」的原因）', async () => {
      const before = await service.resolveConfiguredTempDir();
      const newUploads = path.join(tmp, 'data', 'uploads');
      settings.store[STORAGE_UPLOAD_DIR_KEY] = newUploads;
      const after = await service.resolveConfiguredTempDir();

      expect(before.path).toBe(path.join(tmp, TEMP_DIR_SEGMENT));
      expect(after.path).toBe(path.join(tmp, 'data', TEMP_DIR_SEGMENT));
      // 显式配过之后就不再跟着变
      settings.store[STORAGE_TEMP_DIR_KEY] = path.join(tmp, 'pinned');
      settings.store[STORAGE_UPLOAD_DIR_KEY] = uploads();
      const pinned = await service.resolveConfiguredTempDir();
      expect(pinned.path).toBe(path.resolve(tmp, 'pinned'));
      expect(pinned.configured).toBe(true);
    });

    it('配置指向允许根之外 → 400 且带稳定错误码（与上传目录同一套穿越防护）', async () => {
      settings.store[STORAGE_TEMP_DIR_KEY] = '/etc';
      await expect(service.resolveConfiguredTempDir()).rejects.toMatchObject({
        response: { code: 'UPLOAD_DIR_OUT_OF_SCOPE' },
      });
    });
  });

  describe('setTempDir：写入权威临时图目录', () => {
    it('写 storage.temp_dir（只写配置，不碰文件系统）', async () => {
      const target = path.join(tmp, 'temp-written');
      await service.setTempDir(target);
      expect(settings.set).toHaveBeenCalledWith(STORAGE_TEMP_DIR_KEY, target);
      expect(fs.existsSync(target)).toBe(false);
    });
  });

  describe('允许根白名单（R1：收归配置表 storage.allowed_roots）', () => {
    it('配置表优先 → source=system_configs，家目录恒定在列', async () => {
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = path.join(tmp, 'data');
      setEnv(STORAGE_ALLOWED_ROOTS_ENV, path.join(tmp, 'from-env'));

      const r = await service.resolveConfiguredAllowedRoots();
      expect(r.roots).toContain(path.resolve(path.join(tmp, 'data')));
      expect(r.roots).not.toContain(path.resolve(path.join(tmp, 'from-env')));
      expect(r.roots).toContain(path.resolve(os.homedir()));
      expect(r.source).toBe('system_configs');
      // 内部接口回传的是逗号分隔串，消费侧能原样还原（家目录由消费侧按同一规则补）
      expect(r.path).toBe(path.join(tmp, 'data'));
      expect([...new Set([path.resolve(os.homedir()), ...r.path.split(',')])]).toEqual(r.roots);
    });

    it('配置缺失 → env 兜底（source=env）', async () => {
      setEnv(STORAGE_ALLOWED_ROOTS_ENV, tmp);
      const r = await service.resolveConfiguredAllowedRoots();
      expect(r.roots).toContain(tmp);
      expect(r.source).toBe('env');
    });

    it('都没有 → 仅家目录（source=default）', async () => {
      setEnv(STORAGE_ALLOWED_ROOTS_ENV, undefined);
      const r = await service.resolveConfiguredAllowedRoots();
      expect(r.roots).toEqual([path.resolve(os.homedir())]);
      expect(r.source).toBe('default');
    });

    it('🔴 allowedRoots() 跟随配置表（判据不再写死在 .env 里）', async () => {
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = path.join(tmp, 'data');
      await expect(service.allowedRoots()).resolves.toContain(
        path.resolve(path.join(tmp, 'data')),
      );
    });

    it('🔴 允许根收窄 → 已配置的目录会被判越界（越界校验真的按新根走）', async () => {
      // prod 事故形态：允许根是 <root>/uploads（窄），而上传目录在 <root>/data 下
      settings.store[STORAGE_UPLOAD_DIR_KEY] = path.join(tmp, 'data', 'uploads');
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = path.join(tmp, 'uploads');
      await expect(service.resolveConfiguredUploadDir()).rejects.toMatchObject({
        response: { code: 'UPLOAD_DIR_OUT_OF_SCOPE' },
      });
    });

    it('允许根覆盖得住 → 正常解析（放宽后同一份配置就合法了）', async () => {
      settings.store[STORAGE_UPLOAD_DIR_KEY] = path.join(tmp, 'data', 'uploads');
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = tmp;
      await expect(service.resolveConfiguredUploadDir()).resolves.toEqual({
        path: path.join(tmp, 'data', 'uploads'),
        source: 'system_configs',
      });
    });

    describe('checkAllowedRoots：保存前置校验', () => {
      it('空值 → ALLOWED_ROOTS_EMPTY（空白名单等于把所有目录判越界）', async () => {
        const check = await service.checkAllowedRoots('  ,  ');
        expect(check.ok).toBe(false);
        expect(check.code).toBe('ALLOWED_ROOTS_EMPTY');
      });

      it('正常 → ok，且 roots 不含家目录（家目录恒定在列，不需要落库）', async () => {
        const check = await service.checkAllowedRoots(`${path.join(tmp, 'a')},${tmp}`);
        expect(check.ok).toBe(true);
        expect(check.roots).toEqual([path.join(tmp, 'a'), tmp]);
        expect(check.roots).not.toContain(path.resolve(os.homedir()));
      });

      /** 🔴 prod 事故复发防护：允许根比别处窄 → 已配置目录下次启动被判越界 */
      it('🔴 收窄到不含已配置目录 → ALLOWED_ROOTS_EXCLUDE_CONFIGURED_DIRS', async () => {
        const configured = path.join(tmp, 'uploads');
        const check = await service.checkAllowedRoots(path.join(tmp, 'elsewhere'), [
          configured,
        ]);
        expect(check.ok).toBe(false);
        expect(check.code).toBe('ALLOWED_ROOTS_EXCLUDE_CONFIGURED_DIRS');
        expect(check.message).toContain(configured);
      });

      it('覆盖得住 → ok（含家目录这一恒定根）', async () => {
        const check = await service.checkAllowedRoots(tmp, [path.join(tmp, 'uploads')]);
        expect(check.ok).toBe(true);
      });
    });

    it('setAllowedRoots：逗号分隔写入 storage.allowed_roots', async () => {
      await service.setAllowedRoots([path.join(tmp, 'a'), tmp]);
      expect(settings.set).toHaveBeenCalledWith(
        STORAGE_ALLOWED_ROOTS_KEY,
        `${path.join(tmp, 'a')},${tmp}`,
      );
    });
  });

  describe('checkStorageDir：保存前校验（不抛异常，回报 ok/code）', () => {
    it('存在且可写 → ok，并给出剩余空间', async () => {
      const dir = path.join(tmp, 'ok');
      fs.mkdirSync(dir);
      const check = await service.checkStorageDir(dir);
      expect(check.ok).toBe(true);
      expect(check.resolvedPath).toBe(dir);
      expect(check.writable).toBe(true);
      // 探测用的临时文件必须清干净（不能在上传根里留垃圾）
      expect(fs.readdirSync(dir)).toEqual([]);
      expect(check.freeSpace === null || check.freeSpace > 0).toBe(true);
    });

    it('不存在 + create=true → 自动创建并判定可写', async () => {
      const dir = path.join(tmp, 'brand-new', 'nested');
      const check = await service.checkStorageDir(dir, { create: true });
      expect(check.ok).toBe(true);
      expect(check.created).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('不存在 + create=false（纯校验）→ ok=false 且不创建', async () => {
      const dir = path.join(tmp, 'not-yet');
      const check = await service.checkStorageDir(dir, { create: false });
      expect(check.ok).toBe(false);
      expect(check.exists).toBe(false);
      expect(fs.existsSync(dir)).toBe(false);
      expect(check.message).toContain('目录不存在');
    });

    it('路径越界 → ok=false + UPLOAD_DIR_OUT_OF_SCOPE（不抛异常）', async () => {
      const check = await service.checkStorageDir('/etc');
      expect(check.ok).toBe(false);
      expect(check.code).toBe('UPLOAD_DIR_OUT_OF_SCOPE');
      expect(check.resolvedPath).toBeNull();
    });

    it('路径是文件 → 明确报「不是目录」', async () => {
      const file = path.join(tmp, 'a-file');
      fs.writeFileSync(file, 'x');
      const check = await service.checkStorageDir(file);
      expect(check.ok).toBe(false);
      expect(check.code).toBe('UPLOAD_DIR_NOT_DIRECTORY');
    });

    it('目录不可写（0500）→ ok=false + UPLOAD_DIR_NOT_WRITABLE', async () => {
      if (process.getuid && process.getuid() === 0) return; // root 无视权限位
      const dir = path.join(tmp, 'readonly');
      fs.mkdirSync(dir, { mode: 0o500 });
      const check = await service.checkStorageDir(dir);
      expect(check.ok).toBe(false);
      expect(check.code).toBe('UPLOAD_DIR_NOT_WRITABLE');
    });
  });

  describe('browse：安全目录浏览（design §1.5，逐条约束）', () => {
    it('只列目录、不列文件；文件不出现在结果里', async () => {
      fs.mkdirSync(path.join(tmp, 'dir-a'));
      fs.mkdirSync(path.join(tmp, 'dir-b'));
      fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top-secret');

      const r = await service.browse(tmp);
      expect(r.entries.map((e) => e.name)).toEqual(['dir-a', 'dir-b']);
      expect(r.path).toBe(tmp);
      expect(r.depth).toBe(0);
      expect(r.parent).toBeNull();
      // 不返回文件内容/文件项
      expect(JSON.stringify(r)).not.toContain('secret.txt');
      expect(JSON.stringify(r)).not.toContain('top-secret');
    });

    it('越界请求直接拒绝（不返回部分结果）', async () => {
      await expect(service.browse('/etc')).rejects.toThrow(BadRequestException);
      await expect(service.browse('/etc')).rejects.toMatchObject({
        response: { code: 'UPLOAD_DIR_OUT_OF_SCOPE' },
      });
    });

    it('关闭开关（storage.browse_enabled=0）→ 403', async () => {
      settings.store[STORAGE_BROWSE_ENABLED_KEY] = '0';
      await expect(service.browse(tmp)).rejects.toThrow(ForbiddenException);
    });

    it('层级超限 → 400 BROWSE_DEPTH_EXCEEDED', async () => {
      const deep = path.join(tmp, ...Array.from({ length: BROWSE_MAX_DEPTH + 1 }, (_, i) => `l${i}`));
      fs.mkdirSync(deep, { recursive: true });
      await expect(service.browse(deep)).rejects.toMatchObject({
        response: { code: 'BROWSE_DEPTH_EXCEEDED' },
      });
    });

    it('条数超上限 → 截断并置 truncated（按名称稳定排序）', async () => {
      for (let i = 0; i < BROWSE_MAX_ENTRIES + 5; i++) {
        fs.mkdirSync(path.join(tmp, `d-${String(i).padStart(3, '0')}`));
      }
      const r = await service.browse(tmp);
      expect(r.entries).toHaveLength(BROWSE_MAX_ENTRIES);
      expect(r.truncated).toBe(true);
      expect(r.entries[0].name).toBe('d-000');
    });

    it('符号链接指向允许根之外 → 跳过该条目（不解链到根外）', async () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-outside-'));
      const linked = path.join(tmp, 'link-outside');
      fs.symlinkSync(outside, linked);
      fs.mkdirSync(path.join(tmp, 'real-dir'));

      const r = await service.browse(tmp);
      expect(r.entries.map((e) => e.name)).toEqual(['real-dir']);
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('符号链接指向允许根之内 → 保留并标记 symlink', async () => {
      fs.mkdirSync(path.join(tmp, 'target'));
      fs.symlinkSync(path.join(tmp, 'target'), path.join(tmp, 'link-in'));

      const r = await service.browse(tmp);
      const names = r.entries.map((e) => e.name).sort();
      expect(names).toEqual(['link-in', 'target']);
      expect(r.entries.find((e) => e.name === 'link-in')?.symlink).toBe(true);
    });

    it('缺省 path → 落到第一个允许根（家目录白名单之外也要能列）', async () => {
      const r = await service.browse();
      expect(r.path).toBe(path.resolve(os.homedir()));
      expect(r.parent).toBeNull();
    });

    it('目录不存在 → 404 语义（BROWSE_NOT_FOUND）', async () => {
      await expect(service.browse(path.join(tmp, 'ghost'))).rejects.toMatchObject({
        response: { code: 'BROWSE_NOT_FOUND' },
      });
    });
  });

  /**
   * 拍板第 4 项：`GET /api/admin/settings/storage` 要能拿到「当前生效目录」。
   * 前端不持内部密钥，所以由 system-service 代问 upload-service 的 `/internal/storage/path`；
   * **取不到一律降级为 null**（它是增强信息，不能拖垮读配置）。
   */
  describe('fetchEffectiveUploadDir：代问 upload-service 的当前生效值', () => {
    const okFetch = (payload: unknown) =>
      jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => payload,
      })) as unknown as jest.MockedFunction<typeof fetch>;

    it('取到 → 返回 path/source/startedAt，并带上 x-internal-key', async () => {
      const fetchImpl = okFetch({
        code: 0,
        data: {
          path: '/Users/geekwen/web_system/uploads',
          source: 'system_service',
          startedAt: '2026-09-22T06:58:02.791Z',
        },
      });

      const r = await service.fetchEffectiveUploadDir({
        baseUrl: 'http://127.0.0.1:6008/',
        internalKey: 'k',
        fetchImpl,
      });

      expect(r).toEqual({
        path: '/Users/geekwen/web_system/uploads',
        source: 'system_service',
        startedAt: '2026-09-22T06:58:02.791Z',
      });
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:6008/internal/storage/path', {
        headers: { 'x-internal-key': 'k' },
        signal: expect.anything(),
      });
    });

    it('未配内部密钥 → 直接返回 null（不发请求）', async () => {
      const fetchImpl = okFetch({ data: { path: '/x' } });
      const r = await service.fetchEffectiveUploadDir({
        internalKey: '',
        env: {},
        fetchImpl,
      });
      expect(r).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('服务返回非 2xx（401/500）→ null', async () => {
      const fetchImpl = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      })) as unknown as jest.MockedFunction<typeof fetch>;
      await expect(
        service.fetchEffectiveUploadDir({ internalKey: 'k', fetchImpl }),
      ).resolves.toBeNull();
    });

    it('连接失败 / 超时 → null（降级，不抛）', async () => {
      const fetchImpl = jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as jest.MockedFunction<typeof fetch>;
      await expect(
        service.fetchEffectiveUploadDir({ internalKey: 'k', fetchImpl }),
      ).resolves.toBeNull();

      const abortImpl = jest.fn(
        async (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              rej(e);
            });
          }),
      ) as unknown as jest.MockedFunction<typeof fetch>;
      await expect(
        service.fetchEffectiveUploadDir({ internalKey: 'k', timeoutMs: 10, fetchImpl: abortImpl }),
      ).resolves.toBeNull();
    });

    it('响应形状不对（无 path）→ null', async () => {
      const fetchImpl = okFetch({ code: 0, data: {} });
      await expect(
        service.fetchEffectiveUploadDir({ internalKey: 'k', fetchImpl }),
      ).resolves.toBeNull();
    });

    it('未配 UPLOAD_SERVICE_URL 时回落 SERVICE_URL_DEFAULTS.upload', async () => {
      const fetchImpl = okFetch({ data: { path: '/x' } });
      await service.fetchEffectiveUploadDir({ internalKey: 'k', env: {}, fetchImpl });
      expect(fetchImpl).toHaveBeenCalledWith(
        'http://localhost:6008/internal/storage/path',
        expect.anything(),
      );
    });
  });
});
