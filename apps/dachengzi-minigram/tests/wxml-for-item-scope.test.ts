/// <reference types="node" />
/**
 * wxml 循环作用域守护（`wx:for` 的迭代变量名必须真的在作用域里）
 *
 * 🔴 缺陷来源（P0，2026-11-26 首页「今日一句」英文整段不显示）：
 *   pages/home/index/index.wxml:29 曾写
 *     <block wx:for="{{quoteTokens}}" wx:key="idx">          ← 漏了 wx:for-item
 *   而循环体内取的是 {{tk.w && tk.hasDef}} / {{tk.t}}。
 *   微信 WXML 语义：未声明 wx:for-item 时迭代变量**恒为 item**，作用域里根本没有 tk，
 *   于是 24 个 token 全部求值 undefined → 全部渲染成空串 → 英文整段塌成空白。
 *
 *   页面不报错、不白屏、日志无痕，既有 671 条测试全绿上线 —— 因为那些断言只检查
 *   「字符串 {{tk.t}} 存在」，从没检查「tk 被引入作用域」。两者是一对约束，单独断言任一半无效。
 *
 * 本测试是这一类缺陷的回归网（对标 tests/no-dev-copy-in-wxml.test.ts 的口径）：
 *   扫描 apps/dachengzi-minigram 下所有 .wxml（排除原型稿/文档/依赖），逐元素解析 `wx:for` 作用域，
 *   断言「循环体里出现的每一个 `{{x.` 形式的取值，`x` 必须由本元素或其任一外层元素的
 *   wx:for-item / wx:for-index 引入」。
 *
 * 设计要点：
 *  1) 报错信息给出「文件:行号 + 越界根标识符 + 该循环声明的迭代变量 + 原文」，修的人不必自己找；
 *  2) 负例矩阵证明「放进去就会红」（缺陷原文、写错 item 名两条必红）；正例矩阵证明不误报
 *     （`item.` 默认名、嵌套循环、循环外页面数据三条必绿）—— 否则「永远绿」的守卫等于没有；
 *  3) 扫描面非空断言 + `wx:for` 命中数非零断言：目录名写错或正则写飘导致扫到 0 个循环时，
 *     一次性暴露，而不是假绿；
 *  4) 已知覆盖边界（照实写，别假装全知）：只识别 `{{x.` 这种「根标识符紧跟点」的取值；
 *     `{{x[0].t}}` / `{{x?.[0]}}` 这类下标访问不在检查面内（本仓当前无此写法）。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 小程序根目录（tests/ 的上一级） */
const APP_ROOT = path.join(__dirname, '..');

/** 不扫描的目录名：原型稿、文档、第三方依赖 */
const EXCLUDED_DIRS = new Set(['node_modules', 'prototype', 'docs']);

interface Violation {
  /** 相对 apps/dachengzi-minigram 的路径 */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 循环体里用了、但不在作用域内的点号根标识符（如 `tk`） */
  root: string;
  /** 该 wx:for 元素声明（或默认）的迭代变量名，用来在报错里对照 */
  itemName: string;
  /** 该行原文（已 trim） */
  text: string;
}

/** 词法单元：开标签 / 闭标签 / 文本 */
type Token =
  | { kind: 'open' | 'selfclose'; tag: string; inner: string; offset: number; line: number }
  | { kind: 'close'; tag: string; offset: number }
  | { kind: 'text'; raw: string; offset: number };

/** 相对偏移 → 1-based 行号查表 */
function makeLineResolver(source: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * 把 wxml 源文本切成「标签 / 文本」序列。标签内引号里的 `>` 不当作标签结束
 * （模板里 `{{a > b}}` 这类比较表达式很常见）。
 */
function tokenize(source: string): Token[] {
  const lineOf = makeLineResolver(source);
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '<' && (source[i + 1] === '/' || /[A-Za-z]/.test(source[i + 1] || ''))) {
      // 找到引号外层的 '>'
      let j = i + 1;
      let quote: string | null = null;
      while (j < source.length) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '>') {
          break;
        }
        j++;
      }
      if (j >= source.length) {
        // 未闭合标签：余下全部按文本处理（守卫自身不能因为语法异常直接抛错）
        tokens.push({ kind: 'text', raw: source.slice(i), offset: i });
        break;
      }
      const raw = source.slice(i, j + 1);
      const isClose = raw.startsWith('</');
      const isSelf = /\/>$/.test(raw);
      const tag = (/^<\/?([A-Za-z][\w-]*)/.exec(raw) || ['', ''])[1];
      tokens.push(
        isClose
          ? { kind: 'close', tag, offset: i }
          : {
              kind: isSelf ? 'selfclose' : 'open',
              tag,
              inner: raw,
              offset: i,
              line: lineOf(i),
            },
      );
      i = j + 1;
    } else {
      let j = i;
      while (j < source.length && !(source[j] === '<' && (source[j + 1] === '/' || /[A-Za-z]/.test(source[j + 1] || '')))) {
        j++;
      }
      tokens.push({ kind: 'text', raw: source.slice(i, j), offset: i });
      i = j;
    }
  }
  return tokens;
}

