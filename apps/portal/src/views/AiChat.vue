<template>
  <div class="ai-chat-page">
    <!-- 左侧历史对话栏 -->
    <aside class="chat-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="sidebar-brand" @click="router.push('/')">
          <img src="/logo.svg" alt="科豆 AI" class="brand-logo" width="28" height="15" />
          <span class="brand-text">科豆 AI</span>
        </div>
        <button class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed">
          <svg v-if="sidebarCollapsed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <button class="new-chat-btn" @click="startNewChat">
        <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span v-if="!sidebarCollapsed">新建对话</span>
      </button>

      <div v-if="!sidebarCollapsed" class="conversation-list">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="conversation-item"
          :class="{ active: conv.id === activeConversationId }"
          @click="selectConversation(conv)"
        >
          <div class="conv-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="conv-content">
            <div class="conv-title">{{ conv.title || '新对话' }}</div>
            <div class="conv-time">{{ formatTime(conv.updatedAt) }}</div>
          </div>
          <button class="conv-delete" @click.stop="handleDeleteConversation(conv.id)" title="删除对话">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>

        <!-- 加载更多 -->
        <div v-if="loadingConversations" class="conv-loading">
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
        </div>

        <!-- 空状态 -->
        <div v-if="!loadingConversations && conversations.length === 0" class="conv-empty">
          <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          <p>暂无对话记录</p>
        </div>
      </div>
    </aside>

    <!-- 主聊天区域 -->
    <main class="chat-main">
      <!-- 顶部导航 -->
      <nav class="chat-navbar">
        <div class="nav-left">
          <button v-if="sidebarCollapsed" class="menu-btn" @click="sidebarCollapsed = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <h2 class="nav-title">AI 学习助手</h2>
          <div v-if="availableModels.length > 0" class="model-selector-wrapper">
            <button class="model-selector-btn" @click="showModelSelector = !showModelSelector">
              <svg class="model-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="18" height="20" rx="2" ry="2"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="2"/></svg>
              <span class="model-name">{{ getSelectedModelName() }}</span>
              <svg class="model-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <Transition name="model-drop">
              <div v-if="showModelSelector" class="model-dropdown">
                <div
                  v-for="m in availableModels"
                  :key="m.id"
                  class="model-option"
                  :class="{ active: m.id === selectedModel }"
                  @click="selectedModel = m.id; showModelSelector = false"
                >
                  <span class="model-opt-icon">
                    <svg v-if="m.id === selectedModel" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ECDC4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="18" height="20" rx="2" ry="2"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="2"/></svg>
                  </span>
                  <div class="model-opt-info">
                    <span class="model-opt-name">{{ m.displayName }}</span>
                    <span class="model-opt-desc">{{ m.description }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
        <div class="nav-right">
          <!-- 全局导航由 AppNavbar 提供；这里只保留上下文相关按钮（如新建对话） -->
        </div>
      </nav>

      <!-- 聊天内容区 -->
      <div class="chat-content" ref="chatContentRef">
        <!-- 欢迎页 -->
        <div v-if="!activeConversationId" class="welcome-section">
          <div class="welcome-icon">
            <img src="/logo.svg" alt="AI" class="welcome-logo" width="80" height="43" />
          </div>
          <h1 class="welcome-title">你好，我是科豆学习助手</h1>
          <p class="welcome-desc">选一个话题开始对话，或者直接问我任何学习问题吧！</p>
          <div class="suggestion-grid">
            <button
              v-for="item in quickStarts"
              :key="item.id"
              class="suggestion-card"
              @click="quickStart(item.prompt)"
            >
              <span class="suggestion-icon" v-html="item.icon"></span>
              <span class="suggestion-label">{{ item.label }}</span>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="messages-area" @click="handleSpeakClick">
          <TransitionGroup name="msg-fade">
            <div
              v-for="(msg, idx) in currentMessages"
              :key="idx"
              class="message-row"
              :class="msg.role"
            >
              <div class="message-avatar">
                <template v-if="msg.role === 'user'">
                  <div class="avatar-user">我</div>
                </template>
                <template v-else-if="msg.role === 'assistant'">
                  <img src="/logo.svg" alt="AI" class="avatar-ai" width="32" height="17" />
                </template>
              </div>
              <div class="message-bubble">
                <div v-if="msg.content" class="message-content" v-html="renderContent(msg.content)"></div>
                <div v-else-if="msg.role === 'assistant' && isTyping && idx === currentMessages.length - 1" class="typing-bubble">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </div>
              </div>
            </div>
          </TransitionGroup>

          <!-- loading 动画内嵌到最后一条 assistant 消息中，不再单独显示 -->
          <div v-if="isTyping && currentMessages.length === 0" class="message-row assistant">
            <div class="message-avatar">
              <img src="/logo.svg" alt="AI" class="avatar-ai" width="32" height="17" />
            </div>
            <div class="message-bubble typing-bubble">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区域 -->
      <div class="chat-input-area" v-if="activeConversationId">
        <div class="input-wrapper">
          <textarea
            v-model="inputMessage"
            class="chat-input"
            placeholder="输入你的问题..."
            :rows="1"
            ref="inputRef"
            @keydown.enter.exact.prevent="handleSend"
            @input="autoResize"
          ></textarea>
          <button
            class="send-btn"
            :disabled="!inputMessage.trim() || isTyping"
            @click="handleSend"
            :class="{ disabled: !inputMessage.trim() || isTyping }"
          >
            <svg class="send-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <p class="input-hint">AI 学习助手能帮你答疑解惑、探索知识</p>
      </div>
      <div v-else class="start-input-area">
        <div class="input-wrapper">
          <textarea
            v-model="inputMessage"
            class="chat-input"
            placeholder="直接输入问题开始对话..."
            :rows="1"
            ref="inputRef"
            @keydown.enter.exact.prevent="handleStartChat"
            @input="autoResize"
          ></textarea>
          <button
            class="send-btn"
            :disabled="!inputMessage.trim() || isTyping"
            @click="handleStartChat"
            :class="{ disabled: !inputMessage.trim() || isTyping }"
          >
            <svg class="send-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <p class="input-hint">直接问问题，自动开启新对话</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  sendChatMessage,
  sendChatMessageStream,
  getConversations,
  getConversation,
  deleteConversation,
  fetchModels,
  type ChatMessage,
  type ConversationSummary,
  type ModelInfo,
} from '@/api/ai';

