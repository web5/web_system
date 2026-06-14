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
          <span v-if="sidebarCollapsed">☰</span>
          <span v-else>✕</span>
        </button>
      </div>

      <button class="new-chat-btn" @click="startNewChat">
        <span class="btn-icon">＋</span>
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
          <div class="conv-icon">💬</div>
          <div class="conv-content">
            <div class="conv-title">{{ conv.title || '新对话' }}</div>
            <div class="conv-time">{{ formatTime(conv.updatedAt) }}</div>
          </div>
          <button class="conv-delete" @click.stop="handleDeleteConversation(conv.id)" title="删除对话">
            <span>🗑</span>
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
          <span class="empty-icon">📭</span>
          <p>暂无对话记录</p>
        </div>
      </div>
    </aside>

    <!-- 主聊天区域 -->
    <main class="chat-main">
      <!-- 顶部导航 -->
      <nav class="chat-navbar">
        <div class="nav-left">
          <button v-if="sidebarCollapsed" class="menu-btn" @click="sidebarCollapsed = false">☰</button>
          <h2 class="nav-title">AI 学习助手</h2>
        </div>
        <div class="nav-right">
          <router-link to="/" class="nav-link">🏠 首页</router-link>
          <router-link to="/draw" class="nav-link">🎨 画笔</router-link>
        </div>
      </nav>

      <!-- 聊天内容区 -->
      <div class="chat-content" ref="chatContentRef">
        <!-- 欢迎页 -->
        <div v-if="!activeConversationId" class="welcome-section">
          <div class="welcome-icon">
            <img src="/logo.svg" alt="AI" class="welcome-logo" width="80" height="43" />
          </div>
          <h1 class="welcome-title">你好，我是科豆 AI 学习助手</h1>
          <p class="welcome-desc">选一个话题开始对话，或者直接问我任何学习问题吧！</p>
          <div class="suggestion-grid">
            <button
              v-for="item in quickStarts"
              :key="item.id"
              class="suggestion-card"
              @click="quickStart(item.prompt)"
            >
              <span class="suggestion-emoji">{{ item.emoji }}</span>
              <span class="suggestion-label">{{ item.label }}</span>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="messages-area">
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
                <div class="message-content" v-html="renderContent(msg.content)"></div>
              </div>
            </div>
          </TransitionGroup>

          <!-- 输入中动画 -->
          <div v-if="isTyping" class="message-row assistant">
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
            <span class="send-icon">➤</span>
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
            <span class="send-icon">➤</span>
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
  getConversations,
  getConversation,
  deleteConversation,
  type ChatMessage,
  type ConversationSummary,
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

const chatContentRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

// --- 快捷提问 ---
const quickStarts = [
  { id: 1, emoji: '🔢', label: '数学问题', prompt: '什么是质数？请用简单的方式解释' },
  { id: 2, emoji: '🌍', label: '科学探索', prompt: '为什么天空是蓝色的？' },
  { id: 3, emoji: '📚', label: '写作帮助', prompt: '请帮我写一段关于春天的短文' },
  { id: 4, emoji: '🧠', label: '学习方法', prompt: '有什么好的记忆方法推荐吗？' },
  { id: 5, emoji: '🎨', label: '创意灵感', prompt: '给我推荐一些适合小学生的创意手工活动' },
  { id: 6, emoji: '🇬🇧', label: '英语学习', prompt: '如何用英语做自我介绍？请举例' },
];

