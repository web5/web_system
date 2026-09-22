<template>
  <div class="chat">
    <!-- 标题行：通栏对齐面板边缘，标题左对齐（v4 · 原型 d43117b） -->
    <div class="chead">
      <h1>{{ title }}</h1>
      <span v-if="agentBadge" class="badge">{{ agentBadge }}</span>
      <span class="spacer" />
      <button type="button" class="btn-primary btn-sm" @click="newChat">
        <app-icon name="plus" />
        <span>新对话</span>
      </button>
    </div>

    <!-- 面板：消息 + 输入同一浅暖大面板（v4：回答与输入永不分离） -->
    <div class="chatpanel">
      <div ref="bodyRef" class="thread">
        <div class="thread-inner">
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

          <div v-else-if="detailError" class="load-error">
            <span>会话加载失败，请检查网络后重试</span>
            <button type="button" class="err-act" @click="reload">重试</button>
          </div>

          <template v-else>
            <!-- 一轮 = 一条用户消息 + 紧随的 AI 回答 -->
            <div v-for="turn in turns" :key="turn.key" class="turn">
              <div
                v-for="m in turn.msgs"
                :key="m.id"
                class="mrow"
                :class="m.role === 'user' ? 'me' : 'ai'"
              >
                <div class="av">{{ m.role === 'user' ? userInitial : 'AI' }}</div>
                <div class="col">
                  <!-- 用户：唯一气泡形态 -->
                  <div v-if="m.role === 'user'" class="ubub">{{ m.content }}</div>

                  <!-- AI：白底卡片浮在浅暖面板上 -->
                  <div v-else class="acard">
                    <div class="ameta">
                      <span class="badge">{{ m.agentName || '助手' }}</span>
                      <span v-if="m.stopped" class="stopped">已停止</span>
                    </div>

                    <!-- 音乐卡片（card 事件，PC 侧自补分支） -->
                    <music-card
                      v-if="m.musicCard"
                      :card="m.musicCard"
                      @swap="sendWith('换一批')"
                      @dislike="sendWith('不感兴趣，换一批')"
                    />

                    <!-- 结构化回答 blocks -->
                    <div v-else-if="m.content" class="ans" :class="{ foldfade: needFold(m) && !expanded[m.id] }">
                      <template v-for="(b, i) in shownBlocks(m)" :key="i">
                        <p v-if="b.t === 'p'" :class="{ lead: b.lead }">
                          <template v-for="(seg, k) in boldSegs(b.v)" :key="k">
                            <strong v-if="seg.b">{{ seg.v }}</strong>
                            <template v-else>{{ seg.v }}</template>
                          </template>
                        </p>
                        <h4 v-else-if="b.t === 'h'">{{ b.v }}</h4>
                        <ol v-else-if="b.t === 'ol'">
                          <li v-for="(it, j) in b.items" :key="j">
                            <span>
                              <template v-for="(seg, k) in boldSegs(it)" :key="k">
                                <strong v-if="seg.b">{{ seg.v }}</strong>
                                <template v-else>{{ seg.v }}</template>
                              </template>
                            </span>
                          </li>
                        </ol>
                        <ul v-else-if="b.t === 'ul'">
                          <li v-for="(it, j) in b.items" :key="j">
                            <span>
                              <template v-for="(seg, k) in boldSegs(it)" :key="k">
                                <strong v-if="seg.b">{{ seg.v }}</strong>
                                <template v-else>{{ seg.v }}</template>
                              </template>
                            </span>
                          </li>
                        </ul>
                        <div v-else-if="b.t === 'law'" class="law"><b>{{ b.src }}</b>{{ stripInline(b.v) }}</div>
                        <!-- 翻译卡片（agentId=translate 四段契约） -->
                        <div v-else-if="b.t === 'tcard'" class="tcard">
                          <div class="tc-hd">
                            <span class="badge brand">推荐译文</span>
                            <span class="dir">{{ b.dir }}</span>
                          </div>
                          <div class="tc-main">{{ b.main }}<span v-if="m.streaming" class="caret" /></div>
                          <div v-if="b.note" class="tc-fold" @click="noteOpen[m.id] = !noteOpen[m.id]">
                            <span>直译对照 · 委婉版 · 语气要点</span>
                            <span class="tc-act">{{ noteOpen[m.id] ? '收起' : '展开' }}</span>
                          </div>
                          <div v-if="b.note && noteOpen[m.id]" class="tc-note">{{ b.note }}</div>
                          <div v-if="!m.streaming" class="tc-ops">
                            <button type="button" class="act" @click="copy(b.main)">复制</button>
                            <button type="button" class="act" @click="speak(m.id, b.main)">
                              {{ reading === m.id ? '停止' : '朗读' }}
                            </button>
                            <button type="button" class="act" @click="collectWord">收藏</button>
                          </div>
                        </div>
                      </template>
                      <span v-if="m.streaming && !isTcard(m)" class="caret" />
                    </div>

                    <!-- 流式等待 / 失败 -->
                    <div v-else-if="m.streaming" class="answering">
                      <span class="thinking"><i /><i /><i /></span>正在思考…
                    </div>
                    <div v-else-if="m.failed" class="failed">生成失败，请重试</div>

                    <!-- 长回答折叠：按块截断 + 渐隐（Q9 拍板） -->
                    <button
                      v-if="needFold(m)"
                      type="button"
                      class="foldbtn"
                      @click="expanded[m.id] = !expanded[m.id]"
                    >
                      {{ expanded[m.id] ? '收起 ▲' : '展开更多 ▼' }}
                    </button>
                  </div>

                  <!-- 操作条：固定高度占位，hover 显形不跳动 -->
                  <div class="acts">
                    <button v-if="m.content" type="button" class="act" @click="copy(m.content)">
                      <app-icon name="copy" />复制
                    </button>
                    <button v-if="m.role === 'assistant'" type="button" class="act" @click="retryMsg(m.id)">
                      重新生成
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 日期分隔线：同日消息组底部（2026-09-21 拍板） -->
            <div v-if="messages.length" class="daysep"><span>今天</span><i /></div>
          </template>
        </div>
      </div>

      <!-- 输入区：面板底部，白底与回答卡同语言 -->
      <div class="composer">
        <div class="box">
          <textarea
            v-model="input"
            class="composer-input"
            placeholder="描述你的问题，⌘Enter 发送"
            @keydown="onKeydown"
          />
          <div class="crow">
            <button
              type="button"
              class="attach"
              title="上传合同 / 图片（P2 支持）"
              @click="onAttach"
            >
              <app-icon name="doc" />
            </button>
            <span class="hint">⌘Enter 发送 · ⌘K 命令面板</span>
            <span class="spacer" />
            <button v-if="sending" type="button" class="btn-stop" @click="stop">
              <app-icon name="stop" /><span>停止</span>
            </button>
            <button
              v-else
              type="button"
              class="btn-primary btn-sm"
              :disabled="!canSend"
              @click="send(input)"
            >
              <app-icon name="arrow" /><span>发送</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import { getConversation, runAgentStream, type MusicCardPayload } from '@/api/agent';
