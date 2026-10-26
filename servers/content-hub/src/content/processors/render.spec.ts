import { buildDailyMarkdown, markdownToHtml, toRenderItem } from './render';

/**
 * 标题本地化的渲染口径（2026-10-26）。
 *
 * 为什么单独钉：`toRenderItem` 是「日报里显示哪个标题」的**唯一决策点**，
 * 定时发布和成文预览都调它。这里判错的形态很难在开发环境发现——
 * 单条看起来正常，只有整篇日报里混着中英文标题才暴露。
 */
describe('toRenderItem 标题优先级', () => {
  it('有中文标题就用中文', () => {
    expect(
      toRenderItem({ title: 'Torvalds: AI is fine', title_zh: '托瓦兹：AI 没问题' }).title,
    ).toBe('托瓦兹：AI 没问题');
  });

  it('中文标题为空 → 回落原文（中文源就是这条路径，不该显示空标题）', () => {
    expect(toRenderItem({ title: '百度世界2026前瞻', title_zh: null }).title).toBe('百度世界2026前瞻');
    expect(toRenderItem({ title: '百度世界2026前瞻' }).title).toBe('百度世界2026前瞻');
  });

  it('中文标题是空白串 → 也回落原文（不能把空串当真值）', () => {
    expect(toRenderItem({ title: 'Some English Title', title_zh: '   ' }).title).toBe(
      'Some English Title',
    );
  });

  it('其余字段照旧透传，缺省补空', () => {
    expect(toRenderItem({ title: 't', summary: null })).toEqual({
      title: 't',
      summary: '',
      url: undefined,
      source_name: undefined,
    });
  });
});

/**
 * 渲染器回归（#399 根因 B）。
 *
 * 线上现象：prod 成文预览里 `原文：https://…` 是死文本，点不动。
 * 根因：`buildDailyMarkdown` 输出的是**裸 URL**，而 `inline()` 只认 `[文字](url)`
 *       这种 markdown 链接 —— 裸 URL 在任何版本里都不会变成 `<a>`。
 *
 * 修法把「裸 URL → 链接」加进 `inline()`，代价是三个顺序/边界陷阱，
 * 下面每一条用例就是钉死其中一个（全部为负向可验证，不是凑数）：
 *   1. 必须在 markdown 链接**之后**处理，否则 `[文字](url)` 里的 URL 先变 `<a>` 会炸语法；
 *   2. 不能把 `<a href="…">` 里的 URL 再链接一次（嵌套 `<a>` 在公众号编辑器里会丢内容）；
 *   3. URL 体内不能吞掉中文标点，否则「链接后面的整句话」会一起变成链接。
 */
describe('markdownToHtml 裸 URL 转链接（#399）', () => {
  const aTags = (html: string) => html.match(/<a\s/g) ?? [];

  it('裸 URL 变成可点链接（带 query 的也不截断）', () => {
    const html = markdownToHtml('原文：https://example.com/a?id=1&b=2');
    expect(html).toBe(
      '<p>原文：<a href="https://example.com/a?id=1&b=2">https://example.com/a?id=1&b=2</a></p>',
    );
    expect(aTags(html).length).toBe(1);
  });

  it('URL 结尾的中文句号不吞进 href', () => {
    const html = markdownToHtml('原文：https://example.com/a。');
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('</a>。</p>');
  });

  it('URL 后面紧跟中文时，链接只到 URL 为止（不吞整句）', () => {
    const html = markdownToHtml('来源：https://example.com/a，后面还有一句中文。');
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('后面还有一句中文');
    // 链接文字里不得出现中文
    const anchorText = html.match(/<a [^>]*>(.*?)<\/a>/)?.[1] ?? '';
    expect(anchorText).toBe('https://example.com/a');
  });

  it('markdown 链接不被二次包裹（不得出现嵌套 <a>）', () => {
    const html = markdownToHtml('见[官方公告](https://example.com/notice)');
    expect(html).toBe('<p>见<a href="https://example.com/notice">官方公告</a></p>');
    expect(aTags(html).length).toBe(1);
  });

  it('markdown 链接里带 URL 文字时，标签内也不再套一层链接', () => {
    const html = markdownToHtml('[https://example.com/x](https://example.com/x)');
    expect(aTags(html).length).toBe(1);
    expect(html).toBe('<p><a href="https://example.com/x">https://example.com/x</a></p>');
  });

  it('加粗照旧生效，且链接文字里的加粗不丢', () => {
    expect(markdownToHtml('**重点**')).toBe('<p><strong>重点</strong></p>');
    expect(markdownToHtml('[**官方**](https://example.com/n)')).toBe(
      '<p><a href="https://example.com/n"><strong>官方</strong></a></p>',
    );
  });

  it('没有 URL 的纯文本输出不变（不漏标签、不改空格）', () => {
    expect(markdownToHtml('普通一句话')).toBe('<p>普通一句话</p>');
    expect(markdownToHtml('### 小标题')).toBe('<h4>小标题</h4>');
    expect(markdownToHtml('- 条目一\n- 条目二')).toBe('<ul>\n<li>条目一</li>\n<li>条目二</li>\n</ul>');
  });

  it('http 之外的协议不误判（ftp:// 不该被当成链接）', () => {
    const html = markdownToHtml('ftp://example.com/a');
    expect(aTags(html).length).toBe(0);
  });
});

describe('buildDailyMarkdown → markdownToHtml 端到端（#399 现场）', () => {
  it('日报里的「原文：」整行产出可点链接', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-23', [
      {
        title: 'Exercise in a pill',
        summary: '一种模拟运动效果的药物进入临床。',
        url: 'https://www.technologyreview.com/2026/10/22/exercise-pill/',
        source_name: 'MIT Tech Review',
      },
    ]);
    const html = markdownToHtml(md);

    // 层级仍在：文章标题 `#` → h2，条目 `##` → h3（`Math.min(level+1, 4)`）。
    // 注意不是 h2 —— 原来 issue 里写的「条目标题应是 h2」是看漏了 +1，实测是 h3；
    // 层级关系（标题 > 条目 > 正文）本来就对，坏的只有链接。
    expect(html).toContain('<h2>AI 资讯日报 ｜ 2026-10-23</h2>');
    expect(html).toContain('<h3>1. Exercise in a pill</h3>');
    // 原文链接可点
    expect(html).toContain('<a href="https://www.technologyreview.com/2026/10/22/exercise-pill/">');
    // 且整篇只有这一个链接（没有因为是「裸 URL + 段落」而重复包一层）
    expect((html.match(/<a\s/g) ?? []).length).toBe(1);
  });
});
