/** 渲染器——Markdown 日报组装 + Markdown→公众号 HTML 转换（P0-B 内联样式版） */

import { WS, TABLE } from './wechat-style';

export interface RenderItem {
  title: string;
  summary: string;
  url?: string;
  source_name?: string;
}

/**
 * 条目 → 渲染项的唯一映射。
 *
 * 🔴 **只在这里决定「日报里显示哪个标题」**。
 *   定时发布（`pipeline.service.run`）和成文预览重建（`content.service`）都必须调它，
 *   禁止各自 `items.map(...)`。
 *
 * 中文标题优先：`title_zh` 为空表示原文本身就是中文，回落 `title`。
 */
export function toRenderItem(it: {
  title: string;
  title_zh?: string | null;
  summary?: string | null;
  url?: string | null;
  source_name?: string | null;
}): RenderItem {
  return {
    title: it.title_zh?.trim() || it.title,
    summary: it.summary ?? '',
    url: it.url ?? undefined,
    source_name: it.source_name ?? undefined,
  };
}

/**
 * 组装 Markdown 日报。
 *
 * D4：不输出首行 `# 标题`（与文章标题重复，公众号正文不需要再写一遍）。
 * D1：`原文：长URL` → `[阅读原文 →](url)`（URL 藏 href，正文不裸奔）。
 */
