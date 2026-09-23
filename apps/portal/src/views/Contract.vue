<template>
  <div class="ct">
    <!-- ============ 首页：Hero + 双入口 + 能查什么风险 ============ -->
    <template v-if="step === 'home'">
      <div class="chead">
        <h1>合翻（合同翻译官）</h1>
        <span class="badge brand">签字前，先查一查</span>
      </div>
      <div class="pane">
        <div class="hero">
          <div class="hero-ic"><app-icon name="shield" size="lg" /></div>
          <h2>签字前，先查一查</h2>
          <p>上传合同，AI 帮你翻译成大白话，找出风险点，还能帮你把权益争取回来</p>
        </div>
        <div class="entries">
          <button type="button" class="entry" @click="step = 'upload'">
            <h3><app-icon name="up" />上传合同，立即体检</h3>
            <p>支持 图片 / 粘贴文本 · 自动识别合同类型</p>
          </button>
          <button type="button" class="entry" @click="soonChat">
            <h3><app-icon name="chat" />与 AI 对话，直接体检</h3>
            <p>粘贴合同文字或上传照片 · 像聊天一样出报告</p>
          </button>
        </div>
        <div class="sec">
          <h3>能查什么风险？</h3>
          <div class="riskgrid">
            <div v-for="c in RISK_CARDS" :key="c[0]" class="card riskcard">
              <h4>{{ c[0] }}</h4>
              <p>{{ c[1] }}</p>
            </div>
          </div>
        </div>
        <div class="claim">
          仅用于理解合同、识别风险，不构成法律 / 理财 / 投资建议。重大决策请咨询持牌专业人士。
        </div>
      </div>
    </template>

    <!-- ============ 上传：拖拽图片 OCR / 粘贴文本 ============ -->
    <template v-else-if="step === 'upload'">
      <div class="chead">
        <h1>上传合同</h1>
        <span class="badge">第 1 步 / 共 3 步</span>
      </div>
      <div class="pane">
        <div class="steps">
          <template v-for="(s, i) in STEP_LABELS" :key="s">
            <div class="s" :class="{ done: i + 1 < stepIndex, on: i + 1 === stepIndex }">
              <span class="n">
                <app-icon v-if="i + 1 < stepIndex" name="check" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              {{ s }}
            </div>
            <app-icon v-if="i < STEP_LABELS.length - 1" name="right" class="arw" />
          </template>
        </div>

        <div
          class="drop"
          :class="{ on: dragging, busy: ocring }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <template v-if="ocring">
            <span class="thinking"><i /><i /><i /></span>
            <h3>正在识别图片文字…</h3>
            <p>OCR 约需几秒，识别结果会填入下方文本框，可再手工修改</p>
          </template>
          <template v-else>
            <div class="drop-ic"><app-icon name="up" size="lg" /></div>
            <h3>上传需要体检的合同</h3>
            <p>拖拽<b>图片</b>到此处，或点击选择 / 直接在下方粘贴文本（不超过 8000 字）</p>
            <p class="note">
              图片走 OCR 识别（对齐小程序）；<b>PDF / Word 解析本轮不支持</b>（Q11 拍板）
            </p>
            <div class="drop-acts">
              <button type="button" class="btn-ghost" @click="pickFile">选择图片（OCR）</button>
              <button type="button" class="btn-ghost" @click="useSample">使用示例合同</button>
              <button type="button" class="btn-primary" :disabled="!text.trim()" @click="startAnalyze">
                开始 AI 体检
              </button>
            </div>
          </template>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden-file"
          @change="onFileChange"
        />

        <div class="card ta-card">
          <div class="ta-head">
            <span>合同文本</span>
            <span class="spacer" />
            <span class="cnt">{{ text.length }} / 8000</span>
          </div>
          <textarea
            v-model="text"
            class="ta"
            maxlength="8000"
            spellcheck="false"
            placeholder="把合同文字粘贴到这里；也可先选图片做 OCR，结果会填进来"
          />
        </div>

        <div class="chiprow">
          <span class="lb">合同场景（不选则自动识别）</span>
          <button
            v-for="s in SCENES"
            :key="s"
            type="button"
            class="chip"
            :class="{ on: scene === s }"
            @click="scene = s"
          >
            {{ s }}
          </button>
        </div>
        <div class="claim">内容仅用于本次解读 · 可随时删除 · 不用于模型训练</div>
      </div>
    </template>

    <!-- ============ 分析中：思考条 + 5 步计划 + 可取消 ============ -->
    <template v-else-if="step === 'analyzing'">
      <div class="chead">
        <h1>AI 合同解读中</h1>
        <span class="badge">第 2 步 / 共 3 步</span>
      </div>
      <div class="pane">
        <div class="steps">
          <template v-for="(s, i) in STEP_LABELS" :key="s">
            <div class="s" :class="{ done: i + 1 < stepIndex, on: i + 1 === stepIndex }">
              <span class="n">
                <app-icon v-if="i + 1 < stepIndex" name="check" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              {{ s }}
            </div>
            <app-icon v-if="i < STEP_LABELS.length - 1" name="right" class="arw" />
          </template>
        </div>
        <div class="card prog">
          <span class="thinking"><i /><i /><i /></span>
          <h3>正在为你体检合同</h3>
          <p>AI 正在写报告，已生成 {{ rawLen }} 字…</p>
          <div class="thinkbar">
            <app-icon name="spark" />
            <span class="flex1">{{ reasoning ? 'AI 思考中…' : 'AI 正在梳理条款…' }}</span>
            <span class="tag ok">进行中</span>
            <button type="button" class="btn-ghost btn-sm" @click="showReasoning = true">
              查看完整思考 ›
            </button>
          </div>
          <div class="plan">
            <div v-for="p in plan" :key="p.label" class="st" :class="p.state">
              <span class="i">
                <app-icon v-if="p.state === 'done'" name="check" />
                <span v-else-if="p.state === 'run'" class="thinking"><i /><i /><i /></span>
                <template v-else-if="p.state === 'skip'">—</template>
                <template v-else>○</template>
              </span>
              {{ p.label }}
              <span class="flex1" />
              <span class="st-tip">{{ PLAN_TIP[p.state] }}</span>
            </div>
          </div>
          <div class="prog-acts">
            <button type="button" class="btn-ghost" @click="cancelAnalyze">取消体检</button>
            <button type="button" class="btn-ghost" @click="showReasoning = true">
              查看完整思考
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 体检失败：原文保留，给重试 / 返回 ============ -->
    <template v-else-if="step === 'fail'">
      <div class="chead">
        <h1>合同体检未完成</h1>
        <span class="badge hi">未完成</span>
      </div>
      <div class="pane">
        <div class="steps">
          <template v-for="(s, i) in STEP_LABELS" :key="s">
            <div class="s" :class="{ done: i + 1 < stepIndex, on: i + 1 === stepIndex }">
              <span class="n">
                <app-icon v-if="i + 1 < stepIndex" name="check" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              {{ s }}
            </div>
            <app-icon v-if="i < STEP_LABELS.length - 1" name="right" class="arw" />
          </template>
        </div>
        <div class="card fail">
          <div class="fail-ic"><app-icon name="warn" size="lg" /></div>
          <h3>这次体检没跑完</h3>
          <p>AI 生成报告时中断（{{ failMsg }}）。合同文本还在，可直接重试。</p>
          <div class="fail-acts">
            <button type="button" class="btn-ghost" @click="step = 'upload'">返回修改</button>
            <button type="button" class="btn-primary" @click="startAnalyze">重试体检</button>
          </div>
        </div>
        <div class="claim">合同文本不会丢失，可直接重试，也可修改后再试</div>
      </div>
    </template>

    <!-- ============ 报告 ============ -->
    <template v-else>
      <div class="chead">
        <h1>{{ report?.scene || '合同' }} · 体检报告</h1>
        <span class="badge ok">体检完成</span>
        <span class="spacer" />
        <button type="button" class="btn-ghost" @click="backHome">
          <app-icon name="left" />回到首页
        </button>
        <button type="button" class="btn-ghost" :disabled="!hasReport" @click="exportReport">
          <app-icon name="download" />导出报告
        </button>
        <button type="button" class="btn-primary btn-sm" @click="focusAsk">继续追问</button>
      </div>

      <div class="pane">
        <!-- 空态：解析不出结构化结论时不渲染半张报告 -->
        <div v-if="!hasReport" class="card empty">
          <div class="empty-ic"><app-icon name="doc" size="lg" /></div>
          <h3>暂无报告数据</h3>
          <p>这次没能解析出风险结论，换一份更完整的合同文本再试一次</p>
          <button type="button" class="btn-primary btn-sm" @click="step = 'upload'">重新体检</button>
        </div>

        <template v-else>
          <!-- 健康指数 + 一句话结论 -->
          <div class="card scorecard">
            <div
              class="ring"
              :style="{
                background: `conic-gradient(var(${ringColor}) 0 ${score}%, var(--ws-bg-subtle) ${score}% 100%)`,
              }"
            >
              <span>{{ score }}</span>
            </div>
            <div class="score-txt">
              <div class="score-t">健康指数 · {{ riskLevelLabel(score) }}</div>
              <p>{{ scoreSummary }}</p>
            </div>
          </div>
          <div class="card concl">
            <h3>一句话结论</h3>
            <p>{{ report?.conclusion }}</p>
          </div>

          <!-- 关键数字 -->
          <div v-if="report?.keyNumbers.length" class="kn">
            <div v-for="k in report.keyNumbers" :key="k.label" class="card">
              <div class="v">{{ k.value }}</div>
              <div class="l">{{ k.label }}</div>
            </div>
          </div>

          <!-- 风险信号 -->
          <div class="sec">
            <h3>风险信号（{{ report?.signals.length }} 项）</h3>
            <div v-for="s in report?.signals" :key="s.id" class="sigitem">
              <div class="s-hd" @click="toggleSignal(s.id)">
                <span class="lv" :class="s.level">{{ s.level === 'danger' ? '!' : s.level === 'warn' ? '?' : '✓' }}</span>
                <span class="ttl">{{ s.signalTitle }}</span>
                <button type="button" class="btn-ghost btn-sm" @click.stop="toggleSignal(s.id)">
                  {{ expandedId === s.id ? '收起' : '展开' }}
                </button>
              </div>
              <div v-if="expandedId === s.id" class="s-bd">
                <p class="plain">{{ s.plainText }}</p>
                <div v-if="s.legalBasis.law || s.legalBasis.quote" class="law2">
                  <b>{{ [s.legalBasis.law, s.legalBasis.article].filter(Boolean).join(' ') }}</b>
                  <template v-if="s.legalBasis.quote"><br />{{ s.legalBasis.quote }}</template>
                </div>
                <div v-if="s.actions.length" class="blk">
                  <div class="h">你可以怎么做</div>
                  <ol>
                    <li v-for="a in s.actions" :key="a">{{ a }}</li>
                  </ol>
                </div>
                <div v-if="s.termExplain" class="blk">
                  <div class="h">这是什么意思</div>
                  {{ s.termExplain }}
                </div>
                <div v-if="s.askableQuestions.length" class="blk">
                  <div class="h">追问</div>
                  <div class="askwrap">
                    <button
                      v-for="q in s.askableQuestions"
                      :key="q"
                      type="button"
                      class="ask"
                      @click.stop="ask(q)"
                    >
                      追问：{{ q }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 我的权益 -->
          <div v-if="report?.rights.length" class="sec">
            <h3>我的权益（{{ report.rights.length }} 条可主张）</h3>
            <div v-for="r in report.rights" :key="r.id" class="rightitem">
              <div class="r-hd">
                <span class="r-t"><app-icon name="shield" />{{ r.title }}</span>
                <span v-if="r.amount" class="amt">可争取 {{ formatAmount(r.amount) }}</span>
              </div>
              <p class="r-d">{{ r.description }}</p>
              <div v-if="r.legalBasis.law" class="law2">
                {{ [r.legalBasis.law, r.legalBasis.article].filter(Boolean).join(' ') }}
              </div>
              <div v-if="r.actions.length" class="blk">
                <div class="h">你可以这样做</div>
                <ol>
                  <li v-for="a in r.actions" :key="a">{{ a }}</li>
                </ol>
              </div>
            </div>
          </div>

          <!-- 权益最大化 -->
          <div v-if="report?.optimize.length" class="sec">
            <h3>怎么把权益最大化（{{ report.optimize.length }} 个关键时机）</h3>
            <div v-for="(o, i) in report.optimize" :key="`${o.stage}-${i}`" class="rightitem">
              <div class="r-hd">
                <span class="stage">{{ o.stage }}</span>
                <span class="r-t">{{ o.title }}</span>
              </div>
              <p class="r-d">{{ o.plainText }}</p>
              <div v-if="o.actions.length" class="blk">
                <div class="h">你可以这样做</div>
                <ol>
                  <li v-for="a in o.actions" :key="a">{{ a }}</li>
                </ol>
              </div>
            </div>
          </div>

          <!-- 追问区：复用报告 conversationId 续跑同一会话 -->
          <div ref="askRef" class="card askcard">
            <app-icon name="chat" size="lg" />
            <div class="ask-main">
              <div class="ask-t">有疑问？继续追问 AI</div>
              <p class="ask-s">基于本次合同上下文回答 · 直接问任何条款问题</p>
            </div>
            <button type="button" class="btn-primary btn-sm" @click="focusAsk">追问</button>
          </div>
          <div class="card askbox">
            <textarea
              ref="askInputRef"
              v-model="askInput"
              class="ask-ta"
              rows="2"
              placeholder="例如：这个违约金条款可以要求改吗？"
              @keydown.enter.exact.prevent="sendAsk"
            />
            <div class="ask-acts">
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!askAnswer"
                @click="copyText(askAnswer)"
              >
                复制
              </button>
              <button v-if="asking" type="button" class="btn-ghost btn-sm" @click="stopAsk">
                <app-icon name="stop" />停止
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                :disabled="asking || !askInput.trim()"
                @click="sendAsk"
              >
                {{ asking ? '追问中…' : '发送追问' }}
              </button>
            </div>
            <div v-if="askAnswer || asking" class="askanswer">
              <span v-if="asking && !askAnswer" class="thinking"><i /><i /><i /></span>
              <span class="whitespace-pre">{{ askAnswer }}</span>
            </div>
          </div>

          <div class="claim">{{ report?.disclaimer }}</div>
        </template>
      </div>
    </template>

    <!-- 完整思考过程 -->
    <a-modal
      :open="showReasoning"
      title="AI 思考过程"
      :footer="null"
      :width="640"
      @cancel="showReasoning = false"
    >
      <div class="reasoning">{{ reasoning || '（本次没有返回思考过程）' }}</div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { runAgentStream } from '@/api/agent';
import { readFileAsBase64, recognizeOcr } from '@/api/ocr';
import {
  healthScore,
  parseContractReport,
  pickKeyword,
  riskLevelLabel,
} from '@/utils/contract-report';
import type { ContractReport } from '@/types/contract';
import { useContextPanel } from '@/stores/context';
import ContractOriginal from '@/components/contract/ContractOriginal.vue';
import AppIcon from '@/components/AppIcon.vue';

type Step = 'home' | 'upload' | 'analyzing' | 'fail' | 'result';

const STEP_LABELS = ['选择方式', '上传合同', '查看报告'];
const SCENES = ['自动识别', '房屋租赁', '劳动合同', '买卖合同'];
const RISK_CARDS = [
  ['消费贷 / 购车贷款', '真实年化利率 · 砍头息 · 违约金'],
  ['保险条款', '保障责任 · 免责 · 等待期'],
  ['租房合同', '押金 · 违约金 · 维修责任'],
  ['其他合同', '格式条款 · 强制搭售'],
];
const PLAN_TIP: Record<string, string> = {
  done: '完成',
  run: '进行中…',
  skip: '已跳过',
  wait: '待执行',
};

/** 示例合同：与原型 CONTRACT_SAMPLE 同源（条款编号与风险信号对得上） */
const SAMPLE_CONTRACT = [
  '房屋租赁合同',
  '甲方（出租方）：王某　乙方（承租方）：李某',
  '第一条 房屋基本情况：甲方将位于 XX 市 XX 区 XX 路 88 号 2 单元 501 室的房屋出租给乙方使用，建筑面积 68 平方米。',
  '第二条 租赁期限：自 2026 年 10 月 1 日起至 2028 年 9 月 30 日止，共计 24 个月。',
  '第五条 租金及支付方式：5.1 乙方应于每月 5 日前向甲方支付当月租金人民币 8,500 元。5.2 租金递增比例由甲方于每年度开始前 30 日书面通知乙方，乙方不得异议。5.3 乙方逾期支付租金的，每逾期一日按当月租金的 5% 向甲方支付违约金。',
  '第七条 押金：乙方于签约时支付押金人民币 25,500 元；7.2 退租时房屋损耗赔偿金由甲方核定，从押金中扣除。',
  '第九条 提前解约：9.1 租赁期内乙方提前退租的，应向甲方支付相当于 3 个月租金的违约金。',
].join('\n');

const step = ref<Step>('home');
const text = ref('');
const scene = ref(SCENES[0]);
const dragging = ref(false);
const ocring = ref(false);

const rawLen = ref(0);
const reasoning = ref('');
const showReasoning = ref(false);
const failMsg = ref('网络波动或模型超时');

const report = ref<ContractReport | null>(null);
const conversationId = ref<string | null>(null);
const expandedId = ref<string | null>(null);

const askInput = ref('');
const askAnswer = ref('');
const asking = ref(false);
const askInputRef = ref<HTMLTextAreaElement | null>(null);
const askRef = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const ctx = useContextPanel();

let controller: ReturnType<typeof runAgentStream> | null = null;
let askController: ReturnType<typeof runAgentStream> | null = null;

const hasReport = computed(() => !!report.value && (!!report.value.signals.length || !!report.value.rights.length));
const score = computed(() => healthScore(report.value?.signals ?? []));
const ringColor = computed(() => {
  if (score.value >= 80) return '--ws-success-500';
  if (score.value >= 60) return '--ws-warning-500';
  return '--ws-error-500';
});
const scoreSummary = computed(() => {
  const signals = report.value?.signals ?? [];
  const danger = signals.filter((s) => s.level === 'danger').length;
  const warn = signals.filter((s) => s.level === 'warn').length;
  if (!signals.length) return '这份合同没有识别出明显风险信号，签署前仍建议通读一遍。';
  return `发现 ${danger} 项高风险、${warn} 项中风险，建议就下方标注的条款重新协商后再签署。`;
});

const stepIndex = computed<number>(
  () => ({ home: 0, upload: 1, analyzing: 2, fail: 2, result: 3 })[step.value],
);

/** 执行计划：按已生成字数推进（真实进度不可得，只做可视化，不谎报完成） */
const plan = computed(() => [
  { label: '清洗合同文本', state: 'done' },
  { label: '扫描法定风险信号', state: rawLen.value ? 'done' : 'run' },
  { label: '测算真实年化利率', state: 'skip' },
  { label: '对比市场基准', state: rawLen.value > 120 ? 'done' : rawLen.value ? 'run' : 'wait' },
  { label: '生成体检报告', state: rawLen.value > 120 ? 'run' : 'wait' },
]);

/** 报告 ↔ 右栏原文联动关键词（Q1 兜底：关键词回查，命中不到不高亮） */
const activeKeyword = computed(() => {
  if (!expandedId.value || !report.value) return '';
  const sig = report.value.signals.find((s) => s.id === expandedId.value);
  return sig ? pickKeyword(sig.signalTitle, text.value) : '';
});

/* ==================== 上传 ==================== */

function pickFile() {
  fileInput.value?.click();
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void doOcr(file);
  (e.target as HTMLInputElement).value = '';
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) void doOcr(file);
}

