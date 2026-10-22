<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  listCollectRuns,
  collectHealth,
  listSources,
  type CollectRun,
  type CollectHealth,
  type ContentSource,
} from '@/api/content';

const fmtTime = (s?: string | null) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

const runs = ref<CollectRun[]>([]);
const runsTotal = ref(0);
const health = ref<CollectHealth | null>(null);
const runsLoading = ref(false);
const runsSourceCode = ref<string | undefined>(undefined);
const sources = ref<ContentSource[]>([]);

async function loadRuns() {
  runsLoading.value = true;
  try {
    const [runsRes, healthRes] = await Promise.all([
      listCollectRuns(runsSourceCode.value, 50),
      collectHealth(7),
    ]);
    runs.value = runsRes.items;
    runsTotal.value = runsRes.total;
    health.value = healthRes;
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    runsLoading.value = false;
  }
}

const healthSuccessRate = (h: CollectHealth | null) =>
  h ? `${Math.round(h.successRate * 100)}%` : '-';

const runsColumns = [
  { title: '源', dataIndex: 'source_code', width: 140 },
  { title: '源名称', dataIndex: 'source_name', width: 150 },
  { title: '触发', dataIndex: 'trigger_type', width: 90 },
  { title: '状态', dataIndex: 'status', width: 80 },
  { title: '条数', dataIndex: 'item_count', width: 70 },
  { title: '去重', dataIndex: 'dedup_count', width: 70 },
  { title: '失败', dataIndex: 'fail_count', width: 70 },
  { title: '耗时(ms)', dataIndex: 'duration_ms', width: 90 },
  { title: '开始时间', dataIndex: 'started_at', width: 160 },
  { title: '错误', dataIndex: 'error_message', ellipsis: true },
];

onMounted(async () => {
  try {
    sources.value = await listSources();
  } catch {
    /* request 拦截器已弹错 */
  }
  loadRuns();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>采集监控</h2>
    </div>

    <a-space style="margin-bottom: 12px" wrap>
      <a-button type="primary" :loading="runsLoading" @click="loadRuns">刷新</a-button>
      <a-select
        v-model:value="runsSourceCode"
        placeholder="全部源"
        allow-clear
        style="width: 220px"
        @change="loadRuns"
      >
        <a-select-option v-for="s in sources" :key="s.id" :value="s.code">{{ s.name }}（{{ s.code }}）</a-select-option>
      </a-select>
    </a-space>

    <a-row :gutter="16" style="margin-bottom: 12px">
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="近 7 天采集批次" :value="health?.totalRuns ?? 0" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="近 7 天成功率" :value="healthSuccessRate(health)" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="今日失败次数"
            :value="health?.todayFailed ?? 0"
            :value-style="{ color: (health?.todayFailed ?? 0) > 0 ? '#cf1322' : undefined }"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="静默失效源"
            :value="health?.staleSources?.length ?? 0"
            :value-style="{ color: (health?.staleSources?.length ?? 0) > 0 ? '#cf1322' : undefined }"
          />
        </a-card>
      </a-col>
    </a-row>

    <a-table
      :columns="runsColumns"
      :data-source="runs"
      :loading="runsLoading"
      row-key="id"
      :pagination="false"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'status'">
          <a-tag :color="record.status === 'ok' ? 'green' : record.status === 'failed' ? 'red' : 'default'">
            {{ record.status }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'trigger_type'">
          <a-tag :color="record.trigger_type === 'manual' ? 'blue' : 'default'">{{ record.trigger_type }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'started_at'">
          {{ fmtTime(record.started_at) }}
        </template>
        <template v-else-if="column.dataIndex === 'error_message'">
          <span class="mono" :title="record.error_message">{{ record.error_message ?? '-' }}</span>
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
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