const router = useRouter();

// --- 状态 ---
const sidebarCollapsed = ref(false);
const inputMessage = ref('');
const isTyping = ref(false);
const activeConversationId = ref<string>('');
const currentMessages = ref<ChatMessage[]>([]);
const conversations = ref<ConversationSummary[]>([]);
const loadingConversations = ref(false);
const abortController = ref<AbortController | null>(null);

// --- 模型选择 ---
const availableModels = ref<ModelInfo[]>([]);
const selectedModel = ref<string>('');
const showModelSelector = ref(false);

const chatContentRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

// --- 快捷提问 ---
const quickStarts = [
  { id: 1, icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/><text x="8" y="16" font-size="10" fill="currentColor" stroke="none">123</text></svg>', label: '数学问题', prompt: '什么是质数？请用简单的方式解释' },
  { id: 2, icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', label: '科学探索', prompt: '为什么天空是蓝色的？' },
  { id: 3, icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>', label: '写作帮助', prompt: '请帮我写一段关于春天的短文' },
  { id: 4, icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.95.5 2.5 2.5 0 0 1-2.45-2V4.5A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.95.5 2.5 2.5 0 0 0 2.45-2V4.5A2.5 2.5 0 0 0 14.5 2z"/></svg>', label: '学习方法', prompt: '有什么好的记忆方法推荐吗？' },
  { id: 5, icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><polygon points="12 2 12 8 12 22" fill="currentColor" opacity="0.2" stroke="none"/></svg>', label: '创意灵感', prompt: '给我推荐一些适合小学生的创意手工活动' },
  { id: 6, icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><text x="7" y="16" font-size="9" fill="currentColor" stroke="none" font-family="sans-serif">Aa</text></svg>', label: '英语学习', prompt: '如何用英语做自我介绍？请举例' },
];

// --- 生命周期 ---
onMounted(() => {
  loadConversations();
  loadModels();
});

watch(activeConversationId, () => {
  nextTick(scrollToBottom);
});

// --- 方法 ---
async function loadConversations() {
  loadingConversations.value = true;
  try {
    const res = await getConversations();
    conversations.value = res.data?.list || [];
  } catch {
    // 静默失败
  } finally {
    loadingConversations.value = false;
  }
}

async function loadModels() {
  try {
    const res = await fetchModels();
    availableModels.value = res.models.filter((m) => m.available);
    selectedModel.value = res.defaultModel || availableModels.value[0]?.id || '';
  } catch {
    // 静默失败，模型选择器不会显示
  }
}

function getSelectedModelName(): string {
  const m = availableModels.value.find((m) => m.id === selectedModel.value);
  return m?.displayName || '默认模型';
}

async function selectConversation(conv: ConversationSummary) {
  if (conv.id === activeConversationId.value) return;
  activeConversationId.value = conv.id;
  try {
    const res = await getConversation(conv.id);
    currentMessages.value = res.data.messages || [];
    await nextTick(scrollToBottom);
  } catch {
    message.error('加载对话失败');
  }
}

function startNewChat() {
  activeConversationId.value = '';
  currentMessages.value = [];
  inputMessage.value = '';
  nextTick(() => inputRef.value?.focus());
}

async function handleDeleteConversation(id: string) {
  try {
    await deleteConversation(id);
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (activeConversationId.value === id) {
      startNewChat();
    }
    message.success('已删除');
  } catch {
    message.error('删除失败');
  }
}

function quickStart(prompt: string) {
  inputMessage.value = prompt;
  handleStartChat();
}

async function handleStartChat() {
  const msg = inputMessage.value.trim();
  if (!msg || isTyping.value) return;

  inputMessage.value = '';

  // 设置临时活跃对话ID，触发 v-if 切换到 messages-area
  activeConversationId.value = 'new';

  // 添加用户消息到界面
  currentMessages.value = [{ role: 'user', content: msg }];
  isTyping.value = true;

  // 添加空的 AI 消息占位，后续逐步填充
  currentMessages.value.push({ role: 'assistant', content: '' });
  await nextTick(scrollToBottom);

  try {
    abortController.value = sendChatMessageStream(
      {
        messages: [{ role: 'user', content: msg }],
        model: selectedModel.value || undefined,
      },
      // onChunk: 逐块追加到 AI 消息
      (text) => {
        const lastIdx = currentMessages.value.length - 1;
        const updated = [...currentMessages.value];
        updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + text };
        currentMessages.value = updated;
        nextTick(scrollToBottom);
      },
      // onDone: 流结束
      (convId) => {
        isTyping.value = false;
        abortController.value = null;
        // 从 SSE 尾部拿到真实 conversationId，后续消息可正确续传
        if (convId) {
          activeConversationId.value = convId;
        }
        loadConversations();
        nextTick(scrollToBottom);
      },
      // onError: 出错
      (err) => {
        isTyping.value = false;
        abortController.value = null;
        const updated = [...currentMessages.value];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && !updated[lastIdx].content) {
          updated[lastIdx] = { ...updated[lastIdx], content: `抱歉，AI 服务暂不可用：${err.message}` };
        }
        currentMessages.value = updated;
        message.error('对话出错了');
        nextTick(scrollToBottom);
      },
    );
  } catch (error: any) {
    isTyping.value = false;
    const errMsg = error?.response?.data?.message || 'AI 服务暂不可用，请稍后再试';
    const updated = [...currentMessages.value];
    const lastIdx = updated.length - 1;
    if (updated[lastIdx]?.role === 'assistant') {
      updated[lastIdx] = { ...updated[lastIdx], content: `抱歉，${errMsg}` };
    } else {
      updated.push({ role: 'assistant', content: `抱歉，${errMsg}` });
    }
    currentMessages.value = updated;
    message.error('消息发送失败');
    await nextTick(scrollToBottom);
  }
}

async function handleSend() {
  const msg = inputMessage.value.trim();
  if (!msg || isTyping.value) return;

  if (!activeConversationId.value) {
    await handleStartChat();
    return;
  }

  inputMessage.value = '';

  // 添加用户消息
  currentMessages.value.push({ role: 'user', content: msg });
  isTyping.value = true;

  // 添加空的 AI 消息占位
  currentMessages.value.push({ role: 'assistant', content: '' });
  await nextTick(scrollToBottom);

  try {
    // 构建消息历史（不含 system prompt，服务端会添加）
    const messagesList: ChatMessage[] = currentMessages.value.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // 去掉最后一个空消息
    messagesList.pop();

    abortController.value = sendChatMessageStream(
      {
        conversationId: activeConversationId.value,
        messages: messagesList,
        model: selectedModel.value || undefined,
      },
      // onChunk
      (text) => {
        const lastIdx = currentMessages.value.length - 1;
        const updated = [...currentMessages.value];
        updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + text };
        currentMessages.value = updated;
        nextTick(scrollToBottom);
      },
      // onDone
      (_convId) => {
        isTyping.value = false;
        abortController.value = null;
        loadConversations();
        nextTick(scrollToBottom);
      },
      // onError
      (err) => {
        isTyping.value = false;
        abortController.value = null;
        const updated = [...currentMessages.value];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && !updated[lastIdx].content) {
          updated[lastIdx] = { ...updated[lastIdx], content: `抱歉，AI 服务暂不可用：${err.message}` };
        }
        currentMessages.value = updated;
        nextTick(scrollToBottom);
      },
    );
  } catch (error: any) {
    isTyping.value = false;
    const errMsg = error?.response?.data?.message || 'AI 服务暂不可用';
    currentMessages.value.push({
      role: 'assistant',
      content: `抱歉，${errMsg}`,
    });
  } finally {
    await nextTick(scrollToBottom);
  }
}

function autoResize() {
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto';
      inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 120) + 'px';
    }
  });
}

