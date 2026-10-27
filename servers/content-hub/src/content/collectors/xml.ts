/** XML/RSS/Atom 解析公共工具——arxiv / rss 采集器共用 */

/**
 * HTML/XML 实体解码。
 * 支持命名实体（&lt; &gt; &quot; &#39; &apos; &amp;）+ 数字实体（&#NN; / &#xHH;）。
 * 顺序有语义：&amp; 最后解，避免二次解码。
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 去掉 XML/HTML 标签，保留纯文本。
 * 🔴 顺序：先解码实体 → 后去标签（P0-A #270）。
 * 旧顺序（先去标签后解码）导致二次转义的 HTML 残片漏进 content：
 *   RSS 里 `&lt;a href=&#34;…&#34;&gt;` 解码后才能被去标签规则正确匹配。
 */
export function stripTags(text: string): string {
  return decodeEntities(
    text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'),
  )
    .replace(/<[^>]*>/g, '')
    .trim();
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
