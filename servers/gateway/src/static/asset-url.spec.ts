import {
  assetConfigFrom,
  assetOriginHost,
  assetUrl,
  commonAssetUrl,
  moduleAssetRel,
  moduleAssetsBaseRel,
  normalizeAssetOrigin,
} from './asset-url';

/**
 * 资源 URL 单点（2026-11-04 Phase 1）。
 *
 * 锁死两条用户拍板的规范：
 * 1. ASSET_ORIGIN 必须是带域名的完整 URL base（拒绝 /cdn/ 相对值）；
 * 2. cdn 模式去指针化，且未配置 origin + 非 cdn 时输出逐字节兼容旧相对路径。
 *
 * 变异验证入口：把 assetUrl() 的 `if (!origin) return '/'+rel` 改成永远返回 rel，
 * 或把 cdn 分支的 commit 校验去掉，本文件必须变红。
 */
describe('normalizeAssetOrigin', () => {
  it('空值 = 兼容模式（相对路径，线上现状）', () => {
    expect(normalizeAssetOrigin('')).toBe('');
    expect(normalizeAssetOrigin(undefined)).toBe('');
    expect(normalizeAssetOrigin('   ')).toBe('');
  });

  it('带域名的完整 URL base 原样保留', () => {
    expect(normalizeAssetOrigin('https://kedouai.com/cdn/')).toBe('https://kedouai.com/cdn/');
    expect(normalizeAssetOrigin('https://dev.kedouai.com/cdn/')).toBe('https://dev.kedouai.com/cdn/');
    expect(normalizeAssetOrigin('https://cdn.kedouai.com/')).toBe('https://cdn.kedouai.com/');
  });

  it('缺结尾斜杠自动补齐、重复斜杠归一', () => {
    expect(normalizeAssetOrigin('https://kedouai.com/cdn')).toBe('https://kedouai.com/cdn/');
    expect(normalizeAssetOrigin('https://kedouai.com')).toBe('https://kedouai.com/');
    expect(normalizeAssetOrigin('https://kedouai.com//cdn//')).toBe('https://kedouai.com/cdn/');
  });

  it('拒绝相对路径（这是「换 CDN 要重建全部产物」的根源）', () => {
    expect(() => normalizeAssetOrigin('/cdn/')).toThrow(/带域名的完整 URL/);
    expect(() => normalizeAssetOrigin('cdn/')).toThrow(/带域名的完整 URL/);
    expect(() => normalizeAssetOrigin('kedouai.com/cdn/')).toThrow(/带域名的完整 URL/);
  });

  it('拒绝非本机 http / query / hash / 用户信息', () => {
    expect(() => normalizeAssetOrigin('http://kedouai.com/cdn/')).toThrow(/https/);
    expect(() => normalizeAssetOrigin('https://kedouai.com/cdn/?v=1')).toThrow(/query/);
    expect(() => normalizeAssetOrigin('https://kedouai.com/cdn/#x')).toThrow(/query/);
    expect(() => normalizeAssetOrigin('https://u:p@kedouai.com/cdn/')).toThrow(/用户信息/);
  });

  it('本机 http 允许（本地跨域自测用）', () => {
    expect(normalizeAssetOrigin('http://localhost:8080/cdn/')).toBe('http://localhost:8080/cdn/');
  });
});

describe('assetConfigFrom', () => {
  it('默认 = legacy + 空 origin（逐字节兼容，线上零变化）', () => {
    expect(assetConfigFrom({})).toEqual({ origin: '', mode: 'legacy', cssApps: null });
  });

  it('cdn 模式必须同时给带域名 origin，否则 fail-fast', () => {
    expect(() => assetConfigFrom({ ASSET_URL_MODE: 'cdn' })).toThrow(/必须同时配置带域名的 ASSET_ORIGIN/);
    const cfg = assetConfigFrom({ ASSET_URL_MODE: 'cdn', ASSET_ORIGIN: 'https://kedouai.com/cdn/' });
    expect(cfg.mode).toBe('cdn');
    expect(cfg.origin).toBe('https://kedouai.com/cdn/');
  });

  it('ASSET_CSS_APPS 白名单解析（cdn 模式不依赖磁盘）', () => {
    const cfg = assetConfigFrom({ ASSET_CSS_APPS: 'admin, portal ,' });
    expect([...(cfg.cssApps as Set<string>)]).toEqual(['admin', 'portal']);
  });
});