function scrollToBottom() {
  if (chatContentRef.value) {
    chatContentRef.value.scrollTop = chatContentRef.value.scrollHeight;
  }
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN');
}

/** 当前正在播放的 Audio 实例，用于停止上一个播放 */
let currentAudio: HTMLAudioElement | null = null;

function renderContent(content: string): string {
  if (!content) return '';

  // 步骤 1：提取 AI 标记的 [en]...[/en] 英语片段，用占位符保护
  // AI 在 system prompt 中被要求将所有英语句子/短语用 [en]...[/en] 包裹
  const enMap = new Map<string, string>();
  let enIdx = 0;
  const EN_TAG_RE = /\[en\]([\s\S]*?)\[\/en\]/g;
  const protectedContent = content.replace(EN_TAG_RE, (_full: string, match: string) => {
      const key = `___EN${enIdx++}___`;
      enMap.set(key, match.trim());
      return key;
    });

  // 步骤 2：转 markdown 为 HTML
  let html = protectedContent
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  // 步骤 3：恢复占位符为带播放按钮的 HTML
  enMap.forEach((text, key) => {
    const escaped = escapeAttr(text);
    const speakerSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
      '<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
      '</svg>';
    const replacement =
      `<span class="en-speak-group"><span class="en-text">${text}</span>` +
      `<button class="speak-btn" data-en-text="${escaped}" type="button" title="点击播放发音" aria-label="播放英语发音">${speakerSvg}</button></span>`;
    html = html.replace(key, replacement);
  });

  return html;
}

