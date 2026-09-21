<template>
  <div class="chat">
    <!-- 页头：会话标题 + agent 徽标 + 新对话（隐藏全局页头，本页自带） -->
    <header class="chat-head">
      <div class="head-main">
        <h1 class="chat-title">{{ title }}</h1>
        <span v-if="agentBadge" class="badge">{{ agentBadge }}</span>
      </div>
      <span class="spacer" />
      <button type="button" class="btn-primary" @click="newChat">
        <app-icon name="plus" />
        <span>新对话</span>
      </button>
    </header>

    <div ref="bodyRef" class="chat-body">
      <!-- 空态：欢迎语 + 示例问题（有出路，非灰字） -->
      <div v-if="showEmpty" class="chat-empty">
        <h2>你好{{ userName ? `，${userName}` : '' }}</h2>
        <p>描述你的问题，或直接选择一个示例开始</p>
        <div class="examples">
          <button v-for="q in EXAMPLES" :key="q" type="button" class="example" @click="send(q)">
            {{ q }}
          </button>
        </div>
      </div>

      <div v-if="detailError" class="load-error">
        <span>会话加载失败，请检查网络后重试</span>
        <button type="button" class="act" @click="reload">重试</button>
      </div>

      <div v-else class="msgs">
        <div v-for="(m, i) in messages" :key="m.id" class="msg" :class="m.role === 'user' ? 'me' : 'ai'">
          <div class="who">{{ m.role === 'user' ? userInitial : 'AI' }}</div>
          <div class="msg-main">
            <div class="bubble">
              <div v-if="m.role === 'assistant'" class="bubble-head">
                <span class="badge">{{ m.agentName || '助手' }}</span>
              </div>
              <span v-if="m.content" class="bubble-text">{{ m.content }}</span>
              <span v-else-if="m.streaming" class="thinking"><i /><i /><i /></span>
              <span v-else-if="m.failed" class="bubble-failed">生成失败，请重试</span>
            </div>
            <div class="acts">
              <button type="button" class="act" @click="copy(m.content)">复制</button>
              <button v-if="m.role === 'assistant'" type="button" class="act" @click="retry(i)">
                重新生成
              </button>
              <span v-if="m.stopped" class="stopped">已停止</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区：⌘Enter 发送；生成中禁用发送（防重复提交） -->
    <div class="composer">
      <div class="composer-box">
        <textarea
          v-model="input"
          class="composer-input"
          placeholder="描述你的问题，⌘Enter 发送"
          @keydown="onKeydown"
        />
        <div class="composer-row">
          <span class="hint">⌘Enter 发送 · ⌘K 命令面板</span>
          <span class="spacer" />
          <button v-if="sending" type="button" class="btn-stop" @click="stop">
            <app-icon name="stop" />
            <span>停止</span>
          </button>
          <button v-else type="button" class="btn-primary btn-sm" :disabled="!canSend" @click="send(input)">
            <app-icon name="arrow" />
            <span>发送</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import { getConversation, runAgentStream } from '@/api/agent';
import { useConversationStore } from '@/stores/conversations';
import { useUserStore } from '@/stores/user';
import AppIcon from '@/components/AppIcon.vue';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 作答 agent 展示名（来自 intent 事件）；历史消息无此信息则不展示徽标 */
  agentName?: string;
  streaming?: boolean;
  stopped?: boolean;
  failed?: boolean;
}

const EXAMPLES = [
  '帮我看看这份租赁合同有什么风险',
  '把这段产品文案翻译成商务英语',
  '解释一下竞业限制条款的有效条件',
];

const store = useConversationStore();
const userStore = useUserStore();

const bodyRef = ref<HTMLElement | null>(null);
const messages = ref<ChatMsg[]>([]);
const input = ref('');
const sending = ref(false);
const convId = ref<string | null>(null);
/** 已加载详情的会话 id：避免「自己刚创建的会话」被 watch 二次拉取导致闪烁 */
const loadedId = ref<string | null>(null);
const agentBadge = ref('');
const detailError = ref(false);

