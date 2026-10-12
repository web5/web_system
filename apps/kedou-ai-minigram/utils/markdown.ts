/**
 * 轻量 Markdown → rich-text nodes 渲染器（小程序 AI 对话专用）
 *
 * 为什么不用 towxml / mp-html 等三方库：
 *   ① 对话场景只需要常见语法子集，自研 ≈ 300 行，零依赖、无版本维护负担；
 *   ② rich-text 是 webview 隔离渲染 —— **拿不到页面的 CSS 变量**，
 *      所有色值/字号必须硬编码，三方库的主题变量体系在这里反而绕。
 *
 * ⚠️ 硬编码色值与 app.wxss 的设计 Token 同源，改 token 时两处同步：
 *      --t1 #10131A / --t2 rgba(60,60,67,.62) / --brand #F97316 /
 *      --brand-txt #EA580C / --surface-2 #F2F2F7 / --line rgba(60,60,67,.12)
 * ⚠️ rich-text 内样式单位用 px 不用 rpx —— webview 不认识 rpx，写了不生效。
 *
 * 安全：nodes 为「对象数组」而非 HTML 字符串，rich-text 不会执行任何 HTML，
 * 文本中的 <>& 都按纯文本渲染，天然无 XSS 面。
 *
 * 流式友好：onDelta 每次全量重解析；未闭合的行内标记（**、`、[）按原样输出，
 * 未配对收尾的 ``` 代码围栏不生效（按普通段落渲染），完成态 onReply 重算即定型。
 */

/** rich-text 节点（只用白名单：div / span / text / br；style 值一律 px） */
export interface MdNode {
  name: string;
  attrs?: Record<string, string>;
  children?: Array<MdNode | string>;
}

/* ===== 设计 Token 硬编码副本（与 app.wxss 同步） ===== */
const C = {
  t1: '#10131A',
  t2: 'rgba(60,60,67,0.62)',
  brand: '#F97316',
  brandTxt: '#EA580C',
  codeBg: '#F2F2F7',
  codeText: '#C2410C',
  quoteBg: 'rgba(249,115,22,0.06)',
  line: 'rgba(60,60,67,0.12)',
};

/** rpx → px（按当前屏宽换算；rich-text webview 只认 px） */
const WIN_W = (() => {
  try {
    return wx.getSystemInfoSync().windowWidth || 375;
  } catch (_) {
    return 375;
  }
})();
const px = (rpx: number): string => `${Math.round((rpx * WIN_W) / 750)}px`;

/** 正文基准样式（.msg-text：26rpx / line-height 1.6） */
const BASE = `font-size:${px(26)};line-height:1.6;color:${C.t1};word-break:break-word;`;

/* ================= 行内解析 ================= */

/** 行内标记节点（code / bold / italic / del / link） */
function inlineSpan(style: string, children: Array<MdNode | string>): MdNode {
  return { name: 'span', attrs: { style: BASE + style }, children };
}

/** 纯文本节点 */
function textSpan(text: string, extraStyle = ''): MdNode {
  return { name: 'span', attrs: { style: BASE + extraStyle }, children: [text] };
}

/**
 * 行内解析：手写扫描器（正则难以表达「未闭合就原样输出」的降级语义）。
 * 支持：`code`、**bold**、__bold__、*italic*、_italic_、~~del~~、[text](url)、![alt](url)。
 */
