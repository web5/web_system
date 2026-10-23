/**
 * linkifyHtml 的单测（#433）。
 *
 * 重点不是「能变链接」，而是**三个不该动的地方没有动**：
 * 已在 `<a>` 里的、`code/pre` 里的、以及 URL 后面紧跟的中文标点。
 * 这三条对应之前踩过的真实串，缺一个就会在页面上看出问题。
 */
import { linkifyHtml } from './linkify';

describe('linkifyHtml', () => {
  it('把正文里的裸 URL 变成可点链接', () => {
    const out = linkifyHtml('<p>原文：https://example.com/a</p>');

    expect(out).toContain('<a href="https://example.com/a"');
    expect(out).toContain('>https://example.com/a</a>');
  });

  it('外链新窗口打开并断 opener（后台登录态不能被跳走）', () => {
    const out = linkifyHtml('<p>https://example.com</p>');

    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('中文标点不被吞进 URL（关键：否则整句变一个链接）', () => {
    const out = linkifyHtml('<p>原文：https://example.com/a，后面还有中文</p>');

    expect(out).toContain('href="https://example.com/a"');
    expect(out).not.toContain('href="https://example.com/a，');
    // 中文必须留在链接外
    expect(out).toMatch(/<\/a>，后面还有中文/);
  });

  it('剥离 URL 末尾的句号/括号，不写进 href', () => {
    const out = linkifyHtml('<p>见 https://example.com/a。</p>');

    expect(out).toContain('href="https://example.com/a"');
    expect(out).not.toContain('href="https://example.com/a。"');
  });

  it('已经在 <a> 里的不重复包裹（幂等的核心）', () => {
    const html = '<p>原文：<a href="https://example.com/a">https://example.com/a</a></p>';
    const out = linkifyHtml(html);

    expect(out).toBe(html);
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it('href 属性里的 URL 不会被当成正文再包一层', () => {
    const out = linkifyHtml('<p><a href="https://example.com/x">点我</a></p>');

    // 只有原来那一个 <a>，没有嵌套
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).not.toContain('<a href="<a');
  });

  it('code / pre 内的原样保留（代码里的 URL 不是可点链接）', () => {
    const html = '<pre><code>curl https://example.com/api</code></pre>';
    const out = linkifyHtml(html);

    expect(out).not.toContain('<a ');
    expect(out).toContain('https://example.com/api');
  });

  it('幂等：连跑两次结果一致', () => {
    const once = linkifyHtml('<p>原文：https://example.com/a</p>');
    const twice = linkifyHtml(once);

    expect(twice).toBe(once);
  });

  it('一段里多个 URL 全部处理', () => {
    const out = linkifyHtml('<p>https://a.com/1 和 https://b.com/2</p>');

    expect(out).toContain('href="https://a.com/1"');
    expect(out).toContain('href="https://b.com/2"');
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  it('没有 URL 时原样返回（不做无谓的 DOM 解析）', () => {
    const html = '<h2>标题</h2><p>没有链接的正文</p>';

    expect(linkifyHtml(html)).toBe(html);
  });

  it('null / undefined / 空串都回空串，不抛错', () => {
    expect(linkifyHtml(null)).toBe('');
    expect(linkifyHtml(undefined)).toBe('');
    expect(linkifyHtml('')).toBe('');
  });

  it('只有协议没有主机时不产出空链接', () => {
    const out = linkifyHtml('<p>https://。</p>');

    expect(out).not.toContain('<a href="https://"');
  });
});