import {
  parseAnswer,
  foldCut,
  plainLength,
  boldSegs,
  stripInline,
  type AnswerBlock,
} from '@/utils/answer-parse';
import { useConversationStore } from '@/stores/conversations';
import { useUserStore } from '@/stores/user';
import AppIcon from '@/components/AppIcon.vue';
import MusicCard from '@/components/MusicCard.vue';

/**
 * 对话工作台 v4（原型 d43117b）：
 * - 面板一体化：消息 + 输入同一浅暖大面板，AI 回答白底卡片，标题通栏左对齐
 * - AI 回答结构化 blocks（结论先行 / 小标题 / 有序列表 / 法条引用），轻量解析、降级纯段落
 * - 长回答按块截断折叠 + 渐隐；翻译 agent → 翻译卡片；card 事件 → 音乐卡片（PC 侧自补分支）
 * - 日期分隔线放同日消息组底部
 */

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 作答 agent（intent 事件）；历史消息无则显示「助手」 */
  agentName?: string;
  /** 意图路由 agentId：translate 时走翻译卡片渲染 */
  agentId?: string;
  musicCard?: MusicCardPayload | null;
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
/** 正在朗读的消息 id（翻译卡片 TTS，本地 Web Speech） */
const reading = ref<string | null>(null);

/** 折叠展开态 / 翻译卡注解展开态（本地状态，不持久化） */
const expanded = reactive<Record<string, boolean>>({});
const noteOpen = reactive<Record<string, boolean>>({});

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

