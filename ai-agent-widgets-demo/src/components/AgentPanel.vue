<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import MessageList from './MessageList.vue';
import LoadTrace from './LoadTrace.vue';
import { connectSse } from '@/lib/sse-client';
import { aguiBus } from '@/lib/agui-event-bus';
import type { AguiEvent } from '@/lib/agui-types';
import type { ChatMessage, AgentStatus } from '@/types';
import { isAllowedApp, widgetLabelOf } from '@/lib/widget-protocol';
import {
  releaseDisconnectedHandles,
  unmountAllWidgets,
} from '@/microfrontend/widget-loader';

const props = withDefaults(
  defineProps<{
    endpoint?: string;
    mcpKey?: string;
    autoConnect?: boolean;
  }>(),
  {
    endpoint: '/agui',
    mcpKey: '',
    autoConnect: false,
  },
);

const messages = ref<ChatMessage[]>([]);
const status = ref<AgentStatus>('idle');
const connected = ref(false);
const errorMsg = ref('');

let controller: AbortController | null = null;
// 用显式 id 追踪「当前正在流式写入」的那条 assistant 消息：
// 交互回写会在流式中途插入 system 消息，不能靠 messages[last] 定位。
let activeMessageId: string | null = null;
const unsubs: Array<() => void> = [];

function genId(): string {
  return 'm_' + Math.random().toString(36).slice(2, 10);
}

function ensureAssistantMessage(): ChatMessage {
  if (activeMessageId) {
    const found = messages.value.find((m) => m.id === activeMessageId && m.streaming);
    if (found) return found;
  }
  const m: ChatMessage = {
    id: genId(),
    role: 'assistant',
    content: '',
    streaming: true,
    status: 'thinking',
    tools: [],
  };
  messages.value.push(m);
  activeMessageId = m.id;
  return m;
}

function handleEvent(evt: AguiEvent): void {
  switch (evt.type) {
    case 'run_started':
      status.value = 'thinking';
      ensureAssistantMessage();
      break;
    case 'text_message_start':
      ensureAssistantMessage();
      break;
    case 'text_message_content': {
      const m = ensureAssistantMessage();
      m.content += evt.delta;
      break;
    }
    case 'text_message_end': {
      const m = ensureAssistantMessage();
      m.streaming = false;
      activeMessageId = null;
      break;
    }
    case 'tool_call_start':
      status.value = 'executing';
      ensureAssistantMessage().tools.push({ name: evt.toolName ?? 'tool', args: '' });
      break;
    case 'tool_call_args': {
      const m = ensureAssistantMessage();
      const t = m.tools[m.tools.length - 1];
      if (t) t.args += evt.delta;
      break;
    }
    case 'tool_call_end':
      break;
    case 'state_snapshot':
      if (evt.snapshot && evt.snapshot.needsConfirmation) status.value = 'waiting';
      break;
    case 'run_finished':
      status.value = 'done';
      connected.value = false;
      activeMessageId = null;
      break;
    case 'run_error':
      status.value = 'error';
      errorMsg.value = evt.message ?? '未知错误';
      connected.value = false;
      break;
    default:
      break;
  }
}

/** 交互回写闭环：widget 内点击/提交 -> 同一 aguiBus -> 立刻追加一条 system 消息。 */
function handleWidgetAction(e: {
  app: string;
  value: string;
  slotId: string;
  label?: string;
}): void {
  const label = isAllowedApp(e.app) ? widgetLabelOf(e.app) : e.app;
  const safe = e.value.replace(/[`*_[\]<>\n\r]/g, ' ').slice(0, 120);
  messages.value.push({
    id: genId(),
    role: 'system',
    content: `✅ 你在 **${label}** 中选择了：\`${safe}\``,
    streaming: false,
    status: 'done',
    tools: [],
  });
}

function start(): void {
  if (connected.value) return;
  controller?.abort();
  // 清理上一轮遗留的孤儿 handle（DOM 已移除但 Map 里还在）——重跑无泄漏。
  // 注意：保留历史消息，所以上一轮 widget 的点击/输入状态不会被清空。
  releaseDisconnectedHandles();
  errorMsg.value = '';
  status.value = 'thinking';
  connected.value = true;
  activeMessageId = null;
  controller = new AbortController();

  connectSse({
    endpoint: props.endpoint,
    mcpKey: props.mcpKey,
    method: 'POST',
    signal: controller.signal,
    onEvent: (evt) => aguiBus.emit(evt.type, evt),
    onError: (e) => {
      errorMsg.value = e.message;
      status.value = 'error';
      connected.value = false;
    },
    onDone: () => {
      connected.value = false;
      if (status.value === 'thinking' || status.value === 'executing') status.value = 'done';
    },
  });
}

function stop(): void {
  controller?.abort();
  controller = null;
  connected.value = false;
  const m = messages.value.find((x) => x.id === activeMessageId);
  if (m) m.streaming = false; // 停止生成后强制渲染未闭合尾块
  activeMessageId = null;
}

/** 清空会话：Vue 卸载所有 WidgetSlot -> onUnmounted -> unmountWidget -> LoadTrace 可见卸载三连 */
function clearConversation(): void {
  stop();
  messages.value = [];
  status.value = 'idle';
  activeMessageId = null;
  unmountAllWidgets();
}

const statusText = computed(
  () =>
    ({
      idle: '空闲',
      thinking: '思考中',
      executing: '执行中',
      waiting: '等待确认',
      done: '已完成',
      error: '出错',
    })[status.value],
);
const statusClass = computed(() => `is-${status.value}`);

onMounted(() => {
  unsubs.push(aguiBus.on('run_started', handleEvent));
  unsubs.push(aguiBus.on('text_message_start', handleEvent));
  unsubs.push(aguiBus.on('text_message_content', handleEvent));
  unsubs.push(aguiBus.on('text_message_end', handleEvent));
  unsubs.push(aguiBus.on('tool_call_start', handleEvent));
  unsubs.push(aguiBus.on('tool_call_args', handleEvent));
  unsubs.push(aguiBus.on('tool_call_end', handleEvent));
  unsubs.push(aguiBus.on('state_snapshot', handleEvent));
  unsubs.push(aguiBus.on('run_finished', handleEvent));
  unsubs.push(aguiBus.on('run_error', handleEvent));
  unsubs.push(aguiBus.on('widget_action', handleWidgetAction));
  if (props.autoConnect) start();
});

onUnmounted(() => {
  unsubs.forEach((u) => u());
  stop();
  unmountAllWidgets();
});
</script>

<template>
  <section class="agent-panel">
    <header class="agent-panel__head">
      <div class="agent-panel__title">
        <span class="brand-dot" /> AI Agent 流式 Markdown · markdown 内嵌可交互微前端
      </div>
      <div class="agent-panel__status" :class="statusClass">
        <span class="status-dot" /> {{ statusText }}
      </div>
    </header>

    <div class="agent-panel__grid">
      <MessageList :messages="messages" class="agent-panel__list" />
      <LoadTrace />
    </div>

    <footer class="agent-panel__foot">
      <button v-if="!connected" class="btn btn--primary" @click="start">开始对话</button>
      <button v-else class="btn" @click="stop">停止生成</button>
      <button class="btn btn--ghost" :disabled="!messages.length" @click="clearConversation">
        清空会话（卸载全部 widget）
      </button>
      <span v-if="errorMsg" class="agent-panel__err">⚠ {{ errorMsg }}</span>
    </footer>
  </section>
</template>
