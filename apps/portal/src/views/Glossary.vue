<template>
  <div class="sub">
    <div class="chead">
      <button type="button" class="btn-back" @click="router.push('/profile')">
        <app-icon name="left" />返回
      </button>
      <h1>生词本</h1>
    </div>

    <div class="tip"><app-icon name="doc" />你收藏的译文会一直保留在这里，即使原对话删除</div>

    <div v-if="!loading && empty" class="empty">
      <app-icon name="lang" size="lg" />
      <p>还没有收藏，去翻译或对话里点「收藏」</p>
    </div>

    <div v-else class="list">
      <div v-for="it in items" :key="it.id" class="card">
        <div class="en">{{ it.enMain }}</div>
        <div v-if="it.sourceText" class="src">{{ it.sourceText }}</div>
        <div v-if="it.note" class="note">{{ it.note }}</div>
        <div class="meta">{{ metaText(it) }}</div>
        <div class="ops">
          <button type="button" class="act" @click="copy(it.enMain)">
            <app-icon name="copy" />复制
          </button>
          <button type="button" class="act" @click="speak(it.id, it.enMain)">
            <app-icon name="volume" />{{ reading === it.id ? '停止' : '朗读' }}
          </button>
          <button type="button" class="act danger" @click="remove(it.id)">
            <app-icon name="x" />移出
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { listGlossary, removeGlossary, type GlossaryItem } from '@/api/glossary';
import { splitSpeakParts, speakSequence, stopTts } from '@/api/tts';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();
const loading = ref(true);
const empty = ref(false);
const items = ref<GlossaryItem[]>([]);
const reading = ref<number | null>(null);

function metaText(it: GlossaryItem): string {
  const m = it.meta || {};
  const parts = [m.tone, m.direction === 'zh2en' ? '中文→英语' : m.direction].filter(Boolean);
  return parts.join(' · ');
}

async function load() {
  loading.value = true;
  try {
    const { list } = await listGlossary(1, 50);
    items.value = list;
    empty.value = list.length === 0;
  } catch {
    empty.value = true;
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function copy(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动选择文本');
  }
}

async function speak(id: number, text: string) {
  if (reading.value === id) {
    stopTts();
    reading.value = null;
    return;
  }
  reading.value = id;
  try {
    // 「首句 + 剩余整段」两块：首句 ~2s 出声，剩余块在首句播放期间预取
    await speakSequence(splitSpeakParts(text), { isActive: () => reading.value === id });
  } catch {
    if (reading.value === id) message.error('朗读失败，请重试');
  } finally {
    if (reading.value === id) reading.value = null;
  }
}

async function remove(id: number) {
  const ok = await removeGlossary(id);
  message.success(ok ? '已移出收藏' : '移除失败，请重试');
  if (ok) void load();
}

onMounted(() => void load());
onBeforeUnmount(() => stopTts());
</script>

<style scoped>
.sub {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 32px 24px;
}

.chead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.chead h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--ws-radius-md);
  font-size: 13px;
  color: var(--ws-text-secondary);
}

.btn-back:hover {
  background: var(--ws-bg-subtle);
}

.tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 16px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--ws-text-tertiary);
  font-size: 13px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.card {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  padding: 16px;
}

.en {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.6;
  color: var(--ws-text-primary);
}

.src {
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-top: 4px;
}

.note {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--ws-border);
  line-height: 1.7;
}

.meta {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 8px;
}

.ops {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
}

.act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.act:hover {
  background: var(--ws-bg-subtle);
  color: var(--ws-brand-500);
}

.act.danger:hover {
  color: var(--ws-error-500);
}
</style>