describe('assetUrl', () => {
  it('origin 空 → 站点绝对相对路径，与改造前逐字节一致', () => {
    expect(assetUrl('static/modules/admin/dev/index.js')).toBe('/static/modules/admin/dev/index.js');
    expect(assetUrl('static/modules/admin/dev/index.css')).toBe('/static/modules/admin/dev/index.css');
  });

  it('origin 有值 → 完整 URL（用户拍板的全 URL base 形态）', () => {
    expect(assetUrl('prod/portal/624bfa46/index.js', 'https://kedouai.com/cdn/')).toBe(
      'https://kedouai.com/cdn/prod/portal/624bfa46/index.js',
    );
    expect(assetUrl('common/libs/vue.js', 'https://cdn.kedouai.com/')).toBe(
      'https://cdn.kedouai.com/common/libs/vue.js',
    );
  });

  it('拒绝注入 / 协议相对 / 上级目录 / query', () => {
    for (const bad of ['../secret', '//evil.com/x.js', 'https://evil.com/x.js', '/abs.js', 'a?x=1', 'a#x', 'a\\b.js', '']) {
      expect(() => assetUrl(bad, 'https://kedouai.com/cdn/')).toThrow(/非法的资源相对路径/);
    }
  });

  it('assetOriginHost 给 CSP 白名单用', () => {
    expect(assetOriginHost('https://kedouai.com/cdn/')).toBe('https://kedouai.com');
    expect(assetOriginHost('')).toBeNull();
  });
});

describe('moduleAssetRel / 去指针化', () => {
  const base = { app: 'portal', env: 'dev', commit: '624bfa46' };

  it('legacy 无 commit = 磁盘指针入口（兼容旧两跳）', () => {
    expect(moduleAssetRel('legacy', { app: 'portal', env: 'dev' })).toBe('static/modules/portal/dev/index.js');
  });

  it('legacy 带 commit = 版本化整包目录', () => {
    expect(moduleAssetRel('legacy', base)).toBe('static/modules/portal/dev/624bfa46/index.js');
  });

  it('cdn = <env>/<app>/<commit>/<file>（env 在 app 前，一跳、无指针层）', () => {
    expect(moduleAssetRel('cdn', base)).toBe('dev/portal/624bfa46/index.js');
    expect(moduleAssetRel('cdn', { ...base, file: 'index.css' })).toBe('dev/portal/624bfa46/index.css');
    expect(moduleAssetRel('cdn', { ...base, file: 'assets/main.a1b2c3d4.js' })).toBe(
      'dev/portal/624bfa46/assets/main.a1b2c3d4.js',
    );
  });

  it('cdn 模式缺 commit 直接抛错（去指针化不允许无版本入口）', () => {
    expect(() => moduleAssetRel('cdn', { app: 'portal', env: 'dev' })).toThrow(/必须带 commit/);
  });

  it('assetsBase：legacy 指指针目录，cdn 指 commit 目录（immutable）', () => {
    expect(moduleAssetsBaseRel('legacy', { app: 'portal', env: 'dev' })).toBe('static/modules/portal/dev/');
    expect(moduleAssetsBaseRel('cdn', base)).toBe('dev/portal/624bfa46/');
  });

  it('拒绝非法 app/env/commit 段', () => {
    expect(() => moduleAssetRel('cdn', { ...base, app: '../admin' })).toThrow(/非法的 app 段/);
    expect(() => moduleAssetRel('cdn', { ...base, commit: 'a/b' })).toThrow(/非法的 commit 段/);
  });
});

describe('commonAssetUrl', () => {
  it('公共库与图标素材统一收进 /cdn/common/', () => {
    expect(commonAssetUrl('libs', 'vue.js', 'https://kedouai.com/cdn/')).toBe(
      'https://kedouai.com/cdn/common/libs/vue.js',
    );
    expect(commonAssetUrl('pub', 'logo.svg', 'https://kedouai.com/cdn/')).toBe(
      'https://kedouai.com/cdn/common/pub/logo.svg',
    );
    expect(commonAssetUrl('pub', 'materials/svg/a.svg', 'https://kedouai.com/cdn/')).toBe(
      'https://kedouai.com/cdn/common/pub/materials/svg/a.svg',
    );
  });
});
