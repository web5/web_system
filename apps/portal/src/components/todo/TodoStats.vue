<template>
  <div class="todo-stats">
    <div class="stat-card">
      <div class="stat-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF8C42" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="12" width="4" height="8"/>
          <rect x="10" y="7" width="4" height="13"/>
          <rect x="17" y="3" width="4" height="17"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-number">{{ stats.total }}</div>
        <div class="stat-label">总任务</div>
      </div>
    </div>
    <div class="stat-card completed">
      <div class="stat-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7ED957" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 13 9 18 20 6"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-number">{{ stats.completed }}</div>
        <div class="stat-label">已完成</div>
      </div>
    </div>
    <div class="stat-card pending">
      <div class="stat-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF8C42" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-number">{{ stats.pending }}</div>
        <div class="stat-label">进行中</div>
      </div>
    </div>
    <div class="stat-card rate">
      <div class="stat-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ECDC4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-number">{{ stats.completionRate }}%</div>
        <div class="stat-label">完成率</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';

const props = defineProps<{
  stats: {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    completionRate: number;
  };
}>();
</script>

<style scoped>
.todo-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 16px;
}

.stat-card {
  background: white;
  border-radius: 4px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: transform 0.2s;
}

.stat-card:active {
  transform: scale(0.98);
}

.stat-icon {
  font-size: 28px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #FFF8F0;
  border-radius: 4px;
}

.stat-content {
  flex: 1;
}

.stat-number {
  font-size: 24px;
  font-weight: bold;
  color: #333;
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: #888;
  margin-top: 2px;
}

.stat-card.completed .stat-number { color: #7ED957; }
.stat-card.pending .stat-number { color: #FF8C42; }
.stat-card.rate .stat-number { color: #4ECDC4; }
</style>
