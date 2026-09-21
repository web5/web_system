<template>
  <aside class="side">
    <div class="side-head">
      <span class="side-title">{{ title }}</span>
      <button type="button" class="btn-ghost" @click="createNew">
        <app-icon name="plus" />
        <span>新建</span>
      </button>
    </div>

    <!-- 未登录：欢迎页是公开页，左栏给出登录出口 -->
    <div v-if="!userStore.isLoggedIn" class="side-empty">
      <span class="empty-icon"><app-icon name="inbox" size="lg" /></span>
      <p class="empty-title">登录后同步记录</p>
      <p class="empty-desc">登录后可查看历史会话</p>
      <button type="button" class="btn-primary-sm" @click="authGate.openAuth()">登录 / 注册</button>
    </div>

    <!-- 加载中：骨架屏 -->
    <div v-else-if="store.loading" class="side-body">
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
      <div
        v-for="item in store.items"
        :key="item.id"
        class="list-row"
        :class="{ 'is-active': store.currentId === item.id }"
      >
        <button type="button" class="list-item" @click="pick(item.id)">
          <span class="item-title">{{ displayTitle(item) }}</span>
          <span class="item-sub">{{ formatRelativeTime(item.updatedAt) }}</span>
        </button>
        <!-- 生成中的会话禁止删除：tooltip 说明原因 -->
        <button
          v-if="store.running && store.currentId === item.id"
          type="button"
          class="row-del"
          title="任务进行中，完成后可删除"
          disabled
        >
          <app-icon name="x" />
        </button>
        <button v-else type="button" class="row-del" title="删除会话" @click="confirmDelete(item)">
          <app-icon name="x" />
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { Modal, message } from 'ant-design-vue';
import type { ConversationSummary } from '@/api/agent';
import { useConversationStore } from '@/stores/conversations';
import { useUserStore } from '@/stores/user';
import { useAuthGateStore } from '@/stores/authGate';
import { formatRelativeTime } from '@/utils/time';
import AppIcon from './AppIcon.vue';

defineProps<{ title: string }>();

const route = useRoute();
const router = useRouter();
const store = useConversationStore();
const userStore = useUserStore();
const authGate = useAuthGateStore();

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
  authGate.ensureAuth(() => {
    store.startNew();
    void ensureChatRoute();
  });
}

/** 破坏性操作：二次确认后才调删除 */
function confirmDelete(item: ConversationSummary) {
  Modal.confirm({
    title: '删除会话',
    content: `「${displayTitle(item)}」删除后该会话记录不可恢复，确定删除？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await store.remove(item.id);
        message.success('已删除');
      } catch {
        message.error('删除失败，请重试');
      }
    },
  });
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

.list-row {
  position: relative;
  margin-bottom: 2px;
  border-radius: var(--ws-radius-md);
}

.list-row:hover {
  background: var(--ws-bg-hover);
}

.list-row.is-active {
  background: var(--ws-brand-50);
}

.list-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border-radius: var(--ws-radius-md);
  background: transparent;
}

.item-title {
  display: block;
  padding-right: 24px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-row.is-active .item-title {
  color: var(--ws-brand-700);
  font-weight: 600;
}

.item-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.row-del {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  border-radius: var(--ws-radius-sm);
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--ws-text-tertiary);
  background: transparent;
}

.list-row:hover .row-del {
  display: inline-flex;
}

.row-del:hover:not(:disabled) {
  background: var(--ws-bg-active);
  color: var(--ws-error-500);
}

.row-del:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  display: inline-flex;
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

.btn-primary-sm:hover {
  background: var(--ws-brand-600);
}
</style>
