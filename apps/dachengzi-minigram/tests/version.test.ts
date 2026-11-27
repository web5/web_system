/// <reference types="node" />
/**
 * 版本号真源一致性 + 三态回退（1.0.18 · 问题 1）
 *
 * 需求真源：`30-任务产物/2026-11-26-大橙子10018修复方案/00-方案.md` §1.6
 *
 * 🔴 为什么每条都要精确断言返回值、而不是只断言「不抛」：
 *    1.0.17 的线上包把关于页版本号写死成字面量 `v1.0.0`，任何「能跑就算过」的测试都抓不到。
 *    所以这里锁的是「任一状态下必须显示哪个字符串」，其中三种降级态都必须等于 APP_VERSION。
 *
 * 🔴 tsconfig 的 types 只有 wechat-miniprogram + jest，没有 node，
 *    所以要读 package.json 必须显式 `/// <reference types="node" />`。
 */
import * as fs from 'fs';
import * as path from 'path';
import { APP_VERSION, resolveAppVersion } from '../utils/version';

interface PkgJson {
  version: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
) as PkgJson;

/** 只用到 getAccountInfoSync 一个成员，其余字段按微信真实返回形态构造。 */
interface WxStub {
  getAccountInfoSync: () => unknown;
}

const g = global as unknown as { wx?: WxStub };

/** 保存真实 wx（jsdom / 小程序模拟层可能已注入），每条用例后恢复，避免污染其它测试文件。 */
const realWx = g.wx;

afterEach(() => {
  g.wx = realWx;
});

function withWx(getAccountInfoSync: () => unknown): void {
  g.wx = { getAccountInfoSync };
}

describe('APP_VERSION 与 package.json.version 必须字面相等（防两处漂移）', () => {
  it('两处版本相等 —— 任一处忘 bump 即红', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('APP_VERSION 形如 x.y.z', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('resolveAppVersion · 正式版优先读微信真值', () => {
  it('miniProgram.version 有合法值 → 返回真值（不是常量）', () => {
    // 故意用一个不同于 APP_VERSION 的值：若实现只 return 常量，这条必红。
    withWx(() => ({ miniProgram: { envVersion: 'release', version: '1.0.20' } }));
    expect(resolveAppVersion()).toBe('1.0.20');
  });

  it('真值优先而非拼接：返回串不带 v 前缀（模板自行拼 v）', () => {
    withWx(() => ({ miniProgram: { envVersion: 'release', version: '2.3.4' } }));
    expect(resolveAppVersion()).toBe('2.3.4');
    expect(resolveAppVersion()).not.toContain('v');
  });
});

describe('resolveAppVersion · 降级态一律回退 APP_VERSION', () => {
  it('version 是空串（开发版 / 体验版真实形态，不是 undefined）→ 回退常量', () => {
    withWx(() => ({ miniProgram: { envVersion: 'trial', version: '' } }));
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('version 是 undefined（字段缺失）→ 回退常量', () => {
    withWx(() => ({ miniProgram: {} }));
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('getAccountInfoSync 返回 undefined → 回退常量', () => {
    withWx(() => undefined);
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('脏值 "abc" → 回退常量（不把异常串直接展示给用户）', () => {
    withWx(() => ({ miniProgram: { version: 'abc' } }));
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('脏值 "1.0"（段数不足）→ 回退常量', () => {
    withWx(() => ({ miniProgram: { version: '1.0' } }));
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('脏值 " 1.0.18 "（带首尾空格）→ 回退常量（白名单不放行，模板不会被撑出多余空格）', () => {
    withWx(() => ({ miniProgram: { version: ' 1.0.18 ' } }));
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('脏值 "1.0.18.1"（段数过多）→ 回退常量', () => {
    withWx(() => ({ miniProgram: { version: '1.0.18.1' } }));
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });
});

describe('resolveAppVersion · 绝不外抛（页面白屏防护）', () => {
  it('wx.getAccountInfoSync 抛异常 → 不抛出，返回 APP_VERSION', () => {
    withWx(() => {
      throw new Error('getAccountInfoSync not supported');
    });
    expect(() => resolveAppVersion()).not.toThrow();
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('miniProgram 的 getter 抛错（异常取值）→ 不抛出，返回 APP_VERSION', () => {
    withWx(
      () =>
        ({
          get miniProgram(): unknown {
            throw new Error('boom');
          },
        }) as unknown,
    );
    expect(() => resolveAppVersion()).not.toThrow();
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('wx 整个不存在 → 返回 APP_VERSION（老基础库 / 纯 Node 环境）', () => {
    g.wx = undefined;
    expect(() => resolveAppVersion()).not.toThrow();
    expect(resolveAppVersion()).toBe(APP_VERSION);
  });

  it('恒返回非空串（三态恒非空是模板 v{{appVersion}} 不出孤零零 "v" 的前提）', () => {
    g.wx = undefined;
    expect(resolveAppVersion().length).toBeGreaterThan(0);
    withWx(() => ({ miniProgram: { version: '' } }));
    expect(resolveAppVersion().length).toBeGreaterThan(0);
  });
});
