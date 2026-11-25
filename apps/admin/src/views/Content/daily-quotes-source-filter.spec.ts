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
 */
import { readFileSync } from 'fs';
import { join } from 'path';

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
