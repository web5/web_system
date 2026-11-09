<script setup lang="ts">
/**
 * 新概念英语课文 · 后台只读预览
 *
 * 只做查看，不提供任何写操作：数据由 scripts/import-nce-lessons.mjs 从
 *私域资产课文抓取产物入库，后台不改内容、不触发抓取。
 * 契约见 docs/development/nce-integration-spec.md。
 */
import { ref, onMounted } from 'vue';
import {
  getNceMeta,
  listNceLessons,
  getNceLesson,
  type NceMeta,
  type NceLessonSummary,
  type NceLessonDetail,
  type NceWord,
} from '@/api/nce';
import { moduleOverlayContainer } from '@/utils/mount';

/** 册别切换：与后端 BOOKS 配置表保持一致（docs/development/reports/2026-11-09-NCE多册支持方案.md §2.1）。 */
const BOOKS = [
  { key: 'NCE2', label: '第二册' },
  { key: 'NCE3', label: '第三册' },
  { key: 'NCE4', label: '第四册' },
];
const activeBook = ref('NCE2');

const loading = ref(false);
const meta = ref<NceMeta | null>(null);
const items = ref<NceLessonSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');

const previewVisible = ref(false);
const previewLoading = ref(false);
const preview = ref<NceLessonDetail | null>(null);
const wordPopup = ref<NceWord | null>(null);

const letters = 'ABCD';
const fmtTime = (s?: string) => (s ? String(s).slice(0, 19).replace('T', ' ') : '—');

async function load() {
  loading.value = true;
  try {
    const [m, list] = await Promise.all([
      getNceMeta(activeBook.value),
      listNceLessons({ page: page.value, pageSize: pageSize.value, keyword: keyword.value, book: activeBook.value }),
    ]);
    meta.value = m;
    items.value = list.items ?? [];
    total.value = list.total ?? 0;
  } catch {
    // request 拦截器已统一弹错
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  page.value = 1;
  void load();
}

function onBookChange(k: string) {
  activeBook.value = k;
  page.value = 1;
  void load();
}

// 分页变更事件用具名类型：Vue 模板属性内不支持内联对象类型注解
// （`(p: { current: number; pageSize: number })` 会触发 TS1005）。
interface NcePageChange {
  current: number;
  pageSize: number;
}

function onPageChange(p: NcePageChange) {
  page.value = p.current;
  pageSize.value = p.pageSize;
  void load();
}

async function openPreview(row: NceLessonSummary) {
  wordPopup.value = null;
  previewVisible.value = true;
  previewLoading.value = true;
  preview.value = null;
  try {
    preview.value = await getNceLesson(row.id, activeBook.value);
  } catch {
    previewVisible.value = false;
  } finally {
    previewLoading.value = false;
  }
}

// —— 交互式查词：与 portal Nce.vue 同源（生词 map 绑对象，token 携带真实 NceWord；
//    不用「排序下标 → 原始下标」，防 2026-11-06 网页原型错位 bug）——
interface Token { text: string; word?: NceWord }

function onWord(w: NceWord) {
  wordPopup.value = w;
}

/** 不用 v-html：句子切 token 渲染，天然免疫 XSS。 */
function tokensOf(en: string): Token[] {
  const ws = preview.value?.words ?? [];
  const map = new Map<string, NceWord>();
  for (const w of ws) if (w.word) map.set(w.word.toLowerCase(), w);
  const names = ws
    .map((w) => w.word)
    .filter((w): w is string => !!w)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!names.length) return [{ text: en }];
  const re = new RegExp('\\b(' + names.join('|') + ')\\b', 'gi');
  return en.split(re).filter(Boolean).map((part) => {
    const w = map.get(part.toLowerCase());
    return w ? { text: part, word: w } : { text: part };
  });
}

onMounted(load);

