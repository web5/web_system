/** 渲染器——Markdown 日报组装 + Markdown→公众号 HTML 转换 */

export interface RenderItem {
  title: string;
  summary: string;
  url?: string;
  source_name?: string;
}

/** 组装 Markdown 日报（腾讯文档直接用） */
export function buildDailyMarkdown(title: string, items: RenderItem[]): string {
  const lines: string[] = [`# ${title}`, ''];
  items.forEach((it, i) => {
    lines.push(`## ${i + 1}. ${it.title}`);
    lines.push('');
    lines.push(it.summary || '');
    if (it.url) lines.push('');
    if (it.url) lines.push(`原文：${it.url}`);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * 裸 URL 的匹配。三处刻意排除，每一处都对应一种真实串：
 *   - 前置 `"` `'` `=` —— `<a href="http…">` / `href=http…` 里的 URL 不能再被链接一次（否则嵌套 <a>）
 *   - 前置 `/`         —— `https://a.com/https://b` 不能在 URL 中间断开
 *   - URL 体内的中日韩标点（`\u3000-\u303f` `\uff00-\uffef`）
 *                      —— `https://a.com/a，后面还有中文` 若不排除，整句会被吞成一个链接
 *
 * 不靠 lookbehind：老 Node / 部分转译链路会直接语法报错，用「吃掉一个前置字符再回填」等价且到处能跑。
 */
const BARE_URL = /(^|[^"'=\w/])(https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+)/g;

/** URL 末尾被误吞的标点（半角 + 中文全角都算，句号/逗号/括号不属于 URL） */
const TRAILING_PUNCT = /[),.;:!?，。；：！？、）】》」』…]+$/;

/**
 * 行内格式：加粗 + markdown 链接 + 裸 URL。
 *
 * 🔴 顺序是**有语义的**，不能换：
 *   1. 先加粗 —— 链接文字里可以有 `**粗体**`，反过来（先提链接）会让标签内的
 *      markdown 失去处理机会。
 *   2. 再把 `[文字](url)` 整段摘成占位符 —— 否则第 3 步会把里面的 URL 先变成
 *      `<a>`，`[文字](<a …>)` 语法直接崩掉（这是 #399 根因 B 最容易踩的坑）。
 *   3. 然后才处理裸 URL —— 此时文本里已经没有任何「属于 markdown 语法的 URL」。
 *   4. 最后还原占位符。
 */
function inline(text: string): string {
  const kept: string[] = [];
  const placeholder = (i: number) => `\u0000${i}\u0000`;

  const withBold = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const withoutMdLinks = withBold.replace(
    /\[(.+?)\]\((.+?)\)/g,
    (_m, label: string, href: string) => {
      kept.push(`<a href="${href}">${label}</a>`);
      return placeholder(kept.length - 1);
    },
  );

  const withBareLinks = withoutMdLinks.replace(
    BARE_URL,
    (whole: string, pre: string, url: string) => {
      const tailMatch = url.match(TRAILING_PUNCT);
      const tail = tailMatch ? tailMatch[0] : '';
      const clean = tail ? url.slice(0, -tail.length) : url;
      // 全是标点（理论上进不来）就原样返回，不产出空链接
      if (!clean) return whole;
      return `${pre}<a href="${clean}">${clean}</a>${tail}`;
    },
  );

  return withBareLinks.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] ?? '');
}

/** 简单 Markdown → HTML（公众号正文；h1 降级为 h2，因公众号标题本身是 h1） */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      const level = (line.match(/^#+/) ?? [''])[0].length;
      const text = line.replace(/^#+\s*/, '');
      const h = Math.min(level + 1, 4);
      html.push(`<h${h}>${inline(text)}</h${h}>`);
    } else if (/^[-*]\s/.test(line)) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s*/, ''))}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}
