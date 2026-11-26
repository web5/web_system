/// <reference types="node" />
/**
 * 首页 `Page({ data })` 初值判据（E2E G3 的唯一实现）—— 负例矩阵单测（台账 9085）
 *
 * 🔴 为什么需要这个文件：G3 是「静态层唯一能挡住首帧回退」的判据，而它原先在
 *    `G-login-gate.js` 里是两行全文正则，属弱锁——独立复核实测两条回退都能绕过仍判 PASS：
 *    ① 删掉 data 里的 `loggedIn` 初值行，只留 onShow 的 `setData({ loggedIn: isLoggedIn() })`；
 *    ② `greetingText: isLoggedIn() ? GREETING_LOADING : GREETING_LOADING`（false 分支不是空串）。
 *    本文件就是「弱锁被硬化」的证据：上述两条形态各有一条负例，必须 FAIL。
 *
 * 判据实现见 `tests/e2e/lib/init-state-check.js`（CommonJS 纯函数，E2E 与单测共用同一份）。
 * 本文件只做两件事：
 *   1. 正例：直接读**真实源码** `pages/home/index/index.ts` → ok === true
 *      （防「函数写死 return { ok: true }」——真实文件是唯一正例来源）；
 *   2. 负例矩阵：在真实源码上做**定向替换**构造反例（绝不写回真实文件），
 *      每条断言 problems 里点明了具体哪条判据、实际取到什么值。
 */

import * as fs from 'fs';
import * as path from 'path';

interface CheckResult {
  ok: boolean;
  problems: string[];
  values: { loggedIn: string | null; greetingText: string | null };
  dataLine: number | null;
}

// lib 是 CommonJS（E2E 侧裸 require 同一份），故此处也 require + 内联类型，
// 不给 e2e 目录引入 d.ts 维护负担。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkHomeInitState } = require('./e2e/lib/init-state-check') as {
  checkHomeInitState: (source: string) => CheckResult;
};

const HOME_TS = path.join(__dirname, '..', 'pages', 'home', 'index', 'index.ts');
const realSource = fs.readFileSync(HOME_TS, 'utf-8');

/**
 * 在真实源码上做一次定向替换，构造反例。
 * 替换没命中就直接抛错：真实源码被改写后，负例不允许静默退化成「又测了一遍正例」。
 */
function mutate(from: string, to: string): string {
  const out = realSource.replace(from, to);
  if (out === realSource) {
    throw new Error(`负例构造失败：真实源码里已找不到 ${JSON.stringify(from)}（判据或源码形态变了，请同步本文件）`);
  }
  return out;
}

/** problems 全文，便于按关键词断言「点明了哪一条」 */
const problemsText = (r: CheckResult): string => r.problems.join('\n');

describe('正例 · 真实文件 pages/home/index/index.ts', () => {
  it('data 块内 loggedIn=isLoggedIn() 且 greetingText 三元 false 分支是空串 → ok', () => {
    const r = checkHomeInitState(realSource);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    // 显式钉住实际取到的两个值：函数若退化成「永远 ok」或取错块（取到 onShow），这里会露出来
    expect(r.values.loggedIn).toMatch(/^isLoggedIn\s*\(\s*\)/);
    expect(r.values.greetingText).toMatch(/\?[\s\S]*:\s*(''|"")$/);
  });

  it('取的是 Page({data}) 里的初值块（dataLine 落在 Page 声明之后的 data 块）', () => {
    const r = checkHomeInitState(realSource);
    const dataIndex = realSource.indexOf('data: {');
    expect(dataIndex).toBeGreaterThan(-1);
    const expectedLine = realSource.slice(0, dataIndex).split('\n').length;
    expect(r.dataLine).toBe(expectedLine);
  });
});

describe('负例① loggedIn 写死 true（首帧闪 hero）', () => {
  it('FAIL，problems 指明 loggedIn 且报出实际值', () => {
    const src = mutate('loggedIn: isLoggedIn(),', 'loggedIn: true,');
    const r = checkHomeInitState(src);
    expect(r.ok).toBe(false);
    expect(problemsText(r)).toMatch(/loggedIn/);
    expect(problemsText(r)).toMatch(/不是 isLoggedIn\(\) 调用/);
    expect(problemsText(r)).toMatch(/"true"/);
    // 只有这一条问题：greetingText 那条判据本身是好的，不该被连带报错
    expect(r.problems).toHaveLength(1);
  });
});