/* ===== blocks（响应式缓存：流式期间 content 变化触发重解析） ===== */

const blocksMap = computed(() => {
  const map: Record<string, AnswerBlock[]> = {};
  let lastQuestion = '';
  messages.value.forEach((m) => {
    if (m.role === 'user') {
      lastQuestion = m.content;
      return;
    }
    if (m.role === 'assistant' && !m.musicCard) {
      map[m.id] = parseAnswer(m.content, { agentId: m.agentId, question: lastQuestion });
    }
  });
  return map;
});

function isTcard(m: ChatMsg): boolean {
  return (blocksMap.value[m.id] || []).some((b) => b.t === 'tcard');
}

/** Q9 拍板：纯文本长回答折叠（卡片不折叠）；阈值 PC 160 字 */
function needFold(m: ChatMsg): boolean {
  if (m.role !== 'assistant' || m.musicCard || !m.content) return false;
  const bs = blocksMap.value[m.id] || [];
  if (bs.some((b) => b.t === 'tcard')) return false;
  return bs.length > 2 && plainLength(bs) > 160;
}

/** 折叠态只渲染截断后的块（按块边界 + 渐隐，不切元素） */
function shownBlocks(m: ChatMsg): AnswerBlock[] {
  const bs = blocksMap.value[m.id] || [];
  return needFold(m) && !expanded[m.id] ? foldCut(bs) : bs;
}

/* ===== 轮次（一轮 = 用户消息 + 紧随的 AI 回答） ===== */

const turns = computed(() => {
  const out: { key: string; msgs: ChatMsg[] }[] = [];
  messages.value.forEach((m) => {
    if (m.role === 'user') {
      out.push({ key: m.id, msgs: [m] });
    } else if (out.length) {
      out[out.length - 1].msgs.push(m);
    } else {
      out.push({ key: m.id, msgs: [m] });
    }
  });
  return out;
});

/* ===== 行为 ===== */

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

function collectWord() {
  message.success('已收进生词本');
}

function onAttach() {
  message.info('上传文件：P2 支持');
}

