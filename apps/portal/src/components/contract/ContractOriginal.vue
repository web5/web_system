<template>
  <div ref="root" class="orig">
    <p v-for="(para, i) in paragraphs" :key="i">
      <template v-for="(seg, j) in segmentsOf(para)" :key="j">
        <mark v-if="seg.hit" class="hl">{{ seg.text }}</mark>
        <template v-else>{{ seg.text }}</template>
      </template>
    </p>
    <div v-if="!paragraphs.length" class="orig-empty">还没有合同原文</div>
    <div v-else-if="keyword && !hitCount" class="orig-tip">这份原文里没找到该条款的原文片段</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps<{
  /** 合同原文（OCR 结果或粘贴文本） */
  text: string;
  /** 联动高亮关键词（Q1 兜底：报告 ↔ 原文本地回查） */
  keyword?: string;
}>();

const paragraphs = computed(() =>
  (props.text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** 命中数（0 表示关键词没回查到，页面给出说明而不是假装高亮） */
const hitCount = computed(() => {
  const kw = (props.keyword || '').trim();
  if (!kw) return 0;
  return paragraphs.value.filter((p) => p.includes(kw)).length;
});

/** 按关键词切段：命中段用 <mark> 包裹（不走 v-html，原文始终转义） */
function segmentsOf(para: string): Array<{ text: string; hit: boolean }> {
  const kw = (props.keyword || '').trim();
  if (!kw || !para.includes(kw)) return [{ text: para, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  let rest = para;
  let idx = rest.indexOf(kw);
  while (idx !== -1) {
    if (idx > 0) out.push({ text: rest.slice(0, idx), hit: false });
    out.push({ text: kw, hit: true });
    rest = rest.slice(idx + kw.length);
    idx = rest.indexOf(kw);
  }
  if (rest) out.push({ text: rest, hit: false });
  return out;
}

const root = ref<HTMLElement | null>(null);

/** 切换风险项 → 把首个命中片段滚进视野（右栏独立滚动） */
watch(
  () => props.keyword,
  async () => {
    await nextTick();
    root.value?.querySelector('.hl')?.scrollIntoView({ block: 'center' });
  },
);
</script>

<style scoped>
.orig {
  font-size: 13px;
  line-height: 2;
  color: var(--ws-text-secondary);
}

.orig p {
  margin-bottom: 16px;
  white-space: pre-wrap;
  word-break: break-word;
}

.hl {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  border-radius: 2px;
  padding: 2px 0;
}

.orig-empty,
.orig-tip {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.orig-tip {
  margin-top: 8px;
}
</style>
