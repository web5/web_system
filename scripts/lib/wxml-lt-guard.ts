/// <reference types="node" />
/**
 * wxml-lt-guard — 「WXML 注释里裸 `<` / 注释边界字面量 / 注释落在开始标签内部」判据的**唯一实现**
 *
 * 三条判据（R1 / R2 / R3）连同文件收集都住在本文件；两个小程序各有一个入口测试：
 *   `apps/dachengzi-minigram/tests/wxml-comment-lt-guard.test.ts`
 *   `apps/kedou-ai-minigram/tests/wxml-comment-lt-guard.test.ts`
 * 入口只做 import + 断言，**不要在这里之外再抄一份判据**。
 *
 * 为什么必须共享而不是各 app 各抄一份：
 *   `scripts/ci/changed-packages.sh` 按 diff 归属的包逐个跑 test（`:25-27` 取 `apps/<pkg>`，
 *   `:86-97` 只对该包跑 test）——kedou 有改动时只跑 kedou 的 tests，dachengzi 反之。
 *   两个 app 各要一个入口；规则若写两份，改判据时必然漏改一处、慢慢漂移（与
 *   `scripts/lib/no-dev-copy-in-wxml.ts` 同一个理由）。
 *   R3 原先只写在大橙子侧，科豆完全无覆盖 —— 本次上移正是为了补这个洞。
 *
 * ─────────────────────────── 判据来源（2026-11-27 出码失败 P0） ───────────────────────────
 *
 * 事故 A（R1）：`pages/nce/detail/detail.wxml:151` 的注释里写了裸小于号
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
 * 🔴 每个入口测试的第一组用例都是**守守卫**（纯函数鉴别力）：只对真实文件断言，
 *    哪天正则被写成恒不匹配，全量扫描照样全绿 —— 那就是「只绿不红」的假守卫。
 *
 * ── R2：注释正文里写了**注释边界字面量** ──
 * 同一次事故还有第二颗雷，而且是「修 bug 引入的」：
 *   `91ba68a3` 之前那版把「尖括号 + 感叹号 + 两个短横」写进注释正文去解释问题，
 *   外层注释被**提前闭合**，剩下的裸反引号变成裸文本，再炸一次
 *   （`140:36: unexpected character '`'`）。只防裸 `<` 的守卫抓不到它。
 * 判据（R2）：每个注释块的**正文**里不许出现注释开头 `<!--`，也不许出现注释结尾 `-->`；
 *   另外「没配成对的 `<!--`」（把后面所有内容吞掉）同样算违规。
 *
 * ── R3：注释写进了**开始标签的属性列表内部** ──
 * 这才是 v1.0.21 首版真正炸的那一处，也是 R1 / R2 同时放行的一处：
 *   `<action-drawer id="…"  <!-- D7 注释 -->  collected-keys="…" />`
 *   WXML 起始标签内部**不认** HTML 注释那套写法 —— 解析器从 `<action-drawer` 起按
 *   「标签名 + 属性列表」读，读到 `<!--` 的 `<` 后的 `!` 当属性名，报
 *   `unexpected character '<'`（真机原文 `./pages/home/index/index.wxml:146:7`），
 *   **整包编译失败** → pageStack 空 → 所有真机用例全红（含一向稳定的 A-tabs）。
 * 为什么 R1 / R2 抓不到：R1 里 `<!--` 的 `<` 后面跟的是 `!`，被判为合法；R2 里注释自身
 *   配对完整、正文没写边界字面量 → 通过。两条守卫全绿，真机依然炸 = 假绿。
 * 判据（R3）：注释块的起始位置若落在某个**开始标签的属性列表内部**
 *   （最近的未闭合开始标签的 `<` 之后，到该标签的 `>` 或 `/>` 之前）即违规。
 *   注释在标签**之前** / 标签**之后** / 已闭合标签之后，一律放行。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 单条违规：文件内行号（1-based）+ 出事片段，便于直接定位 */
export type NakedLt = { line: number; snippet: string };

/** R3 的违规：额外带上「注释落在哪个开始标签的属性列表里」 */
export type CommentInTag = { line: number; snippet: string; tag: string };

/**
 * R1：找出 `src` 里所有 WXML 注释块中的裸 `<`。
 *
 * 抽成纯函数是为了能被单测直接喂样例（见「守守卫」用例）——
 * 只有对真实文件跑，无法证明这个判据真的会红。
 *
 * 规则：`<` 后既不是 ASCII 字母（标签名）也不是 `/`（闭合标签）就算违规。
 * `!` 一并放行：注释里提到 `<!DOCTYPE` 之类同样能编译，不制造无谓误报。
 */
