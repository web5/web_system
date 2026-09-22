import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  allowedRoots,
  DEFAULT_UPLOAD_DIR,
  ensureWritableDir,
  fetchConfiguredUploadDir,
  INTERNAL_API_KEY_ENV,
  resolveUploadDirAtStartup,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_UPLOAD_DIR_ENV,
  SYSTEM_SERVICE_URL_ENV,
} from './upload-dir';

/** 构造一个只回答 `/internal/storage/path` 的 fetch 桩 */
function fetchStub(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return jest.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  })) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('upload-dir：上传根目录三级解析 + 启动自检（A3 / design §1.2）', () => {
  let tmp: string;
  const env: NodeJS.ProcessEnv = {};

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-dir-'));
    // 独立的 env 对象：不污染真实 process.env；允许根指向 tmp 以便越界/白名单用例
    for (const k of [
      STORAGE_UPLOAD_DIR_ENV,
      STORAGE_ALLOWED_ROOTS_ENV,
      INTERNAL_API_KEY_ENV,
      SYSTEM_SERVICE_URL_ENV,
    ]) {
      delete env[k];
    }
    env[STORAGE_ALLOWED_ROOTS_ENV] = tmp;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('允许根 = 家目录 + 白名单（去重）', () => {
    const roots = allowedRoots(env);
    expect(roots).toContain(path.resolve(os.homedir()));
    expect(roots).toContain(tmp);
  });

  describe('resolveUploadDirAtStartup：system_configs → env → 默认', () => {
    it('取到系统配置 → 用它（优先级最高），并忽略 env', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      const fetchImpl = fetchStub({
        data: { path: path.join(tmp, 'from-config'), source: 'system_configs' },
      });

      const r = await resolveUploadDirAtStartup({ env, fetchImpl });
      expect(r.dir).toBe(path.join(tmp, 'from-config'));
      expect(r.source).toBe('system_service');
      // 来源必须说清「配置表里设了值」还是「上游落到了默认」，否则运维会误判
      expect(r.notes[0]).toContain('配置表 storage.upload_dir');
    });

    it('上游是默认值/环境变量时，notes 如实注明（不谎报成「有人在配置中心设过」）', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';

      const asDefault = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({ data: { path: path.join(tmp, 'd'), source: 'default' } }),
      });
      expect(asDefault.source).toBe('system_service');
      expect(asDefault.notes[0]).toContain('默认值');

      const asEnv = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({ data: { path: path.join(tmp, 'd'), source: 'env' } }),
      });
      expect(asEnv.notes[0]).toContain('system-service 的环境变量');
    });

    it('接口 500 / 网络异常 → 回落 env', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');

      const r500 = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({}, { ok: false, status: 500 }),
      });
      expect(r500.source).toBe('env');
      expect(r500.dir).toBe(path.join(tmp, 'from-env'));
      expect(r500.notes[0]).toContain('500');

      const rThrow = await resolveUploadDirAtStartup({
        env,
        fetchImpl: jest.fn(async () => {
          throw new Error('ECONNREFUSED');
        }) as unknown as jest.MockedFunction<typeof fetch>,
      });
      expect(rThrow.source).toBe('env');
      expect(rThrow.notes[0]).toContain('ECONNREFUSED');
    });

    it('未配内部密钥 → 直接跳过系统配置（不发请求），回落 env', async () => {
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      const fetchImpl = fetchStub({ data: { path: path.join(tmp, 'never') } });

      const r = await resolveUploadDirAtStartup({ env, fetchImpl });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(r.source).toBe('env');
      expect(r.notes[0]).toContain(INTERNAL_API_KEY_ENV);
    });

    it('系统配置越界（允许根之外）→ 忽略并回落，notes 说明原因', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      const r = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({ data: { path: '/etc' } }),
      });
      expect(r.source).toBe('default');
      expect(r.dir).toBe(path.resolve(DEFAULT_UPLOAD_DIR));
      expect(r.notes[0]).toContain('已忽略并回落');
    });

    it('都没有 → 跨平台默认 ~/web_system/uploads（notes 说明为何没查配置）', async () => {
      const r = await resolveUploadDirAtStartup({ env, fetchImpl: fetchStub({}) });
      expect(r.dir).toBe(path.resolve(DEFAULT_UPLOAD_DIR));
      expect(r.source).toBe('default');
      expect(r.notes.join()).toContain(INTERNAL_API_KEY_ENV);
    });

    it('env 兜底值也受允许根约束（越界即抛，不静默接受）', async () => {
      env[STORAGE_UPLOAD_DIR_ENV] = '/etc';
      await expect(resolveUploadDirAtStartup({ env })).rejects.toThrow(/越界/);
    });

    it('超时 → 报 AbortError 语义并回落', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      const fetchImpl = jest.fn(
        async (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ) as unknown as jest.MockedFunction<typeof fetch>;

      const r = await resolveUploadDirAtStartup({ env, fetchImpl, timeoutMs: 10 });
      expect(r.source).toBe('env');
      expect(r.notes[0]).toContain('查询超时');
    });

    it('fetchConfiguredUploadDir 用 x-internal-key 请求 system-service', async () => {
      env[INTERNAL_API_KEY_ENV] = 'secret-key';
      env[SYSTEM_SERVICE_URL_ENV] = 'http://127.0.0.1:6004/';
      const fetchImpl = fetchStub({ data: { path: path.join(tmp, 'cfg') } });

      await fetchConfiguredUploadDir({ env, fetchImpl });
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:6004/internal/storage/path', {
        headers: { 'x-internal-key': 'secret-key' },
        signal: expect.anything(),
      });
    });
  });

  describe('ensureWritableDir：fail-fast 的最后一道防线', () => {
    it('目录不存在 → 递归创建', () => {
      const dir = path.join(tmp, 'a', 'b');
      ensureWritableDir(dir);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('不可写 → 抛出带原因的错误（不静默回落）', () => {
      if (process.getuid && process.getuid() === 0) return; // root 无视权限位
      const dir = path.join(tmp, 'readonly');
      fs.mkdirSync(dir, { mode: 0o500 });
      expect(() => ensureWritableDir(dir)).toThrow(/不可写/);
    });

    it('路径是文件 → 抛出「不是目录」', () => {
      const file = path.join(tmp, 'file');
      fs.writeFileSync(file, 'x');
      expect(() => ensureWritableDir(file)).toThrow(/不是目录/);
    });

    it('探测用的临时文件会被删掉（不在上传根里留垃圾）', () => {
      const dir = path.join(tmp, 'clean');
      ensureWritableDir(dir);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
});