let controller: AbortController | null = null;
let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

const userName = computed(() => userStore.userInfo?.username || '');
const userInitial = computed(() => (userName.value ? userName.value.slice(0, 1).toUpperCase() : '我'));
const canSend = computed(() => input.value.trim().length > 0);

const showEmpty = computed(() => messages.value.length === 0);

/** 标题：会话实体标题优先，无标题取首条用户消息截断 20 字 */
const title = computed(() => {
  const stored = store.titleOf(store.currentId);
  if (stored?.trim()) return stored.trim();
  const first = messages.value.find((m) => m.role === 'user');
  if (!first) return '新对话';
  const text = first.content.trim();
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
});

function scrollToBottom() {
  const el = bodyRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

async function copy(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动选择文本');
  }
}

function newChat() {
  controller?.abort();
  controller = null;
  sending.value = false;
  store.setRunning(false);
  store.startNew();
  convId.value = null;
  loadedId.value = null;
  messages.value = [];
  agentBadge.value = '';
  input.value = '';
}

/** 载入历史会话（统一会话流：不区分类型） */
async function loadConversation(id: string) {
  detailError.value = false;
  try {
    const detail = await getConversation(id);
    convId.value = id;
    loadedId.value = id;
    messages.value = (detail.messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ id: uid(), role: m.role as 'user' | 'assistant', content: m.content }));
    agentBadge.value = '';
    nextTick(scrollToBottom);
  } catch {
    detailError.value = true;
    message.error('会话加载失败，请重试');
  }
}

function send(text: string) {
  const content = text.trim();
  if (!content || sending.value) return;

  input.value = '';
  messages.value.push({ id: uid(), role: 'user', content });
  messages.value.push({ id: uid(), role: 'assistant', content: '', streaming: true });
  // 取响应式代理（不能直接改 push 前的原始对象，否则不触发更新）
  const reply = messages.value[messages.value.length - 1];
  sending.value = true;
  store.setRunning(true);
  nextTick(scrollToBottom);

  controller = runAgentStream(
    // agentId 交给后端意图路由（page-spec §2）；工具页（翻译 / 合翻）在 P2/P3 显式指定
    { userInput: content, agentId: 'auto', conversationId: convId.value || undefined },
    {
      onIntent(intent) {
        reply.agentName = intent.agentName || '';
        agentBadge.value = intent.agentName || '';
      },
      onDelta(delta) {
        reply.content += delta;
        void nextTick(scrollToBottom);
      },
      onDone(conversationId) {
        reply.streaming = false;
        sending.value = false;
        store.setRunning(false);
        controller = null;
        if (conversationId) {
          convId.value = conversationId;
          loadedId.value = conversationId;
          store.select(conversationId);
          // 刷新列表：后端异步生成标题，首轮后左栏应显示新会话
          void store.load();
        }
      },
      onError(err) {
        reply.streaming = false;
        reply.failed = true;
        sending.value = false;
        store.setRunning(false);
        controller = null;
        message.error(err.message || '生成失败，请重试');
      },
    },
  );
}

function stop() {
  controller?.abort();
  controller = null;
  sending.value = false;
  store.setRunning(false);
  const last = messages.value[messages.value.length - 1];
  if (last?.role === 'assistant') {
    last.streaming = false;
    last.stopped = true;
  }
}

function reload() {
  if (store.currentId) void loadConversation(store.currentId);
}

/** 失败重试：去掉失败消息及其之后的内容，重发该轮用户消息 */
function retry(index: number) {
  const target = messages.value[index];
  if (!target || target.role !== 'assistant') return;
  const userMsg = [...messages.value.slice(0, index)].reverse().find((m) => m.role === 'user');
  if (!userMsg) return;
  messages.value.splice(index);
  agentBadge.value = '';
  send(userMsg.content);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    send(input.value);
  }
}

