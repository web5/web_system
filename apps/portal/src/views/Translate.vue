<template>
  <div class="tr">
    <!-- 标题行：对齐对话页 chead 结构 -->
    <div class="chead">
      <h1>翻译工作台</h1>
      <span class="badge">{{ srcLang }} → {{ tgtLang }}</span>
      <span class="badge">{{ tone }} · {{ style }}</span>
      <span class="spacer" />
      <button type="button" class="btn-ghost" @click="prefs">偏好设置</button>
      <button
        type="button"
        class="btn-primary btn-sm"
        :disabled="state === 'loading' || !source.trim()"
        @click="translate"
      >
        {{ state === 'loading' ? '翻译中…' : '开始翻译' }}
      </button>
    </div>

    <!-- 双栏：左输入 / 右结果（PC 宽屏增强，替代小程序上下折叠） -->
    <div class="tr-pane">
      <!-- 左：输入区（对齐小程序 translate/index） -->
      <div class="col">
        <div class="langrow">
          <button type="button" class="langsel">{{ srcLang }}</button>
          <button type="button" class="swap" title="对调语言方向" @click="swapLang">
            <app-icon name="right" />
          </button>
          <button type="button" class="langsel">{{ tgtLang }}</button>
        </div>
        <div class="lbl"><span>源文本</span><span class="cnt">{{ source.length }} / 500</span></div>
        <textarea v-model="source" class="src-ta" maxlength="500" spellcheck="false" />
        <div class="chiprow">
          <span class="lb">语气</span>
          <button
            v-for="t in TONES"
            :key="t"
            type="button"
            class="chip"
            :class="{ on: tone === t }"
            @click="tone = t"
          >
            {{ t }}
          </button>
        </div>
        <div class="chiprow">
          <span class="lb">风格</span>
          <button
            v-for="s in STYLES"
            :key="s"
            type="button"
            class="chip"
            :class="{ on: style === s }"
            @click="style = s"
          >
            {{ s }}
          </button>
        </div>
        <div class="samples">
          <div class="lb">不知道怎么开口？试试这些</div>
          <button v-for="q in SAMPLES" :key="q" type="button" class="sample" @click="source = q">
            {{ q }}
          </button>
        </div>
      </div>

      <!-- 右：结果区（对齐小程序 translate/result） -->
      <div class="col">
        <div class="lbl"><span>译文</span></div>
        <div class="card">
          <!-- 空态 -->
          <div v-if="state === 'idle'" class="empty">
            <app-icon name="lang" size="lg" />
            <p>输入内容后，点右上角「开始翻译」</p>
          </div>
          <!-- 翻译中 -->
          <div v-else-if="state === 'loading'" class="loading">
            <span class="thinking"><i /><i /><i /></span>翻译中…
          </div>
          <!-- 失败 -->
          <div v-else-if="state === 'fail'" class="fail">
            <p>翻译失败，请检查网络后重试</p>
            <button type="button" class="btn-primary btn-sm" @click="translate">重试</button>
          </div>
          <!-- 完成：三版对照 + 语气要点 + 操作 -->
          <template v-else>
            <div class="trmeta">
              <span class="badge brand">推荐</span>
              <span class="meta">{{ tone }} · {{ style }} · {{ srcLang }} → {{ tgtLang }}</span>
            </div>
            <div class="tabs">
              <button
                v-for="t in TABS"
                :key="t"
                type="button"
                class="tab"
                :class="{ on: tab === t }"
                @click="tab = t"
              >
                {{ t }}
              </button>
            </div>
            <div class="trout">{{ sections[tab] || '—' }}</div>
            <div v-if="sections['语气要点']" class="tonebox">
              <b>语气要点</b>{{ sections['语气要点'] }}
            </div>
            <div class="tracts">
              <button type="button" class="act" @click="copy(sections[tab])">
                <app-icon name="copy" />复制
              </button>
              <button type="button" class="act" @click="speak">
                <app-icon name="volume" />{{ reading ? '停止' : '朗读' }}
              </button>
              <button type="button" class="act" @click="fav">收藏</button>
            </div>
            <div class="claim">内容由 AI 生成，仅供参考</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { message } from 'ant-design-vue';
import { runAgentStream } from '@/api/agent';
import { collectGlossary } from '@/api/glossary';
import { splitSpeakParts, speakSequence, stopTts } from '@/api/tts';
import { parseSections } from '@/utils/answer-parse';
import AppIcon from '@/components/AppIcon.vue';

const TONES = ['正式', '商务', '日常', '学术', '轻松'];
const STYLES = ['完整', '简洁', '有说服力'];
const SAMPLES = [
  '这个报价我们再商量商量，下周给你答复。',
  '麻烦尽快确认一下，我们这边等着排产。',
  '实在抱歉，这批货可能要晚两天到。',
];
const TABS = ['推荐译文', '直译对照', '委婉版'] as const;

const srcLang = ref('中文');
const tgtLang = ref('英语');
const tone = ref('正式');
const style = ref('完整');
const source = ref('感谢贵司对本次合作的支持。关于合同第三条约定的交付时间，我方希望可以顺延至下月十五号，原因是上游供应商的原材料交付出现了延迟，目前正在协调加急生产。');