export function buildDailyMarkdown(title: string, items: RenderItem[]): string {
  const lines: string[] = [];
  items.forEach((it, i) => {
    lines.push(`## ${i + 1}. ${it.title}`);
    lines.push('');
    lines.push(it.summary || '');
    if (it.url) {
      lines.push('');
      lines.push(`[阅读原文 →](${it.url})`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

/** HTML 转义（防 HTML 残片当正文渲染） */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 裸 URL 的匹配。三处刻意排除，每一处都对应一种真实串：
 *   - 前置 `"` `'` `=` —— `<a href="http…">` / `href=http…` 里的 URL 不能再被链接一次
 *   - 前置 `/`         —— `https://a.com/https://b` 不能在 URL 中间断开
 *   - URL 体内的中日韩标点（CJK 标点）
 */
const BARE_URL = /(^|[^"'=\w/])(https?:\/\/[^\s<>"'　-〿＀-￯]+)/g;

/** URL 末尾被误吞的标点（半角 + 中文全角都算） */
const TRAILING_PUNCT = /[),.;:!?，。；：！？、）】》」』…]+$/;

/**
 * 行内格式：行内代码 + 加粗 + 斜体 + markdown 链接 + 裸 URL。
 * 文本内容先 HTML 转义，生成的标签带内联样式。
 *
 * 🔴 顺序有语义：代码 → 转义 → 加粗 → 斜体 → md链接 → 裸URL → 还原。
 */
function inline(text: string): string {
  const kept: string[] = [];
  const ph = (i: number) => ` ${i} `;

  // 1. 行内代码（内容转义，不参与后续格式化）
  const noCode = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    kept.push(`<code style="${WS.codeSpan}">${esc(code)}</code>`);
    return ph(kept.length - 1);
  });

  // 2. HTML 转义（防止 HTML 残片当正文）
  const safe = esc(noCode);

  // 3. 加粗
  const withBold = safe.replace(
    /\*\*(.+?)\*\*/g,
    (_m, inner: string) => `<strong style="${WS.strong}">${inner}</strong>`,
  );

  // 4. 斜体（*text* 但不是 **text**）
  const withEm = withBold.replace(
    /(?<![*\w])\*([^*]+?)\*(?!\*)/g,
    (_m, inner: string) => `<em style="${WS.em}">${inner}</em>`,
  );

  // 4.5 图片（在链接之前，因为 ![alt](src) 形似 [alt](src)）
  const noImages = withEm.replace(
    /!\[(.*?)\]\((.+?)\)/g,
    (_m, alt: string, src: string) => {
      kept.push(`<img src="${src}" alt="${esc(alt)}" style="${WS.img}">`);
      return ph(kept.length - 1);
    },
  );

  // 5. markdown 链接
  const noMdLinks = noImages.replace(
    /\[(.+?)\]\((.+?)\)/g,
    (_m, label: string, href: string) => {
      kept.push(`<a href="${href}" style="${WS.a}">${label}</a>`);
      return ph(kept.length - 1);
    },
  );

  // 6. 裸 URL
  const withBare = noMdLinks.replace(
    BARE_URL,
    (whole: string, pre: string, url: string) => {
      const tailMatch = url.match(TRAILING_PUNCT);
      const tail = tailMatch ? tailMatch[0] : '';
      const clean = tail ? url.slice(0, -tail.length) : url;
      if (!clean) return whole;
      return `${pre}<a href="${clean}" style="${WS.a}">${clean}</a>${tail}`;
    },
  );

  return withBare.replace(/ (\d+) /g, (_m, i: string) => kept[Number(i)] ?? '');
}

/** 解析表格行：`| a | b |` → `['a', 'b']` */
function parseTableRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Markdown → 公众号 HTML（全内联样式）。
 *
 * h1 降级为 h2（公众号标题本身是 h1）。
 * 支持：标题 / 段落 / 加粗 / 斜体 / 行内代码 / 链接 / 图片 / 列表（ul/ol）/
 *       代码块 / 表格 / 引用 / 分隔线。
 *
 * D2/D3：日报条目（`## N. 标题`）自动 `<section>` 分隔 + 橙色序号。
 */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let i = 0;
  let entryOpen = false; // D2: 日报条目 section 是否打开

  const closeEntry = () => {
    if (entryOpen) {
      html.push('</section>');
      entryOpen = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── 代码块 ``` ──
    if (/^```/.test(line)) {
      closeEntry();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const rows = codeLines
        .map((l) => {
          const body = esc(l).replace(/ {2}/g, '&nbsp;&nbsp;');
          return `<p style="${WS.codeLine}">${body || '&nbsp;'}</p>`;
        })
        .join('');
      html.push(`<section style="${WS.codeWrap}">${rows}</section>`);
      continue;
    }

    // ── 分隔线 --- ──
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeEntry();
      html.push(`<hr style="${WS.hr}">`);
      i++;
      continue;
    }

    // ── 表格 | a | b | ──
    if (/^\|.*\|/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
      closeEntry();
      const headers = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const head = headers.map((c) => `<th style="${TABLE.th}">${inline(c)}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${row.map((c) => `<td style="${TABLE.td}">${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      html.push(`<table style="${TABLE.table}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    // ── 引用块 > ──
    if (/^>\s?/.test(line)) {
      closeEntry();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const inner = quoteLines.map((l) => `<p style="${WS.p}">${inline(l)}</p>`).join('');
      html.push(`<section style="${WS.quote}">${inner}</section>`);
      continue;
    }

    // ── 标题 # ──
    if (/^#{1,6}\s/.test(line)) {
      const level = (line.match(/^#+/) ?? [''])[0].length;
      const text = line.replace(/^#+\s*/, '');
      const h = Math.min(level + 1, 4);

      // D2/D3：日报条目（## N. 标题）→ section 分隔 + 橙色序号
      const entryMatch = text.match(/^(\d+)\.\s+(.+)$/);
      if (h === 3 && entryMatch) {
        closeEntry();
        const num = entryMatch[1];
        const title = entryMatch[2];
        html.push(`<section style="${WS.entrySection}">`);
        html.push(`<h3 style="${WS.h3}"><span style="${WS.entryNum}">${num}.</span>${inline(title)}</h3>`);
        entryOpen = true;
      } else {
        closeEntry();
        if (h === 2) {
          html.push(`<h2 style="${WS.h2}">${WS.h2Bar}${inline(text)}</h2>`);
        } else if (h === 3) {
          html.push(`<h3 style="${WS.h3}">${WS.h3Dot}${inline(text)}</h3>`);
        } else {
          html.push(`<h${h} style="${WS.h4}">${inline(text)}</h${h}>`);
        }
      }
      i++;
      continue;
    }

    // ── 无序列表 - ──
    if (/^[-*]\s/.test(line)) {
      closeEntry();
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s*/, '');
        html.push(`<p style="${WS.li}">${WS.dot}${inline(text)}</p>`);
        i++;
      }
      continue;
    }

    // ── 有序列表 1. ──
    if (/^\d+\.\s/.test(line)) {
      closeEntry();
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const m = lines[i].match(/^(\d+)\.\s+(.*)$/);
        if (m) {
          html.push(`<p style="${WS.li}"><span style="${WS.entryNum}">${m[1]}.</span>${inline(m[2])}</p>`);
        }
        i++;
      }
      continue;
    }

    // ── 空行 ──
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── 段落 ──
    html.push(`<p style="${WS.p}">${inline(line)}</p>`);
    i++;
  }

  closeEntry();
  return html.join('\n');
}
