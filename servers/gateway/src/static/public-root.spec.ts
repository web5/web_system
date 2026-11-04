import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertPublicRoot } from './public-root';

/**
 * 静态根启动自检单测（2026-11-04 dev/prod portal 全白屏的防复发门禁）。
 *
 * 锁定三条行为：根可用时放行、根不可用时 fail-fast 且错误信息带修复入口、
 * STRICT=0 可应急降级为仅告警。
 */
describe('assertPublicRoot（静态根启动自检）', () => {
  let dir: string;
  const originalStrict = process.env.STATIC_PUBLIC_ROOT_STRICT;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wb-public-root-'));
    delete process.env.STATIC_PUBLIC_ROOT_STRICT;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalStrict === undefined) {
      delete process.env.STATIC_PUBLIC_ROOT_STRICT;
    } else {
      process.env.STATIC_PUBLIC_ROOT_STRICT = originalStrict;
    }
    jest.restoreAllMocks();
  });

  it('shell/index.html 存在 → 放行', () => {
    mkdirSync(join(dir, 'shell'));
    writeFileSync(join(dir, 'shell', 'index.html'), '<html></html>');
    expect(() => assertPublicRoot(dir)).not.toThrow();
  });

  it('缺少 shell/index.html → 抛错，且带上根路径与修复入口', () => {
    expect(() => assertPublicRoot(dir)).toThrow(/STATIC_PUBLIC_ROOT 不可用/);
    expect(() => assertPublicRoot(dir)).toThrow(/ecosystem\.config\.js/);
    expect(() => assertPublicRoot(dir)).toThrow(dir);
  });

  it('只有目录、没有 index.html 也要拦住（避免 existsSync 判目录就放行）', () => {
    mkdirSync(join(dir, 'shell'));
    expect(() => assertPublicRoot(dir)).toThrow(/STATIC_PUBLIC_ROOT 不可用/);
  });

  it('STRICT=0 → 只告警不抛', () => {
    process.env.STATIC_PUBLIC_ROOT_STRICT = '0';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertPublicRoot(dir)).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('仅告警'));
  });

  it('严格开关默认开启：非 0 值不豁免', () => {
    process.env.STATIC_PUBLIC_ROOT_STRICT = 'false';
    expect(() => assertPublicRoot(dir)).toThrow(/STATIC_PUBLIC_ROOT 不可用/);
  });
});
