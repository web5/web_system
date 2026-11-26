/**
 * 🔵 RD 独立盲测 H 组：E4（视觉暗示 / 按下反馈）与 AC-B.27（长按越界触发）
 *
 * 判据：
 *  - E4：普通词**无静态暗示**（无点线/下划线/色差）+ **长按瞬间按下高亮**（反馈，不是暗示）
 *  - AC-B.27：长按**中文行** / 长按底部「朗读·收藏」按钮 → **不弹抽屉**
 */
/// <reference types="node" />
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';

const APP = pathMod.join(__dirname, '..');
const read = (p: string) => fsMod.readFileSync(pathMod.join(APP, p), 'utf8');
const HOME_WXSS = 'pages/home/index/index.wxss';
const DETAIL_WXSS = 'pages/nce/detail/detail.wxss';
const HOME_WXML = 'pages/home/index/index.wxml';
const DETAIL_WXML = 'pages/nce/detail/detail.wxml';

/** 去掉注释，避免注释里的说明文字被当成实现 */
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('H1 E4 前半：普通词无静态视觉标记（保住「非生词不高亮」）', () => {
  it('首页：.dw 只有 .has-def 才有点线/品牌色（普通词继承正文色）', () => {
    const css = code(read(HOME_WXSS));
    expect(css).toMatch(/\.dw\.has-def\s*\{[\s\S]*?border-bottom:\s*1rpx dotted/);
    // 裸 .dw 不得带 border-bottom / 下划线
    const base = css.match(/\.dw\s*\{[^}]*\}/g) || [];
    for (const b of base) {
      expect(b).not.toMatch(/border-bottom/);
      expect(b).not.toMatch(/text-decoration/);
    }
  });

  it('详情页：.w 裸规则只有正文色，点线只给 .has-def', () => {
    const css = code(read(DETAIL_WXSS));
    expect(css).toMatch(/\.w\s*\{\s*color:\s*#1A1A1F;?\s*\}/);
    expect(css).toMatch(/\.w\.has-def\s*\{\s*border-bottom:\s*1rpx dotted/);
  });
});

describe('H2 E4 后半：长按瞬间按下高亮（反馈）', () => {
  it('普通词必须也有按下反馈（hover-class 或 :active），否则「按了 350ms 没反应」', () => {
    for (const [wxmlF, wxssF, cls] of [
      [HOME_WXML, HOME_WXSS, 'dw'],
      [DETAIL_WXML, DETAIL_WXSS, 'w'],
    ] as const) {
      const wxml = read(wxmlF);
      const css = code(read(wxssF));
      const hasHoverClass = /hover-class="[^"]+"/.test(wxml);
      const pressedForPlain =
        new RegExp(`\\.${cls}(?:\\.has-def)?:active`).test(css) &&
        // 普通词专属的按下规则（不带 has-def 限定）
        new RegExp(`\\.${cls}:active`).test(css);
      expect(hasHoverClass || pressedForPlain).toBe(true);
    }
  });
});

describe('H3 AC-B.27：长按中文行不得弹抽屉', () => {
  it('首页：长按只挂 .daily-en（不含中文行 / 页脚按钮）', () => {
    const wxml = read(HOME_WXML);
    // .daily 卡片上不得有 longpress
    const dailyTag = (wxml.match(/<view class="daily"[\s\S]{0,200}?>/) || [''])[0];
    expect(dailyTag).not.toMatch(/longpress/);
    // 中文行在 .daily-cn，不在 .daily-en 内
    const enBlock = (wxml.match(/<view class="daily-en"[\s\S]*?<\/view>/) || [''])[0];
    expect(enBlock).toContain('quoteTokens');
    expect(enBlock).not.toContain('quote.cn');
    expect(wxml).toMatch(/class="daily-en"\s+catchlongpress="onQuoteLineLongPress"/);
  });

  it('详情页：中文块 .sent-cn 不得被 bindlongpress 覆盖（AC-B.27 明列「长按中文行」不弹）', () => {
    const wxml = read(DETAIL_WXML);
    // 找到 .sent 起始标签，按 <view>/</view> 配平找出它的作用域，再看 .sent-cn 是否落在里面
    const start = wxml.search(/<view[^>]*class="sent\b/);
    expect(start).toBeGreaterThan(-1);
    const openTag = wxml.slice(start, wxml.indexOf('>', start) + 1);
    const hasLongpress = /bindlongpress=|catchlongpress=/.test(openTag);

    let depth = 0;
    let end = -1;
    const re = /<view\b| <\/view>/g;
    re.lastIndex = start;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wxml)) !== null) {
      if (m[0] === '</view>') {
        depth -= 1;
        if (depth === 0) { end = m.index; break; }
      } else {
        depth += 1;
      }
    }
    const scope = wxml.slice(start, end > 0 ? end : wxml.length);
    const cnInside = /class="sent-cn/.test(scope);
    const cnSwallows = /class="sent-cn[^"]*"[^>]*catchlongpress/.test(scope);

    // 判据：如果中文块在 longpress 作用域内，它必须自己 catchlongpress 吞掉事件
    if (hasLongpress && cnInside) {
      expect(cnSwallows).toBe(true);
    }
  });
});

describe('H4 词卡朗读按钮形态（R-READ-03：icon 而非文字「朗读」）', () => {
  it('两页词卡朗读按钮都必须是 ▶/■ icon 且带 aria-label', () => {
    for (const f of [HOME_WXML, DETAIL_WXML]) {
      const wxml = read(f);
      const btn = (wxml.match(/class="(?:q-tip-btn|wt-play)[^"]*"[^>]*>[^<]*</g) || []).join('\n');
      expect(btn).not.toBe('');
      // 不得是纯文字「朗读 / 停止」
      expect(btn).not.toMatch(/>\s*\{\{[^}]*\?\s*'停止'\s*:\s*'朗读'\}\}\s*</);
      expect(wxml).toMatch(/aria-label="\{\{[^}]*aria[^}]*\}\}"/);
    }
  });
});