/** 转义 HTML 属性值中的特殊字符 */
function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 调用后端腾讯云 TTS 接口朗读英语文本 */
async function handleSpeakClick(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  const btn = target.closest('.speak-btn') as HTMLElement | null;
  if (!btn) return;

  const text = btn.getAttribute('data-en-text');
  if (!text) return;

  // 停止上一个播放
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  // 清除所有按钮的播放状态
  document.querySelectorAll('.speak-btn.speaking').forEach((el) => el.classList.remove('speaking'));

  btn.classList.add('speaking');

  const token = localStorage.getItem('access_token');

  try {
    const response = await fetch('/api/ai/tts/speak', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'TTS 服务请求失败' }));
      throw new Error(errorData.message || `请求失败 (${response.status})`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      btn.classList.remove('speaking');
      currentAudio = null;
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      btn.classList.remove('speaking');
      currentAudio = null;
    };

    await audio.play();
  } catch (error: any) {
    btn.classList.remove('speaking');
    currentAudio = null;
    console.error('TTS 播放失败:', error.message);
  }
}
</script>

<style scoped>
/* ========== 页面布局 ========== */
.ai-chat-page {
  display: flex;
  height: 100vh;
  background: linear-gradient(180deg, #FFFBF5 0%, #FFF8F0 100%);
  overflow: hidden;
}

/* ========== 左侧边栏 ========== */
.chat-sidebar {
  width: 280px;
  min-width: 280px;
  background: #fff;
  border-right: 1px solid rgba(255, 140, 66, 0.08);
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  position: relative;
  z-index: 10;
}

.chat-sidebar.collapsed {
  width: 56px;
  min-width: 56px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 140, 66, 0.06);
  min-height: 60px;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  overflow: hidden;
}

