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
  STORAGE_BROWSE_ENABLED_KEY,
  STORAGE_UPLOAD_DIR_KEY,
  STORAGE_UPLOAD_DIR_ENV,
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
});
