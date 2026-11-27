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
 *
 * ── 2026-11-27 补第二条（R2）：注释正文里写了**注释边界字面量** ──
 * 同一次事故还有第二颗雷，而且是「修 bug 引入的」：
 *   `91ba68a3` 之前那版把「尖括号 + 感叹号 + 两个短横」写进注释正文去解释问题，
 *   外层注释被**提前闭合**，剩下的裸反引号变成裸文本，再炸一次
 *   （`140:36: unexpected character '`'`）。只防裸 `<` 的守卫抓不到它。
 * 判据（R2）：每个注释块的**正文**里不许出现注释开头 `<!--`，也不许出现注释结尾 `-->`；
 *   另外「没配成对的 `<!--`」（把后面所有内容吞掉）同样算违规。
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

/**
 * R2：找出「注释正文里写了注释边界字面量」的地方。
 *
 * 为什么这条必须单独测：`findNakedLtInComments` 只查 `<` 后面跟什么，
 * 而 `<!--` 的 `<` 后面跟的是 `!`（被判为合法）—— 于是
 * `<!-- 起始标签内部不认 <!-- 那套写法 -->` 这种正文**能过第一条守卫**，
 * 但真编译会炸：外层注释在正文那个 `-->` 处提前闭合，剩下的字（含裸反引号）变裸文本。
 *
 * 两点实现说明（与需求字面表述的差异，先讲清楚）：
 *  ① 取正文用**捕获组**（`<!--([\s\S]*?)-->` 的 `m[1]`），而不是 `m[0].slice(4)`：
 *     `m[0].slice(4)` 保留了结尾的 `-->`，再断言「不含 `-->`」就是恒红；
 *  ② 非贪婪配对下 `m[1]` 里**不可能**出现 `-->`（遇到就配对了），所以「不含 `-->`」
 *     这半条在当前配对方式下不可达 —— 保留它是为了「配对方式哪天被改成贪婪」时仍然有网；
 *     真正会命中的是 `<!--`（嵌套开头）与「没配成对的 `<!--`」（下面第三类）。
 */
function findCommentBoundaryLiteral(src: string): NakedLt[] {
  const out: NakedLt[] = [];
  const commentRe = /<!--([\s\S]*?)-->/g;
  const hit = (abs: number): NakedLt => ({
    line: src.slice(0, abs).split('\n').length,
    snippet: src.slice(Math.max(0, abs - 16), abs + 18).replace(/\s+/g, ' '),
  });
  let m: RegExpExecArray | null;
  let endOfLast = 0;
  while ((m = commentRe.exec(src))) {
    const body = m[1];
    const at = body.search(/<!--|-->/);
    if (at >= 0) out.push(hit(m.index + 4 + at));       // 正文里出现注释边界
    endOfLast = m.index + m[0].length;
  }
  // 第三类：剩下还有没配成对的 `<!--` —— 它会把后面所有内容吞掉（正文/属性全变注释）
  const dangling = src.indexOf('<!--', endOfLast);
  if (dangling >= 0) out.push(hit(dangling));
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

// ═════════════════════ 守守卫 · R2：注释边界字面量 ═════════════════════
describe('判据自身 · R2（注释正文里的注释边界字面量）', () => {
  it('🔴 正文里写注释开头 → 必须抓到（v1.0.21 第二颗雷的真实形态）', () => {
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

// ═════════════════════ 真实文件全量扫描 · R2 ═════════════════════
describe('全仓库 WXML 注释正文零注释边界字面量（R2）', () => {
  const files = collectWxml(APP);

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