.brand-logo {
  flex-shrink: 0;
  border-radius: 6px;
}

.brand-text {
  font-size: 16px;
  font-weight: 700;
  color: #FF8C42;
  white-space: nowrap;
}

.sidebar-toggle {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 6px;
  background: transparent;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.sidebar-toggle:hover {
  color: #FF8C42;
  border-color: rgba(255, 140, 66, 0.3);
}

/* 新建对话按钮 */
.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px;
  padding: 10px 14px;
  background: rgba(255, 140, 66, 0.08);
  border: 1px solid rgba(255, 140, 66, 0.15);
  border-radius: 10px;
  color: #FF8C42;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s;
  white-space: nowrap;
  overflow: hidden;
}

.new-chat-btn:hover {
  background: rgba(255, 140, 66, 0.15);
  border-color: rgba(255, 140, 66, 0.3);
  box-shadow: 0 0 16px rgba(255, 140, 66, 0.1);
}

.btn-icon {
  font-size: 16px;
  font-weight: 700;
}

.chat-sidebar.collapsed .new-chat-btn {
  justify-content: center;
  padding: 10px;
  border-radius: 10px;
}

/* 对话列表 */
.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.conversation-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 2px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.conversation-item:hover {
  background: rgba(255, 140, 66, 0.04);
}

.conversation-item.active {
  background: rgba(255, 140, 66, 0.08);
  border: 1px solid rgba(255, 140, 66, 0.12);
}

.conv-icon {
  font-size: 18px;
  flex-shrink: 0;
  color: #888;
}

.conv-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.conv-title {
  font-size: 13px;
  color: #333;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-time {
  font-size: 11px;
  color: #bbb;
  margin-top: 2px;
}

.conv-delete {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #bbb;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s;
  flex-shrink: 0;
}

.conversation-item:hover .conv-delete {
  opacity: 1;
}

.conv-delete:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.conv-loading,
.conv-empty {
  text-align: center;
  padding: 24px 12px;
}

.conv-empty {
  color: #bbb;
}

.conv-empty .empty-icon {
  font-size: 28px;
  display: block;
  margin-bottom: 8px;
}

