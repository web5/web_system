import { decodeEntities, stripTags } from './xml';

/**
 * P0-A 存储层清洗（#270）。
 *
 * 根因：stripTags 先去标签后解码实体，导致二次转义的 HTML 完整漏进 content。
 * 例：RSS 里 `<a href=&#34;…&#34;>` 因为 &#34; 未被识别，去标签时 <a …> 整段被当标签去掉，
 * 但 href 里的 &#34; 引号内容可能残留；反过来先解码再剥才能正确处理。
 */
describe('decodeEntities 数字实体解码（P0-A）', () => {
  it('解码十进制数字实体 &#NN;', () => {
    expect(decodeEntities('&#34;')).toBe('"');
    expect(decodeEntities('&#39;')).toBe("'");
    expect(decodeEntities('&#60;')).toBe('<');
    expect(decodeEntities('&#62;')).toBe('>');
    expect(decodeEntities('&#38;')).toBe('&');
  });

  it('解码十六进制数字实体 &#xHH;', () => {
    expect(decodeEntities('&#x22;')).toBe('"');
    expect(decodeEntities('&#x27;')).toBe("'");
    expect(decodeEntities('&#x3C;')).toBe('<');
    expect(decodeEntities('&#x3E;')).toBe('>');
    expect(decodeEntities('&#x26;')).toBe('&');
  });

  it('混合命名实体和数字实体', () => {
    expect(decodeEntities('&#34;hello&#34; &amp; &#x3C;world&#x3E;')).toBe('"hello" & <world>');
  });

  it('已有命名实体照旧工作', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
    expect(decodeEntities('&quot;hi&quot;')).toBe('"hi"');
    expect(decodeEntities('&amp;')).toBe('&');
    expect(decodeEntities('&#39;a&#39;|&apos;b&apos;')).toBe("'a'|'b'");
  });

  it('不误伤普通文本', () => {
    expect(decodeEntities('hello world')).toBe('hello world');
    expect(decodeEntities('a=1&b=2')).toBe('a=1&b=2'); // &b 不是实体
  });
});

/**
 * stripTags 顺序：先解码实体 → 后去标签。
 * 旧顺序（先去标签后解码）导致二次转义的标签漏进正文。
 */
describe('stripTags 清洗顺序（P0-A）', () => {
  it('二次转义的 HTML 标签被正确清除', () => {
    // 模拟 RSS 中 content 被二次转义的场景：&lt;a href=&#34;...&#34;&gt;查看&lt;/a&gt;
    const dirty = '&lt;a href=&#34;https://example.com&#34; target=&#34;_blank&#34;&gt;查看&lt;/a&gt;';
    const clean = stripTags(dirty);
    // 先解码 → <a href="…" target="_blank">查看</a> → 去标签 → 查看
    expect(clean).toBe('查看');
    expect(clean).not.toContain('<a ');
    expect(clean).not.toContain('target=');
    expect(clean).not.toContain('&#34;');
  });

  it('正常的 HTML 标签照旧被去除', () => {
    expect(stripTags('<p>hello</p>')).toBe('hello');
    expect(stripTags('<a href="https://x.com">link</a> text')).toBe('link text');
  });

  it('CDATA 内容被还原后清洗', () => {
    expect(stripTags('<![CDATA[<b>bold</b> text]]>')).toBe('bold text');
  });

  it('id=225 类脏数据形态（content 带 <a href=&#34;…&#34;>）', () => {
    const dirty = 'Some text <a href=&#34;https://sspai.com/post/115074&#34; target=&#34;_blank&#34;>查看</a> more';
    const clean = stripTags(dirty);
    expect(clean).not.toContain('<a ');
    expect(clean).not.toContain('target=');
    expect(clean).not.toContain('&#34;');
    // 内容文本保留
    expect(clean).toContain('Some text');
    expect(clean).toContain('more');
  });

  it('混合实体与真实标签的脏数据', () => {
    const dirty = '&lt;script&gt;alert(1)&lt;/script&gt; <b>real</b>';
    // 先解码 → <script>alert(1)</script> <b>real</b> → 去标签 → alert(1) real
    const clean = stripTags(dirty);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('<b>');
    expect(clean).toContain('alert(1)');
  });
});
