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

/** 行内格式：加粗 + 链接 */
function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
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