describe('负例② 删掉 data 里的 loggedIn 初值行，只留 onShow 的 setData（第一处可绕过的回退）', () => {
  const src = mutate('    loggedIn: isLoggedIn(),\n', '');

  it('构造前提成立：onShow 里仍有 setData({ loggedIn: isLoggedIn() })', () => {
    expect(src).toMatch(/setData\(\{\s*loggedIn:\s*isLoggedIn\(\)\s*\}\)/);
    // 对应原弱锁会命中的那行（全文正则取第一个 loggedIn: 会落到这里）
    expect(src).not.toMatch(/^\s*loggedIn: isLoggedIn\(\),\s*$/m);
  });

  it('FAIL —— 函数体里的同名键不算 data 初值（problems 指明缺少 loggedIn）', () => {
    const r = checkHomeInitState(src);
    expect(r.ok).toBe(false);
    expect(r.values.loggedIn).toBeNull();
    expect(problemsText(r)).toMatch(/缺少 loggedIn/);
    expect(problemsText(r)).toMatch(/只靠 onShow 的 setData/);
  });
});

describe('负例③ greetingText 三元 false 分支也是占位（第二处可绕过的回退，违反 9045）', () => {
  it('FAIL，problems 指明 false 分支不是空串', () => {
    const src = mutate(
      "greetingText: isLoggedIn() ? GREETING_LOADING : '',",
      'greetingText: isLoggedIn() ? GREETING_LOADING : GREETING_LOADING,',
    );
    const r = checkHomeInitState(src);
    expect(r.ok).toBe(false);
    expect(problemsText(r)).toMatch(/greetingText/);
    expect(problemsText(r)).toMatch(/false 分支不是空串/);
    expect(problemsText(r)).toMatch(/GREETING_LOADING/);
    expect(r.problems).toHaveLength(1);
  });
});

describe('负例④ greetingText 写死占位（不是三元）', () => {
  it('FAIL，problems 指明不是三元表达式', () => {
    const src = mutate(
      "greetingText: isLoggedIn() ? GREETING_LOADING : '',",
      'greetingText: GREETING_LOADING,',
    );
    const r = checkHomeInitState(src);
    expect(r.ok).toBe(false);
    expect(problemsText(r)).toMatch(/greetingText/);
    expect(problemsText(r)).toMatch(/不是三元表达式/);
  });
});

describe('负例⑤ loggedIn: isLoggedIn（漏括号，取到函数对象恒真）', () => {
  it('FAIL，problems 提示漏了调用括号', () => {
    const src = mutate('loggedIn: isLoggedIn(),', 'loggedIn: isLoggedIn,');
    const r = checkHomeInitState(src);
    expect(r.ok).toBe(false);
    expect(problemsText(r)).toMatch(/loggedIn/);
    expect(problemsText(r)).toMatch(/漏了调用括号/);
  });
});

describe('负例⑥ 三元条件恒真（`true ? 占位 : \'\'`，两支等价于写死）', () => {
  it('FAIL，problems 指明条件没引用登录态', () => {
    const src = mutate(
      "greetingText: isLoggedIn() ? GREETING_LOADING : '',",
      "greetingText: true ? GREETING_LOADING : '',",
    );
    const r = checkHomeInitState(src);
    expect(r.ok).toBe(false);
    expect(problemsText(r)).toMatch(/条件没有引用登录态/);
  });
});

describe('入口守卫 · 连 data 块都定位不到时不许判 ok', () => {
  it('空源码 → FAIL', () => {
    expect(checkHomeInitState('').ok).toBe(false);
  });

  it('没有 Page({ data }) → FAIL 且说明定位不到 data 块', () => {
    const r = checkHomeInitState('Page({ onShow() {} });\n');
    expect(r.ok).toBe(false);
    expect(problemsText(r)).toMatch(/找不到 `Page\(\{ data: \{ \.\.\. \} \}\)`/);
  });

  it('注释里出现的 Page({data}) 字样不会被当成真 data 块', () => {
    const r = checkHomeInitState('/** 绝不在 Page({data}) 初始化阶段调用 fetchProfile() */\nPage({ onShow() {} });\n');
    expect(r.ok).toBe(false);
    expect(r.dataLine).toBeNull();
  });
});
