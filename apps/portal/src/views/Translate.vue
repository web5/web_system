<template>
  <work-placeholder
    icon="lang"
    title="翻译工作台"
    desc="并排对照（原文 / 自然版 / 直译版 / 委婉版）与术语库面板在 P2 落地。当前翻译需求可直接用对话完成：把原文贴进来，说明目标语言与语气。"
  >
    <button type="button" class="ph-btn" @click="router.push('/chat')">去对话</button>
  </work-placeholder>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import WorkPlaceholder from '@/components/WorkPlaceholder.vue';

const router = useRouter();
</script>

<style scoped>
.ph-btn {
  height: 32px;
  padding: 0 16px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  font-size: 13px;
  font-weight: 500;
}

.ph-btn:hover {
  background: var(--ws-brand-600);
}
</style>
