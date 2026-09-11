<template>
  <div class="metrics-page">
    <div class="metrics-head">
      <div>
        <h2>Agent 观测</h2>
        <p class="metrics-sub">run 量 / 成功率 / 耗时 / token / 成本趋势（数据源 run_metrics 日聚合）</p>
      </div>
      <a-space>
        <a-select v-model:value="agentId" style="width: 200px" allow-clear placeholder="全部 Agent" :loading="loadingAgents">
          <a-select-option v-for="a in agentOptions" :key="a.agentId" :value="a.agentId">{{ a.name }}</a-select-option>
        </a-select>
        <a-radio-group v-model:value="rangeDays" button-style="solid" size="small" @change="load">
          <a-radio-button :value="7">近 7 天</a-radio-button>
          <a-radio-button :value="14">近 14 天</a-radio-button>
          <a-radio-button :value="30">近 30 天</a-radio-button>
        </a-radio-group>
        <a-button :loading="loading" @click="load">刷新</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="metrics-alert" :message="loadError" />

    <a-row :gutter="12" class="metrics-kpis">
      <a-col :span="6">
        <div class="m-kpi">
          <div class="m-kpi-label">run 数</div>
          <div class="m-kpi-value ws-mono">{{ kpis.runs }}</div>
        </div>
      </a-col>
      <a-col :span="6">
        <div class="m-kpi">
          <div class="m-kpi-label">成功率</div>
          <div class="m-kpi-value ws-mono">{{ kpis.okRate }}%</div>
          <div class="m-kpi-note">ok {{ kpis.ok }} / error {{ kpis.error }}</div>
        </div>
      </a-col>
      <a-col :span="6">
        <div class="m-kpi">
          <div class="m-kpi-label">平均耗时</div>
          <div class="m-kpi-value ws-mono">{{ kpis.avgDuration }}s</div>
          <div class="m-kpi-note">token 合计 {{ kpis.tokens }}</div>
        </div>
      </a-col>
      <a-col :span="6">
        <div class="m-kpi">
          <div class="m-kpi-label">成本（CNY）</div>
          <div class="m-kpi-value ws-mono">{{ kpis.cost }}</div>
          <div class="m-kpi-note">按字典 llm_models 单价核算</div>
        </div>
      </a-col>
    </a-row>

    <a-card :bordered="false" class="metrics-card">
      <template #title>成功 / 失败 趋势</template>
      <v-chart v-if="chartOption && trendDates.length" :option="chartOption" style="height: 300px" autoresize />
      <a-empty v-else-if="!loading && !rows.length" class="chart-empty" description="当前筛选下暂无 run 数据" />
    </a-card>

    <a-card :bordered="false" class="metrics-card">
      <template #title>Agent 汇总</template>
      <a-table
        :columns="columns"
        :data-source="agentRows"
        :loading="loading"
        :pagination="{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }"
        size="middle"
        row-key="agentId"
        :locale="{ emptyText: ' ' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'agentId'">
            <span>{{ agentName(record.agentId) }}</span>
            <span class="m-agent-code ws-mono">{{ record.agentId }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'models'">
            <span class="ws-mono">{{ record.models }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'okRate'">
            <span class="ws-mono">{{ record.okRate }}%</span>
          </template>
          <template v-else-if="column.dataIndex === 'cost'">
            <span class="ws-mono">¥ {{ record.cost }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'avgDuration'">
            <span class="ws-mono">{{ record.avgDuration }}s</span>
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <a-button type="link" size="small" @click="goRuns(record.agentId)">查看对话</a-button>
          </template>
        </template>
      </a-table>
      <a-empty v-if="!loading && !agentRows.length && !loadError" class="chart-empty" description="暂无 run 数据，Agent 跑一次后这里会出现指标" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchRunMetrics, type RunMetricRow } from '@/api/run-metrics';
import { listAgents } from '@/api/agents';

interface AgentRow {
  agentId: string;
  models: string;
  runs: number;
  ok: number;
  error: number;
  okRate: string;
  tokens: string;
  cost: string;
  avgDuration: string;
}

const router = useRouter();
const rows = ref<RunMetricRow[]>([]);
const agentId = ref<string | undefined>(undefined);
const rangeDays = ref(14);
const loading = ref(false);
const loadingAgents = ref(false);
const loadError = ref('');
const agents = ref<Array<{ agentId: string; name?: string }>>([]);

const agentOptions = computed(() => agents.value);

function fmtDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (rangeDays.value - 1));
  try {
    rows.value = await fetchRunMetrics({
      agentId: agentId.value,
      startDate: fmtDate(start),
      endDate: fmtDate(end),
    });
  } catch (e) {
    loadError.value = (e as Error).message || '加载观测数据失败';
  } finally {
    loading.value = false;
  }
}

async function loadAgents(): Promise<void> {
  loadingAgents.value = true;
  try {
    const res = (await listAgents()) as unknown as { data?: Array<{ agentId: string; name?: string }> };
    agents.value = (res?.data ?? (res as unknown as Array<{ agentId: string; name?: string }> | null) ?? []).map(
      (a) => ({ agentId: a.agentId, name: a.name || a.agentId }),
    );
  } catch {
    agents.value = [];
  } finally {
    loadingAgents.value = false;
  }
}

function sum(fn: (r: RunMetricRow) => number): number {
  return rows.value.reduce((acc, r) => acc + fn(r), 0);
}
function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

