import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetStorageDirsForTest, setResolvedStorageDirs } from '@web-system/shared';
import { avatarUploadDir } from './user.controller';

/**
 * 头像落盘目录的口径（W4）。
 *
 * 为什么单独钉它：这段代码跑在**装饰器求值期**（Multer destination），
 * 既拿不到 DI 也没有请求上下文，一旦它自己拼路径（`dataDir('uploads','avatars')`）
 * 就与页面配置的上传根目录脱钩 —— 页面上改了目录，头像仍写老地方。
 */
describe('avatarUploadDir：头像目录 = 上传根目录 + avatars', () => {
  afterEach(() => {
    resetStorageDirsForTest();
  });

  it('跟随注入的上传根目录（cluster 形态：系统配置表的值）', () => {
    setResolvedStorageDirs({
      uploadDir: '/data/web_system/uploads',
      tempDir: null, // user-service 不需要临时图目录
      uploadSource: 'system_service',
      tempSource: null,
      mode: 'cluster',
      notes: [],
    });
    expect(avatarUploadDir()).toBe(path.join('/data/web_system/uploads', 'avatars'));
  });

  it('改了配置并重启 → 用新目录（证明不是写死路径）', () => {
    setResolvedStorageDirs({
      uploadDir: '/mnt/data/uploads',
      tempDir: null,
      uploadSource: 'system_service',
      tempSource: null,
      mode: 'cluster',
      notes: [],
    });
    expect(avatarUploadDir()).toBe(path.join('/mnt/data/uploads', 'avatars'));
  });

  it('🔴 未初始化（模块没装 / 解析失败）→ 抛错，绝不静默回落到 cwd', () => {
    resetStorageDirsForTest();
    expect(() => avatarUploadDir()).toThrow(/尚未初始化/);
  });

  it('🔴 结果必须是绝对路径且在上传根目录之下（不会写到家目录或 cwd）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-root-'));
    setResolvedStorageDirs({
      uploadDir: root,
      tempDir: null,
      uploadSource: 'env',
      tempSource: null,
      mode: 'standalone',
      notes: [],
    });
    const dir = avatarUploadDir();
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir.startsWith(root + path.sep)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