/** 一条属性：名 / 值 / 值在整份源里的绝对偏移 */
interface Attr {
  name: string;
  value: string;
  valueOffset: number;
}

/** 解析标签内的属性（双引号/单引号/无值三种写法），偏移均为整份源里的绝对偏移 */
function parseAttrs(token: { inner: string; offset: number }): Attr[] {
  // 先跳掉 "<tag" 前缀，否则标签名会被当成一条属性
  const head = (/^<\/?([A-Za-z][\w-]*)/.exec(token.inner) || ['<'])[0];
  const body = token.inner.slice(head.length);
  const bodyOffset = token.offset + head.length;

  const attrs: Attr[] = [];
  const re = /([:@\w.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : '';
    // 值在匹配串内的位置：带引号时取引号后第一位
    const quoted = m[2] !== undefined ? `"${m[2]}"` : m[3] !== undefined ? `'${m[3]}'` : '';
    const valueOffset = quoted === '' ? bodyOffset + m.index : bodyOffset + m.index + m[0].lastIndexOf(quoted) + 1;
    attrs.push({ name: m[1], value, valueOffset });
  }
  return attrs;
}

/** 循环表达式 `{{...}}` 提取器 */
const EXPR_RE = /\{\{([\s\S]*?)\}\}/g;
/** `x.` 形式取值的根标识符（前一个字符不能是 `.`/标识符字符，避免 `a.b.c` 里把 `b` 当根） */
const ROOT_REF_RE = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\./g;

/**
 * 纯函数：扫描一段 wxml 源文本，返回全部「循环体取值的根标识符不在作用域内」违规项。
 * 抽成纯函数是为了让负例/正例矩阵能直接喂合成源文本，不必真往仓库写脏文件。
 */
function scanWxmlLoopScopes(source: string, fileLabel = '<inline>'): Violation[] {
  const lineOf = makeLineResolver(source);
  const lines = source.split(/\r?\n/);
  const violations: Violation[] = [];
  const tokens = tokenize(source);

  /** 每层元素的 wx:for 声明的名字（无 wx:for 的元素 names 为空） */
  const scope: { tag: string; names: string[] }[] = [];
  const inScope = (name: string): boolean => scope.some((f) => f.names.includes(name));
  const nearestLoopItem = (): string => {
    for (let k = scope.length - 1; k >= 0; k--) {
      if (scope[k].names.length > 0) return scope[k].names[0];
    }
    return '';
  };

  const checkValue = (value: string, offset: number, itemName: string): void => {
    // 只有落进某个 wx:for 的元素子树里才做校验：循环外的 `{{quote.cn}}` 是页面数据，不是循环变量
    if (nearestLoopItem() === '') return;
    EXPR_RE.lastIndex = 0;
    let em: RegExpExecArray | null;
    while ((em = EXPR_RE.exec(value))) {
      // 抹掉字符串字面量（等长替换成空格，保住偏移）—— `{{'a.b'}}` 里的 a 不是取值
      const expr = em[1]
        .replace(/'[^']*'/g, (s) => `'${' '.repeat(Math.max(0, s.length - 2))}'`)
        .replace(/"[^"]*"/g, (s) => `"${' '.repeat(Math.max(0, s.length - 2))}"`);
      const exprOffset = offset + em.index;
      ROOT_REF_RE.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = ROOT_REF_RE.exec(expr))) {
        const root = rm[1];
        if (inScope(root)) continue;
        const line = lineOf(exprOffset + rm.index + rm[0].indexOf(root));
        violations.push({
          file: fileLabel,
          line,
          root,
          itemName,
          text: (lines[line - 1] || '').trim(),
        });
      }
    }
  };

  for (const tk of tokens) {
    if (tk.kind === 'close') {
      // 容错出栈：优先弹同名帧；找不到同名帧则弹栈顶（WXML 里标签是配对写的）
      const hitIdx = (() => {
        for (let k = scope.length - 1; k >= 0; k--) if (scope[k].tag === tk.tag) return k;
        return scope.length - 1;
      })();
      if (hitIdx >= 0) scope.splice(hitIdx, 1);
      continue;
    }
    if (tk.kind === 'text') {
      checkValue(tk.raw, tk.offset, nearestLoopItem());
      continue;
    }

    const attrs = parseAttrs({ inner: tk.inner, offset: tk.offset });
    const forAttr = attrs.find((a) => a.name === 'wx:for');
    const hasFor = Boolean(forAttr);
    const declared: string[] = [];
    if (hasFor) {
      const itemAttr = attrs.find((a) => a.name === 'wx:for-item');
      const indexAttr = attrs.find((a) => a.name === 'wx:for-index');
      declared.push(itemAttr ? itemAttr.value : 'item');
      declared.push(indexAttr ? indexAttr.value : 'index');
    }

    const itemName = declared[0] || nearestLoopItem();

    if (tk.kind === 'selfclose') {
      // 自闭合元素：自身声明的名字只在自身属性内有效
      scope.push({ tag: tk.tag, names: declared });
      for (const a of attrs) checkValue(a.value, a.valueOffset, itemName);
      scope.pop();
      continue;
    }

    scope.push({ tag: tk.tag, names: declared });
    // 开标签的属性在「含自身 wx:for 声明」的作用域内求值
    for (const a of attrs) checkValue(a.value, a.valueOffset, itemName);
  }

  return violations;
}

