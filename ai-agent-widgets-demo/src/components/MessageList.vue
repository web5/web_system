<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import StreamingMarkdown from './StreamingMarkdown.vue';
import type { ChatMessage } from '@/types';

const props = defineProps<{ messages: ChatMessage[] }>();

const scroller = ref<HTMLElement | null>(null);
const paused = ref(false); // 用户上滑暂停自动滚动

function isNearBottom(): boolean {
  const el = scroller.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function onScroll(): void {
  paused.value = !isNearBottom();
}

// 多轮消息变化（内容增量 / 新增消息）时，若未暂停则自动滚到底
watch(
  () => props.messages,
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el && !paused.value) el.scrollTop = el.scrollHeight;
  },
  { deep: true },
);

onMounted(() => {
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
});
</script>

<template>
  <div ref="scroller" class="msg-list" @scroll="onScroll">
    <div v-for="msg in messages" :key="msg.id" class="msg" :class="`msg--${msg.role}`">
      <div class="msg__role">{{ msg.role === 'assistant' ? 'Agent' : msg.role }}</div>
      <div class="msg__body">
        <StreamingMarkdown
          :text="msg.content"
          :streaming="msg.streaming"
          :message-id="msg.id"
        />
        <div v-if="msg.tools.length" class="msg__tools">
          <div v-for="(t, i) in msg.tools" :key="i" class="tool-chip">
            <span class="tool-chip__name">⚙ {{ t.name }}</span>
            <code class="tool-chip__args">{{ t.args }}</code>
          </div>
        </div>
      </div>
    </div>
    <p v-if="!messages.length" class="msg-empty">点击下方「开始对话」接收流式输出…</p>
  </div>
</template>