watch(
  () => store.currentId,
  (id) => {
    if (!id) {
      if (convId.value) newChat();
      return;
    }
    if (id !== loadedId.value) void loadConversation(id);
  },
);

onMounted(() => {
  if (store.currentId) void loadConversation(store.currentId);
  else if (store.items.length === 0) void store.load();
});

// 离开页面时中断未完成的流，并解除「生成中」锁（否则删除入口会一直禁用）
onBeforeUnmount(() => {
  controller?.abort();
  controller = null;
  store.setRunning(false);
});
</script>

<style scoped>
.chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ===== 页头 ===== */
.chat-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
}

.head-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-title {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ws-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 500;
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  display: inline-flex;
  align-items: center;
}

.spacer {
  flex: 1;
}

/* ===== 消息流：阅读限宽 760px ===== */
.chat-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}

.msgs {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.msg {
  display: flex;
  gap: 12px;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
}

.msg.me {
  flex-direction: row-reverse;
}

.who {
  width: 28px;
  height: 28px;
  border-radius: var(--ws-radius-md);
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.msg.ai .who {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
}

.msg.me .who {
  background: var(--ws-bg-subtle);
  color: var(--ws-text-secondary);
}

.msg-main {
  min-width: 0;
}

.bubble {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  padding: 12px 16px;
  font-size: 14px;
  background: var(--ws-bg-surface);
  color: var(--ws-text-primary);
}

.msg.me .bubble {
  background: var(--ws-brand-500);
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-50);
}

.bubble-head {
  margin-bottom: 6px;
}

.bubble-text {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

.bubble-failed {
  color: var(--ws-error-500);
}

/* 思考动点（非全屏 loading） */
.thinking {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.thinking i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ws-brand-500);
  animation: blink 1.2s infinite;
}

.thinking i:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes blink {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

.acts {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.msg:hover .acts {
  opacity: 1;
}

.act {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--ws-radius-sm);
  font-size: 12px;
  color: var(--ws-text-tertiary);
  background: transparent;
}

.act:hover {
  background: var(--ws-bg-hover);
  color: var(--ws-brand-700);
}

.stopped {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.load-error {
  max-width: 480px;
  margin: 48px auto;
  padding: 16px;
  border: 1px solid var(--ws-error-500);
  border-radius: var(--ws-radius-lg);
  background: var(--ws-error-100);
  color: var(--ws-text-secondary);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* ===== 空态 ===== */
.chat-empty {
  max-width: 560px;
  margin: 8px auto;
  text-align: center;
  padding: 48px 0;
}

.chat-empty h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}

.chat-empty p {
  color: var(--ws-text-secondary);
  margin-bottom: 24px;
}

.examples {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
  margin: 0 auto;
}

.example {
  text-align: left;
  padding: 12px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  background: var(--ws-bg-surface);
  font-size: 14px;
  color: var(--ws-text-primary);
  transition: border-color 0.15s ease, color 0.15s ease;
}

.example:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-700);
}

/* ===== 输入区 ===== */
.composer {
  flex: 0 0 auto;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
  padding: 16px 24px;
}

.composer-box {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  padding: 12px;
  background: var(--ws-bg-surface);
  max-width: 760px;
  margin: 0 auto;
}

.composer-input {
  width: 100%;
  border: 0;
  outline: none;
  resize: none;
  min-height: 56px;
  background: transparent;
  color: var(--ws-text-primary);
  font-size: 14px;
  line-height: 1.6;
}

.composer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s ease;
}

.btn-primary:hover:not(:disabled) {
  background: var(--ws-brand-600);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  height: 28px;
  padding: 0 12px;
  font-size: 13px;
}

.btn-stop {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--ws-radius-md);
  border: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
  color: var(--ws-text-secondary);
  font-size: 13px;
}

.btn-stop:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-700);
}
</style>
