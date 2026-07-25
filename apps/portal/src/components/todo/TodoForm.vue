<template>
  <div class="todo-form-overlay" v-if="visible" @click.self="$emit('close')">
    <div class="todo-form">
      <div class="form-header">
        <h3>{{ isEdit ? '编辑任务' : '创建任务' }}</h3>
        <button class="close-btn" @click="$emit('close')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="form-body">
        <div class="form-group">
          <label>任务标题 *</label>
          <input v-model="form.title" placeholder="输入任务标题..." class="form-input" />
        </div>
        <div class="form-group">
          <label>任务描述</label>
          <textarea v-model="form.description" placeholder="输入任务描述..." class="form-textarea" rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>优先级</label>
          <div class="priority-options">
            <button
              v-for="opt in priorityOptions"
              :key="opt.value"
              class="priority-btn"
              :class="{ active: form.priority === opt.value }"
              @click="form.priority = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="form-group">
          <label>分类</label>
          <div class="category-options">
            <button
              v-for="opt in categoryOptions"
              :key="opt.value"
              class="category-btn"
              :class="{ active: form.category?.includes(opt.value) }"
              @click="toggleCategory(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="form-group">
          <label>截止日期</label>
          <input v-model="form.due_date" type="date" class="form-input" />
        </div>
      </div>
      <div class="form-footer">
        <button class="btn-cancel" @click="$emit('close')">取消</button>
        <button class="btn-submit" @click="handleSubmit">{{ isEdit ? '保存' : '创建' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits, reactive, watch, computed } from 'vue';
import type { Todo, CreateTodoDto, UpdateTodoDto, TodoCategory } from '@/types/todo';

const props = defineProps<{
  visible: boolean;
  todo?: Todo;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', data: CreateTodoDto | UpdateTodoDto): void;
}>();

const isEdit = computed(() => !!props.todo);

const form = reactive<CreateTodoDto & { id?: number }>({
  title: '',
  description: '',
  priority: 'medium',
  category: [],
  due_date: '',
});

watch(() => props.todo, (todo) => {
  if (todo) {
    form.title = todo.title;
    form.description = todo.description || '';
    form.priority = todo.priority;
    form.category = todo.category || [];
    form.due_date = todo.due_date ? todo.due_date.split('T')[0] : '';
  } else {
    form.title = '';
    form.description = '';
    form.priority = 'medium';
    form.category = [];
    form.due_date = '';
  }
}, { immediate: true });

const priorityOptions = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
];

const categoryOptions = [
  { label: '创意', value: 'creative' },
  { label: '学习', value: 'study' },
  { label: '运动', value: 'sport' },
  { label: '音乐', value: 'music' },
  { label: '其他', value: 'other' },
];

function toggleCategory(cat: TodoCategory) {
  if (!form.category) form.category = [];
  const idx = form.category.indexOf(cat);
  if (idx >= 0) form.category.splice(idx, 1);
  else form.category.push(cat);
}

function handleSubmit() {
  if (!form.title.trim()) return;
  const data = { ...form };
  emit('submit', data);
}
</script>

<style scoped>
.todo-form-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}

.todo-form {
  background: white;
  border-radius: 4px 4px 0 0;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.form-header h3 {
  font-size: 20px;
  color: #333;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}
.close-btn:hover { background: #f5f5f5; }
.close-btn:hover svg { stroke: #333; }

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
  font-weight: 500;
}

.form-input, .form-textarea {
  width: 100%;
  padding: 12px 16px;
  border: 2px solid #eee;
  border-radius: 4px;
  font-size: 16px;
  color: #333;
  transition: border-color 0.2s;
  box-sizing: border-box;
  background: #fff;
}

.form-input::placeholder, .form-textarea::placeholder {
  color: #999;
}

.form-input:focus, .form-textarea:focus {
  outline: none;
  border-color: #FF8C42;
  background: #fff;
}

.form-textarea { resize: vertical; }

.priority-options, .category-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.priority-btn, .category-btn {
  padding: 8px 16px;
  border: 2px solid #eee;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.priority-btn.active, .category-btn.active {
  border-color: #FF8C42;
  background: #FFF8F0;
  color: #FF8C42;
}

.form-footer {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.btn-cancel, .btn-submit {
  flex: 1;
  padding: 14px;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: #f5f5f5;
  border: none;
  color: #666;
}

.btn-submit {
  background: #FF8C42;
  border: none;
  color: white;
}

.btn-submit:active { transform: scale(0.98); }
</style>
