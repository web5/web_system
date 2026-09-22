import {
  resolveStoragePath,
  isWithinRoot,
  StoragePathError,
  WINDOWS_ENV_ALLOWLIST,
} from './storage-path';

const HOME_POSIX = '/Users/geekwen';
const HOME_WIN = 'C:\\Users\\geekwen';

describe('resolveStoragePath — posix（darwin / linux）', () => {
  const base = { platform: 'darwin' as const, home: HOME_POSIX, env: {} };

  it('展开 ~ 前缀为家目录', () => {
    expect(resolveStoragePath('~/web_system/uploads', base)).toBe(
      '/Users/geekwen/web_system/uploads',
    );
  });

  it('单独的 ~ 等价于家目录', () => {
    expect(resolveStoragePath('~', base)).toBe(HOME_POSIX);
  });

  it('绝对路径按原样 resolve，并归一化多余的斜杠与点段', () => {
    expect(resolveStoragePath('/var/data//uploads/../uploads', { ...base, allowRoots: ['/var'] })).toBe(
      '/var/data/uploads',
    );
  });

  it('默认允许根为家目录，家目录外的路径被拒', () => {
    expect(() => resolveStoragePath('/var/data/uploads', base)).toThrow(StoragePathError);
  });

  it('显式 allowRoots 可放开其它位置', () => {
    expect(
      resolveStoragePath('/mnt/disk/uploads', { ...base, allowRoots: ['/mnt'] }),
    ).toBe('/mnt/disk/uploads');
  });

  it('挡住 .. 穿越出允许根', () => {
    expect(() =>
      resolveStoragePath('/Users/geekwen/../../etc/passwd', base),
    ).toThrow(/越界/);
  });

  it('空输入报 EMPTY', () => {
    try {
      resolveStoragePath('   ', base);
      fail('should throw');
    } catch (e) {
      expect((e as StoragePathError).code).toBe('EMPTY');
    }
  });
});

describe('resolveStoragePath — win32', () => {
  const winEnv = { USERPROFILE: HOME_WIN, LOCALAPPDATA: 'C:\\Users\\geekwen\\AppData\\Local' };
  const base = { platform: 'win32' as const, home: HOME_WIN, env: winEnv };

  it('正反斜杠混写统一为原生分隔符', () => {
    expect(resolveStoragePath('C:/Users/geekwen/uploads', { ...base, allowRoots: ['C:\\'] })).toBe(
      'C:\\Users\\geekwen\\uploads',
    );
  });

  it('展开白名单环境变量 %USERPROFILE%', () => {
    expect(resolveStoragePath('%USERPROFILE%\\uploads', base)).toBe(
      'C:\\Users\\geekwen\\uploads',
    );
  });

  it('白名单变量未配置时抛 UNRESOLVED_ENV', () => {
    try {
      resolveStoragePath('%LOCALAPPDATA%\\uploads', { ...base, env: {} });
      fail('should throw');
    } catch (e) {
      expect((e as StoragePathError).code).toBe('UNRESOLVED_ENV');
    }
  });

  it('非白名单变量不做展开（保持原样，避免变成注入面）', () => {
    const env = { ...winEnv, SHOULD_NOT_EXPAND: 'C:\\secret' };
    expect(() =>
      resolveStoragePath('%SHOULD_NOT_EXPAND%\\uploads', { ...base, env }),
    ).toThrow(StoragePathError);
  });

  it('盘符大小写不影响归属判定', () => {
    expect(
      isWithinRoot('c:\\Users\\geekwen\\uploads', ['C:\\Users\\geekwen'], 'win32'),
    ).toBe(true);
  });

  it('UNC 路径在 win32 下可解析', () => {
    expect(
      resolveStoragePath('\\\\server\\share\\uploads', {
        ...base,
        allowRoots: ['\\\\server\\share'],
      }),
    ).toBe('\\\\server\\share\\uploads');
  });
});

describe('isWithinRoot', () => {
  it('前缀相似但不相同的目录不误判为包含', () => {
    expect(isWithinRoot('/var/data-2/uploads', ['/var/data'], 'darwin')).toBe(false);
  });

  it('等于根本身视为在范围内', () => {
    expect(isWithinRoot('/var/data', ['/var/data'], 'darwin')).toBe(true);
  });
});

describe('WINDOWS_ENV_ALLOWLIST', () => {
  it('包含常用目录变量，且不含敏感变量', () => {
    expect(WINDOWS_ENV_ALLOWLIST).toContain('USERPROFILE');
    expect(WINDOWS_ENV_ALLOWLIST).toContain('LOCALAPPDATA');
    expect(WINDOWS_ENV_ALLOWLIST).not.toContain('PATH');
  });
});
