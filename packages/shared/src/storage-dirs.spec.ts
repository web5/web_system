import {
  getStorageDirs,
  getTempDir,
  getUploadDir,
  hasStorageDirs,
  resetStorageDirsForTest,
  setResolvedStorageDirs,
  STORAGE_DIRS,
} from './storage-dirs';

describe('storage-dirs：存储目录进程内持有者', () => {
  beforeEach(() => {
    resetStorageDirsForTest();
  });

  it('DI token 是稳定字符串（跨模块注入靠它，改名等于断链）', () => {
    expect(STORAGE_DIRS).toBe('STORAGE_DIRS');
  });

  describe('未初始化', () => {
    it('hasStorageDirs() = false', () => {
      expect(hasStorageDirs()).toBe(false);
    });

    it('🔴 取目录抛错，绝不静默回落 cwd', () => {
      expect(() => getUploadDir()).toThrow(/尚未初始化/);
      expect(() => getTempDir()).toThrow(/尚未初始化/);
      expect(() => getStorageDirs()).toThrow(/尚未初始化/);
    });
  });

  describe('已初始化', () => {
    beforeEach(() => {
      setResolvedStorageDirs({
        uploadDir: '/data/web_system/uploads',
        tempDir: '/data/web_system/temp-images',
        uploadSource: 'system_service',
        tempSource: 'system_service',
        mode: 'cluster',
        notes: ['形态=cluster（平台默认）'],
      });
    });

    it('取到两个目录与形态', () => {
      const dirs = getStorageDirs();
      expect(dirs.uploadDir).toBe('/data/web_system/uploads');
      expect(dirs.tempDir).toBe('/data/web_system/temp-images');
      expect(dirs.mode).toBe('cluster');
      expect(hasStorageDirs()).toBe(true);
    });

    it('便捷取目录 = 集合里的对应值', () => {
      expect(getUploadDir()).toBe('/data/web_system/uploads');
      expect(getTempDir()).toBe('/data/web_system/temp-images');
    });

    it('🔴 两个目录必须不同（temp 落在 uploads 之下会让存量临时图 404）', () => {
      expect(getTempDir().startsWith(getUploadDir() + '/')).toBe(false);
    });

    it('重复 set 以最后一次为准（正常只调一次，但不允许第二次被忽略后仍用旧值）', () => {
      setResolvedStorageDirs({
        uploadDir: '/other/uploads',
        tempDir: '/other/temp-images',
        uploadSource: 'env',
        tempSource: 'env',
        mode: 'standalone',
        notes: [],
      });
      expect(getUploadDir()).toBe('/other/uploads');
    });
  });
});
