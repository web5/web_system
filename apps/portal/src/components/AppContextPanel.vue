<template>
  <!-- 折叠态：只留一条竖排标题 + 展开入口，中栏自动扩展 -->
  <div v-if="collapsed" class="ctx-collapsed">
    <button type="button" class="icon-btn" title="展开上下文面板" @click="setCollapsed(false)">
      <app-icon name="left" />
    </button>
    <span class="vertical-title">{{ title }}</span>
  </div>

  <aside v-else class="ctx">
    <div class="ctx-head">
      <h2>{{ title }}</h2>
      <span class="spacer" />
      <button type="button" class="icon-btn" title="收起面板" @click="setCollapsed(true)">
        <app-icon name="right" />
      </button>
    </div>
    <div class="ctx-body">
      <slot />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from './AppIcon.vue';

defineProps<{ title: string }>();

const STORAGE_KEY = 'portal.context-panel.collapsed';

/** 折叠状态本地持久化（page-spec §1 风险项：倾向 localStorage） */
const collapsed = ref<boolean>(read());

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setCollapsed(next: boolean) {
  collapsed.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* 隐私模式下忽略 */
  }
}
</script>

<style scoped>
.ctx {
  width: var(--ctx-w);
  flex: 0 0 var(--ctx-w);
  background: var(--ws-bg-surface);
  border-left: 1px solid var(--ws-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ctx-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--ws-border);
}

.ctx-head h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.spacer {
  flex: 1;
}

.ctx-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.ctx-collapsed {
  width: 44px;
  flex: 0 0 44px;
  background: var(--ws-bg-surface);
  border-left: 1px solid var(--ws-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 16px;
  gap: 8px;
}

.vertical-title {
  writing-mode: vertical-rl;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  letter-spacing: 0.08em;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--ws-radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ws-text-secondary);
  background: transparent;
  transition: background 0.15s ease, color 0.15s ease;
}

.icon-btn:hover {
  background: var(--ws-bg-hover);
  color: var(--ws-brand-700);
}
</style>
