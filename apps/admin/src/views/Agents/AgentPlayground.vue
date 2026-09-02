<template>
  <a-page-header
    title="对话调试（Playground）"
    sub-title="直接发起 Agent 对话，完整对话流逐条展示：AI 输出实时流式渲染，工具调用/技能加载/错误均为对话中的一条消息。消耗真实 LLM token"
  >
    <template #extra>
      <a-button :loading="loading" @click="reloadAgents">刷新</a-button>
      <a-button @click="clearSession">新建会话</a-button>
    </template>
  </a-page-header>

  <a-row :gutter="16">
    <!-- 左：控制区 -->
    <a-col :xs="24" :md="8" :lg="7">
      <a-card :bordered="true" size="small" title="运行配置">
        <a-form layout="vertical">
          <a-form-item label="Agent">
            <a-select v-model:value="agentId" placeholder="选择 Agent" show-search option-filter-prop="label" :loading="agentsLoading">
              <a-select-option v-for="a in agents" :key="a.id" :value="a.id" :label="`${a.name} (${a.id})`">
                {{ a.name }} <span class="opt-id">{{ a.id }}</span>
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="用户输入">
            <a-textarea v-model:value="userInput" :rows="5" placeholder="输入想测试的内容" :disabled="streaming" />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" block :loading="streaming" :disabled="!agentId || !userInput.trim()" @click="send">
              发送
            </a-button>
          </a-form-item>
          <a-form-item v-if="conversationId" label="当前会话 ID（多轮）">
            <a-input :value="conversationId" readonly>
              <template #suffix>
                <a-button type="link" size="small" @click="copyConversationId">复制</a-button>
              </template>
            </a-input>
          </a-form-item>
        </a-form>
      </a-card>
    </a-col>

    <!-- 右：对话流 -->
    <a-col :xs="24" :md="16" :lg="17">
      <a-card :bordered="true" size="small">
        <template #title>
          <span>对话流</span>
          <a-tag v-if="streaming" color="processing" class="ml-8">运行中…</a-tag>
          <a-tag v-if="!streaming && messages.length && !hasError" color="success" class="ml-8">完成</a-tag>
        </template>

        <a-empty v-if="!messages.length && !streaming" description="发送消息后，完整对话过程会逐条实时展示（AI 输出流式渲染）" />

        <div ref="scrollBox" class="chat-box">
          <div v-for="m in messages" :key="m.id" class="msg-row" :class="[m.role, m.type || '']">
            <div class="msg-label">{{ labelOf(m) }}</div>
            <div class="msg-body">
              <!-- 工具调用：名称 + 参数 -->
              <template v-if="m.type === 'tool_call'">
                <div class="tool-head">
                  <span class="tool-name">{{ m.name || '调用工具' }}</span>
                </div>
                <pre v-if="m.args" class="code-block">{{ formatJson(m.args) }}</pre>
                <div v-else class="muted">等待执行…</div>
              </template>
              <!-- 工具结果 / 技能加载 -->
              <template v-else-if="m.type === 'tool_result' || m.type === 'skill_load'">
                <div class="tool-head">
                  <span class="tool-name">{{ m.type === 'skill_load' ? '加载技能' : '工具结果' }}</span>
                  <span class="tool-id">{{ m.name }}</span>
                </div>
                <pre v-if="m.content" class="code-block">{{ m.content }}</pre>
              </template>
              <!-- 最终/错误/普通消息：流式文本 -->
              <template v-else>
                <span class="text-content">{{ m.content }}</span><span v-if="m.streaming" class="cursor">▍</span>
              </template>
            </div>
          </div>
        </div>
      </a-card>
    </a-col>
  </a-row>
</template>

<script setup lang="ts">
import { onMounted, ref, nextTick, watch } from 'vue';
import { message } from 'ant-design-vue';
import { listAgentDefs, type AgentDef } from '@/api/agent-defs';
import { useUserStore } from '@/stores/user';

/** 对话消息：用户/AI 输出/工具调用/工具结果/技能加载/错误，全部作为一条消息进入对话流 */
interface Msg {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'error';
  /** tool_call / tool_result / skill_load / final */
  type?: string;
  name?: string;
  content: string;
  args?: unknown;
  /** 正在流式输出的 AI 消息 */
  streaming?: boolean;
}