async function doOcr(file: File) {
  // Q11 拍板：本轮只有图片 OCR，PDF / Word 必须明确拒绝，不能让用户拖了没反应
  if (!file.type.startsWith('image/')) {
    message.error('本轮仅支持图片 OCR，PDF / Word 解析不支持（Q11）');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message.error('图片超过 10MB，请压缩后再上传');
    return;
  }
  ocring.value = true;
  try {
    const base64 = await readFileAsBase64(file);
    const res = await recognizeOcr(base64, scene.value === SCENES[0] ? undefined : scene.value);
    if (!res.text.trim()) {
      message.warning('没识别出文字，可直接粘贴合同文本');
      return;
    }
    text.value = res.text;
    message.success(`识别到 ${res.blockCount} 段文字，可在下方修改`);
  } catch (err) {
    message.error((err as Error)?.message || 'OCR 识别失败，可改用粘贴文本');
  } finally {
    ocring.value = false;
  }
}

function useSample() {
  text.value = SAMPLE_CONTRACT;
  scene.value = '房屋租赁';
}

function soonChat() {
  message.info('对话式体检排在 P2，本轮可先上传合同出报告');
}

/* ==================== 分析 ==================== */

function startAnalyze() {
  const body = text.value.trim();
  if (!body) return;

  controller?.abort();
  step.value = 'analyzing';
  rawLen.value = 0;
  reasoning.value = '';
  report.value = null;
  conversationId.value = null;
  expandedId.value = '';
  askAnswer.value = '';
  askInput.value = '';

  let raw = '';
  const userInput = scene.value && scene.value !== SCENES[0]
    ? `【合同场景】${scene.value}\n【合同内容】\n${body}\n\n请识别这份合同的风险，输出结构化风险报告。`
    : `【合同内容】\n${body}\n\n请判断合同类型并识别风险，输出结构化风险报告。`;

  controller = runAgentStream(
    { userInput, agentId: 'contract-risk', source: 'tool' },
    {
      onDelta(delta) {
        raw += delta;
        rawLen.value = raw.length;
      },
      onReasoning(delta) {
        reasoning.value += delta;
      },
      onDone(cid) {
        conversationId.value = cid ?? null;
        report.value = parseContractReport(raw);
        step.value = 'result';
        controller = null;
      },
      onError(err) {
        failMsg.value = err.message || '网络波动或模型超时';
        step.value = 'fail';
        controller = null;
      },
    },
  );
}

