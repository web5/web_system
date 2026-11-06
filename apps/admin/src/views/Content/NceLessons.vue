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
} from '@/api/nce';
import { moduleOverlayContainer } from '@/utils/mount';

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

const letters = 'ABCD';
const fmtTime = (s?: string) => (s ? String(s).slice(0, 19).replace('T', ' ') : '—');

async function load() {
  loading.value = true;
  try {
    const [m, list] = await Promise.all([
      getNceMeta(),
      listNceLessons({ page: page.value, pageSize: pageSize.value, keyword: keyword.value }),
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
  previewVisible.value = true;
  previewLoading.value = true;
  preview.value = null;
  try {
    preview.value = await getNceLesson(row.id);
  } catch {
    previewVisible.value = false;
  } finally {
    previewLoading.value = false;
  }
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
              <div><div class="en">{{ l.en }}</div><div class="cn-line">{{ l.cn }}</div></div>
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
        </div>
        <a-empty v-else-if="!previewLoading" description="未取到课文数据" />
      </a-spin>
    </a-drawer>
  </div>
</template>

<style scoped>
.page { padding: 4px 0; }
.page-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 14px; }
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
.cn-line { color: #6b7280; font-size: 12px; margin-top: 2px; }
.word { padding: 5px 0; font-size: 13px; }
.quiz { padding: 10px 0; border-bottom: 1px dashed rgba(0, 0, 0, .06); font-size: 13px; }
.q { font-weight: 600; margin-bottom: 6px; }
.opt { padding-left: 12px; color: #374151; }
.opt.right { color: #0ea5a4; font-weight: 600; }
.exp { margin-top: 6px; color: #6b7280; font-size: 12px; }
.src { color: #6b7280; font-size: 12px; word-break: break-all; padding: 2px 0; }
</style>