/** 翻译卡片朗读：Web Speech 本地实现（后端 TTS 接口留给正文朗读排期） */
function speak(mId: string, text: string) {
  if (!('speechSynthesis' in window)) {
    message.info('当前浏览器不支持朗读');
    return;
  }
  if (reading.value) {
    window.speechSynthesis.cancel();
    reading.value = null;
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /^[A-Za-z]/.test(text) ? 'en-US' : 'zh-CN';
  u.onend = () => (reading.value = null);
  u.onerror = () => (reading.value = null);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  reading.value = mId;
}

/** 音乐卡「换一批 / 不感兴趣」：当新一轮对话发出（排序交给 agent 口味档案） */
function sendWith(text: string) {
  send(text);
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
  Object.keys(expanded).forEach((k) => delete expanded[k]);
  Object.keys(noteOpen).forEach((k) => delete noteOpen[k]);
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
  const reply: ChatMsg = {
    id: uid(),
    role: 'assistant',
    content: '',
    streaming: true,
    musicCard: null,
  };
  messages.value.push(reply);
  sending.value = true;
  store.setRunning(true);
  nextTick(scrollToBottom);

  controller = runAgentStream(
    // agentId 交给后端意图路由（page-spec §2）；工具页（翻译 / 合翻）在 P2/P3 显式指定
    { userInput: content, agentId: 'auto', conversationId: convId.value || undefined },
    {
      onIntent(intent) {
        reply.agentName = intent.agentName || '';
        reply.agentId = intent.agentId;
        agentBadge.value = intent.agentName || '';
      },
      onDelta(delta) {
        reply.content += delta;
        void nextTick(scrollToBottom);
      },
      onEvent(event) {
        // PC 侧自补 card 分支（小程序 chat 页缺这一分支，音乐卡片只在历史回放出现）
        if (event.type === 'card' && event.card?.kind === 'music') {
          reply.musicCard = event.card;
        }
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
  const last = messages.value[messages.value.length - 1];
  if (last?.role === 'assistant') {
    last.streaming = false;
    last.stopped = true;
  }
  store.setRunning(false);
}

function reload() {
  if (store.currentId) void loadConversation(store.currentId);
}

/** 失败重试：去掉失败消息及其之后的内容，重发该轮用户消息 */
function retryMsg(id: string) {
  const index = messages.value.findIndex((m) => m.id === id);
  if (index === -1) return;
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

// 离开页面时中断未完成的流、停掉朗读，并解除「生成中」锁（否则删除入口会一直禁用）
onBeforeUnmount(() => {
  controller?.abort();
  controller = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  store.setRunning(false);
});
</script>

<style scoped>
.chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction:column;
  background: var(--ws-bg-surface);
  padding: 0 var(--ws-space-24);
}

/* ===== 标题行：通栏对齐面板边缘 ===== */
.chead {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 12px;
}

.chead h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--ws-text-primary);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--ws-radius-pill);
  font-size: 12px;
  font-weight: 500;
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  display: inline-flex;
  align-items: center;
}

.badge.brand {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
}

.spacer {
  flex: 1;
}

/* ===== 面板：消息 + 输入一体 ===== */
.chatpanel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ws-bg-page);
  border-radius: var(--ws-radius-lg);
  overflow: hidden;
}

.thread {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 8px;
}

.thread-inner {
  max-width: 720px;
  margin: 0 auto;
}

/* 一轮：轮内 12 / 轮间 24 */
.turn {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.turn:last-of-type {
  margin-bottom: 8px;
}

.mrow {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.mrow.me {
  flex-direction: row-reverse;
}

.av {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  flex: 0 0 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  margin-top: 2px;
}

.mrow.ai .av {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
}

.mrow.me .av {
  background: var(--ws-bg-subtle);
  color: var(--ws-text-secondary);
}

.col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.mrow.me .col {
  align-items: flex-end;
}

/* 用户：唯一气泡形态，限宽 78% */
.ubub {
  max-width: 78%;
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  border-radius: 16px 16px 4px 16px;
  padding: 8px 16px;
  font-size: 14px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}

/* AI：白底卡片 */
.acard {
  background: var(--ws-bg-surface);
  border-radius: var(--ws-radius-md);
  padding: 16px 20px;
  max-width: 660px;
}

.ameta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.stopped {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

/* AI 正文排版 */
.ans {
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--ws-text-primary);
}

.ans p {
  margin: 0 0 16px;
}

.ans p:last-child {
  margin-bottom: 0;
}

.ans .lead {
  font-size: 15px;
  font-weight: 500;
}

.ans h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  margin: 24px 0 8px;
  color: var(--ws-text-primary);
}

.ans h4::before {
  content: '';
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--ws-brand-500);
  flex: 0 0 3px;
}

