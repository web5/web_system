<template>
  <work-placeholder
    icon="grid"
    title="发现"
    desc="能力市场正在建设中（后端待办 B2：C 端 agent 清单接口）。现在可以直接描述你的问题，由后端自动识别该用哪项能力。"
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
