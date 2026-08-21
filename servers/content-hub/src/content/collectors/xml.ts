/** XML/RSS/Atom 解析公共工具——arxiv / rss 采集器共用 */

/** HTML/XML 实体解码 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 去掉 XML 标签，保留纯文本（先还原 CDATA 内容） */
export function stripTags(text: string): string {
  return decodeEntities(
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ''),
  ).trim();
}

/** 提取第一个匹配的标签内容（兼容带属性的 <title type="html"> 等） */
export function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}

/** 提取标签属性，如 <link href="..."/> 的 href */
export function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"[^>]*/?>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}