.ans ol {
  counter-reset: step;
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ans ol li {
  counter-increment: step;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.ans ol li::before {
  content: counter(step);
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 50%;
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  font-size: 12px;
  font-weight: 600;
  display: grid;
  place-items: center;
  margin-top: 4px;
}

/* 无序列表（markdown「- 」）：小圆点 */
.ans ul {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ans ul li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  color: var(--ws-text-secondary);
}

.ans ul li::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ws-brand-300, var(--ws-brand-500));
  flex: 0 0 5px;
  margin-top: 9px;
}

.ans strong {
  font-weight: 600;
  color: var(--ws-text-primary);
}

.ans .law {
  margin: 0 0 16px;
  padding: 8px 16px;
  border-left: 3px solid var(--ws-brand-500);
  background: var(--ws-brand-50);
  border-radius: 0 var(--ws-radius-sm) var(--ws-radius-sm) 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--ws-text-secondary);
}

.ans .law b {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-brand-700);
  margin-bottom: 2px;
}

/* 翻译卡片（对齐小程序 chat 页内嵌卡片） */
.tcard {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  overflow: hidden;
  background: var(--ws-bg-surface);
  margin-bottom: 8px;
}

.tc-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ws-border);
}

.tc-hd .dir {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.tc-main {
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.7;
  color: var(--ws-text-primary);
}

.tc-fold {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--ws-border);
  font-size: 13px;
  color: var(--ws-text-secondary);
  cursor: pointer;
}

.tc-fold:hover {
  background: var(--ws-bg-hover);
}

.tc-act {
  margin-left: auto;
  color: var(--ws-brand-700);
  font-weight: 500;
  flex: 0 0 auto;
}

.tc-note {
  padding: 0 16px 16px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ws-text-secondary);
  white-space: pre-line;
}

.tc-ops {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--ws-border);
}

/* 长回答折叠：按块截断 + 渐隐 */
.foldfade {
  position: relative;
  max-height: 230px;
  overflow: hidden;
}

.foldfade::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 64px;
  background: linear-gradient(rgba(255, 255, 255, 0), var(--ws-bg-surface));
}

.foldbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-brand-700);
  margin-top: 8px;
}

.foldbtn:hover {
  text-decoration: underline;
}

/* 操作条：固定占位，hover 显形 */
.acts {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  height: 24px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.mrow:hover .acts {
  opacity: 1;
}

.mrow.me .acts {
  justify-content: flex-end;
}

.act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

/* 流式 / 失败 */
.answering {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ws-text-tertiary);
}

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
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/* 流式光标（翻译卡片主文与普通正文共用） */
.caret {
  display: inline-block;
  width: 2px;
  height: 16px;
  background: var(--ws-brand-500);
  vertical-align: -3px;
  margin-left: 2px;
  animation: caret-blink 1s steps(2) infinite;
}

@keyframes caret-blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}

.failed {
  color: var(--ws-error-500);
  font-size: 13px;
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

.err-act {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--ws-radius-sm);
  font-size: 12px;
  color: var(--ws-brand-700);
  background: transparent;
}

.err-act:hover {
  background: var(--ws-bg-hover);
}

/* 日期分隔线：同日消息组底部 */
.daysep {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 0;
}

.daysep span {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  font-weight: 500;
}

.daysep i {
  flex: 1;
  height: 1px;
  background: var(--ws-border);
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
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.example:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-700);
}

/* ===== 输入区（面板底部，白底与回答卡同语言） ===== */
.composer {
  flex: 0 0 auto;
  padding: 8px 24px 16px;
}

.composer .box {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  padding: 12px;
  background: var(--ws-bg-surface);
  max-width: 720px;
  margin: 0 auto;
  transition: border-color 0.15s ease;
}

.composer .box:focus-within {
  border-color: var(--ws-brand-500);
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

.crow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.crow .spacer {
  flex: 1;
}

.attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--ws-radius-sm);
  color: var(--ws-text-tertiary);
  background: transparent;
}

.attach:hover {
  background: var(--ws-bg-hover);
  color: var(--ws-brand-700);
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
