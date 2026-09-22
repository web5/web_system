<template>
  <div class="mcard">
    <div class="hd">
      <app-icon name="music" />
      <span>为你推荐</span>
      <span class="n">共 {{ songs.length }} 首</span>
    </div>
    <div v-for="(s, i) in songs" :key="i" class="song">
      <div class="t">{{ s.title }}</div>
      <div v-if="s.artist" class="a">{{ s.artist }}</div>
      <div v-if="s.reason" class="w">{{ s.reason }}</div>
    </div>
    <div class="ops">
      <button type="button" class="act" @click="$emit('swap')">换一批</button>
      <button type="button" class="act" @click="$emit('dislike')">不感兴趣</button>
      <button type="button" class="go" @click="goListen">{{ btnText }}</button>
    </div>
    <div class="ft">跳转后在 {{ providerName }} 搜索并播放，本站不提供音频播放</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 音乐推荐卡（对齐小程序 components/music-card）。
 * 后端 card 事件 kind=music（present-music-card 工具产出），最多展示 3 首。
 * PC 无小程序跳转：entryType=h5 时开新页；否则降级为复制关键词（与小程序降级口径一致）。
 */
import { computed } from 'vue';
import { message } from 'ant-design-vue';
import type { MusicCardPayload } from '@/api/agent';
import AppIcon from '@/components/AppIcon.vue';

const props = defineProps<{ card: MusicCardPayload }>();
defineEmits<{
  /** 换一批 / 不感兴趣：当新一轮对话发出，排序交给 agent 侧口味档案 */
  (e: 'swap'): void;
  (e: 'dislike'): void;
}>();

const songs = computed(() => (props.card.songs || []).slice(0, 3));
const providerName = computed(() => props.card.provider?.name || '音乐 App');
const btnText = computed(() => (props.card.provider ? `去 ${providerName.value}听` : '去听'));

async function goListen() {
  const p = props.card.provider;
  const keyword = props.card.keyword || songs.value[0]?.title || '';
  if (p?.ready && p.entryType === 'h5' && p.path) {
    window.open(p.path, '_blank', 'noopener');
    return;
  }
  try {
    await navigator.clipboard.writeText(keyword);
    message.success(`已复制「${keyword}」，去音乐 App 搜索`);
  } catch {
    message.info(`请在音乐 App 搜索：${keyword}`);
  }
}
</script>

<style scoped>
.mcard {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  overflow: hidden;
  background: var(--ws-bg-surface);
  max-width: 520px;
}
.hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-text-primary);
}
.hd .n {
  font-size: 12px;
  font-weight: 400;
  color: var(--ws-text-tertiary);
}
.song {
  padding: 16px;
  border-bottom: 1px solid var(--ws-border-subtle);
}
.song .t {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}
.song .a {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 2px;
}
.song .w {
  font-size: 12px;
  color: var(--ws-text-secondary);
  margin-top: 8px;
}
.ops {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--ws-border);
}
.ops .act {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--ws-radius-pill);
  border: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-secondary);
}
.ops .act:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-700);
}
.ops .go {
  height: 28px;
  padding: 0 16px;
  border-radius: var(--ws-radius-pill);
  border: 1px solid var(--ws-brand-500);
  background: var(--ws-brand-500);
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-brand-50);
}
.ops .go:hover {
  background: var(--ws-brand-600);
  border-color: var(--ws-brand-600);
}
.ft {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  border-top: 1px solid var(--ws-border-subtle);
}
</style>
