/// <reference types="node" />
/**
 * WXML 注释里的裸 `<` 编译守卫（2026-11-27 出码失败 P0）
 *
 * 事故：`pages/nce/detail/detail.wxml:151` 的注释里写了裸小于号
 *   `尺寸按 .wt-tools 的 gap 8rpx 收（胶囊高 48rpx < 朗读圆钮 88rpx 热区）`
 *   → 微信开发者工具 `code:10 / Error: 146:7:unexpected character '<'`（`✖ compile_start`），
 *   **整包编译失败**，连烧两轮出码。
 *
 * 为什么 1053 条静态测试全绿却漏掉：本仓库没有一条测试会去**编译** WXML。所有既有 wxml 用例
 * 都是 `readFileSync` + 正则/字符串匹配，字符级语法错误对它们完全不可见。这条守卫补的就是这个
 * 缺口里唯一「静态可判」的那一类：注释内裸 `<`。
 *
 * 判据（为什么允许 `<view>` 却禁止 `< 朗读`）：
 *  - **合法**：注释里提到标签名，`<` 后面紧跟 ASCII 字母（`<view>`、`<text`、`<image`）
 *    或 `/`（闭合标签 `</view>`）——解析器看到 `<` 会当成标签开头去**读标签名**，
 *    读到合法标识符就正常吃掉，v1.0.20 起就有多处这种写法，能编译；
 *  - **违规**：`<` 后面是空格 / 中文 / 数字 / 标点——标签名读不出来，
 *    `unexpected character '<'`，整个包编译失败；
 *  - **为什么用「小于」而不是 `&lt;`**：注释不参与渲染，`&lt;` 在注释里不会被解码，
 *    读者看到的是一串实体，可读性差且容易被下一个人「顺手改回来」；写中文零歧义。
 *
 * 🔴 本文件的第一组用例是**守守卫**（纯函数鉴别力）：只对真实文件断言，
 *    哪天正则被写成恒不匹配，全量扫描照样全绿 —— 那就是「只绿不红」的假守卫。
 */
export {};

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');

/** 单条违规：文件内行号（1-based）+ 出事片段，便于直接定位 */
type NakedLt = { line: number; snippet: string };

/**
 * 找出 `src` 里所有 WXML 注释块中的裸 `<`。
 *
 * 抽成纯函数是为了能被单测直接喂样例（见「守守卫」用例）——
 * 只有对真实文件跑，无法证明这个判据真的会红。
 *
 * 规则：`<` 后既不是 ASCII 字母（标签名）也不是 `/`（闭合标签）就算违规。
 * `!` 一并放行：注释里提到 `<!DOCTYPE` 之类同样能编译，不制造无谓误报。
 */
function findNakedLtInComments(src: string): NakedLt[] {
  const out: NakedLt[] = [];
  const commentRe = /<!--[\s\S]*?-->/g;
  let m: RegExpExecArray | null;
  while ((m = commentRe.exec(src))) {
    const body = m[0];
    const badRe = /<(?![A-Za-z/!])/g;
    let b: RegExpExecArray | null;
    while ((b = badRe.exec(body))) {
      const abs = m.index + b.index;
      const line = src.slice(0, abs).split('\n').length;
      const from = Math.max(0, abs - 16);
      out.push({ line, snippet: src.slice(from, abs + 18).replace(/\s+/g, ' ') });
    }
  }
  return out;
}

/** 递归收集 app 下所有 .wxml（跳过 node_modules / .git） */
function collectWxml(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectWxml(p, out);
    else if (e.name.endsWith('.wxml')) out.push(p);
  }
  return out;
}

// ═════════════════════ 守守卫：判据本身必须有鉴别力 ═════════════════════
describe('判据自身（纯函数）', () => {
  it('🔴 裸 `<` 必须被抓到：空格 / 中文 / 数字 三种形态', () => {
    const cases = [
      '<!-- 胶囊高 48rpx < 朗读圆钮 88rpx 热区 -->',   // ← 本次事故形态（后面是空格）
      '<!-- 胶囊高 48rpx <朗读圆钮 88rpx 热区 -->',     // 后面直接中文
      '<!-- 尺寸 <48rpx 就够 -->',                      // 后面数字
    ];
    for (const src of cases) {
      expect(findNakedLtInComments(src).length).toBeGreaterThan(0);
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
    for (const src of ok) expect(findNakedLtInComments(src)).toEqual([]);
  });

  it('行号按文件内绝对行数算（不是注释内相对行）', () => {
    const src = 'line1\nline2\n<!-- 前面正常\n这里有裸 < 号\n-->\nline6\n';
    const hits = findNakedLtInComments(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);                    // 「这里有裸 < 号」是第 4 行
  });

  it('注释外的 `<` 不归本守卫管（那是模板语法自己的事，别制造假红）', () => {
    // 正文里的 `<` 必然是标签开头，非法写法会被开发者工具在别处直接报错
    expect(findNakedLtInComments('<view>{{ a }} is fine</view>')).toEqual([]);
  });
});

// ═════════════════════ 真实文件全量扫描 ═════════════════════
describe('全仓库 WXML 注释零裸小于号', () => {
  const files = collectWxml(APP);

  it('凡是出现在注释里的 `<`，后面必须是标签名（否则整包编译失败）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const hit of findNakedLtInComments(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${path.relative(APP, f)}:${hit.line}  …${hit.snippet}…`);
      }
    }
    // 失败信息直接给出「文件:行号 + 片段」：出码事故里最耗时间的就是定位是哪一行
    expect(offenders).toEqual([]);
  });

  it('防空转：确实扫到了文件，且确实存在合法标签名引用（判据不是恒不匹配）', () => {
    expect(files.length).toBeGreaterThan(10);        // app 下 14 个 wxml，下界放宽
    const withTagRef = files.filter((f) => /<!--[\s\S]*?<[A-Za-z/]/.test(fs.readFileSync(f, 'utf8')));
    expect(withTagRef.length).toBeGreaterThan(0);    // v1.0.20 起就有多处，扫到 0 说明正则坏了
  });
});
