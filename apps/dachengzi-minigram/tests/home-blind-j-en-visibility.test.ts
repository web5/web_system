/**
 * 🔵 RD 独立盲测 J 组：需求①「首页英文句可见」（AC-1.1 / AC-1.2，经 AC-B.26 继续有效）
 *
 * 用户原话是「首页英文句子不见了」。这一条有两个层次：
 *  ① 结构层：token 真的渲染出来（P0 已修：wx:for 缺 wx:for-item）
 *  ② 可见层：AC-1.2 明确量化「字号 ≥26rpx、对比度 ≥4.5:1（WCAG AA 正文）」，
 *     并写明「即便结构正常，23rpx / 1.9:1 在真机上就是『看着像没有』」。
 * 只修①不修②，用户看到的仍是「几乎看不见」——两个层次都要验。
 */
/// <reference types="node" />
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';
import { tokenize } from '../utils/tokenize';

const APP = pathMod.join(__dirname, '..');
const read = (p: string) => fsMod.readFileSync(pathMod.join(APP, p), 'utf8');

/** 从 wxss 取某个 class 规则体（首个匹配） */
function ruleOf(css: string, cls: string): string {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`);
  const m = cleaned.match(re);
  return m ? m[1] : '';
}

/** 取 CSS 变量定义值（app.wxss 的 page 选择器） */
function cssVar(name: string): string {
  const css = read('app.wxss');
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : '';
}

/** rgba/rgb/#hex → {r,g,b,a} */
function parseColor(v: string): { r: number; g: number; b: number; a: number } | null {
  const s = v.trim();
  const rgba = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
  }
  const hex = s.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  return null;
}

/** 半透明前景合成到白底 */
function overWhite(c: { r: number; g: number; b: number; a: number }) {
  const mix = (ch: number) => Math.round(255 * (1 - c.a) + ch * c.a);
  return { r: mix(c.r), g: mix(c.g), b: mix(c.b) };
}

/** WCAG 相对亮度 + 对比度 */
function luminance(c: { r: number; g: number; b: number }) {
  const f = (ch: number) => {
    const s = ch / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrastOnWhite(c: { r: number; g: number; b: number }) {
  const L = luminance(c);
  return (1.05) / (L + 0.05);
}

describe('J1 结构层：英文 token 真的渲染（P0 回归守卫）', () => {
  it('wx:for 带 wx:for-item="tk"（漏写整段英文渲染为空 = 本次 P0 的根因）', () => {
    const w = read('pages/home/index/index.wxml');
    const loop = w.match(/<block\s+wx:for="\{\{quoteTokens\}\}"[^>]*>/);
    expect(loop).not.toBeNull();
    expect(loop![0]).toMatch(/wx:for-item="tk"/);
  });

  it('正常英文句切词后 w 非空 token 数 > 0（不是空数组渲染）', () => {
    const toks = tokenize('I never get up early on Sundays.');
    expect(toks.filter((t) => t.w).length).toBeGreaterThan(0);
  });

  it('反例 B6：英文句为空串 → 不渲染 token、不报错', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('J2 可见层：AC-1.2 字号 ≥26rpx、对比度 ≥4.5:1', () => {
  it('字号 ≥ 26rpx', () => {
    const body = ruleOf(read('pages/home/index/index.wxss'), 'daily-en');
    const size = Number((body.match(/font-size:\s*([\d.]+)rpx/) || [])[1]);
    expect(size).toBeGreaterThanOrEqual(26);
  });

  it('文字对比度 ≥ 4.5:1（--t3 半透明灰合成白底后计算）', () => {
    const body = ruleOf(read('pages/home/index/index.wxss'), 'daily-en');
    const raw = ((body.match(/color:\s*([^;]+);/) || [])[1] || '').trim();
    // 支持 var(--x) 间接引用
    const varName = (raw.match(/var\(--([\w-]+)/) || [])[1];
    const value = varName ? cssVar(varName) : raw;
    const parsed = parseColor(value);
    expect(parsed).not.toBeNull();
    const contrast = contrastOnWhite(overWhite(parsed!));
    // 便于报告引用：把实际算出的数字打到断言消息里
    expect({ color: value, contrast: Math.round(contrast * 100) / 100 }).toEqual(
      expect.objectContaining({ contrast: expect.any(Number) }),
    );
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('对照：详情页英文正文（.w）对比度必须达标（同页面同语言不应两套可读性）', () => {
    const body = ruleOf(read('pages/nce/detail/detail.wxss'), 'w');
    const parsed = parseColor((body.match(/color:\s*([^;]+);/) || [])[1] || '')!;
    expect(contrastOnWhite(overWhite(parsed))).toBeGreaterThanOrEqual(4.5);
  });
});
