<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { aguiBus } from 'agui-bus';
import type { WidgetProps } from '@/lib/widget-protocol';
import type { WidgetMountContext } from '@/microfrontend/widget-contract';

const props = defineProps<{ data: WidgetProps; ctx: WidgetMountContext }>();

// —— dataSource（D3-B 拍板）：fence props 承载初始展示态，接口承载实时态；挂载后 fetch 覆盖 ——
const dataSource = computed(() => String(props.data.dataSource ?? '').replace(/\/+$/, ''));

interface PollOption {
  id: string;
  label: string;
  votes: number;
}

/** fence props 的 options 可能是 string[]（LLM 语境）或对象数组：统一成 {id,label,votes}。 */
function toOptions(raw: unknown): PollOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o, i) => {
    if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>;
      return {
        id: String(rec.id ?? `opt_${i}`),
        label: String(rec.label ?? `选项 ${i + 1}`),
        votes: Number(rec.votes) || 0,
      };
    }
    return { id: `opt_${i}`, label: String(o), votes: 0 };
  });
}

const fallbackOptions = computed<PollOption[]>(() => toOptions(props.data.options));

// 接口实时态：null = 未拉取 / 拉取失败 → 回退初始 props（不白屏）
const remote = ref<{ question?: string; options?: PollOption[]; total?: number } | null>(null);
const loading = ref(false);
const loadError = ref('');

const question = computed(() => {
  const fromProps = props.data.question;
  if (typeof fromProps === 'string' && fromProps.trim()) return fromProps;
  const fromRemote = remote.value?.question;
  if (typeof fromRemote === 'string' && fromRemote.trim()) return fromRemote;
  return '请选择一个选项';
});
const options = computed<PollOption[]>(() =>
  remote.value?.options?.length ? remote.value.options : fallbackOptions.value,
);
const totalVotes = computed(() =>
  remote.value?.total ?? fallbackOptions.value.reduce((s, o) => s + o.votes, 0),
);

let disposed = false; // 竞态护栏：fetch 回来时组件可能已卸载

async function refresh(): Promise<void> {
  if (!dataSource.value) return;
  loading.value = true;
  try {
    const res = await fetch(dataSource.value, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { question?: string; options?: unknown; total?: number };
    if (disposed) return;
    remote.value = {
      question: typeof json.question === 'string' ? json.question : undefined,
      options: toOptions(json.options),
      total: typeof json.total === 'number' ? json.total : undefined,
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

// 🔴 这些 ref 是子应用自己的状态。只要 WidgetSlot 节点不被重建，
// 后面 markdown 继续逐字吐出时它们就不会被清空。
const selectedId = ref<string | null>(null);
const totalClicks = ref(0);
const voting = ref(false);
const voteError = ref('');
const busEcho = ref('等待交互…');
let off: (() => void) | null = null;

const selectedLabel = computed(
  () => options.value.find((o) => o.id === selectedId.value)?.label ?? '',
);

async function choose(opt: PollOption): Promise<void> {
  selectedId.value = opt.id;
  totalClicks.value += 1;
  aguiBus.emit('widget_action', {
    type: 'widget_action',
    app: 'poll',
    value: opt.label,
    slotId: props.ctx.slotId,
    label: '投票组件',
  });
  // D3-B：Shadow DOM 直连 demo-backend 投票接口（不走基座转发）；成功后刷新计数
  if (!dataSource.value || voting.value) return;
  voting.value = true;
  voteError.value = '';
  try {
    const res = await fetch(`${dataSource.value}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: opt.id }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && json?.ok) {
      await refresh();
    } else {
      voteError.value = `投票未计入：${json?.error ?? `HTTP ${res.status}`}`;
    }
  } catch (e) {
    voteError.value = `投票请求失败：${(e as Error).message}`;
  } finally {
    voting.value = false;
  }
}

onMounted(() => {
  // 真实订阅基座同一个 EventTarget；卸载时精确解绑（LoadTrace 会记 bus 解绑）
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
    <span class="w-title">{{ question }}</span>
    <span class="w-tag">System.register · poll</span>
  </div>
  <p class="w-hint">点击任一选项 —— 会经 aguiBus 回写到消息流，并在下方立刻出现系统消息。</p>
  <div class="poll-options">
    <button
      v-for="opt in options"
      :key="opt.id"
      class="poll-opt"
      :class="{ 'is-selected': selectedId === opt.id }"
      type="button"
      :disabled="voting"
      @click="choose(opt)"
    >
      {{ selectedId === opt.id ? '✓ ' : '' }}{{ opt.label }}
      <span v-if="totalVotes > 0" class="poll-votes"> · {{ opt.votes }} 票</span>
    </button>
  </div>
  <div class="poll-feedback">
    <span v-if="selectedId">已选择：<strong>{{ selectedLabel }}</strong> · 累计点击 {{ totalClicks }} 次（后续 token 不会清空）</span>
    <span v-else>尚未选择 · 试着点一下，再观察后面的文字继续逐字吐出</span>
  </div>
  <div class="w-ds">
    <span v-if="loading" class="w-ds-loading">实时数据加载中…</span>
    <span v-else-if="loadError" class="w-ds-error">⚠ {{ loadError }}</span>
    <span v-else-if="voteError" class="w-ds-error">⚠ {{ voteError }}</span>
    <span v-else-if="dataSource">实时数据源 · 总票数 {{ totalVotes }}</span>
  </div>
  <div class="w-busecho">🔌 {{ busEcho }}</div>
</template>
