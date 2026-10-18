import { isAuthed, isTokenExpired } from './index';

/**
 * 回归：过期 token 必须被判为「未登录」。
 *
 * 背景（issue #356）：此前守卫两条分支口径不一致 ——
 * 「踢去登录页」看 `!token || isTokenExpired(token)`，
 * 「踢回首页」只看 `!!token`。过期 token 是非空字符串，于是受保护路由与 /login
 * 互相把对方踢出去 → 同步无限重定向，主线程占满，页面渲染不出来且控制台零报错。
 *
 * 这里锁的就是那条**唯一口径**：只要口径被改坏，本用例先红。
 * 之所以测纯函数而不是整个守卫：守卫依赖 vue-router 运行时与 pinia store，
 * 而这个判定不需要 —— admin 目前没有前端测试运行时，纯函数可以直接用 jest 跑。
 */

/** 构造 JWT（不签名：本地只做 exp 检查，签名校验是后端的事） */
function jwtWithExp(expSeconds: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp: expSeconds })}.sig`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('admin 路由守卫 · 登录判定口径', () => {
  it('V1 过期 token 判为未登录（#356 根因：此前的写法会返回 true 触发来回踢）', () => {
    const expired = jwtWithExp(nowSec() - 3600);
    expect(isTokenExpired(expired)).toBe(true);
    // 关键断言：token 明明非空，但必须判为未登录
    expect(expired.length).toBeGreaterThan(0);
    expect(isAuthed(expired)).toBe(false);
  });

  it('V2 未过期 token 判为已登录（不得误伤在线用户）', () => {
    const valid = jwtWithExp(nowSec() + 3600);
    expect(isTokenExpired(valid)).toBe(false);
    expect(isAuthed(valid)).toBe(true);
  });

  it('V3 空值一律判为未登录', () => {
    expect(isAuthed('')).toBe(false);
    expect(isAuthed(null)).toBe(false);
    expect(isAuthed(undefined)).toBe(false);
  });

  it('V4 无 exp 字段 / 格式异常不得误判过期（保持既有兜底，避免误踢有效 token）', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    // 无 exp：无法判定过期 → 视为有效，交给后端 401 兜底
    expect(isAuthed(`${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1' })}.sig`)).toBe(true);
    // 非 JWT 字符串：解析失败同样不得判过期
    expect(isAuthed('not-a-jwt')).toBe(true);
  });

  it('V5 口径一致性：isAuthed 与「非空且未过期」完全等价（防止两处再写歪）', () => {
    const cases = [jwtWithExp(nowSec() - 1), jwtWithExp(nowSec() + 60), '', 'garbage'];
    for (const t of cases) {
      expect(isAuthed(t)).toBe(!!t && !isTokenExpired(t));
    }
  });
});
