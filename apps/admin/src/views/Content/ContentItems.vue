<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  listItems,
  itemStats,
  listSources,
  listPipelines,
  type ContentItem,
  type ContentSource,
  type ContentPipeline,
} from '@/api/content';

const router = useRouter();

const fmtTime = (s?: string | null) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

// ── 筛选（服务端）──
const filters = reactive({
  source: undefined as number | undefined,
  pipeline: undefined as number | undefined,
  quality_status: undefined as string | undefined,
  keyword: '',
  date_from: '',
  date_to: '',
});
const page = reactive({ current: 1, pageSize: 20, total: 0 });

// ── 统计行 ──
const stats = ref({ today_new: 0, today_dedup: 0, quality_abnormal_7d: 0, into_article_7d: 0 });

// ── 数据 ──
const items = ref<ContentItem[]>([]);
const loading = ref(false);
const sources = ref<ContentSource[]>([]);
const pipelines = ref<ContentPipeline[]>([]);

async function loadAll() {
  loading.value = true;
  try {
    const [listRes, statsRes] = await Promise.all([
      listItems({
        limit: page.pageSize,
        offset: (page.current - 1) * page.pageSize,
        source: filters.source,
        pipeline: filters.pipeline,
        quality_status: filters.quality_status,
        keyword: filters.keyword || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      }),
      // 统计卡是装饰性数据：失败只让四卡归零，不得拖垮列表。
      // （2026-10-23 事故：itemStats 一处 SQL 笔误 → 整个采集明细页 500，而列表数据其实一直是好的）
      itemStats().catch(() => null),
    ]);
    items.value = listRes.items;
    page.total = listRes.total;
    stats.value = statsRes ?? { today_new: 0, today_dedup: 0, quality_abnormal_7d: 0, into_article_7d: 0 };
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.current = 1;
  loadAll();
}

function onTableChange(pag: { current: number; pageSize: number }) {
  page.current = pag.current;
  page.pageSize = pag.pageSize;
  loadAll();
}

/** 日期区间：清空时 a-range-picker 给空串，统一落为 '' 让后端忽略 */
function onDateRangeChange(_dates: unknown, dateStrings: [string, string]) {
  filters.date_from = dateStrings?.[0] ?? '';
  filters.date_to = dateStrings?.[1] ?? '';
  onFilterChange();
}

// ── 质量状态展示（status + 归因阶段子标签）──
const QUALITY_STATUS_MAP: Record<string, { color: string; label: string }> = {
  ok: { color: 'green', label: '正常' },
  skip: { color: 'orange', label: '去重跳过' },
  fail: { color: 'red', label: '失败' },
  partial: { color: 'gold', label: '部分异常' },
};
const STAGE_LABEL: Record<string, string> = {
  collect: '采集',
  dedup: '去重',
  ai: 'AI 处理',
  publish: '发布',
};

const itemColumns = [
  // 标题列不设 ellipsis：英文源要在同一格里显示「中文标题 + 原文」两行，
  // ellipsis 会把第二行裁掉（原文就看不见了，等于没法核对翻译）
  { title: '标题', dataIndex: 'title' },
  { title: '来源', dataIndex: 'source_name', width: 130, ellipsis: true },
  { title: '管线', dataIndex: 'pipeline_code', width: 110, ellipsis: true },
  { title: '质量', key: 'quality', width: 150 },
  { title: '采集耗时', dataIndex: 'collect_duration_ms', width: 100 },
  { title: '发布时间', dataIndex: 'publish_date', width: 150 },
  { title: '入库时间', dataIndex: 'created_at', width: 150 },
  { title: '操作', key: 'action', width: 80 },
];

onMounted(async () => {
  try {
    const [s, p] = await Promise.all([listSources(), listPipelines()]);
    sources.value = s;
    pipelines.value = p;
  } catch {
    /* request 拦截器已弹错 */
  }
  loadAll();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>采集明细</h2>
    </div>

    <!-- 统计行（G2：明细页自带概览） -->
    <a-row :gutter="12" class="stat-row">
      <a-col :span="6">
        <a-card size="small"><a-statistic title="今日新增" :value="stats.today_new" /></a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small"><a-statistic title="今日去重跳过" :value="stats.today_dedup" /></a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="近 7 天质量异常"
            :value="stats.quality_abnormal_7d"
            :value-style="{ color: stats.quality_abnormal_7d > 0 ? '#cf1322' : undefined }"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small"><a-statistic title="近 7 天进入成文" :value="stats.into_article_7d" /></a-card>
      </a-col>
    </a-row>

    <!-- 筛选栏（服务端） -->
    <div class="filters">
      <a-select
        v-model:value="filters.source"
        placeholder="采集源"
        allow-clear
        style="width: 160px"
        @change="onFilterChange"
      >
        <a-select-option v-for="s in sources" :key="s.id" :value="s.id">{{ s.name }}</a-select-option>
      </a-select>
      <a-select
        v-model:value="filters.pipeline"
        placeholder="管线"
        allow-clear
        style="width: 140px"
        @change="onFilterChange"
      >
        <a-select-option v-for="p in pipelines" :key="p.id" :value="p.id">{{ p.code }}</a-select-option>
      </a-select>
      <a-select
        v-model:value="filters.quality_status"
        placeholder="质量状态"
        allow-clear
        style="width: 130px"
        @change="onFilterChange"
      >
        <a-select-option v-for="(v, k) in QUALITY_STATUS_MAP" :key="k" :value="k">{{ v.label }}</a-select-option>
      </a-select>
      <a-input
        v-model:value="filters.keyword"
        placeholder="标题 / 摘要关键词"
        allow-clear
        style="width: 180px"
        @press-enter="onFilterChange"
        @change="onFilterChange"
      />
      <a-range-picker
        :value="filters.date_from && filters.date_to ? [filters.date_from, filters.date_to] : undefined"
        style="width: 240px"
        @change="onDateRangeChange"
      />
      <a-button type="primary" @click="onFilterChange">查询</a-button>
    </div>

    <a-table
      :columns="itemColumns"
      :data-source="items"
      :loading="loading"
      row-key="id"
      size="middle"
      :pagination="{
        current: page.current,
        pageSize: page.pageSize,
        total: page.total,
        showSizeChanger: true,
        showTotal: (t: number) => `共 ${t} 条`,
      }"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'title'">
          <!-- 中文标题优先；英文源把原文挂在下面一行，便于核对翻译是否跑偏 -->
          <a @click="router.push(`/content/items/${record.id}`)">{{ record.title_zh || record.title }}</a>
          <div v-if="record.title_zh && record.title_zh !== record.title" class="title-origin">
            {{ record.title }}
          </div>
        </template>
        <template v-else-if="column.key === 'quality'">
          <template v-if="record.quality_status">
            <a-tag :color="QUALITY_STATUS_MAP[record.quality_status]?.color ?? 'default'">
              {{ QUALITY_STATUS_MAP[record.quality_status]?.label ?? record.quality_status }}
            </a-tag>
            <a-tag v-if="record.quality_stage" class="stage-tag">
              {{ STAGE_LABEL[record.quality_stage] ?? record.quality_stage }}
            </a-tag>
          </template>
          <span v-else class="muted">-</span>
        </template>
        <template v-else-if="column.dataIndex === 'collect_duration_ms'">
          {{ record.collect_duration_ms != null ? `${record.collect_duration_ms} ms` : '-' }}
        </template>
        <template v-else-if="column.dataIndex === 'publish_date'">
          {{ fmtTime(record.publish_date) }}
        </template>
        <template v-else-if="column.dataIndex === 'created_at'">
          {{ fmtTime(record.created_at) }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-button size="small" type="link" @click="router.push(`/content/items/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.stat-row {
  margin-bottom: 12px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
.stage-tag {
  margin-left: 4px;
}
.muted {
  color: var(--text-faint);
  font-size: 12px;
}
/* 英文源的原文标题：小一号、弱化，作为翻译的对照 */
.title-origin {
  margin-top: 2px;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.3;
}
</style>
