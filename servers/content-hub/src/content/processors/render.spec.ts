import { buildDailyMarkdown, markdownToHtml, toRenderItem } from './render';
import { C, WS, TABLE } from './wechat-style';

/**
 * 标题本地化的渲染口径（2026-10-26）。
 */
describe('toRenderItem 标题优先级', () => {
  it('有中文标题就用中文', () => {
    expect(
      toRenderItem({ title: 'Torvalds: AI is fine', title_zh: '托瓦兹：AI 没问题' }).title,
    ).toBe('托瓦兹：AI 没问题');
  });

  it('中文标题为空 → 回落原文', () => {
    expect(toRenderItem({ title: '百度世界2026前瞻', title_zh: null }).title).toBe('百度世界2026前瞻');
    expect(toRenderItem({ title: '百度世界2026前瞻' }).title).toBe('百度世界2026前瞻');
  });

  it('中文标题是空白串 → 也回落原文', () => {
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
 * P0-B 内联样式覆盖（#270 / #272 / REQ-3）。
 * 判据 V12-V16：无伪元素 / 无 class / 变量已展开 / 代码块配色 / 内联覆盖率 100%。
 */
describe('markdownToHtml 内联样式（P0-B / REQ-3）', () => {
  it('V12: 输出不含 <style> 标签', () => {
    const html = markdownToHtml('# 标题\n\n正文段落');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('::before');
  });

  it('V13: 输出不含 class= 属性', () => {
    const html = markdownToHtml('# 标题\n\n正文\n\n- 列表\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).not.toContain('class=');
  });

  it('V14: 输出不含 CSS 变量 var(--', () => {
    const html = markdownToHtml('# 标题\n\n正文\n\n```\ncode\n```');
    expect(html).not.toContain('var(--');
  });

  it('V16: 段落 <p> 带 style= 且含 text-align:left', () => {
    const html = markdownToHtml('普通一句话');
    expect(html).toMatch(/<p style="[^"]*text-align:left[^"]*"/);
  });

  it('V16: 标题 <h2>-<h4> 带 style=', () => {
    const html = markdownToHtml('# 章节\n\n## 小节\n\n### 细节');
    expect(html).toMatch(/<h2 style="[^"]+"/);
    expect(html).toMatch(/<h3 style="[^"]+"/);
    expect(html).toMatch(/<h4 style="[^"]+"/);
  });

  it('V16: 表格 <td>/<th> 带 style=', () => {
    const html = markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toMatch(/<th style="[^"]+"/);
    expect(html).toMatch(/<td style="[^"]+"/);
  });

  it('V15: 代码块深底 #1C1E26 + 浅字 #E2E8F0', () => {
    const html = markdownToHtml('```\nconst x = 1;\n```');
    expect(html).toContain(C.codeBg); // #1C1E26
    expect(html).toContain(C.codeText); // #E2E8F0
    expect(html).not.toContain('#f6f8fa'); // 旧浅灰底不得残留
  });

  it('h2 章节标题带橙色竖条 span', () => {
    const html = markdownToHtml('# 章节标题');
    expect(html).toContain(WS.h2Bar);
  });

  it('h3 小节标题带橙色圆点 span', () => {
    const html = markdownToHtml('## 小节标题');
    expect(html).toContain(WS.h3Dot);
  });

  it('引用块用 section + 内联样式（不依赖 blockquote 标签）', () => {
    const html = markdownToHtml('> 引用内容');
    expect(html).toContain('<section');
    expect(html).toContain(C.brand500); // border-left 橙色
  });

  it('分隔线 <hr> 带内联样式', () => {
    const html = markdownToHtml('---');
    expect(html).toMatch(/<hr style="[^"]*border-top/);
  });

  it('有序列表序号带橙色 span', () => {
    const html = markdownToHtml('1. 第一项\n2. 第二项');
    expect(html).toContain(`color:${C.brand500}`);
    expect(html).toContain('1.');
    expect(html).toContain('2.');
  });

  it('无序列表圆点用真实 span（非伪元素）', () => {
    const html = markdownToHtml('- 条目');
    expect(html).toContain(WS.dot);
    expect(html).not.toContain('::before');
  });

  it('行内代码带内联样式', () => {
    const html = markdownToHtml('用 `npm run dev` 启动');
    expect(html).toMatch(/<code style="[^"]+"/);
  });

  it('加粗带内联样式', () => {
    const html = markdownToHtml('**重点**');
    expect(html).toMatch(/<strong style="[^"]+"/);
  });
});

/**
 * P0-B HTML 转义（#270）。
 * 反例：过度转义（把正常 <p> 显示成字面量）或转义不足（HTML 残片当正文）。
 */
describe('markdownToHtml HTML 转义（P0-A/P0-B）', () => {
  it('正文中的 HTML 标签被转义，不被渲染', () => {
    const html = markdownToHtml('点击<a href="https://x.com">查看</a>');
    // <a> 应被转义为 &lt;a，不产生真实的 <a> 标签（除非是 markdown 语法生成的）
    expect(html).not.toContain('<a href="https://x.com">');
    expect(html).toContain('&lt;a');
  });

  it('HTML 实体 &#34; 不出现在输出中（已被解码或转义）', () => {
    const html = markdownToHtml('test &#34;quoted&#34;');
    expect(html).not.toContain('&#34;');
  });

  it('正常的 markdown 生成的标签不被转义（不过度转义）', () => {
    const html = markdownToHtml('**加粗** 和 [链接](https://x.com)');
    expect(html).toContain('<strong');
    expect(html).toContain('<a ');
    expect(html).not.toContain('&lt;strong');
    expect(html).not.toContain('&lt;a');
  });

  it('脚本标签被转义', () => {
    const html = markdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

/**
 * P0-B 新语法覆盖（#269）：表格 / 代码块 / 引用 / 有序列表。
 */
describe('markdownToHtml 语法覆盖（#269）', () => {
  it('表格：完整渲染 <table>/<thead>/<tbody>/<th>/<td>', () => {
    const html = markdownToHtml('| 元素 | 样式 |\n|---|---|\n| 代码块 | 深底 |');
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('元素');
    expect(html).toContain('深底');
  });

  it('代码块：用 section + 逐行 p（不用 pre）', () => {
    const html = markdownToHtml('```\nline1\nline2\n```');
    expect(html).not.toContain('<pre');
    expect(html).toContain('<section');
    expect(html).toContain('line1');
    expect(html).toContain('line2');
  });

  it('引用块：用 section 包裹', () => {
    const html = markdownToHtml('> 第一行\n> 第二行');
    expect(html).toContain('<section');
    expect(html).toContain('第一行');
  });

  it('有序列表：序号用 span 标记', () => {
    const html = markdownToHtml('1. 甲\n2. 乙');
    expect(html).toContain('<span');
    expect(html).toContain('甲');
    expect(html).toContain('乙');
  });

  it('图片带内联样式', () => {
    const html = markdownToHtml('![alt](https://x.com/img.png)');
    expect(html).toMatch(/<img [^>]*style="[^"]+"/);
  });
});

/**
 * 裸 URL 转链接回归（#399）。
 * 内联样式加入后，链接仍需正常工作。
 */
describe('markdownToHtml 裸 URL 转链接（#399）', () => {
  const aTags = (html: string) => html.match(/<a\s/g) ?? [];

  it('裸 URL 变成可点链接', () => {
    const html = markdownToHtml('原文：https://example.com/a?id=1&b=2');
    expect(html).toContain('href="https://example.com/a?id=1');
    expect(aTags(html).length).toBe(1);
  });

  it('URL 结尾的中文句号不吞进 href', () => {
    const html = markdownToHtml('原文：https://example.com/a。');
    expect(html).toContain('href="https://example.com/a"');
  });

  it('markdown 链接不被二次包裹', () => {
    const html = markdownToHtml('见[官方公告](https://example.com/notice)');
    expect(aTags(html).length).toBe(1);
    expect(html).toContain('官方公告');
  });

  it('加粗照旧生效', () => {
    const html = markdownToHtml('**重点**');
    expect(html).toContain('<strong');
    expect(html).toContain('重点');
  });

  it('http 之外的协议不误判', () => {
    const html = markdownToHtml('ftp://example.com/a');
    expect(aTags(html).length).toBe(0);
  });
});

/**
 * 日报方案B（D1-D4，V19-V23）。
 * 真源：需求单附录 · 日报类内容的专属排版缺口。
 */
describe('日报方案B D1-D4（V19-V23）', () => {
  const dailyItems = [
    {
      title: 'Exercise in a pill',
      summary: '一种模拟运动效果的药物进入临床。',
      url: 'https://www.technologyreview.com/2026/10/22/exercise-pill/',
      source_name: 'MIT Tech Review',
    },
    {
      title: 'AI Agent 新突破',
      summary: '多智能体协作框架发布。',
      url: 'https://arxiv.org/abs/2026.10234',
      source_name: 'arXiv',
    },
    {
      title: '开源模型更新',
      summary: '参数量提升 3 倍。',
      url: 'https://github.com/org/repo/releases/v2',
      source_name: 'GitHub',
    },
  ];

  it('D4/V23: 日报正文不输出首行 # 标题（与文章标题重复）', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    expect(md).not.toContain('# AI 资讯日报');
    expect(md.trimStart()).not.toMatch(/^#\s/);
  });

  it('D1/V19: 日报正文 HTML 不出现裸 URL、不出现 <a> 链接', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    const html = markdownToHtml(md);
    // V19: 不出现 >https:// 形式的纯文本 URL
    expect(html).not.toMatch(/>https?:\/\//);
    // Option B: 不出现任何 <a> 标签（微信剥外链，链接必死）
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
  });

  it('D1/V20: 正文不含「原文：」短标签段、不含「阅读原文」暗示', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    const html = markdownToHtml(md);
    expect(html).not.toContain('原文：');
    expect(html).not.toContain('阅读原文');
    expect(html).not.toMatch(/<p[^>]*>原文：/);
  });

  it('D2/V21: 每条外层有独立 section 分隔', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    const html = markdownToHtml(md);
    const sections = html.match(/<section[^>]*border-top/g) ?? [];
    expect(sections.length).toBeGreaterThanOrEqual(3); // 至少 3 条各有分隔
  });

  it('D3/V22: 序号带品牌橙色 #F97316', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    const html = markdownToHtml(md);
    expect(html).toContain('#F97316');
    // 序号 span 存在
    expect(html).toMatch(/<span[^>]*#F97316[^>]*>1\.<\/span>/);
    expect(html).toMatch(/<span[^>]*#F97316[^>]*>2\.<\/span>/);
  });

  it('D1 Option B: 正文完全无 URL、无链接（来源走 content_source_url）', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    const html = markdownToHtml(md);
    // 无 <a> 标签
    expect(html).not.toContain('<a ');
    // 无 href 属性
    expect(html).not.toContain('href=');
    // 无裸 URL 文本
    expect(html).not.toMatch(/https?:\/\//);
    // 无「阅读原文」暗示可点的措辞
    expect(html).not.toContain('阅读原文');
    expect(html).not.toContain('→');
  });

  it('P2: summary 内容里的裸 URL 被中和，不泄漏到 HTML', () => {
    const items = [
      {
        title: 'Test Article',
        summary: '研究进展可参考 https://arxiv.org/abs/2026.10234 获取详情。',
        url: 'https://example.com/source',
      },
    ];
    const md = buildDailyMarkdown('Test', items);
    const html = markdownToHtml(md);
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('P2: summary 里的 markdown 链接被中和（保留文字、去掉链接）', () => {
    const items = [
      {
        title: 'Test Article',
        summary: '详见 [论文原文](https://arxiv.org/abs/2026.10234) 了解更多。',
        url: 'https://example.com/source',
      },
    ];
    const md = buildDailyMarkdown('Test', items);
    const html = markdownToHtml(md);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    // 保留文字
    expect(html).toContain('论文原文');
  });

  it('P2: title 里的 URL 也被中和', () => {
    const items = [
      {
        title: 'See https://example.com/bad-link for details',
        summary: '正常摘要内容',
        url: 'https://example.com/source',
      },
    ];
    const md = buildDailyMarkdown('Test', items);
    const html = markdownToHtml(md);
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('P2: 正常无 URL 的内容不受影响', () => {
    const items = [
      {
        title: 'AI Agent 新突破',
        summary: '多智能体协作框架发布，支持复杂任务分解与并行执行。',
      },
    ];
    const md = buildDailyMarkdown('Test', items);
    const html = markdownToHtml(md);
    expect(html).toContain('AI Agent 新突破');
    expect(html).toContain('多智能体协作框架发布');
  });

  it('P3#3: <a> HTML 标签壳被整壳清除（不残留空壳标签）', () => {
    const items = [
      {
        title: 'Test',
        summary: '详见 <a href="https://x.com">链接文字</a> 了解更多。',
      },
    ];
    const md = buildDailyMarkdown('Test', items);
    const html = markdownToHtml(md);
    // 不出现 <a> 标签、不出现 <a > 空壳
    expect(html).not.toContain('<a');
    // 不出现转义后的标签壳（&lt;a）
    expect(html).not.toContain('&lt;a');
  });

  it('P3#1: 空 scheme 残段（单独 https://）被清除', () => {
    const items = [
      {
        title: 'Test',
        summary: '研究进展可参考 https:// 获取详情。',
      },
    ];
    const md = buildDailyMarkdown('Test', items);
    const html = markdownToHtml(md);
    expect(html).not.toContain('https://');
    expect(html).not.toContain('http://');
  });

  it('端到端：日报 HTML 结构完整', () => {
    const md = buildDailyMarkdown('AI 资讯日报 ｜ 2026-10-27', dailyItems);
    const html = markdownToHtml(md);
    // 有内容
    expect(html).toContain('Exercise in a pill');
    expect(html).toContain('AI Agent 新突破');
    expect(html).toContain('开源模型更新');
    // 有摘要
    expect(html).toContain('一种模拟运动效果的药物进入临床。');
    // 不含标题（D4）
    expect(html).not.toContain('AI 资讯日报 ｜ 2026-10-27');
  });
});
