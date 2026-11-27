<script setup lang="ts">
// 🔴 稳定挂载的关键节点：一个 widget block 对应一个 WidgetSlot 组件实例。
// Vue 用稳定 :key 复用它 —— 后面 markdown 继续吐 token 时，本组件不会卸载/重建，
// Shadow DOM 里的子应用 Vue 实例、输入/点击状态因此完整保留。
import { onMounted, onUnmounted, ref } from 'vue';
import type { WidgetSpec } from '@/lib/widget-protocol';
import { slotAttributes, widgetLabelOf } from '@/lib/widget-protocol';
import { mountWidget, unmountWidget } from '@/microfrontend/widget-loader';
import { trace } from '@/microfrontend/load-trace';

const props = defineProps<{ spec: WidgetSpec; slotId: string }>();

const host = ref<HTMLElement | null>(null);
const state = ref<'loading' | 'ready' | 'error'>('loading');
const errorMsg = ref('');
const attrs = slotAttributes(props.spec);
let disposed = false; // 竞态护栏：mount 尚未 resolve 时组件就被卸载

onMounted(async () => {
  const el = host.value;
  if (!el) return;
  // 真实样式沙箱：把子应用挂进 Shadow DOM，全局 CSS 无法穿透，
  // 由 widget-loader 用 ?inline 把主题 + widget CSS 注入 shadow root。
  const shadow = el.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  container.className = 'mf-widget-root';
  shadow.appendChild(container);

  try {
    await mountWidget(container, props.spec, props.slotId);
    // 若在 fetch/实例化期间组件已被卸载，立刻回收刚创建的 handle，避免孤儿
    if (disposed) {
      unmountWidget(props.slotId);
      return;
    }
    state.value = 'ready';
  } catch (e) {
    if (disposed) return;
    state.value = 'error';
    errorMsg.value = (e as Error).message;
    trace(props.slotId, props.spec.app, 'error', `加载失败：${errorMsg.value}`, 'error');
  }
});

onUnmounted(() => {
  disposed = true;
  // 卸载 -> bus 解绑 -> slot 释放（LoadTrace 可见），无残留 handle
  unmountWidget(props.slotId);
});
</script>

<template>
  <div class="mf-widget" :class="`mf-widget--${spec.app}`">
    <div class="mf-widget__badge">
      <span class="mf-widget__dot" :class="`is-${state}`" />
      <span class="mf-widget__badge-text">
        微前端子应用 · <strong>{{ spec.app }}</strong> ·
        <span v-if="state === 'ready'" class="mf-widget__state is-ready">已挂载</span>
        <span v-else-if="state === 'loading'" class="mf-widget__state">加载中…</span>
        <span v-else class="mf-widget__state is-error">加载失败</span>
      </span>
      <span class="mf-widget__label">{{ widgetLabelOf(spec.app) }}</span>
    </div>

    <!-- 与 markdown-it 插件输出完全一致的挂载点（data-* 属性编码，杜绝 XSS） -->
    <div
      ref="host"
      class="mf-slot"
      :data-app="attrs.app"
      :data-props="attrs.props"
      :data-slot-id="slotId"
    />
    <div v-if="state === 'error'" class="mf-widget__err">⚠ {{ errorMsg }}</div>
    <div class="mf-widget__foot">
      System.import('mf-widgets/{{ spec.app }}') · 运行时按需加载 · Shadow DOM 样式沙箱
    </div>
  </div>
</template>