function cancelAnalyze() {
  Modal.confirm({
    title: '取消本次体检？',
    content: '取消后本次识别将中止，已上传的合同不会保存。',
    okText: '取消体检',
    cancelText: '继续体检',
    onOk() {
      controller?.abort();
      controller = null;
      step.value = 'upload';
    },
  });
}

/* ==================== 报告交互 ==================== */

function toggleSignal(id: string) {
  expandedId.value = expandedId.value === id ? '' : id;
}

function backHome() {
  report.value = null;
  expandedId.value = '';
  askAnswer.value = '';
  askInput.value = '';
  step.value = 'home';
}

function formatAmount(n: number): string {
  return `¥${n.toLocaleString('zh-CN')}`;
}

async function copyText(val: string) {
  if (!val) return;
  try {
    await navigator.clipboard.writeText(val);
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动选择文本');
  }
}

/** 导出：小程序是 toast 占位，PC 落地为 Markdown 文件下载（本机 Blob，无后端依赖） */
function exportReport() {
  const r = report.value;
  if (!r || !hasReport.value) return;
  const lines: string[] = [
    `# 合同体检报告 · ${r.scene}`,
    '',
    `生成时间：${new Date(r.createdAt).toLocaleString('zh-CN')}`,
    `健康指数：${score.value}（${riskLevelLabel(score.value)}）`,
  ];
  if (r.conclusion) lines.push('', '## 一句话结论', r.conclusion);
  if (r.keyNumbers.length) {
    lines.push('', '## 关键数字');
    r.keyNumbers.forEach((k) => lines.push(`- ${k.label}：${k.value}`));
  }
  if (r.signals.length) {
    lines.push('', `## 风险信号（${r.signals.length} 项）`);
    r.signals.forEach((s, i) => {
      const lv = s.level === 'danger' ? '高风险' : s.level === 'warn' ? '中风险' : '提示';
      lines.push('', `### ${i + 1}. [${lv}] ${s.signalTitle}`);
      if (s.plainText) lines.push(s.plainText);
      if (s.legalBasis.law) lines.push(`- 依据：${[s.legalBasis.law, s.legalBasis.article].filter(Boolean).join(' ')}`);
      s.actions.forEach((a) => lines.push(`- 可做：${a}`));
    });
  }
  if (r.rights.length) {
    lines.push('', `## 我的权益（${r.rights.length} 条）`);
    r.rights.forEach((t) => {
      lines.push('', `### ${t.title}${t.amount ? `（可争取 ${formatAmount(t.amount)}）` : ''}`);
      if (t.description) lines.push(t.description);
      t.actions.forEach((a) => lines.push(`- 可做：${a}`));
    });
  }
  if (r.optimize.length) {
    lines.push('', '## 权益最大化');
    r.optimize.forEach((o) => {
      lines.push('', `### ${o.stage} · ${o.title}`);
      if (o.plainText) lines.push(o.plainText);
      o.actions.forEach((a) => lines.push(`- 可做：${a}`));
    });
  }
  lines.push('', '---', r.disclaimer);

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `合同体检报告-${new Date(r.createdAt).toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('报告已导出');
}

/* ==================== 追问（复用报告会话） ==================== */

function focusAsk() {
  void nextTick(() => {
    askRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    askInputRef.value?.focus();
  });
}

function ask(q: string) {
  askInput.value = q;
  void sendAsk();
}

function sendAsk() {
  const q = askInput.value.trim();
  if (!q || asking.value) return;
  askAnswer.value = '';
  asking.value = true;
  askController?.abort();
  askController = runAgentStream(
    {
      userInput: q,
      agentId: 'contract-risk',
      source: 'tool',
      ...(conversationId.value ? { conversationId: conversationId.value } : {}),
    },
    {
      onDelta(delta) {
        askAnswer.value += delta;
      },
      onDone(cid) {
        if (cid) conversationId.value = cid;
        asking.value = false;
        askController = null;
      },
      onError(err) {
        asking.value = false;
        askController = null;
        message.error(err.message || '追问失败，请重试');
      },
    },
  );
}

function stopAsk() {
  askController?.abort();
  askController = null;
  asking.value = false;
}

/* ==================== 右栏：合同原文 ==================== */

function syncContext() {
  if (step.value === 'result' && hasReport.value && text.value.trim()) {
    ctx.set({
      title: '合同原文',
      component: ContractOriginal,
      props: { text: text.value, keyword: activeKeyword.value },
    });
  } else {
    ctx.clear();
  }
}

watch([step, activeKeyword, hasReport], syncContext, { immediate: true });

onBeforeUnmount(() => {
  controller?.abort();
  askController?.abort();
  ctx.clear();
});
</script>

<style scoped>
.ct {
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
  background: var(--ws-bg-subtle);
  color: var(--ws-text-secondary);
  display: inline-flex;
  align-items: center;
}

.badge.brand {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
}

.badge.ok {
  background: var(--ws-success-100);
  color: var(--ws-success-500);
}

.badge.hi {
  background: var(--ws-error-100);
  color: var(--ws-error-500);
}

.spacer,
.flex1 {
  flex: 1;
}

.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}

.card {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
}

/* ---- 首页 ---- */
.hero {
  padding: 32px;
  text-align: center;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-50);
  border: 1px solid var(--ws-border);
  margin-bottom: 16px;
}

.hero-ic {
  margin-bottom: 8px;
  color: var(--ws-brand-600);
  display: grid;
  place-items: center;
}

.hero h2 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--ws-text-primary);
}

.hero p {
  font-size: 14px;
  color: var(--ws-text-secondary);
  max-width: 520px;
  margin: 0 auto;
}

.entries {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.entry {
  text-align: left;
  padding: 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.entry:hover {
  border-color: var(--ws-brand-500);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.entry h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 4px;
}

.entry p {
  font-size: 13px;
  color: var(--ws-text-tertiary);
}

.sec {
  margin-bottom: 24px;
}

.sec > h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-tertiary);
  margin-bottom: 8px;
}

.riskgrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.riskcard {
  padding: 16px;
}

.riskcard h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 4px;
}

.riskcard p {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.7;
}

.claim {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.8;
}

/* ---- 步骤条 ---- */
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--ws-text-tertiary);
}

.steps .s {
  display: flex;
  align-items: center;
  gap: 8px;
}

.steps .s.on {
  color: var(--ws-brand-600);
  font-weight: 600;
}

.steps .s.done {
  color: var(--ws-success-500);
}

.steps .n {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--ws-bg-subtle);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.steps .s.on .n {
  background: var(--ws-brand-500);
  color: #fff;
}

.steps .s.done .n {
  background: var(--ws-success-500);
  color: #fff;
}

.arw {
  color: var(--ws-text-tertiary);
  opacity: 0.6;
}

/* ---- 上传 ---- */
.drop {
  border: 2px dashed var(--ws-border);
  border-radius: var(--ws-radius-md);
  padding: 40px;
  text-align: center;
  background: var(--ws-bg-surface);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.drop.on {
  border-color: var(--ws-brand-500);
  background: var(--ws-brand-50);
}

.drop h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 4px;
}

.drop p {
  font-size: 13px;
  color: var(--ws-text-secondary);
}

.drop .note {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 8px;
}

.drop-ic {
  margin-bottom: 12px;
  color: var(--ws-brand-600);
  display: grid;
  place-items: center;
}

.drop-acts {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
}

.hidden-file {
  display: none;
}

.ta-card {
  padding: 12px;
  margin-top: 16px;
}

.ta-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.cnt {
  font-size: 12px;
  font-weight: 400;
  color: var(--ws-text-tertiary);
}

.ta {
  width: 100%;
  min-height: 180px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-sm);
  padding: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ws-text-primary);
  background: var(--ws-bg-surface);
  resize: vertical;
}

.ta:focus {
  border-color: var(--ws-brand-500);
}

.chiprow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.lb {
  font-size: 12px;
  color: var(--ws-text-tertiary);
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

/* ---- 分析中 ---- */
.prog {
  padding: 32px;
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
}

.prog h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}

.prog > p {
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 16px;
}

.thinkbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-sm);
  background: var(--ws-bg-subtle);
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 16px;
  text-align: left;
}

.tag {
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.tag.ok {
  background: var(--ws-success-100);
  color: var(--ws-success-500);
}

.plan {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  text-align: left;
}

.plan .st {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan .st .i {
  flex: 0 0 16px;
  display: grid;
  place-items: center;
}

.plan .st.run {
  color: var(--ws-brand-600);
  font-weight: 500;
}

.plan .st.done {
  color: var(--ws-success-500);
}

.plan .st.wait,
.plan .st.skip {
  color: var(--ws-text-tertiary);
}

.st-tip {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.prog-acts {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 24px;
}

/* ---- 失败 ---- */
.fail {
  padding: 32px;
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
}

.fail-ic {
  margin-bottom: 12px;
  color: var(--ws-error-500);
  display: grid;
  place-items: center;
}

.fail h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}

.fail p {
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 16px;
}

.fail-acts {
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* ---- 报告 ---- */
.scorecard {
  padding: 20px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.ring {
  width: 88px;
  height: 88px;
  flex: 0 0 88px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
}

.ring::after {
  content: '';
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  background: var(--ws-bg-surface);
}

.ring span {
  position: relative;
  z-index: 1;
  font-size: 28px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.score-t {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.score-txt p {
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-top: 4px;
  line-height: 1.7;
}

.concl {
  padding: 16px;
  margin-bottom: 16px;
}

.concl h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-tertiary);
  margin-bottom: 8px;
}

.concl p {
  font-size: 14px;
  line-height: 1.8;
  color: var(--ws-text-primary);
}

.kn {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.kn .card {
  padding: 16px;
  text-align: center;
}

.kn .v {
  font-size: 20px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.kn .l {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
}

.sigitem {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  margin-bottom: 8px;
  background: var(--ws-bg-surface);
  overflow: hidden;
}

.s-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  cursor: pointer;
}

.s-hd:hover {
  background: var(--ws-bg-subtle);
}

.lv {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.lv.danger {
  background: var(--ws-error-500);
}

.lv.warn {
  background: var(--ws-warning-500);
}

.lv.ok {
  background: var(--ws-success-500);
}

.ttl {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--ws-text-primary);
}

.s-bd {
  padding: 0 16px 16px;
  border-top: 1px solid var(--ws-border);
  font-size: 13px;
  color: var(--ws-text-secondary);
  line-height: 1.8;
}

.plain {
  padding-top: 16px;
}

.law2 {
  padding: 8px 16px;
  border-left: 3px solid var(--ws-brand-500);
  background: var(--ws-brand-50);
  border-radius: 0 var(--ws-radius-sm) var(--ws-radius-sm) 0;
  margin-top: 8px;
  font-size: 13px;
  color: var(--ws-text-secondary);
}

.blk {
  margin-top: 16px;
}

.blk .h {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 4px;
}

.blk ol {
  list-style: decimal;
  padding-left: 20px;
  margin: 0;
  font-size: 13px;
}

.blk ol li {
  margin-bottom: 4px;
}

.askwrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.ask {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--ws-border);
  border-radius: 13px;
  background: var(--ws-bg-surface);
  font-size: 12px;
  color: var(--ws-text-secondary);
}

.ask:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-600);
}

.rightitem {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  padding: 16px;
  margin-bottom: 8px;
  background: var(--ws-bg-surface);
}

.r-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.r-t {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.amt {
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-brand-600);
}

.r-d {
  font-size: 13px;
  color: var(--ws-text-secondary);
  line-height: 1.7;
}

.stage {
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

.askcard {
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--ws-brand-50);
  border-color: var(--ws-border);
  margin-bottom: 16px;
}

.ask-main {
  flex: 1;
}

.ask-t {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.ask-s {
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-top: 2px;
}

.askbox {
  padding: 16px;
  margin-bottom: 16px;
}

.ask-ta {
  width: 100%;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-sm);
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ws-text-primary);
  resize: vertical;
}

.ask-ta:focus {
  border-color: var(--ws-brand-500);
}

.ask-acts {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.askanswer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
  font-size: 14px;
  line-height: 1.8;
  color: var(--ws-text-primary);
}

.whitespace-pre {
  white-space: pre-wrap;
  word-break: break-word;
}

.empty {
  padding: 64px 24px;
  text-align: center;
  color: var(--ws-text-tertiary);
}

.empty-ic {
  margin: 0 auto 16px;
  color: var(--ws-brand-500);
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
}

.empty h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 4px;
}

.empty p {
  font-size: 13px;
  margin-bottom: 16px;
}

.reasoning {
  font-size: 13px;
  line-height: 1.8;
  color: var(--ws-text-secondary);
  white-space: pre-wrap;
  max-height: 50vh;
  overflow-y: auto;
}

/* ---- 通用控件 ---- */
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

.btn-ghost:hover:not(:disabled) {
  background: var(--ws-bg-subtle);
  color: var(--ws-brand-600);
}

.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  animation: bounce 1.2s infinite;
}

.thinking i:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes bounce {
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
</style>
