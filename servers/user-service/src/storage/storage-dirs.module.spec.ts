import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { STORAGE_DIRS } from '@web-system/shared';
import type { ResolvedStorageDirs } from '@web-system/shared';
import { StorageDirsModule } from './storage-dirs.module';

/**
 * 装配测试（W4）：证明 user-service 启动时真的解析到了上传根目录，
 * 且 `ensureWritableDir` 跑过（目录已存在）。
 *
 * 用 standalone 形态：不发任何 HTTP 请求（不需要 system-service），
 * 只验证「模块能起 + provider 注入成功 + 目录自检执行」。
 */
describe('StorageDirsModule（user-service）', () => {
  let root: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'usr-storage-'));
    process.env.DEPLOY_MODE = 'standalone';
    process.env.WEB_SYSTEM_DIR = root;
    // 允许根校验：临时目录不在家目录下，必须显式放开（与 dev/prod 的 /data 同理）
    process.env.STORAGE_ALLOWED_ROOTS = root;
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('上传根目录 = 运行根/uploads，且已被创建（可写性自检跑过）', async () => {
    const mod = await Test.createTestingModule({ imports: [StorageDirsModule] }).compile();
    const dirs = mod.get<ResolvedStorageDirs>(STORAGE_DIRS);
    expect(dirs.uploadDir).toBe(path.join(root, 'uploads'));
    expect(fs.existsSync(dirs.uploadDir)).toBe(true);
    expect(dirs.mode).toBe('standalone');
    await mod.close();
  });

  /**
   * 🔴 R1：允许根收归配置表后，standalone 形态仍用本服务 env 兜底 ——
   * 这是唯一保留的合法来源，必须钉住（cluster 下改由 system-service 下发）。
   */
  it('standalone：允许根取本服务 env（不发任何请求）', async () => {
    const mod = await Test.createTestingModule({ imports: [StorageDirsModule] }).compile();
    const dirs = mod.get<ResolvedStorageDirs>(STORAGE_DIRS);
    expect(dirs.allowedRoots).toContain(path.resolve(root));
    expect(dirs.allowedRootsSource).toBe('env');
    await mod.close();
  });

  it('🔴 user-service 不解析临时图目录（tempDir=null）—— 不被 temp 配置拖挂', async () => {
    const mod = await Test.createTestingModule({ imports: [StorageDirsModule] }).compile();
    const dirs = mod.get<ResolvedStorageDirs>(STORAGE_DIRS);
    expect(dirs.tempDir).toBeNull();
    await mod.close();
  });
});
