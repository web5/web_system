/**
 * s28 · 每日美句只读页静态 + DOM 审计（157 稿 V5/V6/V7/V8/V10/V11/V12 机检）
 *
 * 思路：直接用 @vue/compiler-sfc 解析生产 SFC 的 template AST（即编译器真正消费的结构），
 * 再把 AST 还原成 DOM 用 jsdom 断言；同时对 compileTemplate 产物检查 v-html / 原生输入元素。
 * 这样「写按钮 / 可编辑控件」的判据针对的是生产组件，不是原型 HTML。
 * 所有路径由 __dirname 推导，禁本机绝对路径硬编码。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- compiler-sfc AST 节点为松散结构，审计需泛型遍历 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, compileTemplate } from '@vue/compiler-sfc';

const vuePath = resolve(__dirname, 'DailyQuotes.vue');
const root = resolve(__dirname, '../../../../..');
const routerPath = resolve(root, 'apps/admin/src/router/index.ts');
const layoutPath = resolve(root, 'apps/admin/src/layouts/BasicLayout.vue');

const sfc = parse(readFileSync(vuePath, 'utf8'), { filename: vuePath });
const script = sfc.descriptor.scriptSetup?.content ?? '';
const templateAst = sfc.descriptor.template?.ast;
const routerSrc = readFileSync(routerPath, 'utf8');
const layoutSrc = readFileSync(layoutPath, 'utf8');

function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  visit(node);
  for (const key of ['props', 'branches', 'parseResult']) walk(node[key], visit);
  walk(node.children, visit);
}

const allNodes: any[] = [];
walk(templateAst, (n) => allNodes.push(n));
const elements = allNodes.filter((n) => n.type === 1);
const isButton = (n: any) => n.tag === 'button' || n.tag === 'a-button';

function textOf(n: any): string {
  if (n?.type === 2) return String(n.content ?? '');
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (n && typeof n === 'object') {
    return ['children', 'branches', 'content'].map((k) => textOf(n[k])).join('');
  }
  return '';
}

/** AST → HTML（插值不产出子节点），供 jsdom 做真实 DOM 查询。 */
function astToHtml(n: any): string {
  if (Array.isArray(n)) return n.map(astToHtml).join('');
  if (!n || typeof n !== 'object') return '';
  if (n.type === 2) {
    return String(n.content ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (n.type === 1) {
    const attrs = (n.props ?? [])
      .filter((p: any) => p.type === 6)
      .map((p: any) => `${p.name}="${String(p.value?.content ?? '').replace(/"/g, '&quot;')}"`)
      .join(' ');
    const inner = [...(n.children ?? []), ...(n.branches ?? [])].map(astToHtml).join('');
    return `<${n.tag}${attrs ? ' ' + attrs : ''}>${inner}</${n.tag}>`;
  }
  return ['children', 'branches'].map((k) => astToHtml(n[k])).join('');
}

const doc = new DOMParser().parseFromString(astToHtml(templateAst), 'text/html');
const WRITE_WORDS = /新增|创建|编辑|删除|保存|提交|生成|批量|导入|上传|修改|重置密码/;

describe('V8 · 只读 DOM 硬审计（生产 SFC AST + 编译产物）', () => {
  it('SFC 可解析且模板无编译错', () => {
    expect(sfc.errors).toEqual([]);
    expect(templateAst).toBeDefined();
  });

  it('无原生 input / textarea / select / button / form，无 contenteditable', () => {
    const forbidden = elements
      .filter((n) => ['input', 'textarea', 'select', 'option', 'button', 'form'].includes(n.tag))
      .map((n) => n.tag);
    expect(forbidden).toEqual([]);

    const editable = allNodes.filter((n) => n.type === 6 && n.name === 'contenteditable');
    expect(editable).toEqual([]);
    expect(doc.querySelectorAll('input, textarea, select, button, [contenteditable]')).toHaveLength(0);
  });

  it('无 v-html；编译产物无 innerHTML / vHtml / 原生输入元素', () => {
    const htmlDirectives = allNodes.filter((n) => n.type === 7 && n.name === 'html');
    expect(htmlDirectives).toEqual([]);

    const compiled = compileTemplate({
      source: sfc.descriptor.template!.content,
      filename: vuePath,
      id: 's28-daily-quotes',
    });
    expect(compiled.errors).toEqual([]);
    expect(compiled.code).not.toContain('innerHTML');
    expect(compiled.code).not.toContain('vHtml');
    expect(compiled.code).not.toContain('createElementVNode("input"');
    expect(compiled.code).not.toContain('createElementBlock("textarea"');
  });

  it('所有按钮文案仅在白名单内（预览/关闭/刷新/重试/清空搜索），无写按钮', () => {
    const buttons = elements.filter(isButton);
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      const label = textOf(b).trim();
      expect(['预览', '关闭', '刷新', '重试', '清空搜索']).toContain(label);
      expect(WRITE_WORDS.test(label)).toBe(false);
    }
    const domButtons = Array.from(doc.querySelectorAll('a-button, button')).map((b) => b.textContent?.trim() ?? '');
    for (const label of domButtons) expect(WRITE_WORDS.test(label)).toBe(false);
  });
});

describe('V5/V6/V7 · 列表、抽屉、搜索与客户端分页', () => {
  it('a-table 五列标题齐，含 a-spin / a-empty / 错误态重试', () => {
    for (const title of ['#', '英文 / English', '中文 / Chinese', '来源 / Source', '操作']) {
      expect(script).toContain(title);
    }
    expect(elements.some((n) => n.tag === 'a-table')).toBe(true);
    expect(elements.some((n) => n.tag === 'a-spin')).toBe(true);
    expect(elements.some((n) => n.tag === 'a-empty')).toBe(true);
    expect(script).toContain('重试');
  });

  it('抽屉 width 900 + moduleOverlayContainer，4 个 source 字段全名 + 版权注记', () => {
    const drawer = elements.find((n) => n.tag === 'a-drawer');
    expect(drawer).toBeDefined();
    const attrs = (drawer!.props ?? []).map((p: any) => `${p.name}=${p.value?.content ?? p.exp?.content ?? ''}`).join(' ');
    expect(attrs).toContain('width=900');
    expect(attrs).toContain('moduleOverlayContainer');

    for (const label of ['source.book', 'source.lessonId', 'source.title', 'source.lineIndex']) {
      expect(script).toContain(label);
    }
    expect(script).toContain('仅供个人学习');
    expect(script).toContain('不对外分发');
  });

  it('rowKey 用 (book, lessonId, lineIndex) 组合键；搜索四字段客户端过滤；20 条/页客户端分页', () => {
    expect(script).toContain('${r.source.book}-${r.source.lessonId}-${r.source.lineIndex}');
    expect(script).toContain('item.cn');
    expect(script).toContain('item.en');
    expect(script).toContain('item.source.title');
    expect(script).toContain('String(item.source.lessonId)');
    expect(script).toMatch(/pageSize\s*=\s*ref\(20\)/);
    expect(script).toContain('.slice(');
  });

  it('只调 getDailyQuotes() 一次整池加载，无分页/keyword 参数、无 book 筛选 tab', () => {
    const calls = script.match(/getDailyQuotes\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(script).not.toMatch(/getDailyQuotes\([^)]/);
    expect(script).not.toContain('params:');
    expect(script).not.toContain('book-tabs');
    expect(script).not.toContain('activeBook');
  });
});

describe('V10/V11 · 路由与菜单三处接线（顺序敏感）', () => {
  it('router: content children 增 daily-quotes，紧跟 nce-lessons，复用 content:view', () => {
    const daily = routerSrc.indexOf("path: 'daily-quotes'");
    const nce = routerSrc.indexOf("path: 'nce-lessons'");
    expect(daily).toBeGreaterThan(-1);
    expect(nce).toBeGreaterThan(-1);
    expect(daily).toBeGreaterThan(nce);
    expect(routerSrc.slice(daily, daily + 400)).toContain("name: 'DailyQuotes'");
    expect(routerSrc.slice(daily, daily + 400)).toContain("permission: 'content:view'");
    expect(routerSrc.slice(daily, daily + 400)).toContain('DailyQuotes.vue');
  });

  it('BasicLayout: 菜单项 / handleMenuClick 路由表 / watch 分支三处齐且分支在 /content 兜底之前', () => {
    expect(layoutSrc).toContain('key="content-daily-quotes"');
    expect(layoutSrc).toContain('每日美句');
    expect(layoutSrc).toContain("'content-daily-quotes': '/content/daily-quotes'");

    const dailyWatch = layoutSrc.indexOf("path.includes('/content/daily-quotes')");
    const nceWatch = layoutSrc.indexOf("path.includes('/content/nce-lessons')");
    const fallback = layoutSrc.indexOf("path.includes('/content')");
    expect(dailyWatch).toBeGreaterThan(nceWatch);
    expect(dailyWatch).toBeLessThan(fallback);
    expect(layoutSrc.slice(dailyWatch, dailyWatch + 160)).toContain("'content-daily-quotes'");
  });
});
