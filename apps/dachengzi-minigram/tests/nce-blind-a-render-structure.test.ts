/**
 * 🔵 RD 独立盲测 A 组：渲染结构与公共层复用（静态判据）
 *
 * 判据来源（需求真源，不看实现注释）：
 *  - V-B17 / AC-B.28：两页「所有 tk.w 都是节点」；`wx:if="{{tk.w && tk.hasDef}}"` 计数 = 0
 *  - AC-B.28：catchlongpress 挂全部单词（不得按 hasDef 分流）
 *  - E1：catchtap 挂全部单词，守卫在函数里（静态只能验「挂了 + 有守卫」，行为由 C/D 组验）
 *  - AC-B.7 / AC-B.33：同一组件两档；两页同口径；不许出现第二份动作表 / 第二份抽屉结构
 *  - AC-B.3 / V-B2：抽屉链路无坐标绑定
 *  - D6/D7/AC-B.20-22：遮罩 .34 / 不透明白底 / env(safe-area-inset-bottom) / 40vh(+48vh) / 104rpx
 *  - U1：详情页行尾 ■ 仅在 readingLineIdx===si 渲染；首页**不得**出现 .sent-stop
 *  - 组件不得 import services（方案 §3.3 红线）
 */
/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(APP, p), 'utf8');

const HOME_WXML = 'pages/home/index/index.wxml';
const DETAIL_WXML = 'pages/nce/detail/detail.wxml';
const DRAWER_WXML = 'components/action-drawer/index.wxml';
const DRAWER_WXSS = 'components/action-drawer/index.wxss';
const DRAWER_TS = 'components/action-drawer/index.ts';
const DRAWER_JSON = 'components/action-drawer/index.json';

