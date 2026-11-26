/// <reference types="node" />
/**
 * s33 · 册别角标 UI 落地静态契约（R11 / 原型 d3c3730281e758d8，方案①）。
 *
 * 在源码层锁定：
 *  - WXML 今日一句标题行为 flex 容器 + 浅青 pill，wx:if 用 bookBadge/showBookBadge 降级；
 *  - WXSS badge-pill 取 token（--accent-soft 底 / --accent-ink 字），不硬编码裸色值；
 *  - index.ts 用 getDailyQuoteMeta + BOOK_LABEL 映射、角标开关默认开；
 *  - 句主显示 {{quote.cn}}/{{quote.en}} 不变（不喧宾夺主）。
 * 视觉/可访问性由原型 Design: pass（机检 + 人工 A–J + WCAG AA）背书，本测试不重复截图。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WXML = readFileSync(resolve(__dirname, '../pages/home/index/index.wxml'), 'utf-8');
const WXSS = readFileSync(resolve(__dirname, '../pages/home/index/index.wxss'), 'utf-8');
const TS = readFileSync(resolve(__dirname, '../pages/home/index/index.ts'), 'utf-8');
const APP_WXSS = readFileSync(resolve(__dirname, '../app.wxss'), 'utf-8');

describe('方案① 角标 WXML（R11）', () => {
  it('今日一句标题行含 daily-top flex 容器 + badge-pill，wx:if 降级隐藏', () => {
    expect(WXML).toMatch(/class="daily-top"/);
    expect(WXML).toMatch(/class="badge-pill" wx:if="\{\{showBookBadge && bookBadge\}\}"/);
  });
  it('主句显示 {{quote.cn}} + 按词渲染的英文（quoteTokens ← quote.en），角标不喧宾夺主', () => {
    expect(WXML).toContain('{{quote.cn}}');
    // 2026-11-26 ⑤：英文由整串改为按词切分渲染（点词/朗读），展示内容仍是今日一句原文
    expect(WXML).toMatch(/wx:for="\{\{quoteTokens\}\}"/);
    expect(WXML).toContain('{{tk.t}}');
    expect(TS).toMatch(/quoteTokens: tokenize\(INITIAL_QUOTE\.en\)/);
  });
});

describe('方案① 角标 WXSS（token 化 + WCAG AA）', () => {
  it('badge-pill 用 accent token，不硬编码裸 hex', () => {
    expect(WXSS).toMatch(/\.badge-pill\s*\{/);
    expect(WXSS).toContain('var(--accent-soft)');
    expect(WXSS).toContain('var(--accent-ink)');
    const pill = WXSS.slice(WXSS.indexOf('.badge-pill'), WXSS.indexOf('.daily-cn'));
    expect(pill).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
  it('app.wxss 定义 --accent-ink 深青 token（AA 4.92:1）', () => {
    expect(APP_WXSS).toContain('--accent-ink:');
    expect(APP_WXSS).toContain('#0F766E');
  });
});

describe('index.ts 角标接线', () => {
  it('import getDailyQuoteMeta + BOOK_LABEL；data 含 bookBadge/showBookBadge', () => {
    expect(TS).toContain('getDailyQuoteMeta');
    expect(TS).toContain('BOOK_LABEL');
    expect(TS).toMatch(/bookBadge:\s*bookBadgeText\(\)/);
    expect(TS).toMatch(/showBookBadge:\s*true/);
  });
  it('缺省只显册名、不编造课号（lessonId 非整数时仅 label）', () => {
    expect(TS).toMatch(/Number\.isInteger\(lessonId\)\s*\?\s*`\$\{label\} · L\$\{lessonId\}`\s*:\s*label/);
  });
});
