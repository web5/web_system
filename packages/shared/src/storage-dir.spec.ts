import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeployModeError } from './deploy-mode';
import {
  allowedRoots,
  DEFAULT_STORAGE_BASE,
  ensureWritableDir,
  fetchConfiguredDir,
  INTERNAL_API_KEY_ENV,
  resolveStorageDirAtStartup,
  resolveUploadDirAtStartup,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_UPLOAD_DIR_ENV,
  SYSTEM_SERVICE_URL_ENV,
  UPLOAD_DIR_SPEC,
  WEB_SYSTEM_DIR_ENV,
} from './storage-dir';

/** 构造一个只回答 `/internal/storage/path` 的 fetch 桩 */
function fetchStub(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return jest.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  })) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('storage-dir：数据目录解析（形态分派 + 启动自检）', () => {
  let tmp: string;
  const env: NodeJS.ProcessEnv = {};

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-dir-'));
    for (const k of [
      STORAGE_UPLOAD_DIR_ENV,
      STORAGE_ALLOWED_ROOTS_ENV,
      INTERNAL_API_KEY_ENV,
      SYSTEM_SERVICE_URL_ENV,
      WEB_SYSTEM_DIR_ENV,
      'DEPLOY_MODE',
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

  describe('cluster 形态：系统表唯一权威，拿不到即拒绝启动', () => {
    it('取到系统配置 → 用它（忽略 env），并说清来自配置表', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      const fetchImpl = fetchStub({
        data: { path: path.join(tmp, 'from-config'), source: 'system_configs' },
      });

      const r = await resolveUploadDirAtStartup({ env, fetchImpl });
      expect(r.dir).toBe(path.join(tmp, 'from-config'));
      expect(r.source).toBe('system_service');
      expect(r.mode).toBe('cluster');
      // 来源必须说清「配置表里设了值」还是「上游落到了默认」，否则运维会误判
      expect(r.notes.join()).toContain('配置表 storage.upload_dir');
    });

    it('权威源是 system-service 的 env（有人配过）→ 通过，notes 如实注明', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      const r = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({ data: { path: path.join(tmp, 'd'), source: 'env' } }),
      });
      expect(r.source).toBe('system_service');
      expect(r.notes.join()).toContain('system-service 的环境变量');
    });

    /**
     * 🔴 D3：原断言是「上游默认值 → notes 注明后照样采用」。
     * 现契约：**拒绝启动**。放行等于让集群全员静默使用单机默认路径（数据分裂）。
     */
    it('权威源是平台默认值 → 拒绝启动（不谎报成「有人在配置中心设过」）', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      await expect(
        resolveUploadDirAtStartup({
          env,
          fetchImpl: fetchStub({ data: { path: path.join(tmp, 'd'), source: 'default' } }),
        }),
      ).rejects.toThrow(/数据分裂/);
    });

    /**
     * 🔴 D2：原断言是「接口 500 / 网络异常 → 回落 env」。
     * 现契约：**拒绝启动**。cluster 链上没有「掉到单机路径」这条路。
     */
    it('接口 500 → 拒绝启动，并把 500 说进原因里', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      await expect(
        resolveUploadDirAtStartup({ env, fetchImpl: fetchStub({}, { ok: false, status: 500 }) }),
      ).rejects.toThrow(DeployModeError);
    });

    it('网络异常（ECONNREFUSED）→ 拒绝启动，不回落', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      await expect(
        resolveUploadDirAtStartup({
          env,
          fetchImpl: jest.fn(async () => {
            throw new Error('ECONNREFUSED');
          }) as unknown as jest.MockedFunction<typeof fetch>,
        }),
      ).rejects.toThrow(/不允许回落/);
    });

    /** 🔴 D2：未配内部密钥 = 集群形态下根本没打算查配置 → 拒绝启动（原为「跳过并回落 env」） */
    it('未配内部密钥 → 拒绝启动（cluster 形态不允许靠单机路径兜底）', async () => {
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      const fetchImpl = fetchStub({ data: { path: path.join(tmp, 'never') } });
      await expect(resolveUploadDirAtStartup({ env, fetchImpl })).rejects.toThrow(
        DeployModeError,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    /** 🔴 D2：超时 = 拿不到权威值（原为「报超时后回落 env」） */
    it('查询超时 → 拒绝启动，原因含「查询超时」', async () => {
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

      await expect(
        resolveUploadDirAtStartup({ env, fetchImpl, timeoutMs: 10 }),
      ).rejects.toThrow(/不允许回落/);
    });

    /** 原断言「越界 → 忽略并回落默认」改为：**越界即拒绝**，非法配置不能被静默接受 */
    it('系统配置越界（允许根之外）→ 拒绝启动', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      await expect(
        resolveUploadDirAtStartup({ env, fetchImpl: fetchStub({ data: { path: '/etc' } }) }),
      ).rejects.toThrow();
    });

    it('拒绝启动的报错给出两条修复路径（补配置 / 声明 standalone）', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      await expect(
        resolveUploadDirAtStartup({ env, fetchImpl: fetchStub({}, { ok: false, status: 500 }) }),
      ).rejects.toThrow(/DEPLOY_MODE=standalone/);
    });

    /** 🔴 防第二套口径：WEB_SYSTEM_DIR 在 cluster 形态下不参与数据目录解析 */
    it('cluster 形态下 WEB_SYSTEM_DIR 不生效（数据目录只认系统表）', async () => {
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[WEB_SYSTEM_DIR_ENV] = path.join(tmp, 'standalone-root');
      const r = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({ data: { path: path.join(tmp, 'from-config'), source: 'system_configs' } }),
      });
      expect(r.dir).toBe(path.join(tmp, 'from-config'));
      expect(r.dir).not.toContain('standalone-root');
    });

    it('未声明 DEPLOY_MODE 时按 cluster 处理（与 dev/prod 现状一致）', async () => {
      delete env.DEPLOY_MODE;
      env[INTERNAL_API_KEY_ENV] = 'k';
      const r = await resolveUploadDirAtStartup({
        env,
        fetchImpl: fetchStub({ data: { path: path.join(tmp, 'cfg'), source: 'system_configs' } }),
      });
      expect(r.mode).toBe('cluster');
      expect(r.modeSource).toBe('default');
    });

    it('fetchConfiguredDir 用 x-internal-key 请求 system-service', async () => {
      env[INTERNAL_API_KEY_ENV] = 'secret-key';
      env[SYSTEM_SERVICE_URL_ENV] = 'http://127.0.0.1:6004/';
      const fetchImpl = fetchStub({ data: { path: path.join(tmp, 'cfg') } });

      await fetchConfiguredDir(UPLOAD_DIR_SPEC, { env, fetchImpl });
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:6004/internal/storage/path', {
        headers: { 'x-internal-key': 'secret-key' },
        signal: expect.anything(),
      });
    });
  });

  describe('standalone 形态：绕开系统表，单机也能跑', () => {
    /** 🔴 D4：原「未配 key → 不发请求、回落 env」的意图在 standalone 下成立且被钉住 */
    it('不查询系统配置表（即使配了 INTERNAL_API_KEY 也不发请求）', async () => {
      env.DEPLOY_MODE = 'standalone';
      env[INTERNAL_API_KEY_ENV] = 'k';
      env[STORAGE_UPLOAD_DIR_ENV] = path.join(tmp, 'from-env');
      const fetchImpl = fetchStub({ data: { path: path.join(tmp, 'never') } });

      const r = await resolveUploadDirAtStartup({ env, fetchImpl });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(r.dir).toBe(path.join(tmp, 'from-env'));
      expect(r.source).toBe('env');
      expect(r.mode).toBe('standalone');
    });

    it('未配 env → 用 WEB_SYSTEM_DIR 单机运行根', async () => {
      env.DEPLOY_MODE = 'standalone';
      env[WEB_SYSTEM_DIR_ENV] = path.join(tmp, 'root');
      const r = await resolveUploadDirAtStartup({ env });
      expect(r.dir).toBe(path.join(tmp, 'root', 'uploads'));
    });

    /** 原断言「都没有 → 跨平台默认」保留，归属 standalone 形态 */
    it('都没有 → 跨平台默认 ~/web_system/uploads', async () => {
      env.DEPLOY_MODE = 'standalone';
      const r = await resolveUploadDirAtStartup({ env });
      expect(r.dir).toBe(path.resolve(path.join(DEFAULT_STORAGE_BASE, 'uploads')));
      expect(r.source).toBe('default');
    });

    it('env 兜底值也受允许根约束（越界即抛，不静默接受）', async () => {
      env.DEPLOY_MODE = 'standalone';
      env[STORAGE_UPLOAD_DIR_ENV] = '/etc';
      await expect(resolveUploadDirAtStartup({ env })).rejects.toThrow(/越界/);
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

    it('探测用的临时文件会被删掉（不在数据目录里留垃圾）', () => {
      const dir = path.join(tmp, 'clean');
      ensureWritableDir(dir);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
});