/** 递归收集 wxml 文件（相对路径，posix 分隔符），跳过 EXCLUDED_DIRS */
function collectWxmlFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectWxmlFiles(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith('.wxml')) {
      acc.push(path.relative(APP_ROOT, abs).split(path.sep).join('/'));
    }
  }
  return acc;
}

/** 把违规项渲染成人能直接照着修的多行文本 */
function formatViolations(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `  ${v.file}:${v.line}  循环体取值 {{${v.root}.…}} 不在作用域内（本循环迭代变量名为 ${v.itemName}）\n` +
        `      原文：${v.text}`,
    )
    .join('\n');
}

const WXML_FILES = collectWxmlFiles(APP_ROOT);

describe('wxml 循环作用域守护 · 仓库全量扫描', () => {
  it('扫描面非空（防止目录名写错导致守卫假绿）', () => {
    expect(WXML_FILES.length).toBeGreaterThan(0);
    // 缺陷现场与同仓正确写法都必须落在扫描面内
    expect(WXML_FILES).toContain('pages/home/index/index.wxml');
    expect(WXML_FILES).toContain('pages/nce/detail/detail.wxml');
  });

  it('扫描面确实含 wx:for 指令（防止解析失效后「零违规」假绿）', () => {
    const forCount = WXML_FILES.reduce((n, rel) => {
      const src = fs.readFileSync(path.join(APP_ROOT, rel), 'utf-8');
      return n + (src.match(/wx:for=/g) || []).length;
    }, 0);
    // 当前仓 10 处（home×2 / nce-detail×2 / nce-index×3 / discover / glossary / custom-tab-bar）
    expect(forCount).toBeGreaterThanOrEqual(5);
  });

  it('所有 wxml 的 wx:for 循环体只取作用域内的变量', () => {
    const violations: Violation[] = [];
    for (const rel of WXML_FILES) {
      const source = fs.readFileSync(path.join(APP_ROOT, rel), 'utf-8');
      violations.push(...scanWxmlLoopScopes(source, rel));
    }
    expect(
      violations.length === 0
        ? ''
        : `发现 ${violations.length} 处循环作用域越界（取值根标识符未由 wx:for-item / wx:for-index 引入）：\n${formatViolations(violations)}`,
    ).toBe('');
  });
});

describe('首页「今日一句」· 缺陷现场专项（P0：英文整段渲染为空）', () => {
  const homeWxml = fs.readFileSync(path.join(APP_ROOT, 'pages', 'home', 'index', 'index.wxml'), 'utf-8');

  it('quoteTokens 循环声明了 wx:for-item="tk"（循环体用的就是 tk.*）', () => {
    expect(homeWxml).toMatch(/<block[^>]*wx:for="\{\{quoteTokens\}\}"[^>]*wx:for-item="tk"/);
  });

  it('首页零循环作用域违规', () => {
    const violations = scanWxmlLoopScopes(homeWxml, 'pages/home/index/index.wxml');
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });
});

