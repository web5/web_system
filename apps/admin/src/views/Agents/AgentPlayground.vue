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

          <template v-for="item in timeline" :key="item.key">
            <!-- 用户/AI 消息气泡 -->
            <template v-if="item.kind === 'msg'">
              <div class="bubble-wrap" :class="(item as Msg).role">
                <div class="avatar" :class="(item as Msg).role">{{ (item as Msg).role === 'user' ? '我' : 'AI' }}</div>
                <div class="bubble" :class="(item as Msg).role">
                  <div class="bubble-meta">
                    <span class="bubble-name">{{ (item as Msg).role === 'user' ? '我' : agentName(item as Msg) }}</span>
                    <a-tag
                      v-if="(item as Msg).role === 'assistant' && (item as Msg).source === 'tool'"
                      size="small"
                      color="green"
                      class="src-tag"
                      title="本次回答基于工具调用结果（联网搜索/查数据等）"
                    >基于工具</a-tag>
                    <a-tag
                      v-else-if="(item as Msg).role === 'assistant' && (item as Msg).source === 'direct'"
                      size="small"
                      class="src-tag tag-direct"
                      title="本次回答未调用任何工具，可能是模型推测/过时信息，谨慎采纳"
                    >AI 直答</a-tag>
                    <span class="bubble-time">{{ fmtTime((item as Msg).ts) }}</span>
                  </div>
                  <template v-if="(item as Msg).status === 'error'">
                    <div class="err-inline">⚠ {{ (item as Msg).error || (item as Msg).content }}</div>
                  </template>
                  <template v-else-if="(item as Msg).status === 'aborted'">
                    <div class="aborted-inline">⏸ {{ (item as Msg).abortReason || '已中断' }}</div>
                  </template>
                  <template v-else-if="(item as Msg).status === 'pending'">
                    <!-- AI 占位气泡：等待首个字到达时显示 typing dots -->
                    <div class="typing-dots" :title="`AI 正在思考…（${(item as Msg).role}）`">
                      <span></span><span></span><span></span>
                      <span class="typing-tip">AI 正在思考…</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="bubble-text">{{ (item as Msg).content }}<span v-if="(item as Msg).status === 'streaming'" class="cursor">▍</span></div>
                  </template>
                  <div v-if="(item as Msg).status !== 'pending' && (item as Msg).status !== 'streaming'" class="bubble-actions">
                    <a-button v-if="canRetry(item as Msg)" type="text" size="small" class="act" title="重新发送该轮" @click="retryMsg(item as Msg)">
                      <template #icon><svg class="act-ico" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M902.5 556.5c-10.4 0-19.3 7.6-20.4 18-9.7 96.2-51.6 184-117.8 248.2C697 886.9 608 928.8 512 928.8c-99.7 0-193.2-39.3-263.5-110.7L136 705.8h243.2c11 0 20-9 20-20s-9-20-20-20H95c-11 0-20 9-20 20v264.2c0 11 9 20 20 20s20-9 20-20V805l112.6 112.4c78.1 78.1 182 121.1 292.4 121.1 114.7 0 222.5-44.7 303.6-125.9C905.4 831.3 950 716.3 943.6 592.6c-.9-20-17.7-36.1-41.1-36.1zM929 19c-11 0-20 9-20 20v156.9l-112.6-112.4C718.2 5.4 614.3-37.6 504-37.6c-114.7 0-222.5 44.7-303.6 125.9-79.5 79.5-128.1 187.6-136.8 304.2-.6 8 5.4 15 13.4 15.9h7.4c9.4 0 17.3-7 18.4-16.4 16.7-201.6 186.4-364 391.2-364 100.1 0 193.6 39.3 263.5 110.7L736.7 318.2H493.8c-11 0-20 9-20 20s9 20 20 20H911c11 0 20-9 20-20V39c0-11-9-20-20-20z"/></svg></template>
                    </a-button>
                    <a-button type="text" size="small" class="act" title="复制" @click="copyMsg(item as Msg)">
                      <template #icon><svg class="act-ico" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M832 64H296c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h496v688c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V96c0-17.7-14.3-32-32-32zM704 192H192c-17.7 0-32 14.3-32 32v672c0 17.7 14.3 32 32 32h512c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32z"/></svg></template>
                    </a-button>
                  </div>
                </div>
              </div>
            </template>

            <!-- 过程卡片：工具调用 / 工具结果 / 技能加载 / 思考 -->
            <template v-else>
              <div class="proc-card" :class="`proc-${(item as ProcessItem).procType}`">
                <div class="proc-head" @click="toggleProc(item as ProcessItem)">
                  <span class="proc-icon">
                    <template v-if="(item as ProcessItem).procType === 'tool_call'">🔧</template>
                    <template v-else-if="(item as ProcessItem).procType === 'tool_result'">✅</template>
                    <template v-else-if="(item as ProcessItem).procType === 'thinking'">🤔</template>
                    <template v-else>📦</template>
                  </span>
                  <span class="proc-title">
                    <template v-if="(item as ProcessItem).procType === 'tool_call'">调用工具 · <code>{{ (item as ProcessItem).name }}</code></template>
                    <template v-else-if="(item as ProcessItem).procType === 'tool_result'">工具返回 · <code>{{ (item as ProcessItem).name }}</code></template>
                    <template v-else-if="(item as ProcessItem).procType === 'thinking'">模型思考</template>
                    <template v-else>加载技能 · <code>{{ (item as ProcessItem).name }}</code></template>
                  </span>
                  <span v-if="(item as ProcessItem).step !== undefined" class="proc-step">step {{ (item as ProcessItem).step }}</span>
                  <span class="proc-toggle">{{ procExpanded[(item as ProcessItem).id] ? '▾' : '▸' }}</span>
                </div>
                <div v-if="procExpanded[(item as ProcessItem).id]" class="proc-body">
                  <div v-if="(item as ProcessItem).args" class="proc-block">
                    <div class="proc-block-label">参数</div>
                    <pre class="proc-pre">{{ (item as ProcessItem).args }}</pre>
                  </div>
                  <div v-if="(item as ProcessItem).content" class="proc-block">
                    <div class="proc-block-label">{{ (item as ProcessItem).procType === 'tool_call' ? '请求' : '返回内容' }}</div>
                    <pre class="proc-pre">{{ truncate((item as ProcessItem).content || '', 2000) }}</pre>
                  </div>
                </div>
              </div>
            </template>
          </template>
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
import { onMounted, ref, computed, nextTick, watch, reactive } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { listAgentDefs, type AgentDef } from '@/api/agent-defs';
import { useUserStore } from '@/stores/user';
import type { StreamEvent } from '@kedouai/agent-core';