const userStore = useUserStore();

const agents = ref<AgentDef[]>([]);
const agentsLoading = ref(false);
const loading = ref(false);
const agentId = ref('');
const userInput = ref('');
const conversationId = ref('');
const streaming = ref(false);
const messages = ref<Msg[]>([]);
const scrollBox = ref<HTMLElement | null>(null);
const lastError = ref('');

let msgSeq = 0;
/** 当前正在流式输出的 AI 消息 */
let currentAssistant: Msg | null = null;
/** 进行中请求的取消控制器（切换 Agent / 新建会话时中断） */
let abortCtrl: AbortController | null = null;

const hasError = ref(false);

/** 切换 Agent：不同 Agent 上下文独立，自动重置对话 */
watch(agentId, (val, oldVal) => {
  if (val === oldVal) return;
  if (messages.value.length > 0 || conversationId.value || streaming.value) {
    clearSession();
    message.info('已切换 Agent，会话已重置');
  }
});

function labelOf(m: Msg): string {
  switch (m.role) {
    case 'user': return '用户';
    case 'assistant': return 'AI';
    case 'tool':
      if (m.type === 'tool_call') return '工具';
      if (m.type === 'skill_load') return '技能';
      return '结果';
    case 'error': return '错误';
    default: return m.role;
  }
}

function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollBox.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// 流式输出时保持滚动到底部
watch([() => messages.value.length, () => currentAssistant?.content], scrollToBottom);

async function reloadAgents() {
  agentsLoading.value = true;
  try {
    const res: any = await listAgentDefs();
    const list = (res?.data ?? res ?? []) as AgentDef[];
    agents.value = list;
    if (!agentId.value && list.length) agentId.value = list[0].id;
  } catch {
    agents.value = [];
  } finally {
    agentsLoading.value = false;
  }
}

function clearSession() {
  // 中断进行中的请求
  if (abortCtrl) {
    abortCtrl.abort();
    abortCtrl = null;
  }
  conversationId.value = '';
  messages.value = [];
  streamingTextReset();
  hasError.value = false;
  userInput.value = '';
  currentAssistant = null;
  streaming.value = false;
}

function streamingTextReset() {
  // 重置任何残留的流式标记
  for (const m of messages.value) m.streaming = false;
}

async function copyConversationId() {
  try {
    await navigator.clipboard.writeText(conversationId.value);
    message.success('已复制会话 ID');
  } catch {
    message.warning('复制失败，请手动选择复制');
  }
}

async function send() {
  if (!agentId.value || !userInput.value.trim()) return;
  if (streaming.value) return;

  const input = userInput.value.trim();
  streaming.value = true;
  hasError.value = false;
  currentAssistant = null;
  userInput.value = '';

  // 用户消息
  messages.value.push({ id: msgSeq++, role: 'user', content: input });
  scrollToBottom();

  abortCtrl = new AbortController();
  try {
    const res = await fetch('/api/ai-agent/agent/admin-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userStore.token}`,
      },
      body: JSON.stringify({
        agentId: agentId.value,
        userInput: input,
        conversationId: conversationId.value || undefined,
      }),
      signal: abortCtrl.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const errMsg = text || `请求失败: HTTP ${res.status}`;
      lastError.value = errMsg;
      hasError.value = true;
      messages.value.push({ id: msgSeq++, role: 'error', content: errMsg });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev: any;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        handleEvent(ev);
      }
    }
  } catch (err: any) {
    // 主动中断（切换 Agent / 新建会话）不算错误
    if (err?.name === 'AbortError') return;
    const errMsg = `网络错误: ${err?.message || '未知'}`;
    lastError.value = errMsg;
    hasError.value = true;
    messages.value.push({ id: msgSeq++, role: 'error', content: errMsg });
  } finally {
    if (currentAssistant) {
      currentAssistant.streaming = false;
      currentAssistant = null;
    }
    abortCtrl = null;
    streaming.value = false;
    scrollToBottom();
  }
}

