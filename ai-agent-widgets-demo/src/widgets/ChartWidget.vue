<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { aguiBus } from 'agui-bus';
import type { WidgetProps } from '@/lib/widget-protocol';
import type { WidgetMountContext } from '@/microfrontend/widget-contract';

const props = defineProps<{ data: WidgetProps; ctx: WidgetMountContext }>();

// —— dataSource（D3-B 拍板）：fence props 给初始 labels/series，接口给实时数据集 ——
const dataSource = computed(() => String(props.data.dataSource ?? '').replace(/\/+$/, ''));

const DEFAULT_LABELS = ['周一', '周二', '周三', '周四', '周五'];
const DEFAULT_SERIES: number[][] = [
  [32, 58, 44, 76, 61],
  [20, 40, 66, 38, 52],
];

function toStrArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((v) => String(v));
}

function toSeries(raw: unknown): number[][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: number[][] = [];
  for (const s of raw) {
    if (!Array.isArray(s)) return null;
    out.push(s.map((n) => Number(n) || 0));
  }
  return out;
}

const propsSeries = computed<number[][]>(() => {
  const s = props.data.series;
  if (Array.isArray(s) && Array.isArray(s[0]) && Array.isArray(s[1])) {
    return [s[0].map(Number), s[1].map(Number)];
  }
  return DEFAULT_SERIES;
});
const propsNames = computed<string[]>(() =>
  Array.isArray(props.data.names) ? props.data.names.map(String) : ['本周', '上周'],
);

// 接口实时态：null = 未拉取 / 拉取失败 → 回退初始 props（不白屏）
const remote = ref<{ labels: string[] | null; names: string[] | null; series: number[][] | null } | null>(
  null,
);
const loading = ref(false);
const loadError = ref('');

const labels = computed<string[]>(() =>
  remote.value?.labels ?? (Array.isArray(props.data.labels) ? props.data.labels.map(String) : DEFAULT_LABELS),
);
const series = computed<number[][]>(() => remote.value?.series ?? propsSeries.value);
const names = computed<string[]>(() => remote.value?.names ?? propsNames.value);

let disposed = false; // 竞态护栏：fetch 回来时组件可能已卸载

async function refresh(): Promise<void> {
  if (!dataSource.value) return;
  loading.value = true;
  try {
    // 可选 range：props.data.range=week|month（缺省 week）
    const range =
      typeof props.data.range === 'string' && props.data.range
        ? `?range=${encodeURIComponent(props.data.range)}`
        : '';
    const res = await fetch(`${dataSource.value}${range}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { labels?: unknown; names?: unknown; series?: unknown };
    if (disposed) return;
    remote.value = {
      labels: toStrArray(json.labels),
      names: toStrArray(json.names),
      series: toSeries(json.series),
    };
    loadError.value = '';
  } catch (e) {
    if (disposed) return;
    // 降级：保留初始 props 渲染，仅提示
    loadError.value = `实时数据拉取失败（${(e as Error).message}），已回退初始数据`;
  } finally {
    loading.value = false;
  }
}

const datasetIndex = ref(0);
const activeBar = ref<number | null>(null);
const clickCount = ref(0);
const busEcho = ref('等待交互…');
let off: (() => void) | null = null;

const values = computed(() => series.value[datasetIndex.value] ?? series.value[0]);
const max = computed(() => Math.max(1, ...series.value.flat().map((n) => (Number.isFinite(n) ? n : 0))));
const datasetName = computed(() => names.value[datasetIndex.value] ?? `数据集 ${datasetIndex.value + 1}`);

function clickBar(i: number): void {
  activeBar.value = i;
  clickCount.value += 1;
  // 点柱子 → 切换数据集（数据肉眼可见地变化）
  datasetIndex.value = (datasetIndex.value + 1) % Math.max(2, series.value.length);
  aguiBus.emit('widget_action', {
    type: 'widget_action',
    app: 'chart',
    value: `${labels.value[i] ?? i} · 切到「${names.value[datasetIndex.value] ?? datasetIndex.value}」`,
    slotId: props.ctx.slotId,
    label: '柱状图组件',
  });
}

onMounted(() => {
  off = aguiBus.on('widget_action', (e) => {
    busEcho.value = `bus 收到：${e.app} / ${e.value}`;
  });
  props.ctx.trace('bus-bind', 'aguiBus.on("widget_action") 已注册（基座单例）');
  void refresh();
});
onUnmounted(() => {
  disposed = true;
  off?.();
});
</script>

<template>
  <div class="w-head">
    <span class="w-title">迷你柱状图 · 点击柱子切换数据</span>
    <span class="w-tag">System.register · chart</span>
  </div>
  <p class="w-hint">纯 CSS 柱状图，无图表库。点击任一柱子会切换数据集并回写 bus。</p>
  <div class="chart-wrap">
    <button
      v-for="(v, i) in values"
      :key="i"
      class="chart-bar-slot"
      :class="{ 'is-active': activeBar === i }"
      type="button"
      :aria-label="`${labels[i]} ${v}`"
      @click="clickBar(i)"
    >
      <span class="chart-val">{{ v }}</span>
      <span class="chart-bar" :style="{ height: `${Math.round((v / max) * 82)}%` }" />
    </button>
  </div>
  <div class="chart-labels">
    <span v-for="(l, i) in labels" :key="i">{{ l }}</span>
  </div>
  <div class="chart-foot">
    当前数据集：<strong>{{ datasetName }}</strong> · 累计点击 {{ clickCount }} 次
    <span v-if="activeBar !== null"> · 最近点击「{{ labels[activeBar] }}」</span>
  </div>
  <div class="w-ds">
    <span v-if="loading" class="w-ds-loading">实时数据加载中…</span>
    <span v-else-if="loadError" class="w-ds-error">⚠ {{ loadError }}</span>
    <span v-else-if="dataSource">实时数据源 · {{ labels.length }} 个数据点 · 点击柱子切换数据集</span>
  </div>
  <div class="w-busecho">🔌 {{ busEcho }}</div>
</template>
