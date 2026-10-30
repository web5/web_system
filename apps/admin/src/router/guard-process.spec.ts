import { isAuthed, isTokenExpired, needsPermissionFetch } from './index';

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

  it('V5 具体值断言：覆盖过期/有效/空串/非 JWT 四种边界', () => {
    // 不再对比 isAuthed === !!t && !isTokenExpired(t)（同义反复 + 两次调用可能跨秒），
    // 直接断言四种输入的预期布尔值，更稳也更可读。
    expect(isAuthed(jwtWithExp(1))).toBe(false); // 1970 远古，必过期
    expect(isAuthed(jwtWithExp(9999999999))).toBe(true); // 2286 远未来，必有效
    expect(isAuthed('')).toBe(false); // 空串 = 未登录
    expect(isAuthed('garbage')).toBe(true); // 非 JWT 解析失败，不假设过期
  });
});

/**
 * 回归：换账号登录必须重新拉权限（issue #478）。
 *
 * 此前守卫用模块级布尔位 `permissionsFetched` 记账，登出再登录不会重置 ——
 * 新账号沿用上一个账号的权限。若上一个账号没有后台权限（库里 5 个 `["user"]`、
 * auth-service 兜底 `'user'` 都属此类），那份权限是空数组，于是**超管登录成功
 * 却连 /dashboard 都进不去**，落到 /403 并被提示「当前账号没有后台访问权限」。
 *
 * 修法是把记账键从布尔位换成 token：token 每次登录都变，天然覆盖换账号场景。
 */
describe('admin 路由守卫 · 换账号后的权限刷新', () => {
  it('V6 首次进入（从未拉取过）必须拉取', () => {
    expect(needsPermissionFetch(true, null, 'token-A')).toBe(true);
  });

  it('V7 同一 token 的后续导航不再重复拉取', () => {
    expect(needsPermissionFetch(true, 'token-A', 'token-A')).toBe(false);
  });

  it('V8 🔴 换账号登录（token 变了）必须重新拉取 —— #478 根因，改回布尔位此用例即红', () => {
    expect(needsPermissionFetch(true, 'token-A', 'token-B')).toBe(true);
  });

  it('V9 未登录 / 登出后（token 空）不拉取', () => {
    expect(needsPermissionFetch(false, null, 'token-A')).toBe(false);
    expect(needsPermissionFetch(true, 'token-A', '')).toBe(false);
    expect(needsPermissionFetch(true, 'token-A', null)).toBe(false);
    expect(needsPermissionFetch(true, 'token-A', undefined)).toBe(false);
  });
});
