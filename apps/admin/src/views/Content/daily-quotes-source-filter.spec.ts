/**
 * 来源筛选表单 · TDD 结构守卫（s36 / 167 稿 V1–V13）
 *
 * ## 为什么是静态源码守卫而不是挂载组件
 *
 * admin 的 jest 配置把 `.vue` 导入映射成空模块桩，且未装 @vue/test-utils。
 * 本仓既有守卫（见 src/utils/overlay-container-guard.spec.ts）一律用 fs 读源码做
 * 「结构断言」——这里沿用同一套：检测器函数吃一段源码字符串，既用于真实文件
 * （实现后必须全绿），也用于变异夹具（注入 bug 必须被判红）。
 *
 * ## 三条硬边界（变异红绿自证）
 * ① 册别 AND 漏加（改了不过滤）→ hasBookAnd 必须变 false
 * ② 注入编辑按钮 → findWriteButtonLabels 必须命中（V8 零容忍）
 * ③ 页码不重置 → hasPageReset 必须变 false
 *
 * 路径用 __dirname 相对定位，绝不硬编码本机绝对路径（历史 CI 事故）。
 *
 * ---
 *
 * ## 🔴 2026-11-25 增补（s42 / V9 缺陷）：源码守卫对「渲染」是瞎的
 *
 * 上文的源码正则守卫有一个已被实测击穿的盲区：**它只证明"源码里有这段文本"，
 * 不证明"浏览器里真渲染出来"**。实证：`<a-empty>` 里写的 `<template #extra>`
 * 被 antdv 4.2.6 的 Empty 静默丢弃（该组件只读 slots.image / description / default，
 * 见 node_modules/ant-design-vue/es/empty/index.js 第 49/50/81–83 行），
 * 按钮 **从未进入 vnode 树**，而 hasClearButton / hasEmptyClearLabel 照样绿。
 * V9 要求的「空态唯一恢复入口」实际不存在，页面已上线却没被任何断言拦住。
 *
 * 因此本文件**追加**（不替换、不删除旧断言）一组「渲染态用例」：
 *   · 真实编译并挂载**生产 SFC**（同一个 DailyQuotes.vue，不是副本、不是手搓模板）；
 *   · antdv 用生产同款注册函数 setupAntd 注册；
 *   · 空态按钮一律按**渲染后 DOM**（.ant-empty-footer 内的 button）断言与点击，
 *     绝不读源码字符串 —— 模板槽失效时会立刻变红（见 M1 变异）。
 *
 * 挂载实现说明：仓库无 @vue/test-utils，且 jest.config.cjs 把 `.vue$` 映射为空模块桩。
 * 为不触碰共享测试基建（改了会影响全部 14 个 suite），这里沿用本仓已有的
 * `@vue/compiler-sfc` 路线（daily-quotes.readonly.spec.ts 同样在用）：
 * parse → compileScript + compileTemplate → 用 vue 原生 createApp 挂到 jsdom。
 * 编译产物是 ESM，用 typescript.transpileModule 转 CJS 后以显式模块白名单求值，
 * 白名单之外出现新 import 会直接抛错（防止 harness 悄悄失配生产代码）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createApp, nextTick, type App as VueApplication, type Component } from 'vue';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as ts from 'typescript';
import * as VueRuntime from 'vue';
import * as nceApiModule from '@/api/nce';
import * as mountModule from '@/utils/mount';
import { setupAntd } from '@/plugins/antd';
import type { DailyQuoteItem } from '@/api/nce';

// 渲染态用例的替身：接口整池由用例给定；antd 的 reset.css 在 jsdom 里只需空对象
// （setupAntd 会 import 它，jest 无 css transform，不 mock 会同步抛语法错）。
jest.mock('@/api/nce', () => ({ getDailyQuotes: jest.fn() }));
jest.mock('ant-design-vue/dist/reset.css', () => ({}));

/** 本文件在 views/Content/ 下，页面源码同级，逐级不依赖 cwd。 */
const PAGE = join(__dirname, 'DailyQuotes.vue');
function src(): string {
  return readFileSync(PAGE, 'utf8');
}

