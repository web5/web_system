<template>
  <div class="sub">
    <div class="chead">
      <button type="button" class="btn-back" @click="router.push('/profile')">
        <app-icon name="left" />返回
      </button>
      <h1>音乐口味</h1>
    </div>

    <div class="tip"><app-icon name="spark" />AI 自动归类 · 红色为不想听</div>

    <div class="card">
      <div v-if="tags.length === 0" class="empty">
        <app-icon name="spark" size="lg" />
        <p>还没记住你的口味，去对话里说说你喜欢听什么</p>
      </div>
      <div v-else class="tags">
        <span v-for="(t, i) in tags" :key="i" class="chip" :class="t.like ? 'on' : 'bad'">
          {{ t.like ? t.text : `不想听 ${t.text}` }}
          <button type="button" class="rm" @click="removeTag(t)"><app-icon name="x" /></button>
        </span>
      </div>

      <div class="add">
        <input
          v-model="input"
          class="inp"
          maxlength="12"
          placeholder="手动补充口味（≤12 字）"
          @keydown.enter="addTag"
        />
        <button type="button" class="btn-primary btn-sm" @click="addTag">添加</button>
      </div>

      <button type="button" class="clear" @click="clear">清空口味记忆</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  getMusicTaste,
  addMusicTaste,
  removeMusicTaste,
  clearMusicTaste,
  type TasteData,
} from '@/api/user-taste';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();
const taste = ref<TasteData>({ likes: { genres: [], artists: [], moods: [] }, dislikes: { genres: [], artists: [] } });
const input = ref('');

interface TagItem {
  text: string;
  dim: 'genres' | 'artists' | 'moods';
  like: boolean;
}

const tags = computed<TagItem[]>(() => {
  const t = taste.value;
  const out: TagItem[] = [];
  t.likes.genres.forEach((x) => out.push({ text: x, dim: 'genres', like: true }));
  t.likes.artists.forEach((x) => out.push({ text: x, dim: 'artists', like: true }));
  t.likes.moods.forEach((x) => out.push({ text: x, dim: 'moods', like: true }));
  t.dislikes.genres.forEach((x) => out.push({ text: x, dim: 'genres', like: false }));
  t.dislikes.artists.forEach((x) => out.push({ text: x, dim: 'artists', like: false }));
  return out;
});

async function load() {
  taste.value = await getMusicTaste();
}

async function addTag() {
  const text = input.value.trim();
  if (!text) {
    message.warning('请输入口味');
    return;
  }
  if (text.length > 12) {
    message.warning('不超过 12 字');
    return;
  }
  taste.value = await addMusicTaste({ likes: { genres: [text] } });
  input.value = '';
  message.success('已添加口味');
}

async function removeTag(tag: TagItem) {
  const patch = tag.like ? { likes: { [tag.dim]: [tag.text] } } : { dislikes: { [tag.dim]: [tag.text] } };
  taste.value = await removeMusicTaste(patch as Partial<TasteData>);
  message.success('已移除口味');
}

async function clear() {
  taste.value = await clearMusicTaste();
  message.success('已清空口味记忆');
}

onMounted(() => void load());
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

.card {
  max-width: 720px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  padding: 20px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--ws-text-tertiary);
  font-size: 13px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px 0 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-secondary);
}

.chip.on {
  border-color: var(--ws-brand-500);
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
}

.chip.bad {
  border-color: var(--ws-error-500);
  background: var(--ws-error-100);
  color: var(--ws-error-500);
}

.rm {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: inherit;
  opacity: 0.6;
}

.rm:hover {
  opacity: 1;
}

.add {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.inp {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-primary);
}

.inp:focus {
  border-color: var(--ws-brand-500);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 16px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  font-size: 13px;
  font-weight: 500;
}

.btn-primary:hover {
  background: var(--ws-brand-600);
}

.btn-sm {
  height: 32px;
  padding: 0 16px;
}

.clear {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--ws-radius-md);
  font-size: 13px;
  color: var(--ws-error-500);
}

.clear:hover {
  background: var(--ws-error-100);
}
</style>