const state = ref<'idle' | 'loading' | 'done' | 'fail'>('idle');
const sections = ref<Record<string, string>>({});
const tab = ref<'推荐译文' | '直译对照' | '委婉版'>('推荐译文');
const reading = ref(false);

let controller: AbortController | null = null;

function swapLang() {
  const a = srcLang.value;
  srcLang.value = tgtLang.value;
  tgtLang.value = a;
}

/** 发起翻译：agent/run 显式 agentId=translate + source=tool（记录不进主对话流） */
function translate() {
  const text = source.value.trim();
  if (!text || state.value === 'loading') return;

  controller?.abort();
  state.value = 'loading';
  sections.value = {};
  tab.value = '推荐译文';

  const userInput = [
    `【源语言】${srcLang.value}`,
    `【目标语言】${tgtLang.value}`,
    `【语气】${tone.value}`,
    `【风格】${style.value}`,
    `【原文】${text}`,
  ].join('\n');

  let raw = '';
  controller = runAgentStream(
    { userInput, agentId: 'translate', source: 'tool' },
    {
      onDelta(delta) {
        raw += delta;
        sections.value = parseSections(raw);
      },
      onDone() {
        state.value = 'done';
        controller = null;
      },
      onError(err) {
        state.value = 'fail';
        controller = null;
        message.error(err.message || '翻译失败，请重试');
      },
    },
  );
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

/** 朗读推荐译文（后端 TTS，腾讯云 603007 中英混读统一音色） */
async function speak() {
  const text = (sections.value['推荐译文'] || '').trim();
  if (!text) return;
  if (reading.value) {
    stopTts();
    reading.value = false;
    return;
  }
  reading.value = true;
  try {
    // 「首句 + 剩余整段」两块：首句 ~2s 出声，剩余块在首句播放期间预取
    await speakSequence(splitSpeakParts(text), { isActive: () => reading.value });
  } catch {
    if (reading.value) message.error('朗读失败，请重试');
  } finally {
    reading.value = false;
  }
}

async function fav() {
  const main = (sections.value['推荐译文'] || '').trim();
  if (!main) return;
  try {
    await collectGlossary({
      sourceType: 'translate',
      sourceText: source.value || undefined,
      enMain: main,
      note: sections.value['语气要点'] || undefined,
      meta: { tone: tone.value, direction: 'zh2en' },
    });
    message.success('已收进生词本');
  } catch {
    message.error('收藏失败，请重试');
  }
}

function prefs() {
  message.info('偏好设置：默认语言 / 语气 / 风格 · 朗读发音');
}

onBeforeUnmount(() => {
  controller?.abort();
  stopTts();
});
</script>

<style scoped>
.tr {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 32px 24px;
}

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

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--ws-radius-md);
  font-size: 13px;
  color: var(--ws-text-secondary);
  transition: background 0.15s ease;
}

.btn-ghost:hover {
  background: var(--ws-bg-subtle);
}

.tr-pane {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.col {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.lbl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.lbl .cnt {
  font-size: 12px;
  font-weight: 400;
  color: var(--ws-text-tertiary);
}

.langrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.langsel {
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--ws-border);
  border-radius: 16px;
  background: var(--ws-bg-surface);
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-text-primary);
}

.swap {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 50%;
  border: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
  display: grid;
  place-items: center;
  color: var(--ws-text-secondary);
}

.swap:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-500);
}

.src-ta {
  width: 100%;
  min-height: 160px;
  flex: 1;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  padding: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ws-text-primary);
  resize: none;
}

.src-ta:focus {
  border-color: var(--ws-brand-500);
}

.chiprow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.lb {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  flex: 0 0 auto;
}

.chip {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--ws-border);
  border-radius: 13px;
  background: var(--ws-bg-surface);
  font-size: 12px;
  color: var(--ws-text-secondary);
  transition: all 0.12s ease;
}

.chip:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-500);
}

.chip.on {
  border-color: var(--ws-brand-500);
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  font-weight: 500;
}

.samples {
  margin-top: 16px;
}

.samples .lb {
  margin-bottom: 8px;
}

.sample {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-sm);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 8px;
}

.sample:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-500);
}

.card {
  flex: 1;
  min-height: 240px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  padding: 16px;
  overflow: auto;
}

.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ws-text-tertiary);
  font-size: 13px;
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ws-brand-500);
  font-size: 13px;
}

.fail {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--ws-text-secondary);
  font-size: 13px;
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
  animation: b 1.2s infinite;
}

.thinking i:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes b {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.trmeta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.meta {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--ws-border);
  margin-bottom: 12px;
}

.tab {
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--ws-text-secondary);
  border-bottom: 2px solid transparent;
}

.tab.on {
  color: var(--ws-brand-600);
  font-weight: 500;
  border-bottom-color: var(--ws-brand-500);
}

.trout {
  font-size: 14px;
  line-height: 1.9;
  color: var(--ws-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 80px;
}

.tonebox {
  margin-top: 16px;
  padding: 8px 12px;
  background: var(--ws-bg-subtle);
  border-radius: var(--ws-radius-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ws-text-secondary);
}

.tonebox b {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 2px;
}

.tracts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
}

.act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.act:hover {
  background: var(--ws-bg-subtle);
  color: var(--ws-brand-500);
}

.claim {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 12px;
}
</style>