describe('scanWxmlLoopScopes · 负例矩阵（证明放进去就会红）', () => {
  it('缺陷原文（wx:for 缺 wx:for-item、循环体用 tk.*）必须被判违规', () => {
    const bug = [
      '<view class="daily-en">',
      '  <block wx:for="{{quoteTokens}}" wx:key="idx">',
      '    <text wx:if="{{tk.w && tk.hasDef}}" class="dw has-def" data-w="{{tk.w}}" catchtap="onQuoteWordTap">{{tk.t}}</text>',
      '    <text wx:else>{{tk.t}}</text>',
      '  </block>',
      '</view>',
    ].join('\n');

    const v = scanWxmlLoopScopes(bug, 'pages/home/index/index.wxml');

    expect(v.length).toBeGreaterThan(0);
    // 越界根标识符必须是 tk；默认迭代变量名是 item
    expect(new Set(v.map((x) => x.root))).toEqual(new Set(['tk']));
    expect(new Set(v.map((x) => x.itemName))).toEqual(new Set(['item']));
    // 行号必须精确指到取值行（第 3/4 行），否则修的人得重新定位
    expect(v.some((x) => x.line === 3)).toBe(true);
    expect(v.some((x) => x.line === 4)).toBe(true);
    // 报错文本自解释：文件:行号 + 根标识符 + 原文
    const report = formatViolations(v);
    expect(report).toContain('pages/home/index/index.wxml:3');
    expect(report).toContain('{{tk.');
    expect(report).toContain('wx:if="{{tk.w && tk.hasDef}}"');
  });

  it('声明了 wx:for-item 但名字写错（tk 声明 / tk2 取值）同样必红', () => {
    const wrong = [
      '<block wx:for="{{tokens}}" wx:for-item="tk">',
      '  <text>{{tk2.t}}</text>',
      '</block>',
    ].join('\n');
    const v = scanWxmlLoopScopes(wrong, 'x.wxml');
    expect(v.map((x) => x.root)).toEqual(['tk2']);
  });

  it('嵌套循环里内层抄了外层变量名但没声明 → 必红', () => {
    const nestedBad = [
      '<view wx:for="{{lines}}" wx:for-item="line">',
      '  <block wx:for="{{line.tokens}}">',
      '    <text>{{line.t}}</text>',
      '  </block>',
      '</view>',
    ].join('\n');
    // line 在外层作用域内 → 不算越界；内层未引入新名不算缺陷
    expect(scanWxmlLoopScopes(nestedBad, 'x.wxml')).toHaveLength(0);

    const nestedBad2 = [
      '<view wx:for="{{lines}}">',
      '  <block wx:for="{{items}}">',
      '    <text>{{tk.t}}</text>',
      '  </block>',
      '</view>',
    ].join('\n');
    expect(scanWxmlLoopScopes(nestedBad2, 'x.wxml').map((x) => x.root)).toEqual(['tk']);
  });
});

describe('scanWxmlLoopScopes · 正例（合法写法必须零违规，防止守卫误报满天飞）', () => {
  it('默认迭代变量 item 的循环零违规', () => {
    const clean = [
      '<view class="fcard" wx:for="{{features}}" wx:key="id" data-path="{{item.path}}">',
      '  <view class="fc-t">{{item.title}}</view>',
      '  <view class="fc-d">{{item.desc}}</view>',
      '</view>',
    ].join('\n');
    expect(scanWxmlLoopScopes(clean, 'pages/home/index/index.wxml')).toHaveLength(0);
  });

  it('显式声明 wx:for-item / wx:for-index 的循环零违规（含自闭合与多行标签）', () => {
    const clean = [
      '<view',
      '  class="tb {{selected === index ? \'on\' : \'\'}}"',
      '  wx:for="{{list}}"',
      '  wx:key="pagePath"',
      '  data-path="{{item.pagePath}}"',
      '  data-index="{{index}}"',
      '>',
      '  <view>{{item.text}}</view>',
      '</view>',
      '<view wx:for="{{lines}}" wx:for-item="line" wx:for-index="si" id="line-{{si}}" class="sent {{expandedIdx === si ? \'expanded\' : \'\'}}">',
      '  <block wx:for="{{line.tokens}}" wx:for-item="tk">',
      '    <text wx:if="{{tk.w && tk.hasDef}}">{{tk.t}}</text>',
      '    <text wx:else>{{tk.t}}</text>',
      '  </block>',
      '</view>',
    ].join('\n');
    expect(scanWxmlLoopScopes(clean, 'pages/nce/detail/detail.wxml')).toHaveLength(0);
  });

  it('循环外的页面数据点号取值不受检查（quote.cn / features.length 等）', () => {
    const clean = [
      '<view class="daily-cn">{{quote.cn}}</view>',
      '<view wx:if="{{groups.length === 0}}">没有匹配的课文</view>',
      '<view wx:for="{{groups}}" wx:for-item="grp">',
      '  <view>{{grp.label}}</view>',
      '  <view wx:for="{{grp.items}}" wx:for-item="l" data-id="{{l.id}}">{{l.title}}</view>',
      '</view>',
    ].join('\n');
    expect(scanWxmlLoopScopes(clean, 'x.wxml')).toHaveLength(0);
  });

  it('空文件 / 纯注释文件零违规', () => {
    expect(scanWxmlLoopScopes('', 'empty.wxml')).toHaveLength(0);
    expect(scanWxmlLoopScopes('<!-- wx:for 说明文字，不是指令 -->', 'comment.wxml')).toHaveLength(0);
  });
});