describe('A1 渲染结构：所有英文 token 都是节点（V-B17）', () => {
  it.each([HOME_WXML, DETAIL_WXML])('%s 不存在 wx:if="{{tk.w && tk.hasDef}}" 分流', (f) => {
    const w = read(f);
    expect(w).not.toMatch(/tk\.w\s*&&\s*tk\.hasDef/);
    expect(w).not.toMatch(/wx:if="\{\{\s*tk\.w\s*&&\s*tk\.hasDef/);
  });

  it.each([HOME_WXML, DETAIL_WXML])('%s 单词节点 wx:if 只判 tk.w，点线由 has-def 插值控制', (f) => {
    const w = read(f);
    const m = w.match(/<text\s+[^>]*wx:if="\{\{tk\.w\}\}"[^>]*>([\s\S]*?)<\/text>/g) || [];
    expect(m.length).toBeGreaterThan(0);
    const node = m[0];
    // 渲染条件只看 tk.w
    expect(node).toMatch(/wx:if="\{\{tk\.w\}\}"/);
    // 生词点线由插值控制（不是渲染条件）
    expect(node).toMatch(/has-def/);
    expect(node).toMatch(/\{\{tk\.hasDef \?/);
  });

  it.each([
    [HOME_WXML, /catchlongpress="onQuoteWordLongPress"/, /catchtap="onQuoteWordTap"/],
    [DETAIL_WXML, /catchlongpress="onWordLongPress"/, /catchtap="onWordTap"/],
  ])('%s 单词节点同时挂 catchlongpress + catchtap', (f, lp, tp) => {
    const w = read(f);
    const nodes = w.match(/<text\s+[^>]*wx:if="\{\{tk\.w\}\}"[^>]*>/g) || [];
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n).toMatch(lp as RegExp);
      expect(n).toMatch(tp as RegExp);
      // catchlongpress 不得被 hasDef 条件包住（不许分流）
      expect(n).not.toMatch(/wx:if="\{\{[^"]*hasDef[^"]*\}\}"/);
    }
  });

  it('token 循环带 wx:key="idx"（嵌套 wx:for 下默认 index 遮蔽是 P0 同源缺陷）', () => {
    expect(read(HOME_WXML)).toMatch(/wx:for="\{\{quoteTokens\}\}"[^>]*wx:key="idx"/);
    expect(read(DETAIL_WXML)).toMatch(/wx:for="\{\{line\.tokens\}\}"[^>]*wx:key="idx"/);
    // 详情页外层句子循环也必须有 item 别名，否则内层 tk 与外层 item 串味
    expect(read(DETAIL_WXML)).toMatch(/wx:for="\{\{lines\}\}"[^>]*wx:for-item="line"/);
    expect(read(HOME_WXML)).toMatch(/wx:for="\{\{quoteTokens\}\}"[^>]*wx:for-item="tk"/);
    expect(read(DETAIL_WXML)).toMatch(/wx:for="\{\{line\.tokens\}\}"[^>]*wx:for-item="tk"/);
  });
});

describe('A2 公共层复用：不许第二份动作表 / 第二份抽屉结构', () => {
  it('页面 wxml 不出现抽屉结构（.ad-mask / .ad-drawer / .ad-acts）', () => {
    for (const f of [HOME_WXML, DETAIL_WXML]) {
      const w = read(f).replace(/<!--[\s\S]*?-->/g, ''); // 注释里的说明文字不算
      expect(w).not.toMatch(/class="[^"]*\bad-mask\b/);
      expect(w).not.toMatch(/class="[^"]*\bad-drawer\b/);
      expect(w).not.toMatch(/class="[^"]*\bad-acts\b/);
      // 用的是组件
      expect(w).toMatch(/<action-drawer[\s\S]*?\/>/);
    }
  });

  it('页面 ts 不出现第二份动作文案常量（朗读此句/收藏此句 不得以字符串字面量出现在代码里）', () => {
    for (const f of ['pages/home/index/index.ts', 'pages/nce/detail/detail.ts']) {
      const src = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(src).not.toMatch(/['"]朗读此句['"]/);
      expect(src).not.toMatch(/['"]收藏此句['"]/);
      expect(src).not.toMatch(/['"]朗读单词['"]/);
      expect(src).not.toMatch(/['"]收藏单词['"]/);
    }
  });

  /**
   * 🔴 2026-11-26 A8 收窄（与 `tests/action-drawer.test.ts` 的 A8 组同一口径）：
   * 原断言是「组件只 import utils/line-actions，且不 import 任何 services」。
   * 朗读下沉到组件是**用户 2026-11-26 拍板**（设计真源 `原型-变体C-抽屉内朗读.html`：
   * 抽屉持有原文，朗读不再回页面中转）→ 组件必须能调 `services/tts`；其余 services
   * （glossary / auth / nce / account …）仍一律禁止，收藏与两页授权差异继续留在页面。
   * 所以断言收窄成「恰好两个 import：line-actions + services/tts」。
   */
  it('组件只 import utils/line-actions 与 services/tts（其余 services 一律禁止）', () => {
    const ts = read(DRAWER_TS);
    const imports = ts.match(/^import .*$/gm) || [];
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatch(/from '\.\.\/\.\.\/utils\/line-actions'/);
    expect(imports[1]).toMatch(/from '\.\.\/\.\.\/services\/tts'/);
    const servicesImports = ts.match(/from '[^']*services\/[^']*'/g) || [];
    expect(servicesImports).toEqual(["from '../../services/tts'"]);
    expect(ts).not.toMatch(/require\(['"][^'"]*services\//);
  });

  it('组件 json 钉 styleIsolation=isolated（D6 不透明白底不随阅读档变化）', () => {
    const j = JSON.parse(read(DRAWER_JSON));
    expect(j.component).toBe(true);
    expect(j.styleIsolation).toBe('isolated');
  });
});

describe('A3 无坐标（AC-B.3 / V-B2）', () => {
  it('组件 wxml 无 left:{{}} / top:{{}} 绑定', () => {
    const w = read(DRAWER_WXML).replace(/<!--[\s\S]*?-->/g, '');
    expect(w).not.toMatch(/left:\{\{/);
    expect(w).not.toMatch(/top:\{\{/);
  });

  it('组件 ts 链路无坐标测量 API', () => {
    const ts = read(DRAWER_TS).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(ts).not.toMatch(/createSelectorQuery\s*\(/);
    expect(ts).not.toMatch(/boundingClientRect/);
    expect(ts).not.toMatch(/scrollOffset/);
    expect(ts).not.toMatch(/750\s*\/\s*windowWidth/);
  });

  it('两页 ts 的抽屉入口方法不读 touches / 不测坐标', () => {
    for (const f of ['pages/home/index/index.ts', 'pages/nce/detail/detail.ts']) {
      const src = read(f);
      const m =
        src.match(/onWordLongPress\([\s\S]*?\n {2}\}/) ||
        src.match(/onQuoteWordLongPress\([\s\S]*?\n {2}\}/);
      expect(m).not.toBeNull();
      expect(m![0]).not.toMatch(/touches|pageX|clientX|boundingClientRect|SelectorQuery/);
    }
  });
});

describe('A4 抽屉样式口径（D1/D2/D6/D7 + AC-B.20/B.22）', () => {
  const css = read(DRAWER_WXSS);
  it('D1/D7 高度自适应 + max-height:40vh，<360px 放宽 48vh', () => {
    expect(css).toMatch(/\.ad-drawer\s*\{[\s\S]*max-height:\s*40vh/);
    expect(css).toMatch(/@media\s*\(max-width:\s*359px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*359px\)\s*\{[\s\S]*max-height:\s*48vh/);
  });
  it('D6 白色底 + 遮罩 rgba(17,24,39,.34)', () => {
    expect(css).toMatch(/\.ad-drawer\s*\{[\s\S]*background:\s*#FFFFFF/);
    expect(css).toMatch(/\.ad-mask\s*\{[\s\S]*rgba\(17,\s*24,\s*39,\s*\.34\)/);
  });
  it('层级：遮罩 1000 < 抽屉 1001', () => {
    const maskZ = Number((css.match(/\.ad-mask\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
    const drZ = Number((css.match(/\.ad-drawer\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
    expect(maskZ).toBe(1000);
    expect(drZ).toBe(1001);
  });
  it('D7 安全区 env(safe-area-inset-bottom)', () => {
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
  });
  it('AC-B.20 格高 96rpx，<360px 补 104rpx', () => {
    expect(css).toMatch(/\.ad-act\s*\{[\s\S]*height:\s*96rpx/);
    expect(css).toMatch(/@media\s*\(max-width:\s*359px\)\s*\{[\s\S]*\.ad-act\s*\{\s*height:\s*104rpx/);
  });
  it('D2 2×2：grid 两列（行=对象 / 列=动词）', () => {
    expect(css).toMatch(/\.ad-acts\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr/);
  });
  it('AC-B.16 关闭动效只改 transform（不改定位方式）', () => {
    expect(css).toMatch(/\.ad-drawer\s*\{[\s\S]*position:\s*fixed/);
    expect(css).toMatch(/transition:\s*transform/);
  });
});

describe('A5 U1 停止入口归属（19:15 拍板）', () => {
  it('详情页：■ 仅在 readingLineIdx===si 时渲染，点击 = stopLineSpeak', () => {
    const w = read(DETAIL_WXML);
    expect(w).toMatch(
      /<text\s+wx:if="\{\{readingLineIdx === si\}\}"\s+class="sent-stop"\s+catchtap="stopLineSpeak">■<\/text>/,
    );
  });
  it('首页：不得出现 .sent-stop 行尾节点 / stopQuoteSpeak 绑定（U1 冗余已去重）', () => {
    const w = read(HOME_WXML);
    expect(w).not.toMatch(/class="sent-stop"/);
    expect(w).not.toMatch(/stopQuoteSpeak/);
  });
  it('首页停止入口唯一：页脚 .dq-act 一处（catchtap="speakQuote"）', () => {
    const w = read(HOME_WXML).replace(/<!--[\s\S]*?-->/g, '');
    const stops = w.match(/■\s*停止/g) || [];
    expect(stops).toHaveLength(1);
  });
});

describe('A6 词卡播放按钮 = 播放 icon（R-READ-03 / AC-3.1~3.4 / AC-B.25）', () => {
  it('详情页 .wt-play 与首页 .q-tip-btn 必须是 ▶/■ 圆形 icon 且带 aria-label', () => {
    const d = read(DETAIL_WXML);
    const h = read(HOME_WXML);
    // 判据：icon 形态（▶ / ■ 字形），而不是文字「朗读」「停止」
    expect(d).toMatch(/class="wt-play[\s\S]{0,200}?aria-label="/);
    expect(d).not.toMatch(/class="wt-play[^"]*"[^>]*>\{\{[^}]*\?\s*'停止'\s*:\s*'朗读'\}\}/);
    expect(h).toMatch(/class="q-tip-btn[\s\S]{0,200}?aria-label="/);
    expect(h).not.toMatch(/class="q-tip-btn[^"]*"[^>]*>\{\{[^}]*\?\s*'停止'\s*:\s*'朗读'\}\}/);
  });
});