// --- 生命周期 ---
onMounted(() => {
  loadConversations();
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

  // 添加用户消息到界面
  currentMessages.value = [{ role: 'user', content: msg }];
  isTyping.value = true;
  await nextTick(scrollToBottom);

  try {
    const res = await sendChatMessage({
      message: msg,
      messages: [{ role: 'user', content: msg }],
    });
    activeConversationId.value = res.data.conversationId;

    // 添加 AI 回复
    currentMessages.value.push({
      role: 'assistant',
      content: res.data.reply,
    });

    // 刷新对话列表
    loadConversations();
  } catch (error: any) {
    const errMsg = error?.response?.data?.message || 'AI 服务暂不可用，请稍后再试';
    currentMessages.value.push({
      role: 'assistant',
      content: `抱歉，${errMsg}`,
    });
    message.error('消息发送失败');
  } finally {
    isTyping.value = false;
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
  await nextTick(scrollToBottom);

  try {
    // 构建消息历史
    const messagesList: ChatMessage[] = currentMessages.value.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const res = await sendChatMessage({
      message: msg,
      conversationId: activeConversationId.value,
      messages: messagesList,
    });

    // 添加 AI 回复
    currentMessages.value.push({
      role: 'assistant',
      content: res.data.reply,
    });

    // 更新对话列表时间
    loadConversations();
  } catch (error: any) {
    const errMsg = error?.response?.data?.message || 'AI 服务暂不可用';
    currentMessages.value.push({
      role: 'assistant',
      content: `抱歉，${errMsg}`,
    });
  } finally {
    isTyping.value = false;
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

function renderContent(content: string): string {
  if (!content) return '';
  return content
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
</script>

<style scoped>
/* ========== 页面布局 ========== */
.ai-chat-page {
  display: flex;
  height: 100vh;
  background: #0a0a0d;
  overflow: hidden;
}

/* ========== 左侧边栏 ========== */
.chat-sidebar {
  width: 280px;
  min-width: 280px;
  background: #0c0c0d;
  border-right: 1px solid rgba(249, 115, 22, 0.08);
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
  border-bottom: 1px solid rgba(249, 115, 22, 0.06);
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
  color: #f97316;
  white-space: nowrap;
}

.sidebar-toggle {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.sidebar-toggle:hover {
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.3);
}

/* 新建对话按钮 */
.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px;
  padding: 10px 14px;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.2);
  border-radius: 10px;
  color: #f97316;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s;
  white-space: nowrap;
  overflow: hidden;
}

.new-chat-btn:hover {
  background: rgba(249, 115, 22, 0.18);
  border-color: rgba(249, 115, 22, 0.35);
  box-shadow: 0 0 16px rgba(249, 115, 22, 0.1);
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
  background: rgba(255, 255, 255, 0.03);
}

.conversation-item.active {
  background: rgba(249, 115, 22, 0.08);
  border: 1px solid rgba(249, 115, 22, 0.12);
}

.conv-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.conv-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.conv-title {
  font-size: 13px;
  color: #e2e8f0;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-time {
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
}

.conv-delete {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
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
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.conv-loading,
.conv-empty {
  text-align: center;
  padding: 24px 12px;
}

.conv-empty {
  color: #64748b;
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
  background: #f97316;
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
  background: #0a0a0d;
}

/* 顶部导航 */
.chat-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 60px;
  border-bottom: 1px solid rgba(249, 115, 22, 0.06);
  background: rgba(12, 12, 13, 0.8);
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
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.menu-btn:hover {
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.3);
}

.nav-title {
  font-size: 17px;
  font-weight: 700;
  color: #f8fafc;
  margin: 0;
}

.nav-right {
  display: flex;
  gap: 20px;
}

.nav-link {
  text-decoration: none;
  color: #94a3b8;
  font-size: 14px;
  font-weight: 500;
  transition: color 0.2s;
}

.nav-link:hover {
  color: #f97316;
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
  background: rgba(249, 115, 22, 0.06);
  border-radius: 24px;
}

.welcome-logo {
  border-radius: 10px;
}

.welcome-title {
  font-size: 26px;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 12px;
}

.welcome-desc {
  font-size: 15px;
  color: #94a3b8;
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.3s;
  color: #cbd5e1;
}

.suggestion-card:hover {
  background: rgba(249, 115, 22, 0.08);
  border-color: rgba(249, 115, 22, 0.25);
  color: #f97316;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(249, 115, 22, 0.08);
}

.suggestion-emoji {
  font-size: 28px;
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
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.15);
  color: #f8fafc;
  border-bottom-right-radius: 4px;
}

.message-row.assistant .message-bubble {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
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
  background: linear-gradient(135deg, #f97316, #ea580c);
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
  color: #f97316;
  font-weight: 600;
}

.message-content :deep(em) {
  color: #cbd5e1;
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
  background: #64748b;
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
  border-top: 1px solid rgba(249, 115, 22, 0.06);
  background: rgba(12, 12, 13, 0.8);
  backdrop-filter: blur(12px);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  max-width: 780px;
  margin: 0 auto;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 8px 8px 8px 18px;
  transition: border-color 0.3s, box-shadow 0.3s;
}

.input-wrapper:focus-within {
  border-color: rgba(249, 115, 22, 0.35);
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.06);
}

.chat-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #f8fafc;
  font-size: 15px;
  font-family: inherit;
  resize: none;
  max-height: 120px;
  line-height: 1.5;
  padding: 4px 0;
}

.chat-input::placeholder {
  color: #64748b;
}

.send-btn {
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 12px;
  background: rgba(249, 115, 22, 0.85);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s;
  flex-shrink: 0;
}

.send-btn:hover:not(.disabled) {
  background: #f97316;
  box-shadow: 0 4px 16px rgba(249, 115, 22, 0.35);
  transform: scale(1.05);
}

.send-btn.disabled {
  background: rgba(255, 255, 255, 0.06);
  color: #475569;
  cursor: not-allowed;
}

.send-icon {
  font-size: 14px;
  transform: rotate(0deg);
}

.input-hint {
  text-align: center;
  font-size: 12px;
  color: #475569;
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
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
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
