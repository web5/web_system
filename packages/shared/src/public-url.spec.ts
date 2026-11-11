import {
  PUBLIC_BASE_URL_ENV,
  normalizePublicBaseUrl,
  resolvePublicUrl,
} from './public-url';

/**
 * 公网访问基座（拼完整 URL）单测 —— 钉住三类行为：
 *  1. normalizePublicBaseUrl：合法值取 origin、去结尾斜杠；空/非法值回落空串；
 *  2. resolvePublicUrl：相对路径拼域名；已绝对路径幂等；base 空保持相对；
 *  3. PUBLIC_BASE_URL_ENV 环境变量名稳定（各服务依赖它读配置）。
 */
describe('normalizePublicBaseUrl', () => {
  it('env 名固定为 PUBLIC_BASE_URL', () => {
    expect(PUBLIC_BASE_URL_ENV).toBe('PUBLIC_BASE_URL');
  });

  it('合法 https 值返回 origin，去掉结尾斜杠', () => {
    expect(normalizePublicBaseUrl('https://dev.kedouai.com')).toBe('https://dev.kedouai.com');
    expect(normalizePublicBaseUrl('https://kedouai.com/')).toBe('https://kedouai.com');
  });

  it('去掉路径 / query / hash（只保留 origin）', () => {
    expect(normalizePublicBaseUrl('https://kedouai.com/api')).toBe('https://kedouai.com');
    expect(normalizePublicBaseUrl('https://kedouai.com?x=1')).toBe('https://kedouai.com');
    expect(normalizePublicBaseUrl('https://kedouai.com#frag')).toBe('https://kedouai.com');
  });

  it('允许 http（本机 / 内网）', () => {
    expect(normalizePublicBaseUrl('http://localhost:6000')).toBe('http://localhost:6000');
  });

  it('空值 → 空串', () => {
    expect(normalizePublicBaseUrl('')).toBe('');
    expect(normalizePublicBaseUrl(null)).toBe('');
    expect(normalizePublicBaseUrl(undefined)).toBe('');
    expect(normalizePublicBaseUrl('   ')).toBe('');
  });

  it('非法值 → 空串（防御性回落，不抛错）', () => {
    expect(normalizePublicBaseUrl('kedouai.com')).toBe(''); // 缺协议
    expect(normalizePublicBaseUrl('ftp://kedouai.com')).toBe(''); // 非 http(s)
    expect(normalizePublicBaseUrl('https://user:pass@kedouai.com')).toBe(''); // 带用户信息
  });
});

describe('resolvePublicUrl', () => {
  const base = 'https://dev.kedouai.com';

  it('相对路径拼上 base', () => {
    expect(resolvePublicUrl('/api/uploads/avatars/x.jpeg', base)).toBe(
      'https://dev.kedouai.com/api/uploads/avatars/x.jpeg',
    );
  });

  it('已绝对（http/https）原样返回，幂等', () => {
    expect(resolvePublicUrl('https://cdn.example.com/a.png', base)).toBe(
      'https://cdn.example.com/a.png',
    );
    expect(resolvePublicUrl('http://localhost:6000/a.png', base)).toBe(
      'http://localhost:6000/a.png',
    );
  });

  it('空值 / 空串 → 空串', () => {
    expect(resolvePublicUrl('', base)).toBe('');
    expect(resolvePublicUrl(null, base)).toBe('');
    expect(resolvePublicUrl(undefined, base)).toBe('');
  });

  it('base 为空 → 保持相对路径（兼容模式，与历史行为一致）', () => {
    expect(resolvePublicUrl('/api/uploads/avatars/x.jpeg', '')).toBe(
      '/api/uploads/avatars/x.jpeg',
    );
  });

  it('base 带结尾斜杠也能正确拼接（去重斜杠）', () => {
    expect(resolvePublicUrl('/api/uploads/avatars/x.jpeg', 'https://kedouai.com/')).toBe(
      'https://kedouai.com/api/uploads/avatars/x.jpeg',
    );
  });

  it('非 / 开头的相对值原样返回（不误拼）', () => {
    expect(resolvePublicUrl('wxfile://tmp/a.png', base)).toBe('wxfile://tmp/a.png');
  });
});