const columns = [
  { title: '课号', dataIndex: 'id', key: 'id', width: 72 },
  { title: '英文标题', dataIndex: 'title', key: 'title', ellipsis: true },
  { title: '中文标题', dataIndex: 'titleCn', key: 'titleCn', width: 160, ellipsis: true },
  { title: '导入问题', key: 'lead', ellipsis: true },
  { title: '句/词/题', key: 'counts', width: 108 },
  { title: '课文来源', key: 'source', width: 112 },
  { title: '抓取时间', key: 'fetchedAt', width: 160 },
  { title: '操作', key: 'action', width: 88 },
];
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>新概念英语课文</h2>
      <div class="book-tabs">
        <button v-for="b in BOOKS" :key="b.key" type="button"
          :class="{ on: activeBook === b.key }" @click="onBookChange(b.key)">{{ b.label }}</button>
      </div>
      <span v-if="meta" class="stat">
        {{ meta.bookTitle }} · 已入库 <b>{{ meta.downloaded }}</b> / {{ meta.total }} 课
      </span>
    </div>

    <div class="toolbar">
      <a-input-search
        v-model:value="keyword"
        placeholder="搜索课号 / 中英文标题"
        allow-clear
        style="width: 320px"
        @search="onSearch"
      />
      <a-button @click="load">刷新</a-button>
      <span class="hint">后台仅提供预览；内容由抓取器入库，不在此修改。</span>
    </div>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        showTotal: (t: number) => `共 ${t} 课`,
      }"
      :row-key="(r: NceLessonSummary) => r.id"
      size="middle"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'id'">
          <span class="no">L{{ String((record as NceLessonSummary).id).padStart(2, '0') }}</span>
        </template>
        <template v-else-if="column.key === 'lead'">
          <template v-if="(record as NceLessonSummary).leadQuestionCn || (record as NceLessonSummary).leadQuestion">
            <div class="lead-zh">{{ (record as NceLessonSummary).leadQuestionCn || '—' }}</div>
            <div class="lead-en">{{ (record as NceLessonSummary).leadQuestion }}</div>
          </template>
          <span v-else class="muted">—</span>
        </template>
        <template v-else-if="column.key === 'counts'">
          {{ (record as NceLessonSummary).lineCount }} / {{ (record as NceLessonSummary).wordCount }} /
          {{ (record as NceLessonSummary).exerciseCount }}
        </template>
        <template v-else-if="column.key === 'source'">
          <a-tag :color="(record as NceLessonSummary).textSource === 'xdf' ? 'green' : 'orange'">
            {{ (record as NceLessonSummary).textSource === 'xdf' ? '权威全文' : '字幕拼接' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'fetchedAt'">
          <span class="muted">{{ fmtTime((record as NceLessonSummary).fetchedAt) }}</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-button type="link" size="small" @click="openPreview(record as NceLessonSummary)">预览</a-button>
        </template>
      </template>
    </a-table>

    <a-drawer
      v-model:open="previewVisible"
      :title="preview ? `Lesson ${preview.id} · ${preview.title}` : '课文预览'"
      :width="900"
      :body-style="{ padding: '0' }"
      :get-container="moduleOverlayContainer"
    >
      <a-spin :spinning="previewLoading">
        <div v-if="preview" class="preview-wrap">
          <div class="preview-head">
            <h3>{{ preview.title }}</h3>
            <div class="cn">{{ preview.titleCn }}</div>
            <div v-if="preview.leadQuestionCn || preview.leadQuestion" class="lead">
              <div class="lead-zh">{{ preview.leadQuestionCn || preview.leadQuestion }}</div>
              <div v-if="preview.leadQuestionCn && preview.leadQuestion" class="lead-en">
                {{ preview.leadQuestion }}
              </div>
            </div>
            <div class="tags">
              <a-tag :color="preview.textSource === 'xdf' ? 'green' : 'orange'">
                {{ preview.textSource === 'xdf' ? '权威全文' : 'LRC 字幕拼接' }}
              </a-tag>
              <span class="muted">{{ preview.lines.length }} 句 · {{ preview.words.length }} 词 ·
                {{ preview.exercises.length }} 题</span>
            </div>
          </div>

          <section>
            <h4>课文全文 / Text</h4>
            <div class="text-body">{{ preview.text }}</div>
          </section>

          <section>
            <h4>逐句对照 / Bilingual</h4>
            <div v-for="(l, i) in preview.lines" :key="i" class="line">
              <span class="idx">{{ i + 1 }}</span>
              <div>
                <div class="en">
                  <template v-for="(t, j) in tokensOf(l.en)" :key="j"><span
                    v-if="t.word" class="w" role="button" tabindex="0"
                    @click="onWord(t.word!)" @keydown.enter="onWord(t.word!)">{{ t.text }}</span><span
                    v-else>{{ t.text }}</span></template>
                </div>
                <div class="cn-line">{{ l.cn }}</div>
              </div>
            </div>
          </section>

          <section v-if="preview.translation">
            <h4>参考译文 / Translation</h4>
            <div class="text-body cn-body">{{ preview.translation }}</div>
          </section>

          <section v-if="preview.words.length">
            <h4>生词 / New words</h4>
            <div v-for="(w, i) in preview.words" :key="i" class="word">
              <b>{{ w.word }}</b> <span class="muted">{{ w.phonetic }} {{ w.pos }}</span>
              {{ w.def }}<span v-if="w.example" class="muted"> — {{ w.example }}</span>
            </div>
          </section>

          <section v-if="preview.exercises.length">
            <h4>习题 / Exercises</h4>
            <div v-for="(q, i) in preview.exercises" :key="i" class="quiz">
              <div class="q">{{ i + 1 }}. {{ q.q }}</div>
              <div v-for="(o, j) in q.options" :key="j" class="opt" :class="{ right: j === q.answer }">
                {{ letters[j] ?? j }}. {{ o }}
              </div>
              <div class="exp">答案 {{ letters[q.answer] ?? q.answer }} · {{ q.exp }}</div>
            </div>
          </section>

          <section v-if="preview.sources.length">
            <h4>来源 / Sources</h4>
            <div v-for="(s, i) in preview.sources" :key="i" class="src">{{ s }}</div>
          </section>

          <div v-if="wordPopup" class="word-card" role="dialog">
            <button type="button" class="close" @click="wordPopup = null">×</button>
            <div class="wd">{{ wordPopup.word }} <span class="ph">{{ wordPopup.phonetic }}</span></div>
            <div class="df">{{ wordPopup.pos }} {{ wordPopup.def }}</div>
            <div v-if="wordPopup.example" class="eg">{{ wordPopup.example }}</div>
          </div>
        </div>
        <a-empty v-else-if="!previewLoading" description="未取到课文数据" />
      </a-spin>
    </a-drawer>
  </div>
</template>

<style scoped>
.page { padding: 4px 0; }
.page-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 14px; }
.book-tabs { display: inline-flex; border: 1px solid rgba(0, 0, 0, .12); border-radius: 8px; overflow: hidden; }
.book-tabs button { border: 0; background: #fff; color: #6b7280; padding: 4px 12px; font-size: 13px; cursor: pointer; }
.book-tabs button + button { border-left: 1px solid rgba(0, 0, 0, .12); }
.book-tabs button.on { background: #f97316; color: #fff; }
.page-head h2 { margin: 0; font-size: 20px; color: #1a1a1f; }
.stat { color: #6b7280; font-size: 13px; }
.stat b { color: #f97316; font-size: 15px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.hint { color: #6b7280; font-size: 12px; margin-left: auto; }
.no { font-variant-numeric: tabular-nums; font-weight: 600; color: #0ea5a4; }
.lead-zh { color: #1a1a1f; font-size: 13px; }
.lead-en, .muted { color: #6b7280; font-size: 12px; }
.lead-en { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview-wrap { padding: 20px 24px 40px; }
.preview-head { border-bottom: 1px solid rgba(0, 0, 0, .08); padding-bottom: 14px; margin-bottom: 8px; }
.preview-head h3 { margin: 0 0 4px; font-family: Georgia, 'Songti SC', serif; }
.preview-head .cn { color: #6b7280; }
.lead { margin-top: 12px; padding: 10px 14px; background: #fff7ed; border-left: 3px solid #f97316; border-radius: 4px; }
.tags { margin-top: 10px; display: flex; align-items: center; gap: 10px; }
section { margin-top: 22px; }
section h4 { font-size: 14px; color: #1a1a1f; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(0, 0, 0, .06); }
.text-body { white-space: pre-wrap; font-family: Georgia, 'Songti SC', serif; font-size: 15px; line-height: 1.9; color: #1a1a1f; }
.cn-body { font-family: inherit; font-size: 14px; color: #374151; }
.line { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed rgba(0, 0, 0, .06); }
.idx { flex: 0 0 26px; color: #9ca3af; font-size: 12px; font-variant-numeric: tabular-nums; }
.en { font-family: Georgia, 'Songti SC', serif; font-size: 14px; }
.w { color: #0ea5a4; border-bottom: 1px dashed #0ea5a4; cursor: pointer; }
.w:focus { outline: none; background: #ecfdf9; border-radius: 3px; }
.cn-line { color: #6b7280; font-size: 12px; margin-top: 2px; }
.word { padding: 5px 0; font-size: 13px; }
.quiz { padding: 10px 0; border-bottom: 1px dashed rgba(0, 0, 0, .06); font-size: 13px; }
.q { font-weight: 600; margin-bottom: 6px; }
.opt { padding-left: 12px; color: #374151; }
.opt.right { color: #0ea5a4; font-weight: 600; }
.exp { margin-top: 6px; color: #6b7280; font-size: 12px; }
.src { color: #6b7280; font-size: 12px; word-break: break-all; padding: 2px 0; }
/* 查词卡：纯展示卡，sticky 到抽屉底部；pointer-events:none 让正文点击穿透，仅关闭按钮可点 */
.word-card { position: sticky; bottom: 12px; margin-top: 18px; background: #fff; border: 1px solid rgba(0, 0, 0, .08); box-shadow: 0 4px 16px rgba(0, 0, 0, .08); border-radius: 10px; padding: 12px 16px; max-width: 68ch; pointer-events: none; }
.word-card .close { float: right; border: 0; background: none; font-size: 18px; cursor: pointer; color: #6b7280; pointer-events: auto; line-height: 1; }
.word-card .wd { font-family: Georgia, 'Songti SC', serif; font-size: 16px; font-weight: 600; color: #1a1a1f; }
.word-card .ph, .word-card .df, .word-card .eg { color: #6b7280; font-size: 12px; margin-top: 3px; }
.word-card .df { color: #374151; }
</style>
