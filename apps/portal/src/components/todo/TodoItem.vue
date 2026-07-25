<template>
  <div class="todo-item" :class="{ completed: todo.status === 'completed' }" @click="$emit('click', todo)">
    <div class="todo-checkbox" @click.stop="$emit('toggle', todo)">
      <input type="checkbox" :checked="todo.status === 'completed'" />
    </div>
    <div class="todo-content">
      <div class="todo-title">{{ todo.title }}</div>
      <div class="todo-meta">
        <span class="todo-category" v-if="todo.category && todo.category.length">
          {{ formatCategory(todo.category[0]) }}
        </span>
        <span class="todo-priority" :class="todo.priority">
          {{ formatPriority(todo.priority) }}
        </span>
        <span class="todo-due" v-if="todo.due_date" :class="{ overdue: isOverdue(todo.due_date) }">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          {{ formatDate(todo.due_date) }}
        </span>
      </div>
    </div>
    <div class="todo-actions" @click.stop>
      <button class="action-btn" @click="$emit('edit', todo)" title="编辑">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
      </button>
      <button class="action-btn" @click="$emit('delete', todo)" title="删除">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';
import type { Todo } from '@/types/todo';

const props = defineProps<{ todo: Todo }>();
const emit = defineEmits<{
  (e: 'click', todo: Todo): void;
  (e: 'toggle', todo: Todo): void;
  (e: 'edit', todo: Todo): void;
  (e: 'delete', todo: Todo): void;
}>();

const categoryMap: Record<string, string> = {
  creative: '创意',
  study: '学习',
  sport: '运动',
  music: '音乐',
  other: '其他',
};

const priorityMap: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

function formatCategory(cat: string) {
  return categoryMap[cat] || cat;
}

function formatPriority(pri: string) {
  return priorityMap[pri] || pri;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function isOverdue(dateStr: string) {
  return new Date(dateStr) < new Date() && props.todo.status !== 'completed';
}
</script>

<style scoped>
.todo-item {
  background: white;
  border-radius: 4px;
  padding: 16px;
  margin: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.2s;
  cursor: pointer;
}

.todo-item:active { transform: scale(0.98); }
.todo-item.completed { opacity: 0.6; }

.todo-checkbox input {
  width: 24px;
  height: 24px;
  accent-color: #FF8C42;
  cursor: pointer;
}

.todo-content { flex: 1; min-width: 0; }

.todo-title {
  font-size: 16px;
  font-weight: 500;
  color: #333;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.completed .todo-title { text-decoration: line-through; }

.todo-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}

.todo-category, .todo-priority {
  padding: 2px 8px;
  border-radius: 4px;
  background: #FFF8F0;
  color: #FF8C42;
}

.todo-priority.low { background: #E8F5E9; color: #7ED957; }
.todo-priority.medium { background: #FFF8E1; color: #FF8C42; }
.todo-priority.high { background: #FFEBEE; color: #FF6B6B; }

.todo-due { color: #888; }
.todo-due.overdue { color: #FF6B6B; font-weight: bold; }

.todo-actions { display: flex; gap: 4px; }
.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.action-btn:hover { background: #f5f5f5; }
.action-btn:hover svg { stroke: #333; }
</style>