/** 把每条 SSE 事件转换为对话流中的一条消息 */
function handleEvent(ev: any) {
  switch (ev.type) {
    // AI 流式输出：逐字追加到当前 AI 消息
    case 'content_delta': {
      if (ev.content) {
        if (!currentAssistant) {
          currentAssistant = {
            id: msgSeq++,
            role: 'assistant',
            content: '',
            streaming: true,
          };
          messages.value.push(currentAssistant);
        }
        currentAssistant.content += ev.content;
        scrollToBottom();
      }
      break;
    }
    // 最终回答：合并到当前 AI 消息（无流式时新建一条）
    case 'final': {
      if (currentAssistant) {
        currentAssistant.content = ev.content ?? currentAssistant.content;
        currentAssistant.streaming = false;
        currentAssistant = null;
      } else if (ev.content) {
        messages.value.push({ id: msgSeq++, role: 'assistant', content: ev.content });
      }
      if (ev.conversationId) conversationId.value = ev.conversationId;
      scrollToBottom();
      break;
    }
    // 工具调用：作为独立一条消息
    case 'tool_call': {
      closeStreamingAssistant();
      messages.value.push({
        id: msgSeq++,
        role: 'tool',
        type: 'tool_call',
        name: ev.name,
        args: ev.args,
        content: ev.content ?? '',
      });
      scrollToBottom();
      break;
    }
    // 工具结果
    case 'tool_result': {
      messages.value.push({
        id: msgSeq++,
        role: 'tool',
        type: 'tool_result',
        name: ev.name,
        content: ev.content ?? '',
      });
      scrollToBottom();
      break;
    }
    // 技能加载（on-demand skill）
    case 'skill_load': {
      messages.value.push({
        id: msgSeq++,
        role: 'tool',
        type: 'skill_load',
        name: ev.name,
        content: ev.content ?? '',
      });
      scrollToBottom();
      break;
    }
    // 错误
    case 'error': {
      closeStreamingAssistant();
      hasError.value = true;
      lastError.value = ev.content || '运行失败';
      messages.value.push({ id: msgSeq++, role: 'error', content: ev.content || '运行失败' });
      scrollToBottom();
      break;
    }
    default:
      // 其他事件（如 start）也作为消息保留，保证完整过程可见
      messages.value.push({
        id: msgSeq++,
        role: 'assistant',
        type: ev.type,
        content: ev.content ?? '',
      });
  }
}

/** 工具调用/错误出现前，结束当前流式 AI 消息（避免与工具消息交错） */
function closeStreamingAssistant() {
  if (currentAssistant) {
    currentAssistant.streaming = false;
    currentAssistant = null;
  }
}

onMounted(reloadAgents);
</script>

<style scoped>
.ml-8 { margin-left: 8px; }
.opt-id { color: #999; font-size: 12px; }
.chat-box {
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 8px;
}
.msg-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.msg-label {
  flex-shrink: 0;
  width: 42px;
  height: 24px;
  line-height: 24px;
  text-align: center;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.msg-row.user .msg-label { background: #e6f4ff; color: #1677ff; }
.msg-row.assistant .msg-label { background: #f6ffed; color: #52c41a; }
.msg-row.tool .msg-label { background: #fff7e6; color: #d46b08; }
.msg-row.error .msg-label { background: #fff2f0; color: #ff4d4f; }
.msg-body {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 10px 12px;
  flex: 1;
  min-width: 0;
}
.msg-row.error .msg-body { background: #fff2f0; border-color: #ffccc7; }
.msg-row.tool .msg-body { background: #fffbe6; border-color: #ffe58f; }
.msg-row.tool.tool_result .msg-body,
.msg-row.tool.skill_load .msg-body { background: #f6ffed; border-color: #b7eb8f; }
.text-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  color: #333;
}
.cursor { color: #52c41a; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0; } }
.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.tool-name { font-weight: 700; font-size: 13px; color: #d46b08; }
.tool-id {
  font-size: 12px;
  color: #999;
  font-family: monospace;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 3px;
  padding: 0 6px;
}
.code-block {
  margin: 0;
  padding: 8px 10px;
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}
.muted { color: #999; font-size: 12px; }
</style>
