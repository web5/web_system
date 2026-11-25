<script setup lang="ts">
/**
 * 每日美句 · 后台只读查看页（s28 / 157 稿）
 *
 * 服务端冻结池只读：整池一次拉回，客户端搜索（cn/en/source.title/lessonId）
 * + 客户端分页（20 条/页）。页面与抽屉零写按钮、零可编辑控件。
 * 契约见 docs/development/nce-integration-spec.md；方案见
 * docs/development/reports/2026-11-25-admin-daily-quotes-ui-方案.md。
 */
import { ref, computed, onMounted } from 'vue';
import {
  getDailyQuotes,
  type DailyQuoteItem,
  type DailyQuotesPool,
} from '@/api/nce';
import { moduleOverlayContainer } from '@/utils/mount';

const loading = ref(false);
const failed = ref(false);
const pool = ref<DailyQuotesPool>({ version: 0, count: 0, items: [] });
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');

const previewVisible = ref(false);
const preview = ref<DailyQuoteItem | null>(null);

/** 版权注记：逐字取自原文，仅供个人学习不对外分发；只展示、不可改。 */
const COPYRIGHT_NOTE = '只读资产：逐字取自 NCE 原文（lessons.json sha16 40339154ec0a54ad），后台不改写、不重新生成；教材内容仅供个人学习，不对外分发。';

/** 抽屉里四个 source 字段用全名展示，保证来源可追溯。 */
const sourceFields: { label: string; get: (s: DailyQuoteItem['source']) => string | number }[] = [
  { label: 'source.book', get: (s) => s.book },
  { label: 'source.lessonId', get: (s) => s.lessonId },
  { label: 'source.title', get: (s) => s.title },
  { label: 'source.lineIndex', get: (s) => s.lineIndex },
];

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    pool.value = await getDailyQuotes();
    page.value = 1;
  } catch {
    // 错误态唯一恢复入口：重试（见模板）。拦截器已统一弹错，不显示伪数据。
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

/** 客户端搜索：接口无 keyword 参数，只对已加载整池做本地过滤。 */
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return pool.value.items;
  return pool.value.items.filter((item) =>
    [item.cn, item.en, item.source.title, String(item.source.lessonId)]
      .some((v) => v.toLowerCase().includes(k)),
  );
});

/** 客户端分页：服务端不分页，禁止把 page/pageSize 伪造成查询参数发给接口。 */
const paged = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

function onSearch() {
  page.value = 1;
}

function clearSearch() {
  keyword.value = '';
  page.value = 1;
}

function rowKeyOf(r: DailyQuoteItem): string {
  return `${r.source.book}-${r.source.lessonId}-${r.source.lineIndex}`;
}

function openPreview(row: DailyQuoteItem) {
  preview.value = row;
  previewVisible.value = true;
}

// 分页变更事件用具名类型：Vue 模板属性内不支持内联对象类型注解（TS1005）。
interface QuotePageChange {
  current: number;
  pageSize: number;
}

function onPageChange(p: QuotePageChange) {
  page.value = p.current;
  pageSize.value = p.pageSize;
}

onMounted(load);

