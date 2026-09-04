<template>
  <div class="pg">
    <!-- 顶部：标题 + 操作 -->
    <div class="pg-head">
      <div class="pg-title">
        <span class="pg-name">Agent Playground</span>
        <span class="pg-sub">多 Agent 对话调试 · 流式输出 · 完整事件可在 Debugger 查看</span>
      </div>
      <div class="pg-head-actions">
        <a-button :loading="loading" size="small" @click="reloadAgents">刷新</a-button>
        <a-button size="small" :disabled="!messages.length" @click="exportChat">导出</a-button>
        <a-popconfirm
          title="确定清空当前会话吗？"
          ok-text="清空"
          cancel-text="取消"
          :disabled="!messages.length && !conversationId"
          @confirm="clearSession"
        >
          <a-button size="small" danger :disabled="!messages.length && !conversationId">新建会话</a-button>
        </a-popconfirm>
      </div>
    </div>

    <!-- 会话工具条 -->
    <div class="pg-toolbar">
      <a-select
        v-model:value="agentId"
        class="agent-picker"
        placeholder="选择 Agent"
        show-search
        option-filter-prop="label"
        :loading="agentsLoading"
      >
        <a-select-option v-for="a in agents" :key="a.id" :value="a.id" :label="`${a.name} (${a.id})`">
          {{ a.name }} <span class="opt-id">{{ a.id }}</span>
        </a-select-option>
      </a-select>
      <span v-if="conversationId" class="conv-id">
        会话 {{ conversationId.slice(0, 8) }}
        <a-button type="link" size="small" @click="copyConversationId">复制</a-button>
      </span>
      <div class="toolbar-right">
        <a-tag v-if="streaming" color="processing">运行中…</a-tag>
        <a-button
          size="small"
          :type="debugOpen ? 'primary' : 'default'"
          @click="debugOpen = !debugOpen"
        >
          Debugger{{ events.length ? ` (${events.length})` : '' }}
        </a-button>
      </div>
    </div>

    <!-- 主体：左侧对话 + 右侧 debug 面板 -->
    <div class="pg-main" :class="{ 'with-debug': debugOpen }">
      <!-- 对话区 -->
      <div class="chat-col">
        <div ref="scrollBox" class="chat-scroll">
          <div v-if="!messages.length && !streaming" class="chat-empty">
            <div class="empty-hint">选择上方 Agent 后发送消息开始调试</div>
          </div>

          <div v-for="m in messages" :key="m.id" class="bubble-wrap" :class="m.role">
            <!-- 头像 -->
            <div class="avatar" :class="m.role">{{ m.role === 'user' ? '我' : 'AI' }}</div>
            <!-- 气泡 -->
            <div class="bubble" :class="m.role">
              <div class="bubble-meta">
                <span class="bubble-name">{{ m.role === 'user' ? '我' : agentName(m) }}</span>
                <span class="bubble-time">{{ fmtTime(m.ts) }}</span>
              </div>
              <template v-if="m.type === 'error'">
                <div class="err-inline">⚠ {{ m.content }}</div>
              </template>
              <template v-else>
                <div class="bubble-text">{{ m.content }}<span v-if="m.streaming" class="cursor">▍</span></div>
              </template>
              <div v-if="!m.streaming" class="bubble-actions">
                <a-button v-if="canRetry(m)" type="text" size="small" class="act" title="重新发送该轮" @click="retryMsg(m)">
                  <template #icon><svg class="act-ico" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M902.5 556.5c-10.4 0-19.3 7.6-20.4 18-9.7 96.2-51.6 184-117.8 248.2C697 886.9 608 928.8 512 928.8c-99.7 0-193.2-39.3-263.5-110.7L136 705.8h243.2c11 0 20-9 20-20s-9-20-20-20H95c-11 0-20 9-20 20v264.2c0 11 9 20 20 20s20-9 20-20V805l112.6 112.4c78.1 78.1 182 121.1 292.4 121.1 114.7 0 222.5-44.7 303.6-125.9C905.4 831.3 950 716.3 943.6 592.6c-.9-20-17.7-36.1-41.1-36.1zM929 19c-11 0-20 9-20 20v156.9l-112.6-112.4C718.2 5.4 614.3-37.6 504-37.6c-114.7 0-222.5 44.7-303.6 125.9-79.5 79.5-128.1 187.6-136.8 304.2-.6 8 5.4 15 13.4 15.9h7.4c9.4 0 17.3-7 18.4-16.4 16.7-201.6 186.4-364 391.2-364 100.1 0 193.6 39.3 263.5 110.7L736.7 318.2H493.8c-11 0-20 9-20 20s9 20 20 20H911c11 0 20-9 20-20V39c0-11-9-20-20-20z"/></svg></template>
                </a-button>
                <a-button type="text" size="small" class="act" title="复制" @click="copyMsg(m)">
                  <template #icon><svg class="act-ico" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M832 64H296c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h496v688c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V96c0-17.7-14.3-32-32-32zM704 192H192c-17.7 0-32 14.3-32 32v672c0 17.7 14.3 32 32 32h512c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32z"/></svg></template>
                </a-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="chat-input">
          <div class="input-box">
            <a-textarea
              v-model:value="userInput"
              :rows="2"
              :auto-size="{ minRows: 1, maxRows: 6 }"
              placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
              :disabled="streaming"
              @keydown="onKeydown"
            />
            <div class="input-bar">
              <div class="bar-left">
                <a-select
                  v-model:value="selectedModel"
                  size="small"
                  class="model-picker"
                  :options="modelOptions"
                  :loading="modelsLoading"
                />
                <span class="input-tip">
                  {{ streaming ? 'Agent 正在回复…' : agentId ? `Agent：${agentNameOfId}` : '请先选择 Agent' }}
                </span>
              </div>
              <a-button type="primary" :loading="streaming" :disabled="!agentId || !userInput.trim()" @click="send">
                <template #icon><svg class="send-ico" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M931.4 498.9 110.2 92.9c-8.4-4.1-18.5-.6-22.5 7.8-1.1 2.4-1.6 4.9-1.6 7.5v187.1c0 8.4 5.3 15.8 13.1 18.5l315.5 99.8-315.5 99.8c-7.8 2.7-13.1 10.1-13.1 18.5v187.1c0 2.6.5 5.1 1.6 7.5 3 6.4 10.4 10.4 17.8 10.4 1.6 0 3.2-.3 4.7-.9l821.3-406c7.8-3.9 11.7-12.5 8.7-20.9-1-2.2-2.5-4.2-4.4-5.7z" fill="currentColor"/></svg></template>
                发送
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Debugger 面板 -->
      <div v-show="debugOpen" class="debug-col">
        <div class="debug-head">
          <span>运行记录</span>
          <a-tag v-if="streaming" color="processing" size="small">live</a-tag>
        </div>
        <div ref="debugBox" class="debug-scroll">
          <a-empty v-if="!events.length" description="发送消息后此处显示事件流（工具调用/技能加载/错误）" :image="null" />
          <a-timeline v-else class="evt-list">
            <a-timeline-item
              v-for="(e, i) in events"
              :key="i"
              :color="evtColor(e.type)"
              class="evt-item"
            >
              <template #dot>
                <span class="evt-type" :class="`type-${e.type}`">{{ evtTag(e.type) }}</span>
              </template>
              <div class="evt-head">
                <span class="evt-name">{{ e.name || evtTag(e.type) }}</span>
                <span class="evt-step">{{ e.step != null ? `step ${e.step}` : '' }}</span>
              </div>
              <pre v-if="e.type === 'tool_call' && e.args" class="evt-content">{{ formatJson(e.args) }}</pre>
              <pre v-else-if="e.content" class="evt-content">{{ e.content }}</pre>
            </a-timeline-item>
          </a-timeline>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, nextTick, watch } from 'vue';
