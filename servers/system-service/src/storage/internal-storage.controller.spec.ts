import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import {
  INTERNAL_STORAGE_KEYS,
  InternalStorageController,
} from './internal-storage.controller';
import {
  StorageService,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_ALLOWED_ROOTS_KEY,
  STORAGE_TEMP_DIR_KEY,
  STORAGE_UPLOAD_DIR_KEY,
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

describe('InternalStorageController（服务间读取权威存储目录）', () => {
  let tmp: string;
  let settings: ReturnType<typeof settingsStub>;
  let service: StorageService;
  let controller: InternalStorageController;
  const envBackup: Record<string, string | undefined> = {};

  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in envBackup)) envBackup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'internal-storage-')));
    // 默认允许根是家目录，而测试目录在 tmp 下 → 用白名单显式放开
    setEnv(STORAGE_ALLOWED_ROOTS_ENV, tmp);
    settings = settingsStub();
    service = new StorageService(settings as unknown as SettingsService);
    controller = new InternalStorageController(service);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('缺省（无 ?key=）→ 上传根目录，并回带 key 与 browseEnabled', async () => {
    const uploads = path.join(tmp, 'uploads');
    settings.store[STORAGE_UPLOAD_DIR_KEY] = uploads;

    const res = await controller.getPath();
    expect(res.data).toEqual({
      key: STORAGE_UPLOAD_DIR_KEY,
      path: uploads,
      source: 'system_configs',
      browseEnabled: true,
    });
  });

  it('?key=storage.temp_dir → 临时图目录', async () => {
    const temp = path.join(tmp, 'temp-configured');
    settings.store[STORAGE_UPLOAD_DIR_KEY] = path.join(tmp, 'uploads');
    settings.store[STORAGE_TEMP_DIR_KEY] = temp;

    const res = await controller.getPath(STORAGE_TEMP_DIR_KEY);
    expect(res.data.key).toBe(STORAGE_TEMP_DIR_KEY);
    expect(res.data.path).toBe(temp);
    expect(res.data.source).toBe('system_configs');
  });

  it('temp 未配 → 返回**派生默认值**且 source=default（消费侧据此判断能否接受）', async () => {
    settings.store[STORAGE_UPLOAD_DIR_KEY] = path.join(tmp, 'uploads');

    const res = await controller.getPath(STORAGE_TEMP_DIR_KEY);
    expect(res.data.path).toBe(path.join(tmp, TEMP_DIR_SEGMENT));
    expect(res.data.source).toBe('default');
  });

  describe('?key=storage.allowed_roots（R1：允许根由配置表统一下发）', () => {
    it('配置表里配了 → 回逗号分隔的允许根，source=system_configs', async () => {
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = `${tmp},${path.join(tmp, 'data')}`;

      const res = await controller.getPath(STORAGE_ALLOWED_ROOTS_KEY);
      expect(res.data.key).toBe(STORAGE_ALLOWED_ROOTS_KEY);
      expect(res.data.source).toBe('system_configs');
      // 回的是配置值本身（逗号分隔），消费侧按同一规则补上恒定的家目录
      expect(res.data.path).toBe(`${tmp},${path.join(tmp, 'data')}`);
    });

    it('配置表没配 → env 兜底，source=env（system-service 的环境变量仍在生效）', async () => {
      setEnv(STORAGE_ALLOWED_ROOTS_ENV, tmp);
      const res = await controller.getPath(STORAGE_ALLOWED_ROOTS_KEY);
      expect(res.data.source).toBe('env');
      expect(res.data.path).toBe(tmp);
    });

    it('都没配 → source=default，path 仅家目录（消费侧据此拒绝启动）', async () => {
      setEnv(STORAGE_ALLOWED_ROOTS_ENV, undefined);
      const res = await controller.getPath(STORAGE_ALLOWED_ROOTS_KEY);
      expect(res.data.source).toBe('default');
      expect(res.data.path).toBe(path.resolve(os.homedir()));
    });

    it('🔴 白名单同步新增键（否则消费侧拿到 400 才知道）', () => {
      expect([...INTERNAL_STORAGE_KEYS]).toEqual([
        STORAGE_UPLOAD_DIR_KEY,
        STORAGE_TEMP_DIR_KEY,
        STORAGE_ALLOWED_ROOTS_KEY,
      ]);
    });
  });

  it('?key= 传空串 → 回落上传根目录（trim 后为空，不算未知键）', async () => {
    settings.store[STORAGE_UPLOAD_DIR_KEY] = path.join(tmp, 'uploads');
    const res = await controller.getPath('   ');
    expect(res.data.key).toBe(STORAGE_UPLOAD_DIR_KEY);
  });

  it('未知键 → 400 STORAGE_KEY_UNSUPPORTED（配置表不能被整体暴露）', async () => {
    await expect(controller.getPath('system.some_secret')).rejects.toThrow(BadRequestException);
    await expect(controller.getPath('system.some_secret')).rejects.toMatchObject({
      response: { code: 'STORAGE_KEY_UNSUPPORTED' },
    });
  });
});