function parseInline(src: string): Array<MdNode | string> {
  const out: Array<MdNode | string> = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ name: 'span', attrs: { style: BASE }, children: [buf] });
      buf = '';
    }
  };

  while (i < src.length) {
    const c = src[i];

    // 行内代码：`x` —— 最高优先级，代码里的 * 等不再解析
    if (c === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        out.push(
          inlineSpan(
            `background:${C.codeBg};border-radius:${px(8)};padding:0 ${px(6)};` +
              `font-family:Menlo,Consolas,monospace;font-size:${px(23)};color:${C.codeText};`,
            [src.slice(i + 1, close)],
          ),
        );
        i = close + 1;
        continue;
      }
    }

    // 图片：![alt](url) → 弱化为「图片」标记文本（对话场景极少，不做真图加载）
    if (c === '!' && src[i + 1] === '[') {
      const m = matchLink(src, i + 1);
      if (m) {
        flush();
        out.push(textSpan(`[图片${m.text ? ':' + m.text : ''}]`, `color:${C.t2};`));
        i = m.end;
        continue;
      }
    }

    // 链接：[text](url) → 品牌色文本（rich-text 的 a 不可绑事件，不可点，避免误导）
    if (c === '[') {
      const m = matchLink(src, i);
      if (m) {
        flush();
        out.push(inlineSpan(`color:${C.brandTxt};`, parseInline(m.text)));
        i = m.end;
        continue;
      }
    }

    // 加粗：**x** / __x__
    if ((c === '*' && src[i + 1] === '*') || (c === '_' && src[i + 1] === '_')) {
      const mark = src.slice(i, i + 2);
      const close = src.indexOf(mark, i + 2);
      if (close > i + 2) {
        flush();
        out.push(inlineSpan('font-weight:600;', parseInline(src.slice(i + 2, close))));
        i = close + 2;
        continue;
      }
      // 未闭合：原样吐出标记符，继续扫
      buf += mark;
      i += 2;
      continue;
    }

    // 斜体：*x* / _x_（_ 要求前后是边界，避免 snake_case 误判）
    if (c === '*' || c === '_') {
      const isEdge = (ch: string | undefined) => ch === undefined || /[\s，。！？、；：""''（）]/.test(ch);
      if (isEdge(src[i - 1])) {
        const close = src.indexOf(c, i + 1);
        if (close > i + 1 && isEdge(src[close + 1])) {
          flush();
          out.push(inlineSpan('font-style:italic;', parseInline(src.slice(i + 1, close))));
          i = close + 1;
          continue;
        }
      }
    }

    // 删除线：~~x~~
    if (c === '~' && src[i + 1] === '~') {
      const close = src.indexOf('~~', i + 2);
      if (close > i + 2) {
        flush();
        out.push(inlineSpan('text-decoration:line-through;', parseInline(src.slice(i + 2, close))));
        i = close + 2;
        continue;
      }
      buf += '~~';
      i += 2;
      continue;
    }

    buf += c;
    i += 1;
  }
  flush();
  return out;
}

/** 匹配 [text](url)，返回闭合区间；src[i] 必须是 '[' */
function matchLink(src: string, i: number): { text: string; end: number } | null {
  const closeBracket = src.indexOf(']', i + 1);
  if (closeBracket < 0 || src[closeBracket + 1] !== '(') return null;
  const closeParen = src.indexOf(')', closeBracket + 2);
  if (closeParen < 0) return null;
  const text = src.slice(i + 1, closeBracket);
  if (!text) return null;
  return { text, end: closeParen + 1 };
}

/* ================= 块级解析 ================= */

/** 判断是否表格分隔行：|---|---| 或 --- | --- */
const isTableSep = (line: string): boolean =>
  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');

/** 判断是否表格行：trim 后以 | 开头或含 ≥2 个 | */
const isTableRow = (line: string): boolean => {
  const t = line.trim();
  return t.includes('|') && t.split('|').filter((s) => s.trim() !== '').length >= 2;
};

/** 拆表格单元格：| a | b | → ['a','b']（去首尾空段） */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((s) => s.trim());
}

/** 代码围栏 ``` 的配对扫描：返回已配对块的行区间；未配对的开闭行直接忽略（流式降级） */
function codeFencePairs(lines: string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let open = -1;
  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) {
      if (open < 0) open = idx;
      else {
        pairs.push([open, idx]);
        open = -1;
      }
    }
  });
  return pairs;
}

/**
 * Markdown → rich-text nodes（对话气泡用）。
 * 顶层数组；段落 div 之间用 margin 呼吸，不用 <br> 堆叠（避免双倍行距）。
 */
