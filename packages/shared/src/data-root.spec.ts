import { dataDir, dataRoot } from './data-root';

describe('data-root（运行数据根目录解析）', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEB_SYSTEM_DIR;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('dataRoot', () => {
    it('配置了 WEB_SYSTEM_DIR 时以其为运行根（部署机语义：数据归位运行根）', () => {
      process.env.WEB_SYSTEM_DIR = '/data/web_system';
      expect(dataRoot()).toBe('/data/web_system');
    });

    it('未配置时回退 process.cwd()（本地开发零配置，行为与历史一致）', () => {
      expect(dataRoot()).toBe(process.cwd());
    });

    it('配置为空字符串时视为未配置，回退 cwd', () => {
      process.env.WEB_SYSTEM_DIR = '';
      expect(dataRoot()).toBe(process.cwd());
    });

    it('支持注入 env，便于单测（不依赖真实进程环境）', () => {
      expect(dataRoot({ WEB_SYSTEM_DIR: '/srv/ws' })).toBe('/srv/ws');
      expect(dataRoot({})).toBe(process.cwd());
    });
  });

  describe('dataDir', () => {
    it('运行根下拼接单段目录', () => {
      process.env.WEB_SYSTEM_DIR = '/data/web_system';
      expect(dataDir('uploads')).toBe('/data/web_system/uploads');
    });

    it('多段拼接（temp-images/<file>、uploads/avatars）', () => {
      process.env.WEB_SYSTEM_DIR = '/data/web_system';
      expect(dataDir('temp-images', 'a.jpg')).toBe('/data/web_system/temp-images/a.jpg');
      expect(dataDir('uploads', 'avatars')).toBe('/data/web_system/uploads/avatars');
    });

    it('回退 cwd 时拼接在 cwd 之下', () => {
      expect(dataDir('uploads')).toBe(`${process.cwd()}/uploads`);
    });
  });
});
