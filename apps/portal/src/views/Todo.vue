<template>
  <div class="todo-page">
    <!-- 顶部导航已迁移到全局 App.vue -->

    <!-- 统计卡片 -->
    <TodoStats :stats="stats" />

    <!-- 筛选栏 -->
    <div class="filters-bar">
      <select v-model="filters.status" @change="fetchTodos" class="filter-select">
        <option value="">全部状态</option>
        <option value="pending">待完成</option>
        <option value="in_progress">进行中</option>
        <option value="completed">已完成</option>
        <option value="overdue">已逾期</option>
      </select>
      <select v-model="filters.priority" @change="fetchTodos" class="filter-select">
        <option value="">全部优先级</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
      <input
        v-model="keyword"
        @input="debounceSearch"
        placeholder="搜索任务..."
        class="filter-search"
      />
    </div>

    <!-- 任务列表 -->
    <div class="todo-list" v-if="todos.length">
      <TodoItem
        v-for="todo in todos"
        :key="todo.id"
        :todo="todo"
        @click="handleTodoClick"
        @toggle="handleToggle"
        @edit="handleEdit"
        @delete="handleDelete"
      />
      <!-- 加载更多 -->
      <div class="load-more" v-if="hasMore" @click="loadMore">
        {{ loading ? '加载中...' : '加载更多' }}
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else-if="!loading">
      <div class="empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <polyline points="2 8 12 13 22 8"/>
        </svg>
      </div>
      <p class="empty-text">暂无任务</p>
      <p class="empty-hint">点击右下角 + 按钮创建新任务</p>
    </div>

    <!-- 加载中 -->
    <div class="loading-state" v-if="loading && !todos.length">
      <p>加载中...</p>
    </div>

    <!-- 创建按钮 -->
    <button class="fab-btn" @click="showForm = true">+</button>

    <!-- 创建/编辑表单 -->
    <TodoForm
      :visible="showForm"
      :todo="editingTodo"
      @close="closeForm"
      @submit="handleSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import TodoStats from '@/components/todo/TodoStats.vue';
import TodoItem from '@/components/todo/TodoItem.vue';
import TodoForm from '@/components/todo/TodoForm.vue';
import { getTodoList, getTodoStats, createTodo, updateTodo, deleteTodo, updateTodoStatus } from '@/api/todo';
import type { Todo, TodoStats as StatsType, QueryTodoParams } from '@/types/todo';

const todos = ref<Todo[]>([]);
const stats = reactive<StatsType>({ total: 0, completed: 0, pending: 0, overdue: 0, completionRate: 0 });
const loading = ref(false);
const hasMore = ref(true);
const showForm = ref(false);
const editingTodo = ref<Todo | undefined>();
const keyword = ref('');

const filters = reactive<QueryTodoParams>({
  page: 1,
  pageSize: 20,
  status: undefined,
  priority: undefined,
});

let searchTimer: number;

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    filters.page = 1;
    fetchTodos();
  }, 300);
}

async function fetchTodos() {
  loading.value = true;
  try {
    const res = await getTodoList(filters);
    if (filters.page === 1) {
      todos.value = res.data.items;
    } else {
      todos.value.push(...res.data.items);
    }
    hasMore.value = todos.value.length < res.data.total;
  } catch (err) {
    message.error('获取任务列表失败');
  } finally {
    loading.value = false;
  }
}

async function fetchStats() {
  try {
    const res = await getTodoStats('today');
    Object.assign(stats, res.data);
  } catch {}
}

function loadMore() {
  if (loading.value) return;
  filters.page! += 1;
  fetchTodos();
}

function handleTodoClick(todo: Todo) {
  // 查看详情（未来实现）
  console.log('Todo clicked:', todo);
}

function handleToggle(todo: Todo) {
  const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
  updateTodoStatus(todo.id, newStatus).then(res => {
    Object.assign(todo, res.data);
    fetchStats();
  });
}

function handleEdit(todo: Todo) {
  editingTodo.value = todo;
  showForm.value = true;
}

async function handleDelete(todo: Todo) {
  if (!confirm('确定删除此任务？')) return;
  try {
    await deleteTodo(todo.id);
    message.success('删除成功');
    filters.page = 1;
    fetchTodos();
    fetchStats();
  } catch {
    message.error('删除失败');
  }
}

function closeForm() {
  showForm.value = false;
  editingTodo.value = undefined;
}

async function handleSubmit(data: any) {
  try {
    if (editingTodo.value) {
      await updateTodo(editingTodo.value.id, data);
      message.success('更新成功');
    } else {
      await createTodo(data);
      message.success('创建成功');
    }
    closeForm();
    filters.page = 1;
    fetchTodos();
    fetchStats();
  } catch {
    message.error(editingTodo.value ? '更新失败' : '创建失败');
  }
}

onMounted(() => {
  fetchTodos();
  fetchStats();
});
</script>

<style scoped>
.todo-page {
  min-height: 100vh;
  background: #FFF8F0;
  padding-bottom: 100px;
}

/* ===== 导航栏（已迁移到 AppNavbar 组件） ===== */

.filters-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  background: white;
  border-bottom: 1px solid #f0f0f0;
}

.filter-select, .filter-search {
  padding: 8px 12px;
  border: 2px solid #eee;
  border-radius: 4px;
  font-size: 14px;
  background: white;
  min-width: 120px;
}

.filter-search { flex: 1; }

.todo-list { padding-bottom: 16px; }

.load-more {
  text-align: center;
  padding: 16px;
  color: #FF8C42;
  cursor: pointer;
  font-weight: 500;
}

.empty-state, .loading-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-icon { font-size: 64px; margin-bottom: 16px; }
.empty-text { font-size: 18px; color: #666; margin-bottom: 8px; }
.empty-hint { font-size: 14px; color: #999; }

.fab-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #FF8C42;
  color: white;
  font-size: 28px;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(255, 140, 66, 0.4);
  transition: all 0.2s;
  z-index: 100;
}

.fab-btn:active {
  transform: scale(0.9);
  box-shadow: 0 2px 6px rgba(255, 140, 66, 0.4);
}
</style>