import { message } from 'ant-design-vue';
import { listAgentDefs, type AgentDef } from '@/api/agent-defs';
import { useUserStore } from '@/stores/user';

/** 对话消息（主面板，干净的用户/AI/错误） */
interface Msg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  streaming?: boolean;
  /** 错误等特殊类型 */
  type?: 'error';
}

/** 调试事件（Debugger 面板） */
interface Evt {
  type: string;
  name?: string;
  content?: string;
  args?: unknown;
  step?: number;
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
const events = ref<Evt[]>([]);
const debugOpen = ref(false);
const scrollBox = ref<HTMLElement | null>(null);
const debugBox = ref<HTMLElement | null>(null);
/** 可选模型（从 ai-agent /agent/models 拉取）；'' = 跟随 Agent 定义 */
const models = ref<Array<{ id: string; displayName: string; available: boolean }>>([]);
const modelsLoading = ref(false);
const selectedModel = ref('');

let msgSeq = 0;
let currentAssistant: Msg | null = null;
let abortCtrl: AbortController | null = null;

const agentNameOfId = computed(() => {
  const a = agents.value.find((x) => x.id === agentId.value);
  return a ? `${a.name}（${a.id}）` : agentId.value || '';
});

/** 当前 Agent 定义里的模型（selectedModel 为空时使用） */
const agentModel = computed(() => {
  const a = agents.value.find((x) => x.id === agentId.value);
  return a?.model || '';
});

const modelOptions = computed(() => {
  const list = [
    {
      value: '',
      label: agentModel.value ? `跟随 Agent（${agentModel.value}）` : '跟随 Agent 定义',
    },
  ];
  for (const m of models.value) {
    list.push({
      value: m.id,
      label: `${m.displayName || m.id}${m.available ? '' : '（不可用）'}`,
    });
  }
  return list;
});

/** 拉取已注册模型列表（ai-agent /agent/models） */
async function loadModels() {
  modelsLoading.value = true;
  try {
    const res = await fetch('/api/ai-agent/agent/models', {
      headers: { Authorization: `Bearer ${userStore.token}` },
    });
    const j = await res.json();
    const data = (j?.data ?? j) as { models?: Array<{ id: string; displayName: string; available: boolean }> };
    models.value = Array.isArray(data?.models) ? data.models : [];
  } catch {
    models.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function agentName(m: Msg): string {
  if (m.role === 'user') return '我';
  const a = agents.value.find((x) => x.id === agentId.value);
  return a?.name || 'AI';
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
function evtTag(type: string): string {
  const map: Record<string, string> = { tool_call: 'tool', tool_result: 'result', skill_load: 'skill', final: 'final', error: 'error', start: 'start' };
  return map[type] || type;
}
function evtColor(type: string): string {
  const map: Record<string, string> = { tool_call: 'blue', tool_result: 'cyan', skill_load: 'purple', final: 'green', error: 'red' };
  return map[type] || 'gray';
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollBox.value;
    if (el) el.scrollTop = el.scrollHeight;
    const dbg = debugBox.value;
    if (dbg && debugOpen.value) dbg.scrollTop = dbg.scrollHeight;
  });
}
watch([() => messages.value.length, () => events.value.length, () => currentAssistant?.content], scrollToBottom);

/** 切换 Agent：上下文独立，自动重置 */
watch(agentId, (val, oldVal) => {
  if (val === oldVal) return;
  if (messages.value.length > 0 || conversationId.value || streaming.value) {
    clearSession();
    message.info('已切换 Agent，会话已重置');
  }
});

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
  if (abortCtrl) {
    abortCtrl.abort();
    abortCtrl = null;
  }
  conversationId.value = '';
  messages.value = [];
  events.value = [];
  userInput.value = '';
  currentAssistant = null;
  streaming.value = false;
  scrollToBottom();
}

async function copyConversationId() {
  try {
    await navigator.clipboard.writeText(conversationId.value);
    message.success('已复制会话 ID');
  } catch {
    message.warning('复制失败');
  }
}

/** 消息文本（复制/导出） */
function msgText(m: Msg): string {
  return m.type === 'error' ? `[错误] ${m.content}` : m.content;
}
async function copyMsg(m: Msg) {
  const text = msgText(m);
  if (!text) { message.warning('无可复制内容'); return; }
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.warning('复制失败，请手动复制');
  }
}

