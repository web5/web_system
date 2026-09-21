<template>
  <!-- 占位态（P1）：顶栏可达、不留死链；空态给出路，不做半成品交互 -->
  <div class="ph">
    <div class="ph-card">
      <span class="ph-icon"><app-icon :name="icon" size="lg" /></span>
      <h2>{{ title }}</h2>
      <p>{{ desc }}</p>
      <div class="ph-actions">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IconName } from '@/config/icons';
import AppIcon from './AppIcon.vue';

defineProps<{ title: string; desc: string; icon: IconName }>();
</script>

<style scoped>
.ph {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ph-card {
  max-width: 480px;
  padding: 32px;
  text-align: center;
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card);
}

.ph-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  border-radius: var(--ws-radius-lg);
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ph-card h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}

.ph-card p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ws-text-secondary);
}

.ph-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  justify-content: center;
}
</style>
