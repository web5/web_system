<script setup lang="ts">
// 🔴 增量渲染改造：从「整段 v-html」改成「稳定 block 序列 + 稳定 :key」。
// 之前每来一个 token 都 v-html 整段替换 DOM，会把 markdown 中间已挂载的
// 微前端子应用连根拔起（输入/点击状态全丢）。现在：
//   * 源码层按 widget fence 切块，每块一个稳定 id；
//   * 文本块 v-html（只有「最后一个文本块」会随 token 增长而更新）；
//   * widget 块是独立组件 WidgetSlot，Vue 按 :key 复用，绝不重建；
//   * reconcileBlocks 复用未变 block 的对象引用，连子组件 render 都不重跑。
import { computed, shallowRef, watch } from 'vue';
import { renderMarkdown } from '@/lib/markdown';
import { splitRenderable } from '@/composables/useStreaming';
import {
  isWidgetPending,
  reconcileBlocks,
  type MdBlock,
} from '@/lib/markdown-blocks';
import WidgetSlot from './WidgetSlot.vue';

const props = withDefaults(
  defineProps<{
    /** 已接收的全部 markdown 文本（增量累积） */
    text: string;
    /** true 表示仍在流式接收；为 false 时即使有未闭合块也强制整段渲染 */
    streaming?: boolean;
    /** 所属消息 id，参与 slotId 组装，保证多轮对话的 slot 全局唯一 */
    messageId?: string;
  }>(),
  { streaming: true, messageId: 'msg' },
);

const split = computed(() => splitRenderable(props.text));
// 流式阶段只对「已闭合」前缀渲染；结束后强制整段渲染（含残留未闭合块）
const safeText = computed(() => (props.streaming ? split.value.safe : props.text));

const blocks = shallowRef<MdBlock[]>([]);
watch(
  safeText,
  (safe) => {
    blocks.value = reconcileBlocks(safe, blocks.value);
  },
  { immediate: true },
);

const showPending = computed(() => props.streaming && split.value.hasUnclosed);
const pendingIsWidget = computed(() => isWidgetPending(split.value.pending));

/** slotId = 消息 id + block id：同一轮内稳定，跨轮不冲突。 */
function slotIdOf(block: MdBlock): string {
  return `${props.messageId}:${block.id}`;
}
function htmlOf(block: MdBlock): string {
  return block.kind === 'md' ? renderMarkdown(block.src) : '';
}
</script>

<template>
  <div class="md-stream">
    <template v-for="block in blocks" :key="block.id">
      <div v-if="block.kind === 'md'" class="md-body" v-html="htmlOf(block)" />
      <WidgetSlot
        v-else-if="block.kind === 'widget'"
        :spec="block.spec"
        :slot-id="slotIdOf(block)"
      />
      <div v-else class="mf-slot mf-slot--pending">⏳ 组件加载中…</div>
    </template>

    <div v-if="showPending" class="md-rendering" aria-live="polite">
      <span class="md-rendering__dot" />
      <span v-if="pendingIsWidget">
        ⏳ 检测到 <code>```widget</code> 声明 —— 正在逐字接收 JSON，等待 fence 闭合后 System.import 挂载…
      </span>
      <span v-else>渲染中…（未闭合代码块延迟渲染，避免半截内容崩渲染）</span>
    </div>
  </div>
</template>
