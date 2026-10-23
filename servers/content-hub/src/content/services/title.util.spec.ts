import { renderTitle } from './title.util';

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
});
