import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { StorageController } from './storage.controller';
import {
  StorageService,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_ALLOWED_ROOTS_KEY,
  STORAGE_TEMP_DIR_ENV,
  STORAGE_TEMP_DIR_KEY,
  STORAGE_UPLOAD_DIR_ENV,
  STORAGE_UPLOAD_DIR_KEY,
  TEMP_DIR_SEGMENT,
} from './storage.service';

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

function logsStub() {
  return { log: jest.fn(async () => undefined) } as unknown as OperationLogsService;
}

/** 最小请求桩：只带 auditContext / hasPermission 用到的字段 */
function reqStub(roles: string[] = ['super_admin']): never {
  return { user: { roles, username: 'tester' }, headers: {}, ip: '127.0.0.1' } as never;
}

describe('StorageController（系统管理页面：读 / 校验 / 保存）', () => {
  let tmp: string;
  let settings: ReturnType<typeof settingsStub>;
  let service: StorageService;
  let logs: OperationLogsService;
  let controller: StorageController;
  const envBackup: Record<string, string | undefined> = {};

  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in envBackup)) envBackup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'storage-ctrl-')));
    setEnv(STORAGE_ALLOWED_ROOTS_ENV, tmp);
    setEnv(STORAGE_UPLOAD_DIR_ENV, undefined);
    setEnv(STORAGE_TEMP_DIR_ENV, undefined);
    settings = settingsStub();
    service = new StorageService(settings as unknown as SettingsService);
    logs = logsStub();
    controller = new StorageController(service, logs);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('GET：临时图目录与上传目录一并回给页面', () => {
    it('temp 未配 → 回派生默认值并标 configured=false', async () => {
      const uploads = path.join(tmp, 'uploads');
      settings.store[STORAGE_UPLOAD_DIR_KEY] = uploads;

      const res = await controller.getConfig(reqStub());
      expect(res.data.tempDir).toBe(path.join(tmp, TEMP_DIR_SEGMENT));
      expect(res.data.tempSource).toBe('default');
      expect(res.data.tempConfigured).toBe(false);
      // 「使用默认目录」按钮填的就是它 —— 必须等于当前生效的 tempDir
      expect(res.data.defaultTempDir).toBe(res.data.tempDir);
      expect(res.data.tempEnvOverride).toBe(false);
    });

    it('temp 已配 → configured=true，defaultTempDir 仍给出派生值（便于回退）', async () => {
      const uploads = path.join(tmp, 'uploads');
      settings.store[STORAGE_UPLOAD_DIR_KEY] = uploads;
      settings.store[STORAGE_TEMP_DIR_KEY] = path.join(tmp, 'temp-pinned');

      const res = await controller.getConfig(reqStub());
      expect(res.data.tempDir).toBe(path.join(tmp, 'temp-pinned'));
      expect(res.data.tempConfigured).toBe(true);
      expect(res.data.defaultTempDir).toBe(path.join(tmp, TEMP_DIR_SEGMENT));
    });

    it('允许根回给页面，并说清它从哪来（配置表 / env 兜底）', async () => {
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = tmp;
      const res = await controller.getConfig(reqStub());
      expect(res.data.allowedRoots).toContain(tmp);
      expect(res.data.allowedRootsSource).toBe('system_configs');
      // system-service 的 env 里也有一份 → 页面要提示「改了配置中心可能不生效」
      expect(res.data.allowedRootsEnvOverride).toBe(true);
    });

    it('允许根没配 → source=default（页面提示「没人配过」）', async () => {
      setEnv(STORAGE_ALLOWED_ROOTS_ENV, undefined);
      const res = await controller.getConfig(reqStub());
      expect(res.data.allowedRootsSource).toBe('default');
      expect(res.data.allowedRootsEnvOverride).toBe(false);
    });
  });

  describe('PUT：两个目录一起保存，且不允许「改了一半」', () => {
    it('只带 uploadDir → 不写 temp 键（保持未配置）', async () => {
      const uploads = path.join(tmp, 'uploads');
      const res = await controller.save({ uploadDir: uploads }, reqStub());
      expect(res.data.uploadDir).toBe(uploads);
      expect(res.data.tempDir).toBeUndefined();
      expect(settings.store[STORAGE_TEMP_DIR_KEY]).toBeUndefined();
      expect(settings.set).toHaveBeenCalledTimes(1);
    });

    it('带 tempDir → 两个键都写，审计日志记录两处变更', async () => {
      const res = await controller.save(
        { uploadDir: path.join(tmp, 'uploads'), tempDir: path.join(tmp, 'temp') },
        reqStub(),
      );
      expect(res.data.tempDir).toBe(path.join(tmp, 'temp'));
      expect(settings.store[STORAGE_UPLOAD_DIR_KEY]).toBe(path.join(tmp, 'uploads'));
      expect(settings.store[STORAGE_TEMP_DIR_KEY]).toBe(path.join(tmp, 'temp'));
      expect((logs.log as unknown as jest.Mock).mock.calls[0][0].target).toContain('临时图目录');
    });

    it('temp 校验失败 → 上传目录**也不落库**（先全校验再写，杜绝半改）', async () => {
      await expect(
        controller.save({ uploadDir: path.join(tmp, 'uploads'), tempDir: '/etc' }, reqStub()),
      ).rejects.toMatchObject({ response: { code: 'UPLOAD_DIR_OUT_OF_SCOPE' } });
      expect(settings.set).not.toHaveBeenCalled();
      expect(settings.store[STORAGE_UPLOAD_DIR_KEY]).toBeUndefined();
    });

    it('tempDir 传空串 → 视为「未提交」，不改动已有配置', async () => {
      settings.store[STORAGE_TEMP_DIR_KEY] = path.join(tmp, 'keep-me');
      const res = await controller.save(
        { uploadDir: path.join(tmp, 'uploads'), tempDir: '' },
        reqStub(),
      );
      expect(res.data.tempDir).toBeUndefined();
      expect(settings.store[STORAGE_TEMP_DIR_KEY]).toBe(path.join(tmp, 'keep-me'));
    });

    it('保存成功仍必须回 restartRequired=true（重启才生效）', async () => {
      const res = await controller.save({ uploadDir: path.join(tmp, 'uploads') }, reqStub());
      expect(res.data.restartRequired).toBe(true);
    });

    it('带 allowedRoots → 一起落库，审计日志记录', async () => {
      const res = await controller.save(
        { uploadDir: path.join(tmp, 'uploads'), allowedRoots: tmp },
        reqStub(),
      );
      expect(res.data.allowedRoots).toBe(tmp);
      expect(settings.store[STORAGE_ALLOWED_ROOTS_KEY]).toBe(tmp);
      expect((logs.log as unknown as jest.Mock).mock.calls[0][0].target).toContain('允许根');
    });

    it('allowedRoots 传空串 → 视为「未提交」，不改动已有配置', async () => {
      settings.store[STORAGE_ALLOWED_ROOTS_KEY] = tmp;
      const res = await controller.save(
        { uploadDir: path.join(tmp, 'uploads'), allowedRoots: '' },
        reqStub(),
      );
      expect(res.data.allowedRoots).toBeUndefined();
      expect(settings.store[STORAGE_ALLOWED_ROOTS_KEY]).toBe(tmp);
    });

    /** 🔴 prod 事故防护：允许根收窄到不含已配置目录 → 不落库（否则下次启动全员越界） */
    it('🔴 allowedRoots 收窄 → 400，上传目录也不落库', async () => {
      await expect(
        controller.save(
          { uploadDir: path.join(tmp, 'uploads'), allowedRoots: path.join(tmp, 'elsewhere') },
          reqStub(),
        ),
      ).rejects.toMatchObject({ response: { code: 'ALLOWED_ROOTS_EXCLUDE_CONFIGURED_DIRS' } });
      expect(settings.set).not.toHaveBeenCalled();
      expect(settings.store[STORAGE_UPLOAD_DIR_KEY]).toBeUndefined();
    });
  });

  describe('POST validate：可选校验临时图目录', () => {
    it('带 tempDir → 回两份校验结果（形状与上传目录一致）', async () => {
      const res = await controller.validate({
        uploadDir: path.join(tmp, 'a'),
        tempDir: path.join(tmp, 'b'),
      });
      expect(res.data.exists).toBe(false);
      expect(res.data.tempDir?.message).toContain('目录不存在');
      // 只校验不创建
      expect(fs.existsSync(path.join(tmp, 'a'))).toBe(false);
      expect(fs.existsSync(path.join(tmp, 'b'))).toBe(false);
    });

    it('不带 tempDir → 不返回 tempDir 字段（前端据此不展示）', async () => {
      const res = await controller.validate({ uploadDir: path.join(tmp, 'a') });
      expect(res.data.tempDir).toBeUndefined();
    });

    it('temp 越界 → 校验结果带 OUT_OF_SCOPE，不抛异常', async () => {
      const res = await controller.validate({
        uploadDir: path.join(tmp, 'a'),
        tempDir: '/etc',
      });
      expect(res.data.tempDir?.ok).toBe(false);
      expect(res.data.tempDir?.code).toBe('UPLOAD_DIR_OUT_OF_SCOPE');
    });
  });

  it('无 storage:browse 权限的用户 → canBrowse=false（后端判定，不由前端猜角色）', async () => {
    const res = await controller.getConfig(reqStub(['operator']));
    expect(res.data.canBrowse).toBe(false);
  });

  it('保存越界的上传目录 → 400（校验是保存的前置门）', async () => {
    await expect(controller.save({ uploadDir: '/etc' }, reqStub())).rejects.toThrow(
      BadRequestException,
    );
  });
});