const kpis = computed(() => {
  const runs = sum((r) => r.runCount);
  const ok = sum((r) => r.okCount);
  const error = sum((r) => r.errorCount);
  const tokens = sum((r) => Number(r.totalTokens));
  const cost = sum((r) => Number(r.totalCost));
  const dur = sum((r) => r.totalDurationMs);
  return {
    runs: fmtNum(runs),
    ok,
    error,
    okRate: runs ? ((ok / runs) * 100).toFixed(1) : '—',
    tokens: fmtNum(tokens),
    cost: cost.toFixed(4),
    avgDuration: runs && dur ? (dur / runs / 1000).toFixed(1) : '—',
  };
});

function colorVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const trendDates = computed(() => {
  const set = new Set<string>();
  for (const r of rows.value) set.add(r.date);
  return [...set].sort();
});

const chartOption = computed(() => {
  const dates = trendDates.value;
  const okData = dates.map((d) =>
    rows.value.filter((r) => r.date === d).reduce((a, r) => a + r.okCount, 0),
  );
  const errorData = dates.map((d) =>
    rows.value.filter((r) => r.date === d).reduce((a, r) => a + r.errorCount, 0),
  );
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['成功', '失败'] },
    grid: { left: 40, right: 16, top: 40, bottom: 24 },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '成功',
        type: 'bar',
        stack: 'runs',
        data: okData,
        itemStyle: { color: colorVar('--ws-success-500', '#22C55E') },
      },
      {
        name: '失败',
        type: 'bar',
        stack: 'runs',
        data: errorData,
        itemStyle: { color: colorVar('--ws-error-500', '#EF4444') },
      },
    ],
  };
});

const agentRows = computed<AgentRow[]>(() => {
  const byAgent = new Map<string, { models: Set<string>; runs: number; ok: number; error: number; tokens: number; cost: number; dur: number }>();
  for (const r of rows.value) {
    let g = byAgent.get(r.agentId);
    if (!g) {
      g = { models: new Set(), runs: 0, ok: 0, error: 0, tokens: 0, cost: 0, dur: 0 };
      byAgent.set(r.agentId, g);
    }
    g.models.add(r.model);
    g.runs += r.runCount;
    g.ok += r.okCount;
    g.error += r.errorCount;
    g.tokens += Number(r.totalTokens);
    g.cost += Number(r.totalCost);
    g.dur += r.totalDurationMs;
  }
  const out: AgentRow[] = [];
  for (const [agentIdKey, g] of byAgent) {
    const models = [...g.models];
    out.push({
      agentId: agentIdKey,
      models: models.length > 2 ? `${models.slice(0, 2).join(' / ')} +${models.length - 2}` : models.join(' / ') || '—',
      runs: g.runs,
      ok: g.ok,
      error: g.error,
      okRate: g.runs ? ((g.ok / g.runs) * 100).toFixed(1) : '—',
      tokens: fmtNum(g.tokens),
      cost: g.cost.toFixed(4),
      avgDuration: g.runs && g.dur ? (g.dur / g.runs / 1000).toFixed(1) : '—',
    });
  }
  return out.sort((a, b) => b.runs - a.runs);
});

function agentName(id: string): string {
  return agents.value.find((a) => a.agentId === id)?.name || id;
}

const columns = [
  { title: 'Agent', dataIndex: 'agentId' },
  { title: '模型', dataIndex: 'models' },
  { title: 'run 数', dataIndex: 'runs', width: 100, align: 'right' as const },
  { title: '成功', dataIndex: 'ok', width: 80, align: 'right' as const },
  { title: '失败', dataIndex: 'error', width: 80, align: 'right' as const },
  { title: '成功率', dataIndex: 'okRate', width: 90, align: 'right' as const },
  { title: 'token', dataIndex: 'tokens', width: 130, align: 'right' as const },
  { title: '成本', dataIndex: 'cost', width: 110, align: 'right' as const },
  { title: '平均耗时', dataIndex: 'avgDuration', width: 100, align: 'right' as const },
  { title: '操作', dataIndex: 'action', width: 110 },
];

function goRuns(id: string): void {
  router.push(`/agents/runs/${id}`);
}

onMounted(() => {
  void loadAgents();
  void load();
});
</script>

<style scoped>
.metrics-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 14px;
}
.metrics-head h2 {
  font-size: var(--ws-font-size-h3);
  color: var(--ws-text-primary);
  margin: 0;
  font-weight: var(--ws-font-weight-semibold);
}
.metrics-sub {
  margin: 4px 0 0;
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
}
.metrics-alert {
  margin-bottom: 12px;
}
.metrics-kpis {
  margin-bottom: 12px;
}
.m-kpi {
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md);
  box-shadow: var(--ws-shadow-card);
  padding: 14px 16px;
}
.m-kpi-label {
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
  font-weight: 500;
}
.m-kpi-value {
  font-size: 24px;
  font-weight: var(--ws-font-weight-semibold);
  color: var(--ws-text-primary);
  margin: 4px 0 2px;
}
.m-kpi-note {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.metrics-card {
  background: var(--ws-bg-surface);
  margin-bottom: 12px;
}
.chart-empty {
  padding: 24px 0;
}
.m-agent-code {
  margin-left: 8px;
  color: var(--ws-text-tertiary);
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