export function mdToNodes(src: string): MdNode[] {
  if (!src) return [];
  const lines = src.split('\n');
  const fencePairs = codeFencePairs(lines);
  const inFence = (idx: number): [number, number] | null =>
    fencePairs.find(([s, e]) => idx >= s && idx <= e) || null;

  const nodes: MdNode[] = [];
  let paraBuf: string[] = []; // 连续普通行 → 合并为一个段落（行间 br）

  const flushPara = () => {
    if (!paraBuf.length) return;
    const children: Array<MdNode | string> = [];
    paraBuf.forEach((line, idx) => {
      if (idx > 0) children.push({ name: 'br' });
      parseInline(line).forEach((n) => children.push(n));
    });
    nodes.push({ name: 'div', attrs: { style: BASE + 'margin:0 0 8px;' }, children });
    paraBuf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行 → 段落分隔
    if (!trimmed) {
      flushPara();
      i += 1;
      continue;
    }

    // 代码块（仅配对生效；围栏本体不渲染）
    const fence = inFence(i);
    if (fence) {
      flushPara();
      const body = lines.slice(fence[0] + 1, fence[1]);
      const children: Array<MdNode | string> = [];
      body.forEach((codeLine, idx) => {
        if (idx > 0) children.push({ name: 'br' });
        children.push(codeLine);
      });
      nodes.push({
        name: 'div',
        attrs: {
          style:
            `background:${C.codeBg};border-radius:${px(16)};padding:${px(16)} ${px(20)};` +
            `margin:4px 0 8px;font-family:Menlo,Consolas,monospace;font-size:${px(23)};` +
            `line-height:1.6;color:${C.t1};word-break:break-word;`,
        },
        children,
      });
      i = fence[1] + 1;
      continue;
    }

    // 分隔线：--- / *** / ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      nodes.push({
        name: 'div',
        attrs: { style: `height:1px;background:${C.line};margin:10px 0;` },
        children: [],
      });
      i += 1;
      continue;
    }

    // 标题：# ~ ######
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      const size = level <= 2 ? px(34) : level === 3 ? px(30) : px(28);
      nodes.push({
        name: 'div',
        attrs: {
          style:
            BASE + `font-size:${size};font-weight:600;line-height:1.4;margin:10px 0 6px;` +
            (level === 1 ? `color:${C.brandTxt};` : ''),
        },
        children: parseInline(h[2]),
      });
      i += 1;
      continue;
    }

    // 引用块：连续 > 行合并
    if (/^>{1,}\s?/.test(trimmed)) {
      flushPara();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>{1,}\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>{1,}\s?/, ''));
        i += 1;
      }
      const children: Array<MdNode | string> = [];
      quoteLines.forEach((q, idx) => {
        if (idx > 0) children.push({ name: 'br' });
        parseInline(q).forEach((n) => children.push(n));
      });
      nodes.push({
        name: 'div',
        attrs: {
          style:
            BASE + `color:${C.t2};border-left:${px(6)} solid ${C.brand};` +
            `padding:${px(8)} 0 ${px(8)} ${px(16)};margin:4px 0 8px;background:${C.quoteBg};` +
            `border-radius:0 ${px(8)} ${px(8)} 0;`,
        },
        children,
      });
      continue;
    }

    // 无序列表：- / * / + 开头
    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara();
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const content = lines[i].trim().replace(/^[-*+]\s+/, '');
        nodes.push({
          name: 'div',
          attrs: { style: BASE + 'display:flex;margin:0 0 4px;' },
          children: [
            { name: 'span', attrs: { style: BASE + `flex:0 0 ${px(28)};color:${C.brand};` }, children: ['•'] },
            { name: 'span', attrs: { style: BASE + 'flex:1;' }, children: parseInline(content) },
          ],
        });
        i += 1;
      }
      continue;
    }

    // 有序列表：1. 开头
    if (/^\d+[.、]\s+/.test(trimmed)) {
      flushPara();
      let n = 0;
      while (i < lines.length && /^\d+[.、]\s+/.test(lines[i].trim())) {
        n += 1;
        const content = lines[i].trim().replace(/^\d+[.、]\s+/, '');
        nodes.push({
          name: 'div',
          attrs: { style: BASE + 'display:flex;margin:0 0 4px;' },
          children: [
            {
              name: 'span',
              attrs: { style: BASE + `flex:0 0 ${px(32)};color:${C.t2};` },
              children: [`${n}.`],
            },
            { name: 'span', attrs: { style: BASE + 'flex:1;' }, children: parseInline(content) },
          ],
        });
        i += 1;
      }
      continue;
    }

    // 表格：连续表格行（含分隔行）
    if (isTableRow(line) && !isTableSep(line)) {
      flushPara();
      const rows: string[][] = [];
      let hasSep = false;
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) break;
        if (isTableSep(cur)) {
          hasSep = true;
          i += 1;
          continue;
        }
        if (!isTableRow(cur)) break;
        rows.push(splitRow(cur));
        i += 1;
      }
      if (rows.length) {
        const cols = Math.max(...rows.map((r) => r.length));
        rows.forEach((cells, r) => {
          const isHead = hasSep && r === 0;
          const children: Array<MdNode | string> = [];
          for (let c = 0; c < cols; c += 1) {
            const cell = cells[c] ?? '';
            children.push({
              name: 'span',
              attrs: {
                style:
                  BASE +
                  `flex:1;padding:${px(8)} ${px(10)};font-size:${px(24)};` +
                  (isHead ? `font-weight:600;background:${C.codeBg};` : `color:${C.t1};`),
              },
              children: parseInline(cell),
            });
          }
          nodes.push({ name: 'div', attrs: { style: 'display:flex;margin:0;' }, children });
        });
        // 表格整体底部留白（容器化：用一个空 div 占位，rich-text 无 margin 合并）
        nodes.push({ name: 'div', attrs: { style: 'height:8px;' }, children: [] });
      }
      continue;
    }

    // 普通行 → 进段落缓冲
    paraBuf.push(trimmed);
    i += 1;
  }
  flushPara();
  return nodes;
}

