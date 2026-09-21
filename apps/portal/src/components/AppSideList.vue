<template>
  <aside class="side">
    <div class="side-head">
      <span class="side-title">{{ title }}</span>
      <button type="button" class="btn-ghost" @click="createNew">
        <app-icon name="plus" />
        <span>新建</span>
      </button>
    </div>

    <!-- 加载中：骨架屏 -->
    <div v-if="store.loading" class="side-body">
      <div v-for="n in 4" :key="n" class="skel-item">
        <span class="skel skel-title" />
        <span class="skel skel-sub" />
      </div>
    </div>

    <!-- 失败：错误态 + 重试 -->
    <div v-else-if="store.error" class="side-empty">
      <span class="empty-icon"><app-icon name="warn" size="lg" /></span>
      <p class="empty-title">加载失败</p>
      <p class="empty-desc">{{ store.error }}</p>
      <button type="button" class="btn-primary-sm" @click="store.load()">重试</button>
    </div>

    <!-- 空态：「新建」是唯一恢复出口 -->
    <div v-else-if="store.isEmpty" class="side-empty">
      <span class="empty-icon"><app-icon name="inbox" size="lg" /></span>
      <p class="empty-title">还没有记录</p>
      <p class="empty-desc">新建第一条{{ title }}</p>
      <button type="button" class="btn-primary-sm" @click="createNew">新建</button>
    </div>

    <!-- 列表：统一会话流，不按类型隔离 -->
    <div v-else class="side-body">
      <button
        v-for="item in store.items"
        :key="item.id"
        type="button"
        class="list-item"
        :class="{ 'is-active': store.currentId === item.id }"
        @click="pick(item.id)"
      >
        <span class="item-title">{{ displayTitle(item) }}</span>
        <span class="item-sub">{{ formatRelativeTime(item.updatedAt) }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import type { ConversationSummary } from '@/api/agent';
import { useConversationStore } from '@/stores/conversations';
import { formatRelativeTime } from '@/utils/time';
import AppIcon from './AppIcon.vue';

defineProps<{ title: string }>();

const route = useRoute();
const router = useRouter();
const store = useConversationStore();

/** 无标题会话（后端异步生成标题）→ 用占位文案，不显示空白行 */
function displayTitle(item: ConversationSummary): string {
  return item.title?.trim() || '新对话';
}

/** 从欢迎页 / 其他页点列表 → 先落到对话工作台，再切换会话 */
async function ensureChatRoute() {
  if (route.path !== '/chat') await router.push('/chat');
}

function pick(id: string) {
  store.select(id);
  void ensureChatRoute();
}

function createNew() {
  store.startNew();
  void ensureChatRoute();
}
</script>

<style scoped>
.side {
  width: var(--sidelist-w);
  flex: 0 0 var(--sidelist-w);
  background: var(--ws-bg-surface);
  border-right: 1px solid var(--ws-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
}

.side-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-tertiary);
  letter-spacing: 0.02em;
}

.side-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
}

.list-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  margin-bottom: 2px;
  border-radius: var(--ws-radius-md);
  background: transparent;
  transition: background 0.15s ease;
}

.list-item:hover {
  background: var(--ws-bg-hover);
}

.list-item.is-active {
  background: var(--ws-brand-50);
}

.item-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-item.is-active .item-title {
  color: var(--ws-brand-700);
  font-weight: 600;
}

.item-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

/* ===== 空态 / 错误态 ===== */
.side-empty {
  flex: 1;
  padding: 24px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.empty-icon {
  width: 40px;
  height: 40px;
  margin-bottom: 8px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-subtle);
  color: var(--ws-text-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.empty-desc {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-bottom: 12px;
}

/* ===== 骨架屏 ===== */
.skel-item {
  padding: 10px 12px;
}

.skel {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--ws-bg-subtle), var(--ws-bg-hover), var(--ws-bg-subtle));
  background-size: 200% 100%;
  animation: skel 1.2s infinite;
}

.skel-title {
  width: 80%;
  margin-bottom: 8px;
}

.skel-sub {
  width: 45%;
  height: 10px;
}

@keyframes skel {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ===== 小按钮 ===== */
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--ws-radius-md);
  color: var(--ws-text-secondary);
  font-size: 13px;
  background: transparent;
  transition: background 0.15s ease, color 0.15s ease;
}

.btn-ghost:hover {
  background: var(--ws-bg-hover);
  color: var(--ws-brand-700);
}

.btn-primary-sm {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  font-size: 13px;
  font-weight: 500;
}
</style>
