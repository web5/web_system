/// <reference types="node" />
/**
 * 2026-11-26 长按抽屉盲测 8 条缺陷 · 修复守卫（静态 + 纯函数）
 *
 * 定位：独立盲测的 156 条回归用例已**全量合入**本目录（`nce-blind-*` / `home-blind-*` /
 * `action-drawer-blind-*` / `tts-blind-*` / `glossary-blind-*` / `collect-blind-*`），
 * 它们覆盖行为与结构。本文件只补「行为用例钉不住、但改回去就会复发」的**形态契约**——
 * 尤其是两条视觉缺陷（P1-1 朗读图标、P1-3 对比度）在机器门里没有真机渲染可依据，
 * 只能把「尺寸 / 颜色 / 无障碍属性」写成数字断言钉死。
 *
 * 判据真源：
 *  - AC-3.1 / 3.3 / 3.4、AC-B.25：词卡朗读按钮 = 圆形 ▶/■ 图标；热区 ≥88rpx、视觉 60rpx、图标 32rpx；
 *    aria-label 随形态切换（「朗读单词」/「停止朗读」）；原型 `.btn-icon`（原型-变体B-底部抽屉.html:294-302, 613-614）
 *  - AC-1.2（经 AC-B.26 继续有效）：首页英文句 ≥26rpx 且对比度 ≥4.5:1
 *  - E4 后半：长按瞬间按下高亮（反馈）；E3：收藏 meta 带 hasDef；BB16：连字符整词
 *  - BB6：下滑起点在动作按钮上不响应拖拽；U1：重复句时 ■ 落在实际朗读的那句
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tokenize } from '../utils/tokenize';
import { ARIA_WORD_PLAY, ARIA_WORD_STOP } from '../utils/line-actions';

const APP = path.join(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(APP, p), 'utf8');
const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const ruleOf = (css: string, sel: string): string => {
  const cleaned = stripCss(css);
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = cleaned.match(re);
  return m ? m[1] : '';
};

const DETAIL_WXML = 'pages/nce/detail/detail.wxml';
const DETAIL_WXSS = 'pages/nce/detail/detail.wxss';
const DETAIL_TS = 'pages/nce/detail/detail.ts';
const HOME_WXML = 'pages/home/index/index.wxml';
const HOME_WXSS = 'pages/home/index/index.wxss';
const HOME_TS = 'pages/home/index/index.ts';

// ═════════════════════ P1-1 词卡朗读按钮 = 圆形播放图标 ═════════════════════
//
// 🔴 2026-11-27 改写（用户真机反馈②「播放 icon 跟抽屉的不一致，真机下更差，不是 svg icon」）：
//    上一条实现把 ▶/■ 用 **CSS border 三角** 画在 `.wt-ico::before` / `.q-tip-ico::before` 上，
//    抽屉用的是**另一份** CSS 三角（还是橙色 #C2410C），首页卡片干脆是**正文字符** `▶ 朗读`。
//    三处三种画法 = 真机上三种观感。现在统一成一套 SVG（assets/icons/*.svg）。
//    ⇒ 本组断言的**对象**从「伪元素三角的 border-width」换成「<image src> 指向哪个 SVG + 32rpx」，
//      强度不降反升：除了尺寸，还把「图标必须是同一套资产」和「色值必须等于 token」一起钉住。
describe('P1-1 朗读按钮形态：圆形 ▶/■ 图标 + 热区 88rpx + aria-label 双态（AC-3.1/3.3/3.4）', () => {
  const CASES = [
    { page: '详情页', wxml: DETAIL_WXML, wxss: DETAIL_WXSS, btn: 'wt-play', ico: 'wt-ico', hv: 'wt-play-hv', playing: 'tipPlaying', tap: 'speakTipWord' },
    { page: '首页', wxml: HOME_WXML, wxss: HOME_WXSS, btn: 'q-tip-play', ico: 'q-tip-ico', hv: 'q-tip-play-hv', playing: 'quoteWordPlaying', tap: 'speakQuoteWord' },
  ] as const;

  it.each(CASES)('$page：热区 ≥88rpx ⊃ 视觉圆 60rpx ⊃ 图标 32rpx（不是文字药丸）', ({ wxss, btn, ico }) => {
    const css = read(wxss);
    const hot = ruleOf(css, `.${btn}`);
    const w = Number((hot.match(/width:\s*([\d.]+)rpx/) || [])[1]);
    const h = Number((hot.match(/height:\s*([\d.]+)rpx/) || [])[1]);
    expect(w).toBeGreaterThanOrEqual(88); // AC-3.3 触控热区下限
    expect(h).toBeGreaterThanOrEqual(88);
    const circle = ruleOf(css, `.${ico}`);
    expect(Number((circle.match(/width:\s*([\d.]+)rpx/) || [])[1])).toBe(60); // 视觉直径
    expect(Number((circle.match(/height:\s*([\d.]+)rpx/) || [])[1])).toBe(60);
    expect(circle).toMatch(/border-radius:\s*999rpx/); // 圆形而非胶囊/文字底
    // 图标 = 32rpx 的 <image>（三处统一基准；image 无显式宽高会按 24px 固有像素撑开）
    const img = ruleOf(css, `.${ico}-img`);
    expect(Number((img.match(/width:\s*([\d.]+)rpx/) || [])[1])).toBe(32);
    expect(Number((img.match(/height:\s*([\d.]+)rpx/) || [])[1])).toBe(32);
    // 反向：CSS 三角那套画法必须彻底消失（回潮即红 —— 那正是「三处不一致」的源头）
    expect(stripCss(css)).not.toMatch(new RegExp(`\\.${ico}::before`));
    expect(stripCss(css)).not.toMatch(/border-width:\s*9rpx 0 9rpx 14rpx/);
    // 不再有文字形态的字号/内边距痕迹（旧实现 font-size + padding + pill 圆角）
    expect(hot).not.toMatch(/font-size/);
  });

  it.each(CASES)('$page：wxml 用 aria-role=button + aria-label 双态，图标是同一个 SVG 三元切换', ({ wxml, btn, ico, playing, tap }) => {
    const w = read(wxml);
    const viewedTags = w.match(/<view class="[^"]*"[\s\S]{0,300}?>/g) || [];
    const tag = viewedTags.find((t) => t.includes(btn)) || '';
    expect(tag).not.toBe('');
    expect(tag).toMatch(/aria-role="button"/);
    // 双态文案：来自共享常量（页面 data 注入），插值名必须让静态扫描认得出是 aria 文案
    expect(tag).toMatch(new RegExp(`aria-label="\\{\\{${playing} \\? ariaStopWord : ariaPlayWord\\}\\}"`));
    // 子节点 = 圆形底 + <image> 图标；图标走 utils/icons 的 play/stop 同一套资产
    expect(w).toMatch(new RegExp(`<view class="${ico}">`));
    expect(w).toMatch(
      new RegExp(`<image class="${ico}-img" mode="aspectFit" src="\\{\\{${playing} \\? icons\\.stop : icons\\.play\\}\\}"`),
    );
    /**
     * 回归反例：**这个按钮**仍然是「文字药丸」（`{{播放态 ? '停止' : '朗读'}}`）即红。
     * 🔴 断言范围必须限定在本按钮内，不能扫整页：首页页脚 .dq-act 的文案本来就是
     * `{{quotePlaying ? '停止' : '朗读'}}`（它也有图标，合法）。扫整页会误红 —— 这一版就踩过。
     */
    const at = w.indexOf(`catchtap="${tap}"`);
    expect(at).toBeGreaterThan(-1);
    const scope = w.slice(at, at + 600);
    expect(scope).not.toMatch(/\{\{[^}]*\?\s*'停止'\s*:\s*'朗读'\}\}/);
  });

  it('两页的 aria 文案取自共享常量（不各写一份字面量）', () => {
    expect(ARIA_WORD_PLAY).toBe('朗读单词');
    expect(ARIA_WORD_STOP).toBe('停止朗读');
    for (const f of [HOME_TS, DETAIL_TS]) {
      const src = stripJs(read(f));
      expect(src).toMatch(/ariaPlayWord:\s*ARIA_WORD_PLAY/);
      expect(src).toMatch(/ariaStopWord:\s*ARIA_WORD_STOP/);
      // 页面里不得再出现动作文案字面量（另一条守卫在 A2，此处对 aria 文案同样要求）
      expect(src).not.toMatch(/['"]朗读单词['"]/);
      expect(src).not.toMatch(/['"]停止朗读['"]/);
    }
  });
});

// ═════════════════ P1-1b 图标资产：一套 SVG + 色值必须等于 token ═════════════════
//
// 为什么必须把「色值」也钉成断言：`<image>` 是图片，**不能继承 CSS color**，
// 所以 play/stop/star/check 的颜色只能烘进 SVG 文件本身。这就有「改了 app.wxss 的 token、
// 忘了改 SVG」的漂移风险 —— 与 app.wxss「新增页面一律从这里取色，禁止硬编码色值」直接冲突。
// 这里做**双向对账**：SVG 里的色值必须等于 app.wxss 里对应 token 的字面值。
describe('P1-1b 图标资产：三处共用一套 SVG，色值与 app.wxss token 对账', () => {
  const tokenOf = (name: string): string => {
    const app = read('app.wxss');
    const m = app.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    expect(m).not.toBeNull();                 // 防空转：token 真的在 app.wxss 里
    return m![1].toUpperCase();
  };

  it('5 个图标资产存在，且都是 svg', () => {
    for (const f of ['play', 'stop', 'star', 'star-filled', 'check']) {
      const p = `assets/icons/${f}.svg`;
      const svg = read(p);
      expect(svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
      expect(svg).toMatch(/viewBox="0 0 24 24"/);
    }
  });

  it('播放/停止/未收藏 = --brand-deep；已收藏(✓/★) = --accent-ink（改 token 不跟着改 SVG 即红）', () => {
    const brand = tokenOf('brand-deep');
    const accent = tokenOf('accent-ink');
    expect(brand).toBe('#1D4ED8');
    expect(accent).toBe('#0F766E');
    for (const f of ['play', 'stop', 'star']) {
      expect(read(`assets/icons/${f}.svg`).toUpperCase()).toContain(brand);
    }
    for (const f of ['check', 'star-filled']) {
      expect(read(`assets/icons/${f}.svg`).toUpperCase()).toContain(accent);
    }
  });

  it('图标路径只有 utils/icons 一份真源：三个模板 + 组件里不得出现 /assets/icons/ 字面量', () => {
    const iconsTs = read('utils/icons.ts');
    for (const f of ['play', 'stop', 'star', 'star-filled', 'check']) {
      expect(iconsTs).toContain(`/assets/icons/${f}.svg`);
    }
    // wxml 不能 import ts，路径必须经 data 插值 —— 模板里出现字面量就是第二份真源
    for (const f of [DETAIL_WXML, HOME_WXML, 'components/action-drawer/index.wxml']) {
      expect(read(f)).not.toMatch(/\/assets\/icons\//);
    }
    for (const f of [DETAIL_TS, HOME_TS, 'components/action-drawer/index.ts']) {
      expect(read(f)).not.toMatch(/['"]\/assets\/icons\//);
    }
  });

  it('三个模板的每个 <image> 图标都带 mode="aspectFit"（默认 scaleToFill 会把三角/方块拉变形）', () => {
    for (const f of [DETAIL_WXML, HOME_WXML, 'components/action-drawer/index.wxml']) {
      const imgs = read(f).match(/<image\b[^>]*\/>/g) || [];
      expect(imgs.length).toBeGreaterThan(0);   // 防空转
      for (const tag of imgs) {
        expect(tag).toMatch(/mode="aspectFit"/);
      }
    }
  });

  /**
   * 🔴 2026-11-27 新增（变异验证补洞）：抽屉这一处以前只被上面那条「每个 image 带 aspectFit」间接覆盖 ——
   * 把 `.ad-ico` 整个换回 `<text>▶/■</text>` 时，上面那条会以「imgs.length 为 0」的方式变红，
   * 报错信息指向 aspectFit，**指不出真正的回归**（用户反馈②的原始形态：字符画法）。
   * 这里把抽屉图标是 `<image>` 这件事本身钉住，并反向禁掉字符画法。
   * 注意：详情页行尾 `.sent-stop` 的 `■` 是 U1 的既有合法设计，不在本条范围（故只查抽屉模板）。
   */
  it('抽屉动作图标 = <image src="{{… item.ico/icoOn}}">，不许退回 ▶/■ 字符画法（反馈②的根因形态）', () => {
    const w = read('components/action-drawer/index.wxml').replace(/<!--[\s\S]*?-->/g, '');
    // 播放态切的是**组件自己算好的 item.icoOn**（循环体不能引用页面 data，见 wxml-for-item-scope 守卫）
    expect(w).toMatch(
      /<image class="ad-ico" mode="aspectFit" src="\{\{playingKey === item\.key \? item\.icoOn : item\.ico\}\}" \/>/,
    );
    expect(w).not.toMatch(/[▶◀■□]/);
    // 模板里只有 1 处图标节点（4 项/2 项由 wx:for 展开），多了就是第二套画法
    expect((w.match(/class="ad-ico"/g) || []).length).toBe(1);
    // 反向：CSS 三角那套画法不许回潮（旧实现是 .ad-ico-play / .ad-ico-stop 的 border 三角）
    const css = stripCss(read('components/action-drawer/index.wxss'));
    expect(css).not.toMatch(/\.ad-ico-play/);
    expect(css).not.toMatch(/\.ad-ico-stop/);
    expect(css).not.toMatch(/border-left:\s*[\d.]+rpx solid transparent/);
  });
});

// ═════════════════════ P1-3 首页英文句可见性 ═════════════════════
describe('P1-3 首页英文句：26rpx + 正文近黑，且不动全局 --t3（AC-1.2）', () => {
  it('.daily-en 字号 26rpx、颜色 #1A1A1F（对比度 ≈17:1）', () => {
    const body = ruleOf(read(HOME_WXSS), '.daily-en');
    expect(Number((body.match(/font-size:\s*([\d.]+)rpx/) || [])[1])).toBe(26);
    expect(body).toMatch(/color:\s*#1A1A1F/);
    expect(body).not.toMatch(/var\(--t3\)/);
  });

  it('全局 --t3 未被顺手改动（它仍被别处灰字依赖）', () => {
    const app = read('app.wxss');
    expect(app).toMatch(/--t3:\s*rgba\(60,\s*60,\s*67,\s*\.34\)/);
  });
});

// ═════════════════════ P2-4 长按瞬间按下高亮 ═════════════════════
describe('P2-4 按下高亮：长按态 class + touch 生命周期（E4 后半）', () => {
  const CASES = [
    { page: '详情页', wxml: DETAIL_WXML, wxss: DETAIL_WXSS, ts: DETAIL_TS, cls: 'w-pressed', key: 'pressedWordKey' },
    { page: '首页', wxml: HOME_WXML, wxss: HOME_WXSS, ts: HOME_TS, cls: 'dw-pressed', key: 'pressedWordKey' },
  ] as const;

  it.each(CASES)('$page：词节点带按下态类插值 + touchstart/touchend 挂钩', ({ wxml, cls, key }) => {
    const w = read(wxml);
    expect(w).toMatch(new RegExp(`\\{\\{${key} === [^}]*\\? '${cls}' : ''\\}\\}`));
    expect(w).toMatch(/bindtouchstart="onWordPressStart"/);
    expect(w).toMatch(/bindtouchend="onWordPressEnd"/);
    expect(w).toMatch(/bindtouchcancel="onWordPressEnd"/);
  });

  it.each(CASES)('$page：按下态样式存在，且不是静态标记（裸词节点无背景/点线）', ({ wxss, cls }) => {
    const css = stripCss(read(wxss));
    expect(ruleOf(css, `.${cls}`)).toMatch(/background:/);
    // E4 前半仍然成立：静态外观不给普通词任何标记
    const bare = cls === 'w-pressed' ? ruleOf(css, '.w') : ruleOf(css, '.dw');
    expect(bare).not.toMatch(/border-bottom|text-decoration|background/);
  });

  it.each(CASES)('$page：按下态由 touch 生命周期驱动（按下记 key，松手清空，K9 切走也清）', ({ ts, key }) => {
    const src = stripJs(read(ts));
    expect(src).toMatch(new RegExp(`${key}:\\s*-1`));
    expect(src).toMatch(new RegExp(`setData\\(\\{\\s*${key}:\\s*key\\s*\\}\\)`));
    expect(src).toMatch(new RegExp(`setData\\(\\{\\s*${key}:\\s*-1\\s*\\}\\)`));
  });
});

// ═════════════════════ P2-5 连字符整词 ═════════════════════
describe('P2-5 连字符词整词一个 token（BB16）', () => {
  it('well-known / state-of-the-art 整词', () => {
    expect(tokenize('a well-known writer').filter((t) => t.w).map((t) => t.w)).toEqual([
      'a',
      'well-known',
      'writer',
    ]);
    expect(tokenize('a state-of-the-art lab').filter((t) => t.w).map((t) => t.w)).toEqual([
      'a',
      'state-of-the-art',
      'lab',
    ]);
  });

  it('反例：独立连字符 / 破折号 / 词尾连字符不得被并进词（否则 data-w 会带标点）', () => {
    expect(tokenize('a - b').filter((t) => t.w).map((t) => t.w)).toEqual(['a', 'b']);
    expect(tokenize('well- done').filter((t) => t.w).map((t) => t.w)).toEqual(['well', 'done']);
    expect(tokenize('page—turn').filter((t) => t.w).map((t) => t.w)).toEqual(['page', 'turn']);
  });

  it('片段拼接仍原样还原句子（切词不改写原文）', () => {
    for (const en of ['A well-known fact.', "I don't know — well-known?", 'a - b', '']) {
      expect(tokenize(en).map((t) => t.t).join('')).toBe(en);
    }
  });
});

// ═════════════════════ P2-6 动作按钮区不参与下滑拖拽 ═════════════════════
describe('P2-6 下滑手势不从按钮区起拖（BB6）', () => {
  // 🔴 2026-11-26 真机缺陷修：本条断言的方向被**反转**过。
  //    原断言要求 `.ad-acts` 必须 `catchtouchstart="noop"` —— 那是「结构层吞掉触摸」的实现，
  //    但微信父节点 catch 掉 touchstart 会让子节点 tap 失效（官方社区 000a248b7b0ff0183bb74180153c00），
  //    导致四个动作按钮全部点不动（抽屉不关 / 不朗读 / 不收藏）。
  //    现在断言的是**相反的契约**：这个容器上只允许 catchtouchmove，出现 catchtouchstart 即红。
  it('结构层：.ad-acts 只 catch 掉 touchmove；🔴 绝不许出现 catchtouchstart（会吃掉子按钮 tap）', () => {
    const w = read('components/action-drawer/index.wxml');
    const actsTag = (w.match(/<view class="ad-acts"[^>]*>/) || [''])[0];
    expect(actsTag).toMatch(/catchtouchmove="noop"/);
    expect(actsTag).not.toMatch(/catchtouchstart/);
    expect(actsTag).not.toMatch(/catch:touchstart/);
    // 同一条命脉上：抽屉根节点不得绑任何 tap（父 catchtap 有吃掉子 tap 的争议，且它本无作用）
    const drawerTag = (w.match(/<view\s+class="ad-drawer[\s\S]*?>/) || [''])[0];
    // 🔴 先证明「真的抓到了那个标签」再断言内容 —— 否则正则失配时 drawerTag 是空串，
    //    not.toMatch 会**空转通过**（本轮变异验证时真踩过这个坑）。
    expect(drawerTag).toMatch(/^<view\s/);
    expect(drawerTag).toMatch(/bindtouchstart="onTouchStart"/);
    expect(drawerTag).not.toMatch(/catchtap/);
    expect(drawerTag).not.toMatch(/bindtap/);
    /**
     * 🔴 2026-11-26 补的假绿盲区（测试员实测）：根节点同样是「按钮命脉」上的可疑节点 ——
     * 给 `.ad-drawer` 加回 `catchtouchstart="noop"`，四个按钮会全部点不动（父 catch 吃掉
     * touchstart → 子节点 tap 不派发），但旧守卫只盯 `.ad-acts`，全量 58/58 仍全绿。
     * 所以根节点必须同样禁 catchtouchstart（含 `catch:touchstart` 冒号写法）。
     */
    expect(drawerTag).not.toMatch(/catchtouchstart/);
    expect(drawerTag).not.toMatch(/catch:touchstart/);
    /**
     * 🔴🔴 P0（2026-11-26 假绿暴露面审计）：只查 `.ad-acts` + `.ad-drawer` **两处**仍然治不了本病 ——
     * 把 `catchtouchstart` 挪到**最外层 `.ad` 容器**（或任何新的抽屉系祖先节点）上，同一个 bug 原地
     * 复活（四按钮 tap 全灭）而套件全绿。所以口径是「**所有抽屉系起始标签**都不得出现它」：
     *   · 取全部 `<view …>` 起始标签；
     *   · class 里去掉 `{{…}}` 插值后按空白拆 token；
     *   · 任一 token 命中「抽屉系」判定的算数。
     *
     * 🔴🔴 2026-11-27 P2 收严（独立盲测）：「抽屉系」原口径是 token **精确等于** `ad` 或 `ad-drawer`，
     * 两个漏洞：① 将来新增 `class="ad-inner"` 之类节点**不会被纳入**（它自身或它的祖先能 catch 掉
     * touchstart，bug 照样复活，而测试全绿）；② 只断 `length >= 2`，挡不住「本该抓到 3 个却只抓到 2 个」。
     * 现在改成**前缀匹配** + **三个节点点名断言**（外框 `.ad` / 抽屉本体 `.ad-drawer` / 动作区
     * `.ad-acts` 缺一个即红）。注意 `ad-mask` 上确实有 `catchtouchmove="noop"` —— 只禁
     * `catchtouchstart`，不许把 touchmove 也禁掉（那是拦页面滚动穿透用的）。
     *
     * 抽屉系 token 的判定口径：**前缀** `/^ad(-|$)/`。
     * 覆盖 `ad` / `ad-drawer` / `ad-acts` / `ad-mask` / `ad-close` / `ad-inner` …；
     * 不误纳 `adx` / `x-ad` / `bad`（否则将来某个无关 class 会被拖进来当抽屉系白名单成员）。
     *
     * ⚠️ 覆盖面 = `<view>` 起始标签 ∩ class token 命中 `ad-*` 前缀，**不是全覆盖**。已知逃逸面：
     *   ① 命名不在 `ad-*` 家族（另起 `class="sheet-body"` 的容器挂 catchtouchstart）；
     *   ② class 全插值（`class="{{wrapCls}}"`）—— 静态扫描拿不到 token；
     *   ③ 非 `<view>` 起始标签（`<text>` / `<block>` / `<scroll-view>` …，目前本组件没有）。
     * ①② 已于 2026-11-27 独立盲测实测确认「挂上 catchtouchstart 仍 25/25 全绿」。
     * ⇒ 新增抽屉系节点请沿用 `ad-` 前缀；机器兜底交给下面 ④ 的**绝对口径**。
     *
     * 🔴 裁定理由（2026-11-27 纠正上一版的说法）：上一版这里写「**静态正则本质上无法穷尽** ⇒
     *    所以边界只落成文字、不写成断言」——那句结论不成立，且与本用例下方 ④ 自相矛盾（④ 就是
     *    把 ①②③ 一起封住的**断言**）。准确表述：
     *      · 对 ① 命名不在 `ad-*` 与 ③ 非 view 标签，「静态正则无法穷尽」**不成立**：它们只是
     *        「**用 class token 去匹配**」这一条路抓不到，换一个不依赖 class 名的口径就抓得到；
     *      · 只有 ② class 全插值，其真值由运行时 data 决定，静态确实无法预知；
     *      · 因此结论不是「放弃断言」，而是「**换掉匹配口径**」：不依赖 class 名、也不依赖标签
     *        类型，直接禁「任何起始标签上的 catchtouchstart」。② 的「具体哪个节点在跑」虽不可知，
     *        但「凡是节点就一律不许挂」这条绝对禁令照样把它封死。
     * ⇒ ①②③ 已**落地为 ④ 绝对口径**（见本用例下方）；上面那段「覆盖面边界」文字只作为
     *   「为什么会有 ④」的解释保留，不再具备「所以不写断言」的含义。
     */
    const isDrawerToken = (tok: string): boolean => /^ad(-|$)/.test(tok);
    // 筛子自测：口径本身也要被钉住，否则「改个正则」就能静默放宽（含「新增节点自动纳入」）
    for (const t of ['ad', 'ad-drawer', 'ad-acts', 'ad-mask', 'ad-close', 'ad-inner', 'ad-foo-bar']) {
      expect(isDrawerToken(t)).toBe(true);
    }
    for (const t of ['', 'adx', 'x-ad', 'adx-drawer', 'bad', 'ad_acts']) {
      expect(isDrawerToken(t)).toBe(false);
    }

    const viewTags = w.match(/<view\b[^>]*>/g) || [];
    /** 起始标签 → class token 数组（丢掉 `{{…}}` 插值：里面是三元表达式，不是 class 名） */
    const tokensOf = (tag: string): string[] =>
      ((tag.match(/class="([^"]*)"/) || ['', ''])[1])
        .replace(/\{\{[^}]*\}\}/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const drawerish = viewTags.filter((tag) => tokensOf(tag).some(isDrawerToken));
    /** 按 token **精确**取节点（不走前缀）—— 用于点名断言「这三个确实被抓到了」 */
    const tagsWithToken = (tok: string): string[] =>
      viewTags.filter((tag) => tokensOf(tag).indexOf(tok) >= 0);

    // ① 点名断言：三个关键抽屉系节点必须在场，且都被前缀筛选纳入
    //    外框 `.ad` / 抽屉本体 `.ad-drawer` / 动作区 `.ad-acts` —— 缺一个即红（比 `>=2` 强，
    //    能挡住「本该抓到 3 个里的 3 个，实际只抓到 2 个」）
    const NAMED = ['ad', 'ad-drawer', 'ad-acts'];
    for (const tok of NAMED) {
      const hits = tagsWithToken(tok);
      expect(hits.length).toBe(1);              // 唯一命中（同名多节点时下面的断言才有意义）
      const tag = hits[0];
      expect(tag).toMatch(/^<view\s/);          // 🔴 先证「真的抓到了那个标签」，防空转
      expect(drawerish).toContain(tag);         // 且确实被前缀口径纳入（不是漏网后被点名兜住的）
      // 抽屉系节点不得 catch 掉 touchstart（父节点 catch touchstart → 子按钮 tap 全灭）
      expect(tag).not.toMatch(/catchtouchstart/);
      expect(tag).not.toMatch(/catch:touchstart/);
    }

    // ② 全部抽屉系节点逐条禁 catchtouchstart（前缀口径：新增 ad-* 节点自动纳入）
    expect(drawerish.length).toBeGreaterThanOrEqual(NAMED.length);   // 防空转
    for (const tag of drawerish) {
      expect(tag).not.toMatch(/catchtouchstart/);
      expect(tag).not.toMatch(/catch:touchstart/);
    }
    // ③ 反向保险：`.ad-mask` 的 catchtouchmove（拦页面滚动穿透）不许被顺手删掉
    expect(tagsWithToken('ad-mask')[0] || '').toMatch(/catchtouchmove="noop"/);

    /**
     * ④ 🔴🔴 **绝对口径**（2026-11-27 team-lead 批准，`rd-engineer-drawer-guards-commit` 提出）：
     * 上面基于 class token 的筛选有**三类已实测逃逸**（见函数头注释：非 `ad-*` 命名 /
     * class 全插值 / 非 `<view>` 标签），改成「本文件内**任何**起始标签都不许 catchtouchstart」，
     * 三条一起封掉：
     *   · 不需要 class 名 → 封「非 `ad-*` 命名」（`sheet-body` 那类）；
     *   · 不需要 token   → 封「class 全插值」（`class="{{wrapCls}}"`）；
     *   · 不限标签类型   → 封「非 `<view>` 标签」。
     * 为什么成立：本组件 wxml 整个文件就是抽屉本身，**任何**节点 catch 掉 touchstart 都是同一个
     * bug（父 catch → 子按钮 tap 全灭），不存在「合法的 catchtouchstart」；反向也没有误红面
     * （`catchtouchmove="noop"` 不在禁令内，`.ad-mask` 那条照样保留）。
     *
     * 🔴 使用注意：**别在本文件或组件 wxml 的注释里写「完整起始标签 + catchtouchstart」的示例** ——
     *    注释也会被这条正则扫到（`viewTags` / `allTags` 都不剥注释），会自己把自己测红。
     *    正则要求 `<` 后紧跟字母，所以 `<!--` 不会被命中；但写成真标签形态就会。
     */
    const allTags = w.match(/<[a-zA-Z][\w-]*\b[^>]*>/g) || [];
    expect(allTags.length).toBeGreaterThanOrEqual(10);   // 防空转前置（当前实测 16 个 <view> + 其余标签）
    for (const tag of allTags) {
      expect(tag).not.toMatch(/catchtouchstart/);
      expect(tag).not.toMatch(/catch:touchstart/);
    }
    /**
     * 🔴 2026-11-26 补的零覆盖项：根节点必须保留 `bindtouchcancel="onTouchEnd"`。
     * 缺它 → 手势被系统打断（来电 / 下拉通知栏 / 手势冲突）时 touchend 不触发，
     * `dragging` 永远为 true、`swipeY` 停在半路 → 抽屉歪着停住且 transition 关闭（拖不动也回不去）。
     * 旧守卫对这条零覆盖，删掉它全量测试仍全绿。
     */
    expect(drawerTag).toMatch(/bindtouchcancel="onTouchEnd"/);
    /**
     * 🔴 2026-11-26 补的假绿盲区：`.ad-act` 必须带 `data-key="{{item.key}}"`。
     * 把 `data-key` 改成 `data-k`：`onActionTap` 取不到 key → **四个按钮全哑**（不朗读、不收藏、
     * 抽屉不关），而旧守卫只断「有 catchtap="onActionTap"」，全量测试仍全绿。变异验证踩过。
     * 先断言「确实抓到了按钮标签」再验内容，防空转。
     */
    const actTag = (w.match(/<view\s+wx:for="\{\{acts\}\}"[\s\S]*?>/) || [''])[0];
    expect(actTag).toMatch(/^<view\s/);
    expect(actTag).toMatch(/data-key="\{\{item\.key\}\}"/);
    expect(actTag).toMatch(/data-kind="\{\{item\.kind\}\}"/);
    // 动作按钮自身的 catchtap 必须在（事件到页面的唯一出口）
    expect((w.match(/<view[\s\S]*?catchtap="onActionTap"/) || [''])[0]).not.toBe('');
  });

  it('逻辑层兜底：onTouchStart 在动作区高度带内直接返回（不置 _hasStart、不 setData）', () => {
    const src = stripJs(read('components/action-drawer/index.ts'));
    /**
     * 动作区带高 208rpx = 2 行 × 96rpx + grid `gap:16rpx`（+ 抽屉 padding-bottom 24rpx 后
     * 上沿 232rpx；取 208 是保守方向，见 index.ts 常量的算术注释）。
     * 旧值 192rpx 漏了 gap 与 padding，按钮带上沿 24~40rpx 会被误判成「可起拖」。
     */
    expect(src).toMatch(/ACTS_ZONE_RPX\s*=\s*208/);
    expect(src).toMatch(/_startedInActsZone\(/);
    const start = (src.match(/onTouchStart\(e: TouchEventLike\)\s*\{([\s\S]*?)\n {4}\},/) || ['', ''])[1];
    expect(start).toMatch(/_startedInActsZone\(startY\)/);
    // 早退必须在写 _hasStart 之前
    expect(start.indexOf('_startedInActsZone')).toBeLessThan(start.indexOf('_hasStart = true'));
  });

  it('三个关闭通道不受影响（遮罩 / ✕ 仍只抛 close，下滑阈值仍是 48rpx）', () => {
    const src = stripJs(read('components/action-drawer/index.ts'));
    expect(src).toMatch(/SWIPE_CLOSE_RPX\s*=\s*48/);
    expect(src).toMatch(/_emitClose\('mask'\)/);
    expect(src).toMatch(/_emitClose\('close'\)/);
    expect(src).toMatch(/_emitClose\('swipe'\)/);
  });
});

// ═════════════════════ P2-7 长按中文行不弹抽屉 ═════════════════════
describe('P2-7 长按只响应英文原文区域（AC-B.27）', () => {
  it('详情页中文块 .sent-cn 自己 catchlongpress 吞掉事件', () => {
    const w = read(DETAIL_WXML);
    const cnTag = (w.match(/<view[^>]*class="sent-cn[^"]*"[^>]*>/) || [''])[0];
    expect(cnTag).toMatch(/catchlongpress="onCnLongPress"/);
    expect(stripJs(read(DETAIL_TS))).toMatch(/onCnLongPress\(\)\s*\{\s*\}/);
  });

  it('首页同口径：长按只挂 .daily-en（不含中文行 / 页脚按钮）', () => {
    const w = read(HOME_WXML);
    expect(w).toMatch(/class="daily-en"\s+catchlongpress="onQuoteLineLongPress"/);
    const dailyTag = (w.match(/<view class="daily"[\s\S]{0,200}?>/) || [''])[0];
    expect(dailyTag).not.toMatch(/longpress/);
  });
});

// ═════════════════════ P2-8 重复句 ■ 定位 ═════════════════════
describe('P2-8 重复句时 ■ 落在实际朗读的那一句（U1）', () => {
  /**
   * 🔴 2026-11-26 变体 C 改写（**不是放松**，是入口变了）：
   * 原用例断「`onDrawerSpeakLine` 里写 `this._lineHint = this._playingIdx`」。
   * 朗读下沉到组件后（用户拍板），页面的 `onDrawerSpeakLine` **已被删除** ——
   * 抽屉朗读时页面拿不到「用户读的是哪一句」，`_lineHint` 不再被写入（只在读词 / 换课 / 卸载复位）。
   * 因此这里改成守住「改写后仍然成立」的那两条：
   *  ① 页面**不得**再出现抽屉朗读 handler（删了就别回潮，回潮 = 重复朗读一次）；
   *  ② 定位链本身不许退化成「只靠文本反查」：`_resolveLineIdx` 的 hint 校验分支必须还在
   *     （未来任何「页面自己发起的整句朗读」入口仍然要能定位重复句），`_onSpeakState` 必须走它。
   * 残留风险已写进回执「遗留」：抽屉内朗读重复句时，页面侧 ■ 只能落到文本反查的第一句
   * （此时抽屉还开着、■ 被抽屉遮住；抽屉关闭即 stopSpeak，所以不影响用户可见行为）。
   */
  it('定位链不退化成纯文本反查：_resolveLineIdx 仍先校验 hint，_onSpeakState 仍走它', () => {
    const src = stripJs(read(DETAIL_TS));
    // ① 抽屉朗读 handler 已删除（回潮即红）
    expect(src).not.toMatch(/onDrawerSpeakLine/);
    expect(src).not.toMatch(/onDrawerSpeakWord/);
    // ② 定位链：字段仍在，hint 校验 + 文本反查两条分支都在
    expect(src).toMatch(/_lineHint:\s*-1/);
    const onState = (src.match(/_onSpeakState\(s: SpeakState \| null\)\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
    expect(onState).toMatch(/this\._resolveLineIdx\(text\)/);
    expect(onState).not.toMatch(/this\._lineIdxOf\(text\)/);
    const resolve = (src.match(/_resolveLineIdx\(text: string\): number\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
    expect(resolve).toMatch(/lines\[hint\]/);
    expect(resolve).toMatch(/return this\._lineIdxOf\(t\)/);
  });

  it('读单词 / 换课 / 卸载仍要把 hint 复位为 -1（■ 语义只属于句子朗读）', () => {
    const src = stripJs(read(DETAIL_TS));
    const resets = src.match(/this\._lineHint = -1;/g) || [];
    expect(resets.length).toBeGreaterThanOrEqual(4); // 读词 + load + goLesson + onUnload
    expect(src).toMatch(/speakTipWord[\s\S]{0,400}?this\._lineHint = -1/);
  });
});

// ═════════════════════ P1-2 收藏 meta.hasDef（两页同口径） ═════════════════════
describe('P1-2 详情页收藏 meta 带 hasDef（E3/E5）', () => {
  it('详情页 meta 显式写 hasDef，取值回落查词结果而不是写死', () => {
    const src = stripJs(read(DETAIL_TS));
    const fn = (src.match(/async onDrawerCollectWord\(e: DrawerEvent<CollectWordDetail>\)\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
    expect(fn).toMatch(/const hasDef = typeof d\.hasDef === 'boolean' \? d\.hasDef : !info\.none/);
    expect(fn).toMatch(/hasDef,\s*\n?\s*\},/);
  });

  it('两页写的 meta 都含 hasDef（消费方 pages/mine/glossary 只认 m.hasDef === false）', () => {
    expect(stripJs(read(HOME_TS))).toMatch(/hasDef,\s*\n\s*from: 'daily',/);
    expect(stripJs(read('pages/mine/glossary/index.ts'))).toMatch(/it\.tag === 'word' && m\.hasDef === false/);
  });
});
