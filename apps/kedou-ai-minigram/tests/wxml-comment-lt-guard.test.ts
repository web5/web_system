/// <reference types="node" />
/**
 * WXML 注释守卫 · 入口（kedou 侧）
 *
 * ⚠️ 本文件只做接线 + 断言，**不要在这里写判据**。
 *    三条判据（R1 裸 `<` / R2 注释边界字面量 / R3 注释落在开始标签属性列表内部）
 *    与文件收集的唯一实现是仓库根共享层 `scripts/lib/wxml-lt-guard.ts`；
 *    另一个入口是 `apps/dachengzi-minigram/tests/wxml-comment-lt-guard.test.ts`。
 *
 * 为什么科豆也要一个入口（本文件是本轮**新增**的）：
 *   R3 判据原先只写在大橙子侧，科豆**完全无覆盖** —— 大橙子炸过一次的地方，
 *   科豆一次都没查过。2026-11-27 大橙子整包编译失败（`unexpected character '<'` →
 *   pageStack 空 → 所有真机 E2E 全红）的根因正是 `<action-drawer …>` 属性列表里夹注释，
 *   而两个 app 的 WXML 写法同源（同一批人、同一套组件习惯）。
 *   `scripts/ci/changed-packages.sh` 按 diff 只跑改动子包的 test，所以科豆必须有自己的入口，
 *   否则「改科豆」的 CI 跑不到这张网。
 *
 * 现状（2026-11-27 实测）：科豆 37 个 wxml，R1 / R2 / R3 **均 0 命中** ——
 *   本文件是**防回归守卫**，不是修 bug。哪天有人把注释写进开始标签，这里会先红，
 *   不必等到真机出码炸包。
 *
 * 🔴 第一组三块用例是**守守卫**（判据鉴别力）：只对真实文件断言的话，判据被改成恒不匹配
 *    也照样全绿 —— 那就是「只绿不红」的假守卫。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  findNakedLt,
  findCommentBoundaryLiteral,
  findCommentInsideStartTag,
  collectWxmlFiles,
} from '../../../scripts/lib/wxml-lt-guard';

const APP = path.resolve(__dirname, '..');

// ═════════════════════ 守守卫：判据本身必须有鉴别力 ═════════════════════
describe('判据自身（纯函数）', () => {
  it('🔴 裸 `<` 必须被抓到：空格 / 中文 / 数字 三种形态', () => {
    const cases = [
      '<!-- 胶囊高 48rpx < 朗读圆钮 88rpx 热区 -->',   // ← 大橙子事故形态（后面是空格）
      '<!-- 胶囊高 48rpx <朗读圆钮 88rpx 热区 -->',     // 后面直接中文
      '<!-- 尺寸 <48rpx 就够 -->',                      // 后面数字
    ];
    for (const src of cases) {
      expect(findNakedLt(src).length).toBeGreaterThan(0);
    }
  });

  it('合法标签名引用不许误报（`<view>` / `<text` / 闭合 `</view>` / `<!DOCTYPE`）', () => {
    const ok = [
      '<!-- 用 <view> 包一层 -->',
      '<!-- 这里是 <text class="dw"> 节点 -->',
      '<!-- 闭合写成 </view> 即可 -->',
      '<!-- 不要写 <!DOCTYPE -->',
      '<!-- 三元 <view wx:if="{{a}}"> 合法 -->',
    ];
    for (const src of ok) expect(findNakedLt(src)).toEqual([]);
  });

  it('行号按文件内绝对行数算（不是注释内相对行）', () => {
    const src = 'line1\nline2\n<!-- 前面正常\n这里有裸 < 号\n-->\nline6\n';
    const hits = findNakedLt(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);                    // 「这里有裸 < 号」是第 4 行
  });

  it('注释外的 `<` 不归本守卫管（那是模板语法自己的事，别制造假红）', () => {
    // 正文里的 `<` 必然是标签开头，非法写法会被开发者工具在别处直接报错
    expect(findNakedLt('<view>{{ a }} is fine</view>')).toEqual([]);
  });
});

// ═════════════════════ 守守卫 · R2：注释边界字面量 ═════════════════════
describe('判据自身 · R2（注释正文里的注释边界字面量）', () => {
  it('🔴 正文里写注释开头 → 必须抓到（大橙子第二颗雷的真实形态）', () => {
    const bad = '<!-- 🔴 注释只能写在标签外面：起始标签内部不认 <!-- 那套写法，写进去会炸 -->';
    const hits = findCommentBoundaryLiteral(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('🔴 裸反引号紧跟小于号（第二颗雷炸出来的那个字符）也要能被这条兜住', () => {
    // 真实事故里剩下的裸文本是 `...unexpected character <` 的闭合反引号
    const bad = '<!-- 说明：不认 <!-- -->，剩下的 ` 会再炸一次 -->';
    expect(findCommentBoundaryLiteral(bad).length).toBeGreaterThanOrEqual(1);
  });

  it('正文里写注释结尾字面量（贪婪配对时的形态）也要被抓', () => {
    // 非贪婪配对下这条用例构造不出「命中」，所以直接喂贪婪匹配语义的字符串：
    // 一旦有人把配对改成贪婪，正文里就会出现 `-->`，这条判据仍然有效。
    const src = '<!-- a <!-- b --> c -->';
    const hits = findCommentBoundaryLiteral(src);
    expect(hits.length).toBeGreaterThanOrEqual(1);      // 命中 `<!--`（正文里的嵌套开头）
  });

  it('没配成对的 `<!--`（把后面内容全吞掉）算违规', () => {
    const src = '<view>\n<!-- 这段注释没有收尾\n id="x"\n</view>\n';
    const hits = findCommentBoundaryLiteral(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('合法注释（无边界字面量）不许误报', () => {
    const ok = [
      '<!-- 祖先链是 ad → 页面根 <view class="page"> -->',
      '<!-- 三个短横连写是允许的：— 与 - 不同；但注释边界字面量不许写 -->',
      '<view class="a"><!-- 注释在标签外面 --></view>',
      '<!-- 多行\n     正文继续\n     再一行 -->',
    ];
    for (const src of ok) expect(findCommentBoundaryLiteral(src)).toEqual([]);
  });
});

// ═════════════════════ 守守卫 · R3：注释落在开始标签属性列表内部 ═════════════════════
describe('判据自身 · R3（注释落在开始标签属性列表内部）', () => {
  it('🔴 真实事故形态必须抓到：属性列表中间插注释（大橙子 home:146 的形态）', () => {
    const bad = [
      '<view class="page">',
      '  <action-drawer',
      '    id="drawer"',
      '    <!-- D7 已收藏动作 key 的唯一通道 -->',
      '    collected-keys="{{collectedKeys}}"',
      '  />',
      '</view>',
    ].join('\n');
    const hits = findCommentInsideStartTag(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);                 // 指向注释那一行，不是标签行
    expect(hits[0].tag).toBe('action-drawer');
    expect(hits[0].snippet).toContain('D7');
  });

  it('同一标签里插两条注释 → 两条都抓到（不是报第一条就收工）', () => {
    const bad = '<action-drawer\n  <!-- a -->\n  id="x"\n  <!-- b -->\n/>';
    const hits = findCommentInsideStartTag(bad);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.line)).toEqual([2, 4]);
    expect(hits.every((h) => h.tag === 'action-drawer')).toBe(true);
  });

  it('合法形态一律不许误报：标签前 / 自闭合后 / 单行已闭合标签之后 / 多行标签之后', () => {
    const ok = [
      '<!-- 在开始标签之前 -->\n<action-drawer id="x" collected-keys="{{a}}" />',
      '<action-drawer id="x" />\n<!-- 在自闭合标签之后 -->',
      '<view class="a"><!-- ok --></view>',                       // 注释在已闭合开始标签之后
      '<action-drawer\n  id="x"\n  collected-keys="{{a}}"\n/>\n<!-- 在整段属性之后 -->',
      '<!-- 前 -->\n<view>\n  <!-- 中 -->\n  <text>{{t}}</text>\n</view>\n<!-- 后 -->',
      '<view>\n  <text>读作 a 小于 b</text>\n</view>\n<!-- 收尾注释 -->',
    ];
    for (const src of ok) expect(findCommentInsideStartTag(src)).toEqual([]);
  });

  it('属性值里的 `>` / 引号 / `{{ }}` 不许把标签边界切断（既不误报也不漏报）', () => {
    // 属性值里的 `>` 不能让解析器提前认为标签结束 → 无注释，不该报
    expect(findCommentInsideStartTag('<view title="{{a > b}}" id="x" />')).toEqual([]);
    // 同一个文件里，属性值含 `>` 之后紧跟的注释仍必须判为「在标签内」
    const bad = '<view title="{{a > b}}"\n  <!-- 仍在属性列表里 -->\n  id="x" />';
    const hits = findCommentInsideStartTag(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].tag).toBe('view');
  });

  it('文本态注释里的 `<` / `>` 不许干扰状态机（必须整块跳过）', () => {
    // 注释正文里提到 <view> / <text>：若不跳过，注释里的 `>` 会被当成标签结尾而错乱
    const src = '<!-- 提到 <view> 与 ad → 页面根 -->\n<!-- 提到 <text> -->\n<view id="x" />\n<!-- 尾 -->';
    expect(findCommentInsideStartTag(src)).toEqual([]);
    // 反向：跳过注释后，紧随其后的「标签内注释」仍要能抓到
    const mixed = '<!-- 前面 <view> 正常 -->\n<view\n  <!-- 这条在属性列表里 -->\n  id="x" />';
    const hits = findCommentInsideStartTag(mixed);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
    expect(hits[0].tag).toBe('view');
  });
});

// ═════════════════════ 真实文件全量扫描 · R1 ═════════════════════
describe('全仓库 WXML 注释零裸小于号', () => {
  const files = collectWxmlFiles(APP);

  it('凡是出现在注释里的 `<`，后面必须是标签名（否则整包编译失败）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const hit of findNakedLt(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${path.relative(APP, f)}:${hit.line}  …${hit.snippet}…`);
      }
    }
    // 失败信息直接给出「文件:行号 + 片段」：出码事故里最耗时间的就是定位是哪一行
    expect(offenders).toEqual([]);
  });

  it('防空转：确实扫到了文件，且确实存在合法标签名引用（判据不是恒不匹配）', () => {
    expect(files.length).toBeGreaterThan(10);        // 科豆 37 个 wxml，下界放宽
    const withTagRef = files.filter((f) => /<!--[\s\S]*?<[A-Za-z/]/.test(fs.readFileSync(f, 'utf8')));
    expect(withTagRef.length).toBeGreaterThan(0);    // 扫到 0 说明正则坏了（不是「没问题」）
  });
});

// ═════════════════════ 真实文件全量扫描 · R2 ═════════════════════
describe('全仓库 WXML 注释正文零注释边界字面量（R2）', () => {
  const files = collectWxmlFiles(APP);

  it('任何注释块的正文里都不许出现 `<!--` / `-->`，也不许留下没配对的 `<!--`', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const hit of findCommentBoundaryLiteral(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${path.relative(APP, f)}:${hit.line}  …${hit.snippet}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('防空转：判据在这批真实文件里真的跑过（配对成功数 > 0）', () => {
    const withComment = files.filter((f) => /<!--([\s\S]*?)-->/.test(fs.readFileSync(f, 'utf8')));
    expect(withComment.length).toBeGreaterThan(0);
    expect(withComment.map((f) => path.relative(APP, f))).toContain('pages/nce/detail/detail.wxml');
  });
});

// ═════════════════════ 真实文件全量扫描 · R3（本次真因） ═════════════════════
describe('全仓库 WXML 注释零「落在属性列表内部」（R3）', () => {
  const files = collectWxmlFiles(APP);

  it('任何注释块的起始位置都不许落在某个开始标签的属性列表内部', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const h of findCommentInsideStartTag(fs.readFileSync(f, 'utf8'))) {
        // 失败信息给「文件:行号 + 标签名 + 片段」，出码事故里最耗时的就是定位
        offenders.push(`${path.relative(APP, f)}:${h.line}  <${h.tag}>  …${h.snippet}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('防空转：确实扫到 > 10 个 wxml，且多行开始标签 + 标签外注释同时存在的文件被扫到', () => {
    expect(files.length).toBeGreaterThan(10);
    const withComment = files.filter((f) => /<!--/.test(fs.readFileSync(f, 'utf8')));
    expect(withComment.length).toBeGreaterThan(0);
    // 「多行开始标签 + 紧贴其前的注释」正是事故形态；一个都扫不到说明扫描器根本没在跑（恒绿）。
    // 锚点取科豆真实存在的两处（nce/detail 与大橙子事故文件同名同形态）。
    const multiLineTag = files.filter((f) =>
      /<[A-Za-z][\w-]*[^>]*\n[\s\S]*?\/?>/.test(fs.readFileSync(f, 'utf8')));
    expect(multiLineTag.length).toBeGreaterThan(0);
    expect(multiLineTag.map((f) => path.relative(APP, f))).toContain('pages/nce/detail/detail.wxml');
    expect(multiLineTag.map((f) => path.relative(APP, f))).toContain('pages/chat/index/index.wxml');
  });
});