// ───────────────────────── 检测器（纯函数，吃源码文本） ─────────────────────────

function hasBookFilterRef(s: string): boolean {
  return /const\s+bookFilter\s*=\s*ref/.test(s) && /'ALL'/.test(s);
}
function hasLessonFilterRef(s: string): boolean {
  return /const\s+lessonFilter\s*=\s*ref\(\s*''\s*\)/.test(s);
}

/** 册别 AND 条件：bookFilter==='ALL' || item.source.book===bookFilter */
function hasBookAnd(s: string): boolean {
  return /bookFilter\.value\s*===\s*'ALL'\s*\|\|\s*\w+\.source\.book\s*===\s*bookFilter\.value/.test(s);
}
/** 课号 AND 条件：!lessonFilter || String(lessonId).includes(lessonFilter.trim()) */
function hasLessonAnd(s: string): boolean {
  return /!lessonFilter\.value\s*\|\|\s*String\(\w+\.source\.lessonId\)\.includes\(lessonFilter\.value\.trim\(\)\)/.test(s);
}
/** keyword 原条件仍在（不能因加筛选而丢掉） */
function hasKeywordAnd(s: string): boolean {
  return /keyword\.value\.trim\(\)\.toLowerCase\(\)/.test(s) && /\.some\(/.test(s);
}

/** 页码重置：onFilterChange 函数体里有 page.value = 1；或 watch([..filter..]) 里重置 */
function hasPageReset(s: string): boolean {
  const fn = /function\s+onFilterChange\s*\([^)]*\)\s*\{([\s\S]*?)\}/.exec(s);
  if (fn !== null) return /page\.value\s*=\s*1/.test(fn[1]);
  return /watch\(\s*\[[^\]]*bookFilter[^\]]*lessonFilter[^\]]*\][\s\S]*?page\.value\s*=\s*1/.test(s);
}
/** 筛选控件确实接了 onFilterChange（定义 1 + 绑定 ≥2） */
function filterChangeWiring(s: string): number {
  return (s.match(/onFilterChange/g) ?? []).length;
}
/** 清空复位三条件 + keyword + 页码 */
function hasClearFilters(s: string): boolean {
  const fn = /function\s+clearFilters\s*\([^)]*\)\s*\{([\s\S]*?)\}/.exec(s);
  if (fn === null) return false;
  const b = fn[1];
  return /bookFilter\.value\s*=\s*'ALL'/.test(b)
    && /lessonFilter\.value\s*=\s*''/.test(b)
    && /keyword\.value\s*=\s*''/.test(b)
    && /page\.value\s*=\s*1/.test(b);
}

function selectOptionValues(s: string): string[] {
  return [...s.matchAll(/<a-select-option[^>]*value="([^"]+)"/g)].map((m) => m[1]);
}
function hasLessonInput(s: string): boolean {
  return /<a-input\b[^>]*v-model:value="lessonFilter"/.test(s);
}
function hasClearButton(s: string): boolean {
  return /<a-button[^>]*@click="clearFilters"/.test(s);
}
function hasEmptyClearLabel(s: string): boolean {
  return /清空筛选与搜索/.test(s);
}

