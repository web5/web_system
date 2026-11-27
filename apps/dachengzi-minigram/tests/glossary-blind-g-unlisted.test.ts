/**
 * 🔵 RD 独立盲测 G 组：收藏页（pages/mine/glossary）metaText / 「未收录」灰标
 *
 * 判据（E3，19:00 拍板）：
 *  - 收藏普通词（tag='word' + meta.hasDef=false）→ 列表显示「未收录」灰标
 *  - **历史旧数据（meta 无 hasDef 字段）不得显示「未收录」**（否则等于数据诬陷）
 *  - 句子收藏（tag='nce'）即使 meta 里混进 hasDef 也不显示词标
 *  - metaText：词收藏 = Lesson N · 单词 xxx（不带「第 M 句」）；句收藏 = Lesson N · 第 M 句
 *  - meta 异常（null / 字符串 / 缺字段）不得崩、不得渲染 undefined
 */
/// <reference types="node" />
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';

const wxMock: any = { getStorageSync: jest.fn(() => ''), setStorageSync: jest.fn(), navigateTo: jest.fn() };
let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: null, radiusClassOf: () => '' });
  (globalThis as any).Page = jest.fn((c: any) => { pageConfig = c; });
  require('../pages/mine/glossary/index');
});

function apply(list: any[]) {
  const ctx: any = {
    data: { ...JSON.parse(JSON.stringify(pageConfig.data)) },
    setData: jest.fn(function (this: any, patch: any) { Object.assign(this.data, patch); }),
  };
  pageConfig.apply.call(ctx, list);
  return ctx;
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 1,
  tag: 'word',
  sourceText: 'Lesson 3',
  enMain: 'bed',
  note: '',
  meta: {},
  createdAt: '2026-11-26T00:00:00Z',
  ...over,
});

describe('G1 「未收录」灰标判据（E3）', () => {
  it('单词收藏 + meta.hasDef=false → 未收录', () => {
    const ctx = apply([item({ meta: { book: 'nce2', lessonId: 3, word: 'bed', hasDef: false } })]);
    expect(ctx.data.items[0].unlistedText).toBe('未收录');
  });

  it('🔴 历史旧数据（meta 无 hasDef）→ 不显示「未收录」', () => {
    const ctx = apply([item({ meta: { book: 'nce2', lessonId: 3, word: 'bed' } })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('meta.hasDef=true → 不显示', () => {
    const ctx = apply([item({ meta: { word: 'early', hasDef: true } })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('句子收藏（tag=nce）即使 meta.hasDef=false 也不得冒「未收录」', () => {
    const ctx = apply([item({ tag: 'nce', enMain: 'I never get up early.', meta: { lessonId: 3, lineIndex: 0, hasDef: false } })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('反例：meta.hasDef="false"（字符串，后端序列化）不得被当成 true/false 误判', () => {
    const ctx = apply([item({ meta: { word: 'bed', hasDef: 'false' } })]);
    // 严格 === false 才标；字符串不是明确信号 → 不标（宁可不标，不诬陷）
    expect(ctx.data.items[0].unlistedText).toBe('');
  });

  it('meta=null / meta 是字符串 → 不崩、不标', () => {
    expect(() => apply([item({ meta: null })])).not.toThrow();
    const ctx = apply([item({ meta: 'not-an-object' })]);
    expect(ctx.data.items[0].unlistedText).toBe('');
  });
});

describe('G2 metaText（本轮新增 word 分支）', () => {
  it('单词收藏 → 「Lesson 3 · 单词 bed」（不带「第 M 句」）', () => {
    const ctx = apply([item({ meta: { lessonId: 3, lineIndex: 1, word: 'bed' } })]);
    expect(ctx.data.items[0].metaText).toBe('Lesson 3 · 单词 bed');
  });

  it('单词收藏缺 lessonId → 只显示「单词 bed」（不出现 undefined）', () => {
    const ctx = apply([item({ meta: { word: 'bed' } })]);
    expect(ctx.data.items[0].metaText).toBe('单词 bed');
  });

  it('句子收藏 → 「Lesson 3 · 第 2 句」（lineIndex 0 基 → 1 基展示）', () => {
    const ctx = apply([item({ tag: 'nce', meta: { lessonId: 3, lineIndex: 1 } })]);
    expect(ctx.data.items[0].metaText).toBe('Lesson 3 · 第 2 句');
  });

  it('句子收藏缺 lineIndex → 只显示 Lesson N', () => {
    const ctx = apply([item({ tag: 'nce', meta: { lessonId: 3 } })]);
    expect(ctx.data.items[0].metaText).toBe('Lesson 3');
  });

  it('旧 tone/direction 数据仍按老口径渲染（不得回归成空串）', () => {
    const ctx = apply([item({ tag: 'tone', meta: { tone: '地道', direction: 'zh2en' } })]);
    expect(ctx.data.items[0].metaText).toBe('地道 · 中文→英语');
  });

  it('meta 全空 → metaText 空串（wxml 隐藏该行，不渲染 undefined）', () => {
    const ctx = apply([item({ meta: {} })]);
    expect(ctx.data.items[0].metaText).toBe('');
  });

  it('列表为空 → empty=true；有数据 → empty=false', () => {
    expect(apply([]).data.empty).toBe(true);
    expect(apply([item()]).data.empty).toBe(false);
  });
});

describe('G3 灰标不可静态伪装：wxml 必须有 .unlisted 节点且受 unlistedText 控制', () => {
  it('wxml 同时渲染 metaText 与 unlistedText，且灰标有 unlisted class', () => {
    const w = fsMod.readFileSync(pathMod.join(__dirname, '../pages/mine/glossary/index.wxml'), 'utf8');
    expect(w).toMatch(/wx:if="\{\{item\.unlistedText\}\}"\s+class="unlisted"/);
    expect(w).toMatch(/\{\{item\.unlistedText\}\}/);
  });
});
