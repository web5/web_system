<template>
  <work-placeholder
    icon="doc"
    title="合翻（合同翻译官）"
    desc="上传 → 分析进度 → 报告 + 原文双栏联动在 P3 落地。当前可以先把合同条款贴进对话，说明签署方与关注点。"
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