/* ================= 纯文本化（朗读 / 复制） ================= */

/**
 * Markdown → 纯文本：星号/井号/反引号/竖线**不能进 TTS**（会被当标点念出怪声），
 * 复制到剪贴板也不该带语法符号。规则：去标记、留内容。
 * 代码围栏/标题/引用/列表/分隔线符号整行剥掉；表格竖线换空格；图片取 alt、链接取文字。
 */
export function mdToPlain(src: string): string {
  if (!src) return '';
  const lines = src.split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    // 代码围栏行：剥掉
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    // 分隔线：整行丢
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) continue;

    let t = line;
    if (inFence) {
      out.push(t); // 代码内容原样保留（TTS 一般不读代码，但复制要保真）
      continue;
    }
    // 标题/引用/列表前缀
    t = t.replace(/^\s*#{1,6}\s+/, '');
    t = t.replace(/^\s*>{1,}\s?/, '');
    t = t.replace(/^\s*[-*+]\s+/, '• ');
    t = t.replace(/^\s*(\d+)[.、]\s+/, '$1. ');
    // 图片 → alt 文本；链接 → 文字
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `[图片:${alt}]` : '[图片]'));
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // 行内标记：**x** / *x* / `x` / ~~x~~
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    t = t.replace(/__([^_]+)__/g, '$1');
    t = t.replace(/\*([^*]+)\*/g, '$1');
    t = t.replace(/(^|[^A-Za-z0-9])_([^_]+)_(?=[^A-Za-z0-9]|$)/g, '$1$2');
    t = t.replace(/~~([^~]+)~~/g, '$1');
    t = t.replace(/`([^`]+)`/g, '$1');
    // 表格竖线 → 空格
    if (t.includes('|')) {
      t = t.replace(/^\s*\|/, '').replace(/\|\s*$/, '').replace(/\s*\|\s*/g, ' ');
    }
    out.push(t);
  }
  // 折叠连续空行，首尾去空
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
