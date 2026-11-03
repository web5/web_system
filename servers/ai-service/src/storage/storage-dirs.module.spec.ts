import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { STORAGE_DIRS } from '@web-system/shared';
import type { ResolvedStorageDirs } from '@web-system/shared';
import { StorageDirsModule } from './storage-dirs.module';

/**
 * 装配测试（W4）：ai-service 需要**两个**目录，且两个都必须通过可写性自检。
 *
 * 用 standalone 形态：不发 HTTP 请求，只验证装配与自检。
 * cluster 形态的取值链由 `packages/shared` 的 storage-dir.spec 覆盖。
 */
describe('StorageDirsModule（ai-service）', () => {
  let root: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-storage-'));
    process.env.DEPLOY_MODE = 'standalone';
    process.env.WEB_SYSTEM_DIR = root;
    // 允许根校验：临时目录不在家目录下，必须显式放开（与 dev/prod 的 /data 同理）
    process.env.STORAGE_ALLOWED_ROOTS = root;
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('两个目录都解析出来并已创建（可写性自检跑过）', async () => {
    const mod = await Test.createTestingModule({ imports: [StorageDirsModule] }).compile();
    const dirs = mod.get<ResolvedStorageDirs>(STORAGE_DIRS);
    expect(dirs.uploadDir).toBe(path.join(root, 'uploads'));
    expect(dirs.tempDir).toBe(path.join(root, 'temp-images'));
    expect(fs.existsSync(dirs.uploadDir)).toBe(true);
    expect(fs.existsSync(dirs.tempDir as string)).toBe(true);
    await mod.close();
  });

  it('🔴 临时图目录与上传根目录**同级**（落在 uploads 之下会让存量临时图 404）', async () => {
    const mod = await Test.createTestingModule({ imports: [StorageDirsModule] }).compile();
    const dirs = mod.get<ResolvedStorageDirs>(STORAGE_DIRS);
    expect(path.dirname(dirs.tempDir as string)).toBe(path.dirname(dirs.uploadDir));
    expect((dirs.tempDir as string).startsWith(dirs.uploadDir + path.sep)).toBe(false);
    await mod.close();
  });
});
