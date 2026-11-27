<script setup lang="ts">
// 微前端加载时序可视化：把「检测 → 白名单 → System.import → register → 共享 vue
// → mount → ready」以及卸载三连逐条打点，让加载逻辑肉眼可见。
import { computed, nextTick, ref, watch } from 'vue';
import { LOAD_PHASES, useLoadTrace } from '@/microfrontend/load-trace';

const { entries, clear } = useLoadTrace();
const scroller = ref<HTMLElement | null>(null);

const latest = computed(() => {
  const keys = new Set(LOAD_PHASES.map((p) => p.key as string));
  for (let i = entries.value.length - 1; i >= 0; i--) {
    if (keys.has(entries.value[i].phase)) {
      return { slotId: entries.value[i].slotId, app: entries.value[i].app };
    }
  }
  return null;
});

const reached = computed(() => {
  const s = new Set<string>();
  if (!latest.value) return s;
  for (const e of entries.value) {
    if (e.slotId === latest.value.slotId) s.add(e.phase);
  }
  return s;
});

const activeSlots = computed(() => {
  const s = new Set<string>();
  for (const e of entries.value) {
    if (e.phase === 'ready') s.add(e.slotId);
    if (e.phase === 'slot-release') s.delete(e.slotId);
  }
  return s.size;
});

function phaseClass(key: string): string {
  if (reached.value.has(key)) return 'is-done';
  return 'is-idle';
}

function shortSlot(id: string): string {
  const parts = id.split(':');
  return parts.length > 2 ? parts.slice(-2).join(':') : id;
}

watch(
  () => entries.value.length,
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <aside class="load-trace">
    <header class="load-trace__head">
      <div class="load-trace__title">
        <span class="load-trace__icon">◈</span> 微前端加载时序
      </div>
      <button class="load-trace__clear" type="button" @click="clear">清空日志</button>
    </header>

    <div class="load-trace__meta">
      <span>活跃 slot <strong>{{ activeSlots }}</strong></span>
      <span>日志 <strong>{{ entries.length }}</strong> 条</span>
      <span v-if="latest" class="load-trace__latest">最近：{{ latest.app }} · {{ shortSlot(latest.slotId) }}</span>
    </div>

    <div class="load-trace__pipeline">
      <div
        v-for="(p, i) in LOAD_PHASES"
        :key="p.key"
        class="pipe-step"
        :class="phaseClass(p.key)"
      >
        <span class="pipe-step__dot" />
        <span class="pipe-step__idx">{{ i + 1 }}</span>
        <span class="pipe-step__label">{{ p.title }}</span>
      </div>
    </div>

    <div ref="scroller" class="load-trace__list">
      <p v-if="!entries.length" class="load-trace__empty">
        点击左侧「开始对话」<br />流式 markdown 中出现 widget 声明时，这里会逐条跑加载时序。
      </p>
      <div
        v-for="e in entries"
        :key="e.seq"
        class="trace-row"
        :class="`is-${e.status}`"
      >
        <span class="trace-row__dot" />
        <span class="trace-row__at">{{ e.at }}</span>
        <div class="trace-row__body">
          <div class="trace-row__line">
            <span class="trace-row__phase">{{ e.phase }}</span>
            <span class="trace-row__app">{{ e.app }}</span>
            <span class="trace-row__slot">{{ shortSlot(e.slotId) }}</span>
          </div>
          <div class="trace-row__label">{{ e.label }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>