/** 对话消息状态机（ACP 风格：显式状态替代 streaming + type:error 两个字段） */
type MsgStatus = 'pending' | 'streaming' | 'done' | 'error' | 'aborted';

/** 对话消息（主面板，干净的用户/AI/错误） */
interface Msg {
  id: number;
  /** 区分消息 vs 过程卡片（在时间线中） */
  kind?: 'msg';
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** 显式状态机：pending(等待首字) / streaming(流式中) / done / error / aborted */
  status: MsgStatus;
  /**
   * 回答来源（仅 status='done' 时有效）：
   * - 'tool'    本次回答基于工具调用（如联网搜索、查数据库等）
   * - 'direct'  模型直接回答，未调用工具（信息可能不准确/过时）
   */
  source?: 'tool' | 'direct';
  /** 错误信息（仅 status='error' 时） */
  error?: string;
  /** 中断原因（仅 status='aborted' 时） */
  abortReason?: string;
  /** 过程卡片（仅 assistant 消息，归属消息而非全局） */
  processes?: ProcessItem[];
}

/**
 * 过程事件：思考/工具调用/工具结果（不作为独立消息渲染，而是归属到某条 assistant 消息）
 */
interface ProcessItem {
  id: number;
  /** 时间线中标记为过程卡片 */
  kind: 'proc';
  /** 过程类型 */
  procType: 'thinking' | 'tool_call' | 'tool_result' | 'skill_load';
  /** 工具名 / 技能 code（思考类无） */
  name?: string;
  /** 工具参数（JSON 字符串） */
  args?: string;
  /** 工具结果 / 思考内容（可能很长） */
  content?: string;
  /** 步骤号（用于分组） */
  step?: number;
  ts: number;
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
/** 单真相源：对话消息数组（reactive，直接 push 对象即可响应，无 reactive proxy 引用坑） */
const messages = reactive<Msg[]>([]);
const events = reactive<Evt[]>([]);
const debugOpen = ref(false);
const scrollBox = ref<HTMLElement | null>(null);
const debugBox = ref<HTMLElement | null>(null);
/** 可选模型（从 ai-agent /agent/models 拉取）；'' = 跟随 Agent 定义 */
const models = ref<Array<{ id: string; displayName: string; available: boolean }>>([]);
const modelsLoading = ref(false);
const selectedModel = ref('');

let msgSeq = 0;
/** 进行中请求的取消控制器（切换 Agent / 新建会话时中断） */
let abortCtrl: AbortController | null = null;

/** 找当前正在等待/流式输出的 assistant 消息（替代全局 currentAssistant 变量） */
function findStreamingAssistant(): Msg | undefined {
  return [...messages].reverse().find((m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'));
}

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
watch([() => messages.length, () => events.length], scrollToBottom);

/** 切换 Agent：上下文独立，自动重置 */
watch(agentId, (val, oldVal) => {
  if (val === oldVal) return;
  if (messages.length > 0 || conversationId.value || streaming.value) {
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
  messages.splice(0, messages.length);
  Object.keys(procExpanded).forEach((k) => delete procExpanded[Number(k)]);
  events.splice(0, events.length);
  userInput.value = '';
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
  return m.status === 'error' ? `[错误] ${m.error || m.content}` : m.content;
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
  const lastUser = [...messages].reverse().find((x) => x.role === 'user');
  return !!lastUser && lastUser.id === m.id;
}
async function retryMsg(m: Msg) {
  if (streaming.value) return;
  const idx = messages.findIndex((x) => x.id === m.id);
  if (idx < 0) return;
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  // 回滚该轮之后的所有消息与事件
  messages.splice(idx);
  events.splice(0, events.length);
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
  for (const m of messages) {
    lines.push(`## ${m.role === 'user' ? '我' : 'AI'} · ${fmtTime(m.ts)}`);
    lines.push('');
    lines.push(msgText(m));
    lines.push('');
  }
  if (events.length) {
    lines.push('---');
    lines.push('# 运行事件');
    lines.push('');
    for (const e of events) {
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

  messages.push({ id: msgSeq++, role: 'user', content: input, ts: Date.now(), status: 'done' });
  // 立即创建 AI 占位气泡（不等后端首个 content_delta），避免「点发送后空白等待」
  // reactive 数组直接 push 对象即可响应，无 reactive proxy 引用坑
  messages.push({
    id: msgSeq++,
    kind: 'msg',
    role: 'assistant',
    content: '',
    ts: Date.now(),
    status: 'pending',
    processes: [],
  });
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
      const cur = findStreamingAssistant();
      if (cur) {
        cur.status = 'error';
        cur.error = errMsg;
      }
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
    if (err?.name === 'AbortError') {
      // 用户主动中断：把占位气泡标为已中断
      const cur = findStreamingAssistant();
      if (cur && !cur.content) {
        cur.status = 'aborted';
        cur.abortReason = '已中断';
      }
      return;
    }
    const msg = `网络错误: ${err?.message || '未知'}`;
    const cur = findStreamingAssistant();
    if (cur) {
      cur.status = 'error';
      cur.error = msg;
    }
  } finally {
    abortCtrl = null;
    streaming.value = false;
    scrollToBottom();
  }
}

function handleEvent(ev: StreamEvent) {
  switch (ev.type) {
    case 'content_delta': {
      if (!ev.content) break;
      const cur = findStreamingAssistant();
      if (!cur) break;
      if (cur.status === 'pending') cur.status = 'streaming';
      cur.content += ev.content;
      scrollToBottom();
      break;
    }
    case 'tool_call':
    case 'tool_result':
    case 'skill_load': {
      const cur = findStreamingAssistant();
      const procType: ProcessItem['procType'] =
        ev.type === 'tool_call' ? 'tool_call' :
        ev.type === 'tool_result' ? 'tool_result' :
        'skill_load';
      const proc: ProcessItem = {
        id: msgSeq++,
        kind: 'proc',
        procType,
        name: ev.name,
        args: ev.args ? (typeof ev.args === 'string' ? ev.args : JSON.stringify(ev.args, null, 2)) : undefined,
        content: ev.content,
        step: ev.step,
        ts: Date.now(),
      };
      // 过程卡片归属到当前 assistant 消息（而非全局数组）
      if (cur) {
        if (!cur.processes) cur.processes = [];
        cur.processes.push(proc);
      }
      events.push({ type: ev.type, name: ev.name, content: ev.content, args: ev.args, step: ev.step });
      scrollToBottom();
      break;
    }
    case 'final': {
      const cur = findStreamingAssistant();
      if (cur) {
        cur.content = ev.content ?? cur.content;
        // 来源标签：本轮是否有工具调用，直接看归属的 processes
        cur.source = (cur.processes?.some((p) => p.procType === 'tool_call')) ? 'tool' : 'direct';
        cur.status = 'done';
      }
      if (ev.conversationId) conversationId.value = ev.conversationId;
      events.push({ type: 'final', content: ev.content, step: ev.step });
      scrollToBottom();
      break;
    }
    case 'error': {
      const cur = findStreamingAssistant();
      if (cur) {
        cur.status = 'error';
        cur.error = ev.content || '运行失败';
        cur.processes = [];  // 本轮过程卡片作废
      } else {
        // 兜底：无占位消息时新建错误消息
        messages.push({ id: msgSeq++, role: 'assistant', content: ev.content || '运行失败', ts: Date.now(), status: 'error', error: ev.content || '运行失败' });
      }
      events.push({ type: 'error', content: ev.content, step: ev.step });
      scrollToBottom();
      break;
    }
    case 'permission_request': {
      // 高危操作权限确认：弹窗 + 调确认接口（非阻塞，不卡 SSE 流循环）
      void handlePermissionRequest(ev);
      events.push({ type: ev.type, name: ev.name, content: ev.content, step: ev.step });
      break;
    }
    case 'summary':
    case 'token': {
      // 预留：引擎未来产生中间总结（summary）/ token 事件；当前仅进 Debugger，未来接渲染
      events.push({ type: ev.type, name: ev.name, content: ev.content, step: ev.step });
      break;
    }
    default:
      events.push({ type: ev.type, name: ev.name, content: ev.content, step: ev.step });
  }
}

/**
 * 权限确认：弹确认框，用户允许/拒绝后调后端确认接口。
 * 服务端在工具执行处挂起等待，60s 超时自动拒绝。
 */
async function handlePermissionRequest(ev: StreamEvent) {
  const requestId = ev.requestId;
  if (!requestId) return;
  let approve = false;
  try {
    approve = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: 'Agent 请求执行高危操作',
        content: ev.content || '该操作需要你的确认',
        okText: '允许',
        cancelText: '拒绝',
        okType: 'danger',
        width: 520,
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  } catch {
    approve = false;
  }
  try {
    await fetch(`/api/ai-agent/agent/permission/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userStore.token}` },
      body: JSON.stringify({ approve }),
    });
  } catch {
    // 确认接口失败：服务端 60s 超时自动拒绝，无需额外处理
  }
}

/** 主面板时间线：把消息和其归属的过程事件按 ts 交错合并 */
type TimelineItem = (Msg & { key: string }) | (ProcessItem & { key: string });

const timeline = computed<TimelineItem[]>(() => {
  const list: TimelineItem[] = [];
  for (const m of messages) {
    list.push({ ...m, kind: 'msg', key: `m-${m.id}` } as TimelineItem);
    for (const p of m.processes || []) {
      list.push({ ...p, kind: 'proc', key: `p-${p.id}` } as TimelineItem);
    }
  }
  return list.sort((a, b) => a.ts - b.ts);
});

/** 过程卡片展开/折叠状态（按 ProcessItem.id） */
const procExpanded = reactive<Record<number, boolean>>({});

function toggleProc(p: ProcessItem) {
  procExpanded[p.id] = !procExpanded[p.id];
}

function truncate(s: string, n: number) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字）` : s;
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
.src-tag { font-size: 10px !important; line-height: 1.2 !important; padding: 0 4px !important; margin-left: 2px; }
.tag-direct { background: #f0f0f0 !important; color: #888 !important; border-color: #d0d0d0 !important; }
.bubble-wrap.user .bubble-meta { justify-content: flex-end; }

/* ========== 过程卡片：思考/工具调用/工具结果/技能加载 ========== */
.proc-card {
  margin: 6px 0 6px 36px;
  max-width: 78%;
  border-radius: 6px;
  border: 1px solid #e6e8eb;
  background: #fafbfc;
  font-size: 12px;
  overflow: hidden;
  transition: all .2s;
}
.proc-card:hover { border-color: #c8d0d8; }
.proc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
}
.proc-icon { font-size: 13px; }
.proc-title { flex: 1; color: #4a5560; }
.proc-title code { background: #eef1f4; padding: 1px 5px; border-radius: 3px; font-size: 11px; color: #4a5560; }
.proc-step { font-size: 10px; color: #99a0a8; padding: 1px 6px; background: #eef1f4; border-radius: 8px; }
.proc-toggle { color: #99a0a8; font-size: 10px; width: 12px; text-align: center; }
.proc-body { padding: 0 10px 8px; border-top: 1px dashed #e6e8eb; }
.proc-block { margin-top: 6px; }
.proc-block-label { font-size: 10px; color: #99a0a8; margin-bottom: 2px; }
.proc-pre {
  margin: 0;
  font-family: 'SF Mono','Menlo','Consolas',monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #2d3748;
  background: #fff;
  border: 1px solid #eef1f4;
  border-radius: 4px;
  padding: 6px 8px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 类型配色 */
.proc-tool_call { border-left: 3px solid #6c8eff; background: #f4f7ff; }
.proc-tool_call .proc-title { color: #2a4ec0; }
.proc-tool_result { border-left: 3px solid #2ea44f; background: #f3fbf5; }
.proc-tool_result .proc-title { color: #1e6b36; }
.proc-skill_load { border-left: 3px solid #b07be0; background: #faf5fd; }
.proc-skill_load .proc-title { color: #6b3a9c; }
.proc-thinking { border-left: 3px solid #f5a623; background: #fffaf3; }
.proc-thinking .proc-title { color: #a96b00; }
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

/* AI 思考中：三个跳动圆点 + 文字 */
.typing-dots {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
  min-height: 24px;
}
.typing-dots > span:not(.typing-tip) {
  width: 7px; height: 7px; border-radius: 50%;
  background: #b0b8c0; display: inline-block;
  animation: typing-bounce 1.2s infinite ease-in-out both;
}
.typing-dots > span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots > span:nth-child(2) { animation-delay: -0.16s; }
.typing-dots .typing-tip {
  margin-left: 6px; color: #99a0a8; font-size: 12px; line-height: 1;
  background: none; width: auto; height: auto; border-radius: 0;
  animation: none;
}
@keyframes typing-bounce {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.35; }
  40% { transform: scale(1); opacity: 1; }
}
.err-inline { color: #cf1322; font-size: 13px; white-space: pre-wrap; }
.bubble-wrap.user .err-inline { color: #ffd6d6; }
.aborted-inline { color: #d48806; font-size: 13px; white-space: pre-wrap; }
.bubble-wrap.user .aborted-inline { color: #ffe58f; }

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