.conv-empty p {
  font-size: 13px;
  margin: 0;
}

/* loading 点 */
.loading-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #FF8C42;
  margin: 0 3px;
  animation: dotPulse 1.4s infinite ease-in-out both;
}

.loading-dot:nth-child(1) { animation-delay: -0.32s; }
.loading-dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes dotPulse {
  0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
  40% { transform: scale(1); opacity: 1; }
}

/* ========== 主聊天区 ========== */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: linear-gradient(180deg, #FFFBF5 0%, #FFF8F0 100%);
}

/* 顶部导航 */
.chat-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 60px;
  border-bottom: 1px solid rgba(255, 140, 66, 0.06);
  background: rgba(255, 248, 240, 0.8);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 8px;
  background: transparent;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.menu-btn:hover {
  color: #FF8C42;
  border-color: rgba(255, 140, 66, 0.3);
}

.nav-title {
  font-size: 17px;
  font-weight: 700;
  color: #333;
  margin: 0;
}

.nav-right {
  display: flex;
  gap: 20px;
}

.nav-link {
  text-decoration: none;
  color: #999;
  font-size: 14px;
  font-weight: 500;
  transition: color 0.2s;
}

.nav-link:hover {
  color: #FF8C42;
}

/* 模型选择器 */
.model-selector-wrapper {
  position: relative;
  margin-left: 8px;
}

.model-selector-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 8px;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.model-selector-btn:hover {
  background: rgba(255, 140, 66, 0.06);
  border-color: rgba(255, 140, 66, 0.2);
  color: #FF8C42;
}

.model-icon {
  font-size: 14px;
}

.model-name {
  font-weight: 500;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-arrow {
  font-size: 10px;
  opacity: 0.6;
}

.model-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 240px;
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.12);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(255, 140, 66, 0.1);
  padding: 6px;
  z-index: 50;
}

.model-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-option:hover {
  background: rgba(255, 140, 66, 0.06);
}

.model-option.active {
  background: rgba(255, 140, 66, 0.08);
}

.model-opt-icon {
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.model-opt-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-opt-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.model-opt-desc {
  font-size: 11px;
  color: #aaa;
  line-height: 1.4;
}

.model-drop-enter-active,
.model-drop-leave-active {
  transition: all 0.2s ease;
}

.model-drop-enter-from,
.model-drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 聊天内容区 */
.chat-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

/* ========== 欢迎页 ========== */
.welcome-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 20px;
  text-align: center;
}

.welcome-icon {
  margin-bottom: 24px;
  padding: 20px;
  background: rgba(255, 140, 66, 0.06);
  border-radius: 24px;
}

.welcome-logo {
  border-radius: 10px;
}

.welcome-title {
  font-size: 26px;
  font-weight: 700;
  color: #333;
  margin: 0 0 12px;
}

.welcome-desc {
  font-size: 15px;
  color: #888;
  margin: 0 0 32px;
  max-width: 400px;
  line-height: 1.6;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  max-width: 560px;
  width: 100%;
}

@media (max-width: 640px) {
  .suggestion-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.suggestion-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 12px;
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.08);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.3s;
  color: #666;
  box-shadow: 0 2px 8px rgba(255, 140, 66, 0.03);
}

.suggestion-card:hover {
  background: rgba(255, 140, 66, 0.06);
  border-color: rgba(255, 140, 66, 0.25);
  color: #FF8C42;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 140, 66, 0.08);
}

.suggestion-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.suggestion-label {
  font-size: 13px;
  font-weight: 500;
}

/* ========== 消息区域 ========== */
.messages-area {
  padding: 24px 0;
  max-width: 780px;
  margin: 0 auto;
}

.message-row {
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  animation: msgSlide 0.3s ease;
}

