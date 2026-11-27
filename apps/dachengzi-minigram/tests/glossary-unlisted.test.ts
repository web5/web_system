/// <reference types="node" />
/**
 * 收藏页 · E3「未收录」灰标（2026-11-26 19:15 用户拍板 / 口径 E3 选项 B）
 *
 * 背景：长按动作抽屉允许收藏**课文词表外**的普通词（`tag='word'`，无音标无释义）。
 * 若列表项什么都不写，用户会以为「收藏坏了」。E3-B 的做法是加一句灰标「未收录」。
 *
 * 🔴 本文件守的是一条**向后兼容红线**：
 *    判据只能是 `meta.hasDef === false`（收藏时明确标记为普通词）。
 *    历史收藏没有 `hasDef` 字段（`undefined`）→ **不得**显示灰标。
 *    写成 `!m.hasDef` / `m.hasDef !== true` 之类的「宽松真值判断」，会把**所有历史收藏**
 *    标成「未收录」—— 那不是显示问题，是对用户既有数据的诬陷。下面第 2、3 条就是打这个点的。
 *
 * 另：`metaText` 在本轮之前是**零测试覆盖**的（盲测指出过），这里顺带把它的四个分支锁住。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');

let glossaryConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = { showToast: jest.fn(), showLoading: jest.fn(), hideLoading: jest.fn(), navigateTo: jest.fn() };
  (globalThis as any).Page = jest.fn((cfg: any) => { glossaryConfig = cfg; });
  (globalThis as any).getApp = jest.fn(() => ({ eventBus: { on: jest.fn(), off: jest.fn() }, radiusClassOf: () => '' }));
  require('../pages/mine/glossary/index');
});

function applyTo(items: any[]): any {
  const ctx: any = Object.create(glossaryConfig);
  ctx.data = JSON.parse(JSON.stringify(glossaryConfig.data));
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  ctx.apply(items);
  return ctx;
}

const item = (id: number, tag: string, meta: unknown) => ({
  id, tag, sourceText: '', enMain: `en-${id}`, note: '', meta, createdAt: '',
});

describe('E3 判据：只有明确 hasDef=false 才出现「未收录」', () => {
  it('普通词收藏（meta.hasDef=false）→ unlistedText = 未收录', () => {
    const ctx = applyTo([item(1, 'word', { book: 'NCE2', lessonId: 7, word: 'bed', hasDef: false })]);
    expect(ctx.data.items[0].unlistedText).toBe('未收录');
  });

  it('🔴 历史数据（meta 里没有 hasDef 字段）→ 不显示灰标（不能诬陷旧收藏）', () => {
    const ctx = applyTo([item(1, 'word', { book: 'NCE2', lessonId: 7, word: 'play' })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('🔴 meta 为 null / 缺失也算历史数据 → 不显示灰标', () => {
    const ctx = applyTo([item(1, 'tone', null), { ...item(2, 'nce', undefined), meta: undefined }]);
    expect(ctx.data.items.map((i: any) => i.unlistedText)).toEqual(['', '']);
  });

  it('生词收藏（meta.hasDef=true）→ 不显示灰标', () => {
    const ctx = applyTo([item(1, 'word', { book: 'NCE2', lessonId: 7, word: 'play', hasDef: true })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('句子收藏里即使混进 hasDef=false 脏字段也**不**标（灰标只属于单词收藏）', () => {
    // 锁「判据不越界」：hasDef 是词维度字段，脏数据不该让一句英文冒出一个「未收录」词标。
    const ctx = applyTo([item(1, 'nce', { book: 'NCE2', lessonId: 7, lineIndex: 0, hasDef: false })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('老数据的既有 metaText 全部不变（本轮不动来源文本）', () => {
    const ctx = applyTo([
      item(1, 'word', { book: 'NCE2', lessonId: 7, lineIndex: 0, word: 'play', hasDef: false }),
      item(2, 'nce', { book: 'NCE2', lessonId: 7, lineIndex: 0 }),
      item(3, 'nce', { from: 'daily' }),
      item(4, 'tone', null),
      item(5, 'nce', { tone: '正式', direction: 'zh2en' }),
    ]);
    const texts = ctx.data.items.map((i: any) => i.metaText);
    expect(texts[0]).toBe('Lesson 7 · 单词 play');
    expect(texts[1]).toBe('Lesson 7 · 第 1 句');
    expect(texts[2]).toBe('');
    expect(texts[3]).toBe('');
    expect(texts[4]).toBe('正式 · 中文→英语');
    texts.forEach((t: string) => expect(t).not.toContain('undefined'));
  });
});

describe('E3 渲染与样式（静态）', () => {
  it('wxml：灰标由 unlistedText 驱动，且与 metaText 同一行', () => {
    const w = src('pages/mine/glossary/index.wxml');
    expect(w).toMatch(/<text wx:if="\{\{item\.unlistedText\}\}" class="unlisted">\{\{item\.unlistedText\}\}<\/text>/);
    // 同一行：都在 .meta 容器里（否则会另起一行把列表项撑高）
    const metaBlock = (/<view class="meta"[\s\S]*?<\/view>/.exec(w) || [''])[0];
    expect(metaBlock).toContain('item.unlistedText');
    expect(metaBlock).toContain('item.metaText');
  });

  it('wxss：灰标是「灰」（#9CA3AF，与抽屉「暂无释义」同档灰）而不是品牌蓝', () => {
    const css = src('pages/mine/glossary/index.wxss');
    const rule = (/\.gi \.meta \.unlisted\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(rule).not.toBe('');
    expect(rule).toMatch(/color:\s*#9CA3AF/);
    expect(rule).not.toMatch(/--brand-txt/);
  });
});
