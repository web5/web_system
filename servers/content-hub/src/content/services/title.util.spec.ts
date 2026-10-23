import { renderPlaceholders, renderTitle } from './title.util';

describe('renderTitle', () => {
  const d = new Date('2026-10-23T08:00:00Z');

  it('把 {{date}} 渲染成 YYYY-MM-DD', () => {
    expect(renderTitle('AI 资讯日报 ｜ {{date}}', '日报', d)).toBe(
      'AI 资讯日报 ｜ 2026-10-23',
    );
  });

  it('模板为空时回落到 fallback', () => {
    expect(renderTitle(null, '日报（ai_news）', d)).toBe('日报（ai_news）');
  });

  it('模板里没有变量时原样返回', () => {
    expect(renderTitle('每日论文速览', 'x', d)).toBe('每日论文速览');
  });

  it('默认取当前日期（不传 date 也能跑，不抛错）', () => {
    const out = renderTitle('日报 ｜ {{date}}', '日报');
    expect(out).toMatch(/^日报 ｜ \d{4}-\d{2}-\d{2}$/);
  });

  /**
   * 标题里有多处占位符时**全部**替换。
   *
   * 曾经的实现是 `text.replace('{{date}}', …)` —— 字符串参数只换第一处，
   * 于是在成文 markdown（标题行 + 摘要都可能有）里会剩半截模板直接进正文（#431）。
   */
  it('多处 {{date}} 全部替换（不是只换第一个）', () => {
    expect(renderTitle('日报 ｜ {{date}}（{{date}} 更新）', 'x', d)).toBe(
      '日报 ｜ 2026-10-23（2026-10-23 更新）',
    );
  });
});

describe('renderPlaceholders（#431 重建存量 markdown）', () => {
  const d = new Date('2026-10-23T04:34:00Z');

  it('把整段 markdown 里的 {{date}} 全部洗掉', () => {
    const md = '# AI 资讯日报 ｜ {{date}}\n\n## 1. 某条新闻\n\n原文：https://a.com/x';
    const out = renderPlaceholders(md, d);
    expect(out).not.toContain('{{date}}');
    expect(out).toContain('# AI 资讯日报 ｜ 2026-10-23');
    // 正文其它内容一个字都不能动
    expect(out).toContain('## 1. 某条新闻');
    expect(out).toContain('原文：https://a.com/x');
  });

  it('没有占位符时原样返回（幂等）', () => {
    const md = '# 日报 ｜ 2026-10-23';
    expect(renderPlaceholders(md, d)).toBe(md);
  });
});