export function findNakedLt(src: string): NakedLt[] {
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
 * 兼容别名：大橙子侧入口测试沿用的原函数名（`findNakedLtInComments`）。
 * 保留别名是为了让上移这次重构**不动既有用例名与断言**（只改 import），
 * 新代码请直接用 `findNakedLt`。
 */
export const findNakedLtInComments = findNakedLt;

/**
 * R2：找出「注释正文里写了注释边界字面量」的地方。
 *
 * 为什么这条必须单独测：`findNakedLt` 只查 `<` 后面跟什么，
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
export function findCommentBoundaryLiteral(src: string): NakedLt[] {
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

/**
 * R3：找出「注释块起始位置落在某个**开始标签的属性列表内部**」的地方 ——
 * 本次事故的真因，R1 / R2 都放行它（详见文件头 R3 段）。
 *
 * 扫描方式（一条单遍状态机，两个关键点）：
 *  ① 文本态遇到 `<!--` ⇒ 这是**合法**注释，必须**整块跳过**。
 *     不跳过的话，注释正文里的 `<` / `>` 会被下一条分支当成标签边界，状态机直接错乱
 *     （注释里写「`<view>`」是常见写法，v1.0.20 起就有多处）。
 *  ② 进入标签后找它的 `>` / `/>`；这期间**撞上 `<!--` ⇒ 违规**（注释落在属性列表内部）。
 *     找结尾时跳过成对引号里的属性值和 `{{ }}` 插值 —— 属性值里的 `>`（如
 *     `title="{{a > b}}"`）不能把标签提前切断，否则会把合法注释误判成违规。
 *
 * 裸 `<`（`<` 后接空格 / 中文 / 数字）不归这条管：那是 R1 的判据，这里直接放过该字符，
 * 免得两条守卫互相抢口径、报同一处两次。
 *
 * @returns 每个违规一条：`line` = 注释开头所在文件内绝对行号，`tag` = 所在开始标签名。
 */
export function findCommentInsideStartTag(src: string): CommentInTag[] {
  const out: CommentInTag[] = [];
  const n = src.length;
  const hit = (abs: number, tag: string): CommentInTag => ({
    line: src.slice(0, abs).split('\n').length,
    snippet: src.slice(Math.max(0, abs - 16), abs + 24).replace(/\s+/g, ' '),
    tag,
  });

  let i = 0;
  while (i < n) {
    if (src[i] !== '<') { i++; continue; }

    // ① 文本态的注释：合法，整块跳过（含注释里的 `<` / `>`）
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }

    const next = src[i + 1] || '';
    // 既不是标签开头（字母 / `/`）也不是声明（`!` / `?`）：裸 `<`，交给 R1
    if (!/[A-Za-z/?]/.test(next) && next !== '!') { i++; continue; }

    const nameMatch = /^[A-Za-z][\w-]*/.exec(src.slice(i + 1, i + 65));
    const tag = nameMatch ? nameMatch[0] : (next === '/' ? '/(闭合标签)' : next);

    // ② 扫到标签结尾；中途撞上 `<!--` 就是违规
    let j = i + 1;
    let tagEnd = -1;
    while (j < n) {
      if (src.startsWith('<!--', j)) {
        out.push(hit(j, tag));                      // 注释落在属性列表内部
        const end = src.indexOf('-->', j + 4);
        j = end < 0 ? n : end + 3;                  // 跳过它继续找标签结尾（同标签可有多条）
        continue;
      }
      const c = src[j];
      if (c === '"' || c === "'") {                 // 成对引号（属性值）整段跳过
        j++;
        while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
        j++;
        continue;
      }
      if (c === '{' && src[j + 1] === '{') {        // 未加引号的 `{{ … }}` 插值
        const e = src.indexOf('}}', j + 2);
        j = e < 0 ? n : e + 2;
        continue;
      }
      if (c === '>') { tagEnd = j; break; }
      j++;
    }
    if (tagEnd < 0) break;                          // 标签本身没闭合（整份文件已坏），收手
    i = tagEnd + 1;
  }
  return out;
}

/**
 * 扫描面：不进入的目录名。
 * `node_modules` / `.git` 是原口径；`miniprogram_npm` / `dist` 是构建产物目录
 * （npm 构建产出的 miniprogram_npm、出码 dist）—— 它们不是源码，扫进去只会制造假红。
 */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = ['node_modules', '.git', 'miniprogram_npm', 'dist'];

/**
 * 递归收集 `root` 下所有 `.wxml`（默认跳过 DEFAULT_EXCLUDED_DIRS）。
 *
 * @param {string} root 应用根目录
 * @param {{ excludeDirs?: readonly string[] }} [opts] 覆盖排除目录（默认 DEFAULT_EXCLUDED_DIRS）
 * @returns {string[]} 绝对路径列表
 */
export function collectWxmlFiles(root: string, opts: { excludeDirs?: readonly string[] } = {}): string[] {
  const excluded = new Set(opts.excludeDirs || DEFAULT_EXCLUDED_DIRS);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (excluded.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.wxml')) out.push(p);
    }
  };
  walk(root);
  return out;
}