function canRetry(m: Msg): boolean {
  if (streaming.value || m.role !== 'user') return false;
  const lastUser = [...messages.value].reverse().find((x) => x.role === 'user');
  return !!lastUser && lastUser.id === m.id;
}
async function retryMsg(m: Msg) {
  if (streaming.value) return;
  const idx = messages.value.findIndex((x) => x.id === m.id);
  if (idx < 0) return;
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  // 回滚该轮之后的所有消息与事件
  messages.value.splice(idx);
  events.value = [];
  currentAssistant = null;
  streaming.value = false;
  userInput.value = m.content;
  await send();
}

function exportChat() {
  const lines: string[] = [];
  lines.push('# Agent 对话记录');
  lines.push('');
  lines.push(`- Agent：${agentNameOfId.value}`);
  lines.push(`- 会话：${conversationId.value || '（单轮）'}`);
  lines.push(`- 导出时间：${new Date().toLocaleString()}`);
  lines.push('');
  for (const m of messages.value) {
    lines.push(`## ${m.role === 'user' ? '我' : 'AI'} · ${fmtTime(m.ts)}`);
    lines.push('');
    lines.push(msgText(m));
    lines.push('');
  }
  if (events.value.length) {
    lines.push('---');
    lines.push('# 运行事件');
    lines.push('');
    for (const e of events.value) {
      lines.push(`- [${evtTag(e.type)}] ${e.name || ''}${e.step != null ? ` (step ${e.step})` : ''}`);
      if (e.type === 'tool_call' && e.args) lines.push(`  \`\`\`json\n  ${formatJson(e.args)}\n  \`\`\``);
      else if (e.content) lines.push(`  ${e.content}`);
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agent-${agentId.value}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('对话已导出');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

async function send() {
  if (!agentId.value || !userInput.value.trim()) return;
  if (streaming.value) return;

  const input = userInput.value.trim();
  streaming.value = true;
  userInput.value = '';

  messages.value.push({ id: msgSeq++, role: 'user', content: input, ts: Date.now() });
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
        // 调试时可选临时覆盖模型（空 = 跟随 Agent 定义）
        model: selectedModel.value || undefined,
      }),
      signal: abortCtrl.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const errMsg = text || `请求失败: HTTP ${res.status}`;
      pushError(errMsg);
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
    if (err?.name === 'AbortError') return;
    pushError(`网络错误: ${err?.message || '未知'}`);
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

function handleEvent(ev: any) {
  switch (ev.type) {
    case 'content_delta': {
      if (!ev.content) break;
      if (!currentAssistant) {
        currentAssistant = { id: msgSeq++, role: 'assistant', content: '', ts: Date.now(), streaming: true };
        messages.value.push(currentAssistant);
      }
      currentAssistant.content += ev.content;
      scrollToBottom();
      break;
    }
    case 'final': {
      if (currentAssistant) {
        currentAssistant.content = ev.content ?? currentAssistant.content;
        currentAssistant.streaming = false;
        currentAssistant = null;
      } else if (ev.content) {
        messages.value.push({ id: msgSeq++, role: 'assistant', content: ev.content, ts: Date.now() });
      }
      if (ev.conversationId) conversationId.value = ev.conversationId;
      events.value.push({ type: 'final', content: ev.content, step: ev.step });
      scrollToBottom();
      break;
    }
    case 'tool_call':
    case 'tool_result':
    case 'skill_load': {
      if (currentAssistant && ev.type === 'tool_call') {
        currentAssistant.streaming = false;
        currentAssistant = null;
      }
      events.value.push({
        type: ev.type,
        name: ev.name,
        content: ev.content,
        args: ev.args,
        step: ev.step,
      });
      scrollToBottom();
      break;
    }
    case 'error': {
      closeStreamingAssistant();
      events.value.push({ type: 'error', content: ev.content, step: ev.step });
      pushError(ev.content || '运行失败');
      break;
    }
    default:
      events.value.push({ type: ev.type, name: ev.name, content: ev.content, step: ev.step });
  }
}

function closeStreamingAssistant() {
  if (currentAssistant) {
    currentAssistant.streaming = false;
    currentAssistant = null;
  }
}

function pushError(errMsg: string) {
  messages.value.push({ id: msgSeq++, role: 'assistant', type: 'error', content: errMsg, ts: Date.now() });
  scrollToBottom();
}

onMounted(() => {
  reloadAgents();
  loadModels();
});
</script>

<style scoped>
.pg { display: flex; flex-direction: column; height: calc(100vh - 140px); min-height: 480px; }
.pg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 10px;
}
.pg-title { display: flex; flex-direction: column; }
.pg-name { font-size: 16px; font-weight: 700; color: #1a1a2e; }
.pg-sub { font-size: 12px; color: #999; margin-top: 2px; }
.pg-head-actions { display: flex; gap: 8px; }

.pg-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid #f0f0f0;
}
.agent-picker { width: 260px; }
.opt-id { color: #999; font-size: 12px; margin-left: 4px; }
.conv-id { font-size: 12px; color: #999; display: inline-flex; align-items: center; }
.toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.pg-main {
  display: flex;
  flex: 1;
  min-height: 0;
  margin-top: 8px;
  gap: 12px;
  background: #f5f5f7;
  border-radius: 12px;
  padding: 8px;
  overflow: hidden;
}
.chat-col {
  flex: 1;
  min-width: 0;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.chat-scroll { flex: 1; overflow-y: auto; padding: 16px 20px; background: #fff; }

.chat-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bbb;
}
.empty-hint { font-size: 13px; }

/* 气泡 */
.bubble-wrap { display: flex; margin-bottom: 16px; gap: 8px; }
.bubble-wrap.user { flex-direction: row-reverse; }
.avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.avatar svg { width: 16px; height: 16px; }
.avatar { font-size: 11px; font-weight: 600; }
.avatar.user { background: #1677ff; color: #fff; }
.avatar.assistant { background: #52c41a; color: #fff; }
.bubble {
  max-width: 78%;
  border-radius: 10px;
  padding: 8px 12px;
  position: relative;
}
.bubble-wrap.user .bubble {
  background: #1677ff;
  color: #fff;
  border-top-right-radius: 2px;
}
.bubble-wrap.assistant .bubble {
  background: #f6f6f6;
  border: 1px solid #eee;
  border-top-left-radius: 2px;
}
.bubble-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 2px; }
.bubble-wrap.user .bubble-meta { justify-content: flex-end; }
.bubble-name { font-size: 11px; font-weight: 600; }
.bubble-wrap.user .bubble-name { color: #dbe9ff; }
.bubble-wrap.assistant .bubble-name { color: #52a84a; }
.bubble-time { font-size: 10px; }
.bubble-wrap.user .bubble-time { color: #bcd8ff; }
.bubble-wrap.assistant .bubble-time { color: #bbb; }
.bubble-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.7;
}
.bubble-wrap.user .bubble-text { color: #fff; }
.bubble-actions {
  position: absolute;
  top: -26px;
  right: 0;
  display: none;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 0 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.bubble-wrap:not(:last-child):hover .bubble-actions { display: flex; }
.bubble-wrap.user .bubble-actions { right: auto; left: 0; }
.act { color: #666; padding: 0 4px; height: 24px; line-height: 24px; }
.act-ico { width: 13px; height: 13px; fill: currentColor; display: block; }
.cursor { color: #52c41a; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0; } }
.err-inline { color: #cf1322; font-size: 13px; white-space: pre-wrap; }
.bubble-wrap.user .err-inline { color: #ffd6d6; }

/* 输入区 */
.chat-input {
  padding: 12px 16px 14px;
  background: #fafafa;
  border-top: 1px solid #f0f0f0;
}
.input-box {
  border: 1px solid #d9d9d9;
  border-radius: 10px;
  background: #fff;
  padding: 8px 12px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input-box:focus-within {
  border-color: #1677ff;
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
}
.input-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}
.bar-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.model-picker { width: 200px; }
.input-tip {
  font-size: 11px;
  color: #bbb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.send-ico { width: 14px; height: 14px; fill: currentColor; margin-right: 2px; }

/* Debugger 面板 */
.debug-col {
  width: 380px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.debug-head {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
}
.debug-scroll { flex: 1; overflow-y: auto; padding: 12px 14px; }
.evt-item { font-size: 12px; }
.evt-type {
  display: inline-block;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: #999;
  font-family: monospace;
}
.type-tool_call { background: #1677ff; }
.type-tool_result { background: #13c2c2; }
.type-skill_load { background: #722ed1; }
.type-final { background: #52c41a; }
.type-error { background: #ff4d4f; }
.type-start { background: #722ed1; }
.evt-head { display: flex; justify-content: space-between; gap: 8px; }
.evt-name { font-weight: 600; color: #333; }
.evt-step { font-size: 10px; color: #999; }
.evt-content {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
  color: #444;
}
</style>
