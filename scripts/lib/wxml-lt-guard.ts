/// <reference types="node" />
/**
 * wxml-lt-guard — 「WXML 注释里裸 `<` / 注释边界字面量 / 注释落在开始标签内部」判据的**唯一实现**
 *
 * 三条判据（R1 / R2 / R3）、扫描面、以及**六组测试用例**都住在本文件；
 * 两个小程序的测试文件只做**接线**（各 1 个 `registerWxmlLtGuardSpecs({ appRoot, … })` 调用）：
 *
 *     apps/dachengzi-minigram/tests/wxml-comment-lt-guard.test.ts
 *     apps/kedou-ai-minigram/tests/wxml-comment-lt-guard.test.ts
 *
 * 🔴 纪律：**app 侧测试文件不许写断言、不许复制规则**。判据改一处，两个 app 同时生效。
 *
 * 为什么必须共享、且必须两个 app 各一个入口：
 *   `scripts/ci/changed-packages.sh` 按 diff 归属的包逐个跑 test（`:25-27` 取 `apps/<pkg>`，
 *   `:86-97` 只对该包跑 test）—— kedou 有改动时只跑 kedou 的 tests，dachengzi 反之。
 *   所以两个 app 各要一个入口；但规则若写两份，改判据时必然漏改一处、慢慢漂移。
 *   同一条理由写在 `scripts/lib/no-dev-copy-in-wxml.ts` 里（本文件的结构与它对齐：
 *   纯函数分离 + `registerXxxSpecs()` 导出 + 大段「为什么」注释）。
 *   R3 原先只写在大橙子侧，科豆完全无覆盖 —— 本次上移就是为了补这个洞。
 *
 * ─────────────────────── 两个「会假绿 / 会必红」的实现约定（别改回去） ───────────────────────
 *
 * 🔴 约定 1：**扫描根由接线方显式传入，共享层绝不自己推算。**
 *   原文件里是 `const APP = path.resolve(__dirname, '..')` —— 它写在 `apps/<app>/tests/` 下时
 *   恰好等于 app 根。一旦这段推演搬进 `scripts/lib/`，同一个 `path.resolve(__dirname, '..')`
 *   会算成 `scripts/`：扫到 0 个 wxml 或扫到无关目录，而 `expect(offenders).toEqual([])` **依然全绿**
 *   —— 典型假绿（判据没跑，但它「没报错」）。所以 `appRoot` 必须是 `registerWxmlLtGuardSpecs`
 *   的必填入参，由 app 侧用 `path.resolve(__dirname, '..')`（在 app 的 tests 目录下算出来才是 app 根）传进来。
 *
 * 🔴 约定 2：**「防空转」不能硬编码文件名。**
 *   原文件里断言 `withComment` 必须包含 `pages/nce/detail/detail.wxml`、`pages/home/index/index.wxml`
 *   —— 那是大橙子的事实。搬到共享层后科豆接线会**直接红**（科豆没有这些文件）。
 *   故把「必须被扫到的文件」变成 `mustScan` 入参、把「至少扫到多少」变成 `minFiles` 入参，
 *   由接线方传各自 app 的真实事实；`mustScan` 传空数组时该断言退化为只校验
 *   `files.length >= minFiles`（**不跳过整条用例**）。
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
 * 🔴 六组用例里的前三组是**守守卫**（纯函数鉴别力）：只对真实文件断言的话，
 *    哪天判据被写成恒不匹配，全量扫描照样全绿 —— 那就是「只绿不红」的假守卫。
 *    注意反向也成立：**扫描用例只能证明「当下干净」，证明不了「判据有鉴别力」**
 *    （干净仓库 + 坏判据，全仓扫描这一层不可区分），两组装不了对方。
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
 * 扫描面：不进入的目录名 —— **沿用原测试的口径，只排除这两个**。
 *
 * 为什么不顺手把 `miniprogram_npm` / `dist` / `prototype` 也排掉（2026-11-27 实测记录）：
 *   - 两个 app 都**没有** `miniprogram_npm/` 与 `dist/`（`ls` 实测），加了等于凭空写政策；
 *   - `prototype/` 两个 app 都有（大橙子、科豆），但**其下 0 个 wxml**，
 *     且科豆 `app.json` 里 `"prototype/` 命中数为 0（不进小程序包）—— 没有 wxml 就不影响扫描面。
 *   将来真有依赖目录里带 wxml 的 app，用 `excludeDirs` 入参在接线处显式排除，
 *   **而不是**在这里替所有 app 预先决定。
 */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = ['node_modules', '.git'];

