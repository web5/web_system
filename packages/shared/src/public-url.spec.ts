import {
  PUBLIC_BASE_URL_ENV,
  normalizePublicBaseUrl,
  resolvePublicUrl,
  stripPublicBaseUrl,
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

/**
 * 写侧净化（2026-11-11 写侧污染修复）：小程序把 upload-service 返回的完整 URL
 * 原样 PUT 落库，导致 DB 写入带公网 origin 的 avatar。stripPublicBaseUrl 是
 * resolvePublicUrl 的逆操作，落库前把误带 origin 的值剥回相对路径。
 */
describe('stripPublicBaseUrl', () => {
  const base = 'https://dev.kedouai.com';

  it('命中前缀 → 剥掉 base，返回以 / 开头的相对路径', () => {
    expect(stripPublicBaseUrl('https://dev.kedouai.com/api/uploads/avatars/x.jpeg', base)).toBe(
      '/api/uploads/avatars/x.jpeg',
    );
  });

  it('base 带结尾斜杠也能命中（去尾斜杠后匹配）', () => {
    expect(stripPublicBaseUrl('https://dev.kedouai.com/api/uploads/avatars/x.jpeg', 'https://dev.kedouai.com/')).toBe(
      '/api/uploads/avatars/x.jpeg',
    );
  });

  it('空值 / 空串 → 空串', () => {
    expect(stripPublicBaseUrl('', base)).toBe('');
    expect(stripPublicBaseUrl(null, base)).toBe('');
    expect(stripPublicBaseUrl(undefined, base)).toBe('');
  });

  it('base 为空 → 原样返回（不剥，兼容模式）', () => {
    expect(stripPublicBaseUrl('https://dev.kedouai.com/api/uploads/avatars/x.jpeg', '')).toBe(
      'https://dev.kedouai.com/api/uploads/avatars/x.jpeg',
    );
    expect(stripPublicBaseUrl('/api/uploads/avatars/x.jpeg', '')).toBe('/api/uploads/avatars/x.jpeg');
  });

  it('第三方 URL（微信头像等）原样返回，不动', () => {
    expect(stripPublicBaseUrl('https://thirdwx.qlogo.cn/mmopen/abc/132', base)).toBe(
      'https://thirdwx.qlogo.cn/mmopen/abc/132',
    );
  });

  it('已是相对路径 → 原样返回（幂等）', () => {
    expect(stripPublicBaseUrl('/api/uploads/avatars/x.jpeg', base)).toBe('/api/uploads/avatars/x.jpeg');
  });

  it('与 base 同域但路径不是 base 子路径的边界：origin 后无 / 不剥', () => {
    // 恰好等于 base（无路径）不是 `${base}/` 前缀，原样返回
    expect(stripPublicBaseUrl('https://dev.kedouai.com', base)).toBe('https://dev.kedouai.com');
    // 与 resolvePublicUrl 互逆：剥完再拼回原值
    const full = 'https://dev.kedouai.com/api/uploads/avatars/x.jpeg';
    expect(resolvePublicUrl(stripPublicBaseUrl(full, base), base)).toBe(full);
  });
});