const columns = [
  { title: '#', key: 'idx', width: 56 },
  { title: '英文 / English', key: 'en', ellipsis: true },
  { title: '中文 / Chinese', key: 'cn', ellipsis: true },
  { title: '来源 / Source', key: 'source', width: 290, ellipsis: true },
  { title: '操作', key: 'action', width: 84 },
];
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>每日美句</h2>
      <span class="badge-ro">只读</span>
      <span class="stat">服务端冻结池 · <b>{{ pool.count }}</b> 条 · version <b>{{ pool.version }}</b></span>
    </div>

    <div class="toolbar">
      <a-input-search
        v-model:value="keyword"
        placeholder="搜索中英文句子 / 来源标题 / 课号"
        allow-clear
        style="width: 320px"
        @search="onSearch"
      />
      <a-button @click="load">刷新</a-button>
      <span class="hint">内容由服务端冻结池提供，不生成 · 不编辑 · 不删除</span>
    </div>

    <a-spin :spinning="loading">
      <div v-if="failed" class="state-box">
        <div class="t">列表加载失败</div>
        <div>接口请求超时 / 返回非 200</div>
        <a-button type="primary" @click="load">重试</a-button>
      </div>
      <template v-else>
        <a-table
          :columns="columns"
          :data-source="paged"
          :pagination="{
            current: page,
            pageSize,
            total: filtered.length,
            showSizeChanger: true,
            showTotal: (t: number) => `共 ${t} 条`,
          }"
          :row-key="rowKeyOf"
          size="middle"
          @change="onPageChange"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'idx'">
              <span class="no">L{{ (record as DailyQuoteItem).source.lessonId }}</span>
            </template>
            <template v-else-if="column.key === 'en'">
              <div class="en">{{ (record as DailyQuoteItem).en }}</div>
            </template>
            <template v-else-if="column.key === 'cn'">
              <div class="cn">{{ (record as DailyQuoteItem).cn }}</div>
            </template>
            <template v-else-if="column.key === 'source'">
              <div class="src-head">{{ (record as DailyQuoteItem).source.book }} · L{{ (record as DailyQuoteItem).source.lessonId }}</div>
              <div class="src-title">{{ (record as DailyQuoteItem).source.title }}</div>
              <div class="src-line">source.lineIndex = {{ (record as DailyQuoteItem).source.lineIndex }}</div>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button type="link" size="small" @click="openPreview(record as DailyQuoteItem)">预览</a-button>
            </template>
          </template>
        </a-table>
        <a-empty v-if="!filtered.length && !loading" description="没有匹配的美句">
          <template #extra>
            <a-button @click="clearSearch">清空搜索</a-button>
          </template>
        </a-empty>
      </template>
    </a-spin>

    <a-drawer
      v-model:open="previewVisible"
      title="美句预览"
      width="900"
      :body-style="{ padding: '0' }"
      :get-container="moduleOverlayContainer"
    >
      <div v-if="preview" class="preview-wrap">
        <section>
          <h4>英文 / English</h4>
          <div class="en quote">{{ preview.en }}</div>
        </section>
        <section>
          <h4>中文 / Chinese</h4>
          <div class="cn quote">{{ preview.cn }}</div>
        </section>
        <section>
          <h4>来源 / Source（可追溯）</h4>
          <div class="src-grid">
            <div v-for="f in sourceFields" :key="f.label" class="src-cell">
              <div class="k">{{ f.label }}</div>
              <div class="v">{{ f.get(preview.source) }}</div>
            </div>
          </div>
        </section>
        <div class="legal">{{ COPYRIGHT_NOTE }}</div>
      </div>
      <a-empty v-else description="未取到美句数据" />
      <div class="drawer-foot">
        <span>此抽屉只有「关闭」，无编辑 / 保存 / 删除入口</span>
        <a-button @click="previewVisible = false">关闭</a-button>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.page { padding: 4px 0; }
.page-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.page-head h2 { margin: 0; font-size: 20px; color: #1a1a1f; }
.badge-ro { border: 1px solid #fed7aa; background: #fff7ed; color: #ea580c; border-radius: 4px; padding: 1px 8px; font-size: 12px; }
.stat { color: #6b7280; font-size: 13px; }
.stat b { color: #ea580c; font-size: 15px; font-variant-numeric: tabular-nums; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.hint { color: #6b7280; font-size: 12px; margin-left: auto; }
.no { color: #0ea5a4; font-weight: 600; font-variant-numeric: tabular-nums; }
.en, .quote { font-family: Georgia, 'Songti SC', serif; }
.en { font-size: 14px; color: #1a1a1f; }
.cn { font-size: 13px; color: #6b7280; }
.src-head { color: #374151; font-size: 12px; font-variant-numeric: tabular-nums; }
.src-title { color: #1a1a1f; font-size: 13px; }
.src-line { color: #6b7280; font-size: 12px; }
.state-box { padding: 28px 16px; text-align: center; color: #6b7280; font-size: 13px; }
.state-box .t { color: #1a1a1f; font-size: 15px; font-weight: 600; margin-bottom: 6px; }
.state-box button { margin-top: 14px; }
.preview-wrap { padding: 20px 24px 8px; }
section { margin-top: 18px; }
section:first-child { margin-top: 0; }
section h4 { font-size: 14px; color: #1a1a1f; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(0, 0, 0, .06); }
.quote { font-size: 15px; line-height: 1.9; color: #1a1a1f; white-space: pre-wrap; }
.src-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.src-cell { background: #f9fafb; border: 1px solid rgba(0, 0, 0, .06); border-radius: 8px; padding: 10px 12px; }
.src-cell .k { color: #6b7280; font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; }
.src-cell .v { color: #1a1a1f; font-size: 14px; margin-top: 4px; word-break: break-word; }
.legal { margin-top: 20px; padding: 10px 12px; background: #fff7ed; border-left: 3px solid #f97316; border-radius: 4px; color: #6b7280; font-size: 12px; line-height: 1.7; }
.drawer-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 24px; border-top: 1px solid rgba(0, 0, 0, .08); color: #6b7280; font-size: 12px; background: #fff; }
</style>