/** V8：产品区写按钮零容忍（看按钮文案，不看正文里的「无编辑/保存/删除入口」说明） */
function findWriteButtonLabels(s: string): string[] {
  const bad: string[] = [];
  const re = /<a-button\b[^>]*>([\s\S]*?)<\/a-button>/g;
  const forbidden = /新增|编辑|删除|保存|生成|批量|提交|修改|写入/;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const label = m[1].replace(/<[^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();
    if (forbidden.test(label)) bad.push(label);
  }
  return bad;
}
/** V8：表格内/抽屉内编辑控件零容忍；查询控件（select / 课号 a-input / 搜索框）放行 */
function findForbiddenEditControls(s: string): string[] {
  const bad: string[] = [];
  if (/contenteditable/i.test(s)) bad.push('contenteditable');
  if (/<textarea\b/i.test(s)) bad.push('textarea');
  if (/v-html\b/.test(s)) bad.push('v-html');
  if (/<input\b/i.test(s)) bad.push('raw-<input>');
  return bad;
}

/** V11：接口调用不得带筛选参数、不得伪造 query */
function hasFabricatedParams(s: string): boolean {
  return /getDailyQuotes\s*\(\s*\{/.test(s)
    || /getDailyQuotes\s*\(\s*params/.test(s)
    || /daily-quotes\?[^'"`]*book=/.test(s)
    || /['"]\?book=/.test(s)
    || /['"]\?lessonId=/.test(s);
}
function hasBareGetDailyQuotes(s: string): boolean {
  return /getDailyQuotes\(\)/.test(s);
}

// ───────────────────────── 正确实现基准夹具 + 变异夹具 ─────────────────────────

/**
 * 与预期实现同构的最小片段。变异测试只对它动手，不碰真实文件；
 * 真实文件由下方「结构守卫」组单独断言。两者共用同一组检测器。
 */
const GOOD = `
const bookFilter = ref<'ALL' | 'NCE2' | 'NCE3' | 'NCE4'>('ALL');
const lessonFilter = ref('');
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return pool.value.items.filter((item) => {
    const okBook = bookFilter.value === 'ALL' || item.source.book === bookFilter.value;
    const okLesson = !lessonFilter.value || String(item.source.lessonId).includes(lessonFilter.value.trim());
    const okKw = !k || [item.cn, item.en, item.source.title, String(item.source.lessonId)].some((v) => v.toLowerCase().includes(k));
    return okBook && okLesson && okKw;
  });
});
function onFilterChange() { page.value = 1; }
function clearFilters() { bookFilter.value = 'ALL'; lessonFilter.value = ''; keyword.value = ''; page.value = 1; }
<a-select><a-select-option value="ALL">全部</a-select-option><a-select-option value="NCE2">NCE2</a-select-option><a-select-option value="NCE3">NCE3</a-select-option><a-select-option value="NCE4">NCE4</a-select-option></a-select>
<a-input v-model:value="lessonFilter" @change="onFilterChange" />
<a-button @click="clearFilters">清空</a-button>
`;

/** 变异①：册别改了不过滤（AND 漏加） */
const MUT_NO_BOOK = GOOD.replace(
  "bookFilter.value === 'ALL' || item.source.book === bookFilter.value",
  'true',
);
/** 变异②：注入编辑按钮 */
const MUT_EDIT_BTN = GOOD.replace('</a-button>\n', '</a-button>\n<a-button type="primary">编辑</a-button>\n');
/** 变异③：页码不重置 */
const MUT_NO_RESET = GOOD.replace(
  'function onFilterChange() { page.value = 1; }',
  'function onFilterChange() { /* forgot page reset */ }',
);

// ───────────────────────── 真实文件结构守卫（实现前 RED / 实现后 GREEN） ─────────────────────────

describe('来源筛选表单 · DailyQuotes.vue 结构守卫', () => {
  it('新增 bookFilter / lessonFilter 两个 ref（默认 ALL / 空串）', () => {
    expect(hasBookFilterRef(src())).toBe(true);
    expect(hasLessonFilterRef(src())).toBe(true);
  });

  it('filtered 同时含册别 ∧ 课号 ∧ keyword 三个 AND 条件', () => {
    expect(hasBookAnd(src())).toBe(true);
    expect(hasLessonAnd(src())).toBe(true);
    expect(hasKeywordAnd(src())).toBe(true);
  });

  it('工具条：四选项册别下拉 + 课号输入 + 清空按钮', () => {
    expect(selectOptionValues(src())).toEqual(['ALL', 'NCE2', 'NCE3', 'NCE4']);
    expect(hasLessonInput(src())).toBe(true);
    expect(hasClearButton(src())).toBe(true);
  });

  it('筛选变化重置第 1 页 + 清空复位三条件', () => {
    expect(hasPageReset(src())).toBe(true);
    expect(filterChangeWiring(src())).toBeGreaterThanOrEqual(3);
    expect(hasClearFilters(src())).toBe(true);
    expect(hasEmptyClearLabel(src())).toBe(true);
  });

  it('V8 只读：无写按钮、无编辑控件（查询控件语义放行）', () => {
    expect(findWriteButtonLabels(src())).toEqual([]);
    expect(findForbiddenEditControls(src())).toEqual([]);
  });

  it('V11 不伪造接口参数：getDailyQuotes() 裸调用', () => {
    expect(hasBareGetDailyQuotes(src())).toBe(true);
    expect(hasFabricatedParams(src())).toBe(false);
  });
});

// ───────────────────────── 变异红绿（证明守卫不是摆设） ─────────────────────────

describe('变异红绿 · 守卫有效性自证', () => {
  it('① 册别 AND 漏加 → 册别守卫红', () => {
    expect(hasBookAnd(GOOD)).toBe(true); // 正确实现：绿
    expect(hasBookAnd(MUT_NO_BOOK)).toBe(false); // 注入「改了不过滤」：红
  });

  it('② 注入编辑按钮 → V8 机检红', () => {
    expect(findWriteButtonLabels(GOOD)).toEqual([]); // 绿
    expect(findWriteButtonLabels(MUT_EDIT_BTN)).toContain('编辑'); // 红
  });

  it('③ 页码不重置 → 页码守卫红', () => {
    expect(hasPageReset(GOOD)).toBe(true); // 绿
    expect(hasPageReset(MUT_NO_RESET)).toBe(false); // 红
  });
});

// ══════════════════ V9 渲染态用例（真实挂载生产 SFC） ══════════════════
//
// 这一组是本轮（s42）新增的「验收层根因」修复：上面的源码正则守卫证明不了
// 「浏览器里真渲染出来」，`<template #extra>` 被 antdv Empty 静默丢弃时它们照样绿。
// 下方用例一律断言**渲染后的 DOM**，模板槽一失效即红。

/** 281 = NCE2 136 + NCE3 80 + NCE4 65（167 稿 V2/V3/V4 实测口径）。 */
function buildPool(): DailyQuoteItem[] {
  const items: DailyQuoteItem[] = [];
  const ranges: Array<{ book: 'NCE2' | 'NCE3' | 'NCE4'; total: number }> = [
    { book: 'NCE2', total: 136 },
    { book: 'NCE3', total: 80 },
    { book: 'NCE4', total: 65 },
  ];
  for (const { book, total } of ranges) {
    for (let i = 1; i <= total; i += 1) {
      items.push({
        cn: `${book} 第 ${i} 课中文`,
        en: `${book} lesson ${i} english`,
        source: { book, lessonId: i, title: `${book} Lesson ${i}`, lineIndex: 0 },
      });
    }
  }
  return items;
}

const POOL = buildPool();
const mockedGetDailyQuotes = nceApiModule.getDailyQuotes as unknown as jest.Mock;

/**
 * 编译产物是 ESM 串，只能运行时求值。求值时的模块解析走**显式白名单**：
 * 生产 SFC 若新增了别的 import，这里会直接抛错，避免 harness 悄悄与生产代码失配。
 */
const MODULE_REGISTRY: Record<string, unknown> = {
  vue: VueRuntime,
  '@/api/nce': nceApiModule,
  '@/utils/mount': mountModule,
};

function evalCjs(esm: string, label: string): Record<string, unknown> {
  const cjs = ts.transpileModule(esm, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const sandboxModule: { exports: Record<string, unknown> } = { exports: {} };
  const sandboxRequire = (id: string): unknown => {
    if (!(id in MODULE_REGISTRY)) {
      throw new Error(`[${label}] 渲染态 harness 未登记模块 "${id}"，请同步 MODULE_REGISTRY`);
    }
    return MODULE_REGISTRY[id];
  };
  // 被测对象就是本仓生产 SFC 的编译产物，输入可信；此处仅为把 ESM 放到 CJS 运行时里执行。
  new Function('require', 'module', 'exports', cjs)(sandboxRequire, sandboxModule, sandboxModule.exports);
  return sandboxModule.exports;
}

/** 编译**生产** DailyQuotes.vue（同一份文件，不是副本、不是手搓模板）。 */
function compileProductionPage(): Component {
  const id = 'v9-empty-recover';
  const { descriptor, errors } = parse(readFileSync(PAGE, 'utf8'), { filename: PAGE });
  if (errors.length > 0) throw new Error(`SFC 解析失败：${errors.map(String).join('; ')}`);
  const script = compileScript(descriptor, { id, inlineTemplate: false });
  const template = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: PAGE,
    id,
    compilerOptions: { bindingMetadata: script.bindings },
  });
  if (template.errors.length > 0) throw new Error(`模板编译失败：${template.errors.map(String).join('; ')}`);
  const component = evalCjs(script.content, 'script').default as Record<string, unknown>;
  (component as { render?: unknown }).render = evalCjs(template.code, 'template').render;
  return component as unknown as Component;
}

/** jsdom 缺 matchMedia / ResizeObserver，antdv 的响应式栅格与 rc-resize-observer 会直接调用。 */
function installJsdomGaps(): void {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof window.ResizeObserver;
  }
}

interface MountedPage {
  container: HTMLElement;
  app: VueApplication;
  destroy(): void;
}

const TICKS = 8;
/** 一次交互后把 onMounted 的异步 load / computed / watcher / antdv 内部更新都跑干净。 */
async function settle(): Promise<void> {
  for (let i = 0; i < TICKS; i += 1) await nextTick();
}

async function mountPage(): Promise<MountedPage> {
  mockedGetDailyQuotes.mockResolvedValue({ version: 7, count: POOL.length, items: POOL });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(compileProductionPage());
  setupAntd(app);
  app.mount(container);
  await settle();
  return {
    container,
    app,
    destroy(): void {
      app.unmount();
      container.remove();
    },
  };
}

/**
 * 页面自己的空态。
 *
 * ⚠️ 2026-11-25（s44 双空态修复）**订正定位口径**，用例语义不变、用例不删：
 *
 * 上一轮（s42）这里是「找**不在** `.ant-table` 内的 `.ant-empty`」，即用**位置**区分
 * 「页面空态」与「表格内置 No data 占位」。这条判据本身正是双空态的帮凶——它主动
 * 忽略了表格那块占位，于是「空态有几块」从来没被问过（#8993 就是这样全绿上线的）。
 * 本轮修复把自定义空态搬进了表格的 `emptyText` 槽，页面空态**就住在** `.ant-table` 内，
 * 位置判据必然失效。故改为**按文案定位**：description === 「没有匹配的美句」的那块。
 *
 * 数量唯一性由下方的 allEmptyStates / T5 单独严格断言，不再靠"排除法"取巧。
 */
const PAGE_EMPTY_DESCRIPTION = '没有匹配的美句';

function pageEmptyState(container: HTMLElement): Element | null {
  return (
    Array.from(container.querySelectorAll('.ant-empty')).find(
      (node) => (node.querySelector('.ant-empty-description')?.textContent ?? '').trim() === PAGE_EMPTY_DESCRIPTION,
    ) ?? null
  );
}

/**
 * 页面上**所有**空态占位（含 a-table 内置 `renderEmpty('Table')` 的 No data）。
 * T5 用它数数量：双空态时 === 2，单空态时 === 1。
 */
function allEmptyStates(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('.ant-empty'));
}

function buttonLabelsWithin(root: Element | null): string[] {
  if (root === null) return [];
  return Array.from(root.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
}

function requireNode<T extends Element>(node: T | null | undefined, what: string): T {
  if (node == null) throw new Error(`断言前置失败：找不到${what}`);
  return node;
}

function clickNode(node: Element | null | undefined, what: string): void {
  requireNode(node, what).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function activePage(container: HTMLElement): string {
  return (container.querySelector('.ant-pagination-item-active')?.textContent ?? '').trim();
}

/**
 * 分页区文本去空白：showTotal 渲染成「共 281 条」，此处统一成「共281条」。 */function totalText(container: HTMLElement): string {
  return (container.querySelector('.ant-pagination')?.textContent ?? '').replace(/\s+/g, '');
}

function inputByPlaceholder(container: HTMLElement, hint: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll('input')).find((el) =>
    (el.getAttribute('placeholder') ?? '').includes(hint),
  );
  return requireNode(found as HTMLInputElement | undefined, `placeholder 含「${hint}」的输入框`);
}

/** 用真实 DOM 操作册别下拉（mousedown 展开 → 点选项），不直接改组件内部状态。 */
async function chooseBook(container: HTMLElement, label: string): Promise<void> {
  const selector = requireNode(container.querySelector('.ant-select-selector'), '册别下拉');
  selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await settle();
  const option = Array.from(document.querySelectorAll('.ant-select-item-option')).find(
    (o) => (o.textContent ?? '').trim() === label,
  );
  requireNode(option, `册别下拉选项「${label}」`);
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
}

/** 走到 V9 的现场：NCE4 + 不可能命中 keyword，且**先停在第 2 页**。 */
async function reachEmptyStateAtPage2(page: MountedPage): Promise<void> {
  await chooseBook(page.container, 'NCE4'); // 65 条 → 4 页
  clickNode(page.container.querySelector('.ant-pagination-item-2'), '第 2 页页码');
  await settle();
  expect(activePage(page.container)).toBe('2'); // 前置条件自检：确实停在第 2 页
  const kw = inputByPlaceholder(page.container, '搜索中英文句子');
  kw.value = 'zzzzz-no-hit';
  // 只派发 input（模拟「正在输入、尚未 blur」那一刻）：keyword 立即参与 filtered 计算，
  // 但不触发 onFilterChange 的页码复位 —— 于是 page 仍为 2，clearFilters 的 page 复位才可被观测。
  kw.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

/**
 * 第 1 条数据的课号角标（`L21` 之类）。用来判定「现在到底是第几页」——
 * 比只读分页高亮更硬：页码错了，首行数据必然错。
 */
function firstRowLesson(container: HTMLElement): string {
  return (container.querySelector('.ant-table-tbody tr.ant-table-row .no')?.textContent ?? '').trim();
}

/**
 * 工具栏上的「清空」按钮（与空态里的「清空筛选与搜索」区分）。
 *
 * ⚠️ 必须去掉空白再比：antd 会给**两字**中文按钮自动插空格，渲染出来是「清 空」而不是「清空」。
 */
function toolbarClearButton(container: HTMLElement): Element | null {
  return (
    Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').replace(/\s+/g, '') === '清空',
    ) ?? null
  );
}

describe('V9 · 空态恢复入口 · 渲染态（真实挂载生产 SFC）', () => {
  jest.setTimeout(60_000);

  let page: MountedPage | null = null;

  beforeEach(() => {
    installJsdomGaps();
    mockedGetDailyQuotes.mockReset();
  });

  afterEach(() => {
    page?.destroy();
    page = null;
    document.querySelectorAll('.ant-select-dropdown').forEach((node) => node.remove());
    document.body.innerHTML = '';
  });

  it('T1 前置：NCE4 + 不可能命中 keyword → 空态「没有匹配的美句」渲染存在', async () => {
    page = await mountPage();
    expect(totalText(page.container)).toContain('共281条');
    await reachEmptyStateAtPage2(page);

    const empty = pageEmptyState(page.container);
    expect(empty).not.toBeNull();
    expect((empty?.querySelector('.ant-empty-description')?.textContent ?? '').trim()).toBe('没有匹配的美句');
  });

  it('T2 空态区域内渲染出可点击的「清空筛选与搜索」按钮', async () => {
    page = await mountPage();
    await reachEmptyStateAtPage2(page);

    const empty = pageEmptyState(page.container);
    expect(empty).not.toBeNull();
    // 关键断言：只看**渲染后 DOM**。antdv Empty 只把默认槽渲染进 .ant-empty-footer，
    // 写成 <template #extra> 时这里按钮数为 0（M1 变异即红）。
    expect(buttonLabelsWithin(empty)).toContain('清空筛选与搜索');
    const button = requireNode(empty?.querySelector('.ant-empty-footer button'), '空态 footer 里的恢复按钮');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('T3 点击恢复按钮 → 281 条 / 页码 1 / 册别课号 keyword 三条件全复位', async () => {
    page = await mountPage();
    await reachEmptyStateAtPage2(page);

    const empty = pageEmptyState(page.container);
    const button = empty?.querySelector('.ant-empty-footer button');
    if (button == null) throw new Error('V9 缺陷：空态区域内没有可点击的恢复按钮');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    // ① 空态消失、列表恢复整池第一页
    expect(pageEmptyState(page.container)).toBeNull();
    expect(page.container.querySelectorAll('.ant-table-tbody tr.ant-table-row').length).toBe(20);
    // ② 总数回 281
    expect(totalText(page.container)).toContain('共281条');
    // ③ 页码回 1（清空前停在第 2 页）
    expect(activePage(page.container)).toBe('1');
    // ④ 册别 / 课号 / keyword 三条件全复位
    expect((page.container.querySelector('.ant-select-selection-item')?.textContent ?? '').trim()).toBe('全部');
    expect(inputByPlaceholder(page.container, '课号').value).toBe('');
    expect(inputByPlaceholder(page.container, '搜索中英文句子').value).toBe('');
  });

  /**
   * T4 · 为什么必须单列一条
   *
   * `clearFilters()` 的 `page.value = 1` 在 **T3 的空态路径上不可观测**：antdv Table 在
   * `total` 归零时会把分页 current 自动纠偏为 1 并回抛 change（→ onPageChange），
   * 也就是说「清空前的第 2 页」在空态出现那一刻就被抹平了。实测：删掉 clearFilters 里的
   * `page.value = 1`，T3 仍绿（只有旧源码守卫红）——这正是"断言不触达"的又一次伪装。
   *
   * 所以页码复位改在**能留下页码的现场**验证：NCE4 第 2 页（filtered 非空，total 65，
   * 页码不会被纠偏），再走同一个 clearFilters（工具栏「清空」与空态按钮绑的是同一函数，
   * 这里点工具栏那个，不修改它、只是调用）。
   */
  it('T4 页码复位（M2 可观测性）：NCE4 停在第 2 页时清空 → 回第 1 页（首行 L1）', async () => {
    page = await mountPage();
    await chooseBook(page.container, 'NCE4');
    clickNode(page.container.querySelector('.ant-pagination-item-2'), '第 2 页页码');
    await settle();

    // 前置自检：确实在第 2 页（NCE4 第 21 条是课号 21）
    expect(activePage(page.container)).toBe('2');
    expect(firstRowLesson(page.container)).toBe('L21');

    clickNode(toolbarClearButton(page.container), '工具栏「清空」按钮');
    await settle();

    expect(totalText(page.container)).toContain('共281条');
    expect(activePage(page.container)).toBe('1');
    expect(firstRowLesson(page.container)).toBe('L1');
  });
});

// ══════════════ V13 空态唯一性 · 渲染态（s44 / 台账 #8993 双空态） ══════════════
//
// 上一轮 V9 只证明了「空态里的按钮能用」，**没有证明「空态只有一块」**：
// `pageEmptyState()` 当时用「不在 .ant-table 内」排除掉表格内置占位，于是
// `dataSource` 为空时那块 `No data` 与表格外的自定义空态**同时渲染**（数量 2），
// 4 条用例照样全绿 —— 用户 2026-11-25 16:23 目视确认「确实是双空态」。
//
// 本组是**验收层根因**的补齐：直接数渲染后 DOM 里的空态占位数量，并要求唯一那块
// 落在表格 tbody 的占位行内（列头保留）、按钮就在它里面。
// 修复手段：自定义空态整块搬进 `<a-table>` 的 `emptyText` 槽（antdv 4.2.6
// Table.js L428–430 该槽优先级最高，命中后不再走 renderEmpty('Table')）。

describe('V13 · 空态唯一性 · 渲染态（真实挂载生产 SFC）', () => {
  jest.setTimeout(60_000);

  let page: MountedPage | null = null;

  beforeEach(() => {
    installJsdomGaps();
    mockedGetDailyQuotes.mockReset();
  });

  afterEach(() => {
    page?.destroy();
    page = null;
    document.querySelectorAll('.ant-select-dropdown').forEach((node) => node.remove());
    document.body.innerHTML = '';
  });

  it('T5 无命中时空态占位数量 === 1（唯一那块在表格内、列头保留、按钮在其中）', async () => {
    page = await mountPage();
    expect(totalText(page.container)).toContain('共281条');
    await reachEmptyStateAtPage2(page);

    // ① 数量：这就是 #8993 的正题。修复前这里 Received: 2（内置 No data + 自定义空态）。
    const empties = allEmptyStates(page.container);
    expect(empties.length).toBe(1);

    // ② 唯一那块的归属与文案：必须落在表格体内（列头因此保留），且是自定义文案而非内置 No data
    const only = requireNode(empties[0], '唯一的空态占位');
    expect(only.closest('.ant-table')).not.toBeNull();
    expect((only.querySelector('.ant-empty-description')?.textContent ?? '').trim()).toBe(PAGE_EMPTY_DESCRIPTION);

    // ③ 列头未被空态吃掉（空态只替换 tbody 占位行）
    const headers = Array.from(page.container.querySelectorAll('.ant-table-thead th')).map((th) =>
      (th.textContent ?? '').replace(/\s+/g, ''),
    );
    expect(headers).toEqual(['#', '英文/English', '中文/Chinese', '来源/Source', '操作']);

    // ④ 恢复入口就在这块空态里面，且可点击
    expect(buttonLabelsWithin(only)).toContain('清空筛选与搜索');
    const button = requireNode(only.querySelector('button'), '唯一空态内的恢复按钮');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('T6 点击唯一空态内的按钮 → 281 条 / 页码 1 / 册别课号 keyword 三条件复位', async () => {
    page = await mountPage();
    await reachEmptyStateAtPage2(page);

    // 前置：先确认只有一块（与 T5 同判据；单列一条是为了让"点了哪一块"无歧义）
    expect(allEmptyStates(page.container).length).toBe(1);
    const only = requireNode(allEmptyStates(page.container)[0], '唯一的空态占位');
    const button = requireNode(only.querySelector('button'), '唯一空态内的恢复按钮');

    clickNode(button, '唯一空态内的恢复按钮');
    await settle();

    // ① 空态彻底消失（不是减到 1，是 0）
    expect(allEmptyStates(page.container).length).toBe(0);
    expect(page.container.querySelectorAll('.ant-table-tbody tr.ant-table-row').length).toBe(20);
    // ② 总数回 281
    expect(totalText(page.container)).toContain('共281条');
    // ③ 页码回 1
    expect(activePage(page.container)).toBe('1');
    // ④ 三条件全复位
    expect((page.container.querySelector('.ant-select-selection-item')?.textContent ?? '').trim()).toBe('全部');
    expect(inputByPlaceholder(page.container, '课号').value).toBe('');
    expect(inputByPlaceholder(page.container, '搜索中英文句子').value).toBe('');
  });
});
