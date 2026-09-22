/**
 * B4（`specs/backend-consolidation/design.md` §2.3）：
 * 生产环境缺关键服务地址必须 fail-fast，不能静默走默认值。
 *
 * 为什么值得单测：默认值只在「本机 / 本地发布」口径正确（auth=6101），
 * dev/prod 口径不同（auth=6001）——判错方向就是「线上所有服务静默 401」，
 * 与 2026-09-11 dev 事故同源；且这里要保证**非生产环境一律不拦**，别把本地起步卡死。
 */
import {
  REQUIRED_SERVICE_URLS_IN_PROD,
  missingRequiredServiceUrls,
  serviceUrlFailFastHint,
} from './services';

/** 用 map 造一个 get 读取器 */
const getter = (map: Record<string, string | undefined>) => (key: string) => map[key];

describe('missingRequiredServiceUrls（B4 生产 fail-fast 判据）', () => {
  it('production 且关键地址齐全 → 空数组（放行）', () => {
    expect(
      missingRequiredServiceUrls(getter({ AUTH_SERVICE_URL: 'http://localhost:6001' }), 'production'),
    ).toEqual([]);
  });

  it('production 缺关键地址 → 报出缺口', () => {
    expect(missingRequiredServiceUrls(getter({}), 'production')).toEqual([
      'AUTH_SERVICE_URL',
    ]);
  });

  it('production 空白串 / 纯空格视为缺失（不能被空白糊弄过去）', () => {
    for (const v of ['', '   ', '\t']) {
      expect(
        missingRequiredServiceUrls(getter({ AUTH_SERVICE_URL: v }), 'production'),
      ).toEqual(['AUTH_SERVICE_URL']);
    }
  });

  it('非 production 一律放行（不能把本地/测试起步卡死）', () => {
    for (const env of ['development', 'test', undefined, '']) {
      expect(missingRequiredServiceUrls(getter({}), env as string | undefined)).toEqual([]);
    }
  });

  it('清单只含口径真的会漂的那些键（默认值可用的端口不该被拦）', () => {
    // 关键：REQUIRED 里出现「本机与 dev/prod 同端口」的项，就是在无谓增加上线成本
    expect(REQUIRED_SERVICE_URLS_IN_PROD).toEqual(['AUTH_SERVICE_URL']);
  });

  it('多键时逐个报出（当前只有 auth，防未来扩展时漏报）', () => {
    const missing = missingRequiredServiceUrls(getter({}), 'production');
    expect(missing.length).toBe(REQUIRED_SERVICE_URLS_IN_PROD.length);
  });
});

describe('serviceUrlFailFastHint（统一文案）', () => {
  it('带缺口键名 + 说明口径差异 + 给出修复动作', () => {
    const text = serviceUrlFailFastHint(['AUTH_SERVICE_URL']);
    expect(text).toContain('AUTH_SERVICE_URL');
    expect(text).toContain('6001');
    expect(text).toContain('6101');
    expect(text).toContain('.env');
  });

  it('多缺口时都出现在文案里', () => {
    const text = serviceUrlFailFastHint(['AUTH_SERVICE_URL', 'USER_SERVICE_URL']);
    expect(text).toContain('AUTH_SERVICE_URL');
    expect(text).toContain('USER_SERVICE_URL');
  });
});