/**
 * 递归收集 `root` 下所有 `.wxml`（默认跳过 DEFAULT_EXCLUDED_DIRS）。
 *
 * ⚠️ `root` 必须是**调用方算好并传进来的** app 根 —— 见文件头「约定 1」：
 *    本文件用 `__dirname` 推不出任何 app 根，推出来的永远是 `scripts/` 那一层。
 *
 * @param root 应用根目录（绝对路径）
 * @param excludeDirs 不进入的目录名（默认 DEFAULT_EXCLUDED_DIRS）
 * @returns 绝对路径列表
 */
export function collectWxmlFiles(root: string, excludeDirs: readonly string[] = DEFAULT_EXCLUDED_DIRS): string[] {
  const excluded = new Set(excludeDirs);
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

/** 接线方入参：每个 app 必须自己声明「我是谁、扫哪里、至少扫到多少、哪些文件必须被扫到」 */
export interface WxmlLtGuardSpecsOptions {
  /** app 根目录（绝对路径）。接线方传，共享层不推算 —— 见文件头「约定 1」 */
  appRoot: string;
  /**
   * 用例文案里的 app 名（如 `'大橙子'` / `'科豆'`），**替代硬编码**。
   * 只挂在最外层 describe 上（`WXML 注释守卫 · <appLabel>`），让两个 app 的
   * CI 日志能各自认出来源；六组用例的名字与断言逐字不动（见 registerWxmlLtGuardSpecs 说明）。
   */
  appLabel: string;
  /**
   * 防空转锚点：这些**相对 appRoot 的 wxml 路径**必须出现在扫描结果里。
   * 一个都不出现 ⇒ 扫描器根本没在正确目录上跑（换根 / 改排除项 / 目录搬家）。
   * 传空数组时退化为只校验 `files.length >= minFiles`，**不跳过整条用例**。
   * 选锚点的原则：优先选生命周期稳定的文件（如自定义 tabbar），别选会被改版重构掉的业务页。
   */
  mustScan?: string[];
  /** 扫描下界：少于这个数说明扫描面塌了。按各 app 实际 wxml 数取明显下界（默认 11） */
  minFiles?: number;
  /** 覆盖排除目录（默认 DEFAULT_EXCLUDED_DIRS）；只有确实存在依赖目录带 wxml 时才需要 */
  excludeDirs?: readonly string[];
}

/**
 * 注册 WXML 注释守卫的全部用例（六组）：前三组守判据本身，后三组扫全仓库。
 *
 * **只能在 jest 测试文件里调用**（依赖 describe / it / expect 全局）。
 * 六组用例名与断言是 2026-11-27 事故文件里的原文，**逐字不动**（抽函数只搬位置，不改文案、不合并用例），
 * 唯一参数化的是「扫描根 / app 名 / 防空转锚点 / 扫描下界」。
 *
 * @param opts 见 WxmlLtGuardSpecsOptions
 * @throws {Error} 未传 appRoot / appLabel、appRoot 不存在、不在 jest 环境
 */
export function registerWxmlLtGuardSpecs(opts: WxmlLtGuardSpecsOptions): void {
  if (typeof describe !== 'function' || typeof it !== 'function' || typeof expect !== 'function') {
    throw new Error('[wxml-lt-guard] registerWxmlLtGuardSpecs 只能在 jest 测试文件里调用（需要 describe/it/expect 全局）');
  }

  const {
    appRoot,
    appLabel,
    mustScan = [],
    minFiles = 11,
    excludeDirs = DEFAULT_EXCLUDED_DIRS,
  } = opts || ({} as WxmlLtGuardSpecsOptions);

  // 把「接线方传错根」变成一句能读懂的红，而不是一堆 ENOENT 堆栈
  if (!appRoot || typeof appRoot !== 'string') {
    throw new Error('[wxml-lt-guard] registerWxmlLtGuardSpecs 必须传 appRoot（共享层不自己推算扫描根，见文件头约定 1）');
  }
  if (!appLabel || typeof appLabel !== 'string') {
    throw new Error('[wxml-lt-guard] registerWxmlLtGuardSpecs 必须传 appLabel（用例输出里用来区分是哪个 app 在跑）');
  }
  if (!fs.existsSync(appRoot)) {
    throw new Error(`[wxml-lt-guard] appRoot 不存在：${appRoot} —— 接线方传错了根，扫描会变空转`);
  }

  // 统一成正斜杠比较，避免 Windows 下 path.relative 的反斜杠造成假红
  const toPosix = (p: string): string => String(p).split(path.sep).join('/');
  const relOf = (f: string): string => toPosix(path.relative(appRoot, f));
  const read = (f: string): string => fs.readFileSync(f, 'utf8');
  const anchors = mustScan.map(toPosix);

  // 扫描只做一次，三个扫描 describe 共用（不必每个 describe 各扫一遍）
  const files = collectWxmlFiles(appRoot, excludeDirs);
  const rels = files.map(relOf);

  // 最外层只承载 app 名（供 CI 日志区分），**不新增用例、不改任何用例名**
  describe(`WXML 注释守卫 · ${appLabel}`, () => {
    // ═════════════════════ 守守卫：判据本身必须有鉴别力 ═════════════════════
    describe('判据自身（纯函数）', () => {
      it('🔴 裸 `<` 必须被抓到：空格 / 中文 / 数字 三种形态', () => {
        const cases = [
          '<!-- 胶囊高 48rpx < 朗读圆钮 88rpx 热区 -->',   // ← 本次事故形态（后面是空格）
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
        // 🔴 2026-11-28 盲测补（变异体 M2「扫全文而非只扫注释」）：上面那条样例**在注释外没有裸 `<`**，
        //    所以「扫全文」的错误实现与正确实现都返回 `[]` —— 该用例等于空转（20 例全绿也拦不住 M2）。
        //    下面两条才是真有鉴别力的：注释外确实有裸 `<`，但本判据只许管注释内。
        expect(findNakedLt('<view>读作 a < b</view>')).toEqual([]);
        expect(findNakedLt('a < b\n</view>')).toEqual([]);
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
        // ⚠️ 2026-11-28 盲测标注：本用例与上一条（正文里的 `<!--`）**实质重复**，且它名义上
        // 守的 `-->` 分支在**当前非贪婪配对下不可达**（源码 findCommentBoundaryLiteral 的注释
        // ② 已自认：`m[1]` 里不可能出现 `-->`）。保留原样是给「配对方式哪天被改成贪婪」留网，
        // **不作为鉴别力依据** —— 判据有鉴别力这件事由上一条与下面「任意 `--` 不许误报」承担。
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
          // 🔴 2026-11-28 盲测补（变异体 M13「任意 `--` 都判违规」）：上面的样例里**没有
          //    「连续两个短横 `--` 但不成 `-->`」的合法形态 —— 「三个短横连写」那句写的是
          //    `—`（破折号）与单个 `-`，所以「见到 `--` 就报」的错误实现照样绿（确证空转）。
          //    下面两条才是真有鉴别力的：单/双短横相邻是合法正文，只有 `<!--` / `-->` 才违规。
          '<!-- 范围 a--b 合法（连续两个短横不是注释边界） -->',
          '<!-- 单横与双横都合法：a-b / a--b / a---b -->',
        ];
        for (const src of ok) expect(findCommentBoundaryLiteral(src)).toEqual([]);
      });
    });

    // ═════════════════════ 守守卫 · R3：注释落在开始标签属性列表内部 ═════════════════════
    describe('判据自身 · R3（注释落在开始标签属性列表内部）', () => {
      it('🔴 真实事故形态必须抓到：属性列表中间插注释（v1.0.21 首版 home:146 的形态）', () => {
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
        // 🔴 2026-11-28 盲测补（变异体 M6「找标签结尾时不跳成对引号」）：
        //    上面三条样例的 `>` 全部包在 `{{ }}` 里，`{{ }}` 分支**先把 `>` 吃掉了**，
        //    「跳过引号」那条分支从未被考验 —— 于是「不跳引号」的错误实现照样绿。
        //    下面两条直接用纯字符串属性值（`{{ }}` 不介入），才真正考验引号分支。
        //    ⚠️ 2026-11-28 复审（PR #734 A5）：这里原写成无注释的
        //    `<view title="a > b" id="x" />` → `[]`，那是**装饰断言** —— 输入里没有 `<!--`，
        //    而本函数只有「撞上 `<!--`」一个 push 点，所以任何实现都返回 `[]`（实测 M6 下仍绿）。
        //    改成「属性值含 `>` **且**后面紧跟标签内注释」：正确实现整段跳过引号 → 报 1；
        //    不跳引号的实现（M6）在引号内的 `>` 处就认为标签结束，`<!--` 落到文本态被当合法注释 → 漏报 0。
        expect(findCommentInsideStartTag('<view title="a > b" id="x" <!-- c --> />')).toHaveLength(1);
        //    ② 不漏报：切断后「标签内注释」必须仍然抓到（M6 在这里返回 []）
        const quoted = '<view title="a > b"\n  <!-- 在属性列表里 -->\n  id="x" />';
        const qHits = findCommentInsideStartTag(quoted);
        expect(qHits).toHaveLength(1);
        expect(qHits[0].line).toBe(2);
        expect(qHits[0].tag).toBe('view');
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
        // 🔴 2026-11-28 盲测补（变异体 M5「R3 不跳过文本态注释」）：
        //    上面三条样例里，文本态注释内部**没有值得误判的形态**（`<view>` / `<text>` 都能正常跳过），
        //    所以「不跳过文本态注释」的错误实现与正确实现输出相同 —— 该用例对 M5 无鉴别力。
        //    下面这条才是真有鉴别力的：注释未闭合 + 正文里紧跟 `<!--`，若不跳过，正文里的 `<!--`
        //    会被当成「落在 `!` 开始标签属性列表内部」而误报（盲测最小反例，base `[]` / M5 报 1）。
        expect(findCommentInsideStartTag('/><!--\n<!--{{}}--text\n\n\n')).toEqual([]);
      });
    });

    // ═════════════════════ 真实文件全量扫描 · R1 ═════════════════════
    describe('全仓库 WXML 注释零裸小于号', () => {
      it('凡是出现在注释里的 `<`，后面必须是标签名（否则整包编译失败）', () => {
        const offenders: string[] = [];
        for (const f of files) {
          for (const hit of findNakedLt(read(f))) {
            offenders.push(`${relOf(f)}:${hit.line}  …${hit.snippet}…`);
          }
        }
        // 失败信息直接给出「文件:行号 + 片段」：出码事故里最耗时间的就是定位是哪一行
        expect(offenders).toEqual([]);
      });

      it('防空转：扫到足够多 wxml，判据在真实文件里真的跑过，且锚点文件确实被扫到', () => {
        expect(files.length).toBeGreaterThanOrEqual(minFiles);
        const withTagRef = files.filter((f) => /<!--[\s\S]*?<[A-Za-z/]/.test(read(f)));
        expect(withTagRef.length).toBeGreaterThan(0);   // 扫到 0 说明正则坏了（不是「没问题」）
        for (const a of anchors) expect(rels).toContain(a);
        // 🔴 扫描根**下界**（2026-11-28 盲测补，变异体 M10「把根上移到仓库根」）：
        //    上面三条都拦不住「扫得更大」——「把根上移到仓库根」时 app 内文件的
        //    `path.relative(appRoot, f)` **完全不变**（锚点照命中）、`files.length` 只会更大
        //    （实测 14 → 51，其中 37 个属于别的 app / 其它目录），真实文件也干净 → 全绿。
        //    危害：大橙子的守卫去扫科豆的 wxml，科豆一旦有违规，红在大橙子这边（归因错误）。
        //    故这里补一条**上界之外的**约束：扫到的每一个文件都必须落在 appRoot 之下。
        expect(files.every((f) => f.startsWith(appRoot + path.sep))).toBe(true);
      });
    });

    // ═════════════════════ 真实文件全量扫描 · R2 ═════════════════════
    describe('全仓库 WXML 注释正文零注释边界字面量（R2）', () => {
      it('任何注释块的正文里都不许出现 `<!--` / `-->`，也不许留下没配对的 `<!--`', () => {
        // ⚠️ 2026-11-28 盲测标注：本条是**设计上承认的快照型** —— 它只断言「当下全仓干净」，
        // 判据本身有鉴别力这件事由 R2 前四组（守守卫）承担（文件头「只绿不红」那段已说明
        // 「扫描用例证明不了判据有鉴别力」）。**不作为鉴别力依据**，保留原样不加强。
        const offenders: string[] = [];
        for (const f of files) {
          for (const hit of findCommentBoundaryLiteral(read(f))) {
            offenders.push(`${relOf(f)}:${hit.line}  …${hit.snippet}…`);
          }
        }
        expect(offenders).toEqual([]);
      });

      it('防空转：判据在真实文件里真的跑过（配对成功数 > 0，且锚点文件确实含注释）', () => {
        expect(files.length).toBeGreaterThanOrEqual(minFiles);
        const withComment = files.filter((f) => /<!--([\s\S]*?)-->/.test(read(f)));
        expect(withComment.length).toBeGreaterThan(0);
        const commented = withComment.map(relOf);
        for (const a of anchors) expect(commented).toContain(a);
      });
    });

    // ═════════════════════ 真实文件全量扫描 · R3（本次真因） ═════════════════════
    describe('全仓库 WXML 注释零「落在属性列表内部」（R3）', () => {
      it('任何注释块的起始位置都不许落在某个开始标签的属性列表内部', () => {
        const offenders: string[] = [];
        for (const f of files) {
          for (const h of findCommentInsideStartTag(read(f))) {
            // 失败信息给「文件:行号 + 标签名 + 片段」，出码事故里最耗时的就是定位
            offenders.push(`${relOf(f)}:${h.line}  <${h.tag}>  …${h.snippet}…`);
          }
        }
        expect(offenders).toEqual([]);
      });

      it('防空转：扫到足够多 wxml，多行开始标签与注释同时存在的文件被扫到，且锚点文件确实被扫到', () => {
        expect(files.length).toBeGreaterThanOrEqual(minFiles);
        const withComment = files.filter((f) => /<!--/.test(read(f)));
        expect(withComment.length).toBeGreaterThan(0);
        // 「多行开始标签 + 紧贴其前的注释」正是事故形态；一个都扫不到说明扫描器没在跑（恒绿）
        const multiLineTag = files.filter((f) => /<[A-Za-z][\w-]*[^>]*\n[\s\S]*?\/?>/.test(read(f)));
        expect(multiLineTag.length).toBeGreaterThan(0);
        for (const a of anchors) expect(rels).toContain(a);
      });
    });
  });
}

