<template>
  <teleport to="body">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="palette" @keydown="onKeydown">
        <input
          ref="inputRef"
          v-model="keyword"
          class="palette-input"
          placeholder="搜索会话、能力或命令…"
          @keydown="onKeydown"
        />
        <div class="palette-list">
          <template v-if="filtered.length">
            <template v-for="(cmd, i) in filtered" :key="cmd.key">
              <div v-if="isGroupHead(i)" class="palette-group">{{ cmd.group }}</div>
              <button
                type="button"
                class="palette-item"
                :class="{ 'is-active': i === activeIndex }"
                @mouseenter="activeIndex = i"
                @click="run(cmd)"
              >
                <app-icon :name="cmd.icon" />
                <span>{{ cmd.label }}</span>
              </button>
            </template>
          </template>
          <div v-else class="palette-empty">没有匹配的命令</div>
        </div>
        <div class="palette-foot">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { NAV_ITEMS } from '@/config/nav';
import type { IconName } from '@/config/icons';
import { useConversationStore } from '@/stores/conversations';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

interface Command {
  key: string;
  group: string;
  label: string;
  icon: IconName;
  action: () => void;
}

const router = useRouter();
const store = useConversationStore();
const inputRef = ref<HTMLInputElement | null>(null);
const keyword = ref('');
const activeIndex = ref(0);

const commands = computed<Command[]>(() => [
  ...NAV_ITEMS.map((item) => ({
    key: `nav-${item.key}`,
    group: '跳转',
    label: item.label,
    icon: item.icon,
    action: () => router.push(item.to),
  })),
  {
    key: 'nav-profile',
    group: '跳转',
    label: '我的',
    icon: 'user' as IconName,
    action: () => router.push('/profile'),
  },
  {
    key: 'action-new-chat',
    group: '动作',
    label: '新建对话',
    icon: 'plus' as IconName,
    action: () => {
      store.startNew();
      router.push('/chat');
    },
  },
  {
    key: 'action-help',
    group: '动作',
    label: '快捷键帮助',
    icon: 'search' as IconName,
    action: () => message.info('⌘K 命令面板 · ⌘N 新建对话 · ⌘/ 快捷键 · Esc 关闭'),
  },
]);

const filtered = computed(() => {
  const q = keyword.value.trim();
  if (!q) return commands.value;
  return commands.value.filter((c) => c.label.includes(q));
});

function isGroupHead(i: number): boolean {
  return i === 0 || filtered.value[i - 1]?.group !== filtered.value[i]?.group;
}

function run(cmd: Command) {
  cmd.action();
  emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % Math.max(filtered.value.length, 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + Math.max(filtered.value.length, 1)) % Math.max(filtered.value.length, 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cmd = filtered.value[activeIndex.value];
    if (cmd) run(cmd);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    keyword.value = '';
    activeIndex.value = 0;
    nextTick(() => inputRef.value?.focus());
  },
);
</script>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: var(--ws-overlay);
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-top: 120px;
}

.palette {
  width: 560px;
  max-width: calc(100vw - 32px);
  background: var(--ws-bg-surface);
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-popover);
  overflow: hidden;
}

.palette-input {
  width: 100%;
  height: 52px;
  border: 0;
  outline: none;
  padding: 0 20px;
  font-size: 15px;
  color: var(--ws-text-primary);
  background: var(--ws-bg-surface);
  border-bottom: 1px solid var(--ws-border);
}

.palette-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

.palette-group {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-tertiary);
  padding: 8px 12px 4px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--ws-radius-md);
  font-size: 14px;
  color: var(--ws-text-primary);
  background: transparent;
  text-align: left;
}

.palette-item.is-active {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
}

.palette-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--ws-text-tertiary);
}

.palette-foot {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--ws-border);
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
</style>