@keyframes msgSlide {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-row.user {
  flex-direction: row-reverse;
}

.message-row.user .message-bubble {
  background: rgba(255, 140, 66, 0.1);
  border: 1px solid rgba(255, 140, 66, 0.15);
  color: #333;
  border-bottom-right-radius: 4px;
}

.message-row.assistant .message-bubble {
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.08);
  color: #555;
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 8px rgba(255, 140, 66, 0.04);
}

/* msg-fade 过渡 */
.msg-fade-enter-active,
.msg-fade-leave-active {
  transition: all 0.3s ease;
}
.msg-fade-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.message-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-user {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-ai {
  border-radius: 6px;
}

.message-bubble {
  max-width: 75%;
  padding: 14px 18px;
  border-radius: 16px;
  line-height: 1.7;
  font-size: 15px;
  word-break: break-word;
}

.message-content :deep(strong) {
  color: #FF8C42;
  font-weight: 600;
}

.message-content :deep(em) {
  color: #888;
}

/* ========== 英语发音播放按钮 ========== */
.message-content :deep(.en-speak-group) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
}

.message-content :deep(.en-speak-group .en-text) {
  color: #4ECDC4;
  font-weight: 500;
}

.message-content :deep(.speak-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(78, 205, 196, 0.1);
  color: #4ECDC4;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.message-content :deep(.speak-btn:hover) {
  background: rgba(78, 205, 196, 0.2);
  border-color: rgba(78, 205, 196, 0.3);
  transform: scale(1.1);
}

.message-content :deep(.speak-btn.speaking) {
  background: rgba(78, 205, 196, 0.3);
  border-color: #4ECDC4;
  animation: speakPulse 0.8s infinite ease-in-out;
}

@keyframes speakPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(78, 205, 196, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(78, 205, 196, 0); }
}

/* 输入动画 */
.typing-bubble {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 14px 20px;
}

.typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #bbb;
  animation: typingBounce 1.4s infinite ease-in-out both;
}

.typing-dot:nth-child(1) { animation-delay: -0.32s; }
.typing-dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes typingBounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-6px); opacity: 1; }
}

/* ========== 输入区域 ========== */
.chat-input-area,
.start-input-area {
  padding: 12px 24px 20px;
  border-top: 1px solid rgba(255, 140, 66, 0.06);
  background: rgba(255, 248, 240, 0.8);
  backdrop-filter: blur(12px);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  max-width: 780px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 16px;
  padding: 8px 8px 8px 18px;
  transition: border-color 0.3s, box-shadow 0.3s;
  box-shadow: 0 2px 8px rgba(255, 140, 66, 0.03);
}

.input-wrapper:focus-within {
  border-color: rgba(255, 140, 66, 0.35);
  box-shadow: 0 0 0 3px rgba(255, 140, 66, 0.08);
}

.chat-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #333;
  font-size: 15px;
  font-family: inherit;
  resize: none;
  max-height: 120px;
  line-height: 1.5;
  padding: 4px 0;
}

.chat-input::placeholder {
  color: #ccc;
}

.send-btn {
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 12px;
  background: rgba(255, 140, 66, 0.85);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s;
  flex-shrink: 0;
}

.send-btn:hover:not(.disabled) {
  background: #FF8C42;
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.35);
  transform: scale(1.05);
}

.send-btn.disabled {
  background: #f0e8e0;
  color: #ccc;
  cursor: not-allowed;
}

.send-icon {
  font-size: 14px;
  transform: rotate(0deg);
}

.input-hint {
  text-align: center;
  font-size: 12px;
  color: #ccc;
  margin: 8px 0 0;
  max-width: 780px;
  margin-left: auto;
  margin-right: auto;
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .chat-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: 4px 0 24px rgba(255, 140, 66, 0.08);
  }

  .chat-sidebar.collapsed {
    transform: translateX(-100%);
  }

  .messages-area {
    padding: 16px 0;
  }

  .message-row {
    padding: 10px 16px;
  }

  .message-bubble {
    max-width: 85%;
  }

  .chat-input-area,
  .start-input-area {
    padding: 8px 16px 16px;
  }
}
</style>
