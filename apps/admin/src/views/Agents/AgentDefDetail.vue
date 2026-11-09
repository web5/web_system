<!--
  Agent 定义详情页（page-spec v2 形态：独立页面 + 基础/高级两卡 + 高级内模型参数调试工作台）
  真源：docs/ui/page-specs/agent-def-detail-v2.md（v1 弹窗版已废弃）、docs/ui/prototypes/admin-agent-def-detail.html 屏②
  契约：contracts.md §7 C7-b 互斥 / C7-c null 语义 / C7-e 不预填 0.7 / C7-h 传了才覆盖
  视觉：--ws-* 工程端 token（D5 口径）
-->
<template>
  <a-page-header
    :title="isCreate ? '新建 Agent' : `Agent 定义 · ${routeId}`"
    :sub-title="isCreate ? '配置化建档，保存为草稿后发布生效' : '基础配置与高级调参；调参区仅管理员及以上可见'"
    @back="goBack"
  >
    <!-- 锚点 detail-back：挂在**返回图标**上而非整块 header（挂整块会把语义泛化成"页头"，A3） -->
    <template #backIcon>
      <span data-dr="detail-back"><arrow-left-outlined /></span>
    </template>
    <template #extra>
      <template v-if="!isCreate && currentDef">
        <a-tag :color="currentDef.status === 'published' ? 'green' : 'orange'">
          {{ currentDef.status === 'published' ? '已发布' : '草稿' }}
        </a-tag>
        <a-tag>v{{ currentDef.version }}</a-tag>
      </template>
      <a-button data-dr="detail-discard" @click="resetForm">放弃更改</a-button>
      <a-button data-dr="detail-save" type="primary" :loading="saving" :disabled="!canManage" @click="save">保存</a-button>
    </template>
  </a-page-header>

  <!-- 内联确认条（page-spec v2 §1：丢弃确认/返回拦截不用弹窗，用内联确认条） -->
  <div v-if="confirmBar" class="cfm-bar" role="alert">
    <span class="cfm-text">
      {{ confirmBar === 'back' ? '返回将丢弃未保存的修改，确认返回？' : '放弃未保存的修改？' }}
    </span>
    <a-button size="small" type="primary" danger @click="confirmBarOk">
      {{ confirmBar === 'back' ? '放弃并返回' : '确认放弃' }}
    </a-button>
    <a-button size="small" @click="confirmBar = ''">继续编辑</a-button>
  </div>

  <!-- 未保存变更条（B2c 面板级对比）：sticky，就地展开 diff 表，不用弹窗（page-spec v2 §4）
       [必读] 只在编辑态出现：新建没有「原值」，谈「与载入值不同」是无意义的。
       role="status"（原型同款，aria-live=polite）。注意这里只做到一半：整条随 v-if 增删，
       而「新插入的 live region」多数读屏不播报，只有区域内文本变化才播报 ——
       所以首次出现那一跳可能静音，1 项→2 项会播。要彻底达标得让区域常驻 DOM（原型用 .hidden
       常驻，但它 display:none 期间同样不播报，也不算达标）。未实测读屏，别按「已无障碍」引用。 -->
  <div v-if="!isCreate && tuningDiffs.length" data-dr="diff-bar" class="diff-bar" role="status">
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9v4M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
    <span><b>{{ tuningDiffs.length }}</b> 项参数未保存，与载入时不同</span>
    <span class="sp"></span>
    <a-button
      size="small"
      :aria-expanded="diffOpen"
      :aria-controls="diffOpen ? 'dr-diff-table' : undefined"
      @click="diffOpen = !diffOpen"
    >{{ diffOpen ? '收起对比' : '查看对比' }}</a-button>
    <a-button size="small" @click="resetForm">全部还原</a-button>
  </div>
  <!-- diff 表：用 v-if 而非 v-show —— 折叠态不该留 DOM，否则「看不见的行」照样能被断言到，
       也照样会被读屏读出来。同理 aria-controls 收起态不给值：指向不存在的 id 是 IDREF 悬空
       （原型用 hidden + 常驻 DOM，故它没这个问题；我们改了取舍就得自己补上这一半）。 -->
  <div
    v-if="!isCreate && diffOpen && tuningDiffs.length"
    id="dr-diff-table"
    data-dr="diff-table"
    class="diff-table"
  >
    <div v-for="d in tuningDiffs" :key="d.field" class="diff-row">
      <span class="dk">{{ d.label }}</span>
      <span class="dv">{{ d.before }}</span>
      <span class="arw">→</span>
      <span class="dn">{{ d.after }}</span>
    </div>
  </div>

  <a-spin :spinning="loading">
    <!-- 锚点 error-cta：设计系统 S4「失败须有可重试路径」——加载失败不能只有一句话，必须给出路。
         D4（2026-11-06 盲测）：主文案曾被 axios 原始串占满（实测直接显示「Network Error」），
         违反 page-spec §2.1「技术文案不进产品页面」。现在拆三层：
         ① 主文案 = 业务结论（发生了什么）；② 次文案 = 用户动作建议（怎么办）；
         ③ 技术细节 = 折叠在 <details> 里（排障/报障要贴给研发时才展开）。 -->
    <a-empty v-if="loadError">
      <template #description>
        <div class="load-fail">
          <p class="load-fail-main">{{ loadError }}</p>
          <p class="load-fail-hint">{{ loadErrorHint }}</p>
          <details v-if="loadErrorDetail" class="load-fail-tech">
            <summary>技术细节</summary>
            <code>{{ loadErrorDetail }}</code>
          </details>
        </div>
      </template>
      <a-button data-dr="error-cta" type="primary" @click="load">重试</a-button>
    </a-empty>
    <!-- 两卡：基础配置默认展开 / 高级默认折叠（page-spec v2 信息架构） -->
    <a-collapse v-else v-model:activeKey="activeCards" :bordered="true" class="def-cards">
      <!-- 卡片一 · 基础配置 -->
      <a-collapse-panel key="basic" data-dr="card-basic" header="基础配置">
        <a-form layout="vertical" :model="form">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="Agent ID（唯一，小写短横线）">
                <a-input v-model:value="form.id" :disabled="!isCreate" placeholder="如 contract-risk" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="名称">
                <a-input v-model:value="form.name" placeholder="如 合同翻译官" />
              </a-form-item>
            </a-col>
          </a-row>
          <!-- 意图路由线索：给 IntentClassifier 读 -->
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item
                label="用途说明"
                extra="给意图路由的 LLM 读的一句话：这个 agent 负责什么。留空则只能靠 agent 名称猜"
              >
                <a-input v-model:value="form.description!" :maxlength="500" placeholder="如：把脑海里的角色场景画成图片" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item
                label="路由关键词"
                extra="逗号分隔；用户这句里包含任一个关键词就直接路由过来，不调 LLM"
              >
                <a-select
                  v-model:value="keywordsInput"
                  mode="tags"
                  :token-separators="[',', '，', '、']"
                  placeholder="如 画画,生图,变变"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="模型">
                <a-select
                  v-model:value="form.model"
                  show-search
                  option-filter-prop="label"
                  :options="modelOptions"
                  placeholder="从字典 llm_models 选择"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="能力配置（本地工具 / MCP 远程工具 / Skills）">
            <CapabilityConfigurator v-model:capabilities="form.capabilities" />
          </a-form-item>
          <a-form-item label="System Prompt">
            <a-textarea
              v-model:value="form.systemPrompt"
              :rows="12"
              placeholder="Agent 的系统提示词，发布后运行时生效"
            />
          </a-form-item>
          <a-row :gutter="16">
            <a-col :span="8">
              <a-form-item label="记忆：压缩阈值">
                <a-input-number v-model:value="form.memory.compactionThreshold" :min="1" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="记忆：保留近期条数">
                <a-input-number v-model:value="form.memory.keepRecent" :min="1" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="启用记忆">
                <a-switch v-model:checked="form.memory.enabled" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="流式输出" extra="开启后 AI 回答逐字流式渲染；关闭后最终回答一次性输出（适合结构化报告类 Agent）">
            <a-switch v-model:checked="form.streaming!" />
          </a-form-item>
        </a-form>
      </a-collapse-panel>

      <!-- 卡片二 · 高级（默认折叠）：模型参数调试工作台（管理员及以上，S5 门禁）
           2026-10-29 拍板（A）：参数面板单列、策略预览整宽（不再困在半宽列内被双重挤压） -->
      <a-collapse-panel v-if="canTune" key="advanced" data-dr="card-advanced" header="高级 · 模型参数调试">
        <a-row :gutter="16">
          <!-- 左：生成参数面板（五控件 + 三条联动，内部单列） -->
          <a-col :span="12">
            <AgentTuningPanel
              v-model:temperature="form.temperature"
              v-model:max-tokens="form.maxTokens"
              v-model:top-p="form.topP"
              v-model:thinking="thinkingForm"
              v-model:max-steps="form.maxSteps"
              :has-tools="hasTools"
              :errors="tuningErrors"
              :diffs="panelDiffs"
            />
          </a-col>
          <!-- 右：调试台（分期：本期占位；消息组件契约见 page-spec v2 §2.1，不进产品页面） -->
          <a-col :span="12">
            <div class="debug-slot">
              <div class="debug-slot-title">调试台</div>
              <a-empty description="对话试跑 / 调参测试用例表 · 分期建设中">
                <template #description>
                  <span>对话试跑 / 调参测试用例表 · 分期建设中</span>
                </template>
              </a-empty>
            </div>
          </a-col>
        </a-row>
        <!-- 生效策略预览（整宽，2026-10-29 拍板）：thinking/maxTokens 与面板同源 -->
        <AgentStrategyPreview
          :has-tools="hasTools"
          :thinking="thinkingForm"
          :max-tokens="form.maxTokens ?? null"
        />
        <!-- 审计 diff 展示（本次会话保存的调参记录） -->
        <TuningAuditList :visible="true" :entries="auditEntries" />
      </a-collapse-panel>
    </a-collapse>

    <!-- 锚点 role-fallback：editor/viewer 看不到调参卡是**既定决策**，但设计系统 S5 禁止「静默隐藏
         后无任何解释」——隐藏的同时必须说明为什么，否则用户只会以为页面坏了。
         文案照 page-spec v2 §5.1。判据 canTune 一字不动，只是把已发生的隐藏说出来 -->
    <a-alert
      v-if="!canTune && !isCreate"
      data-dr="role-fallback"
      class="role-fallback"
      type="info"
      show-icon
      message="调参与审计仅管理员及以上可见"
      description="你当前的角色可查看与编辑基础配置；如需调参权限，请联系管理员开通。"
    />
  </a-spin>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { ArrowLeftOutlined } from '@ant-design/icons-vue';
import {
  getAgentDef,
  createAgentDef,
  updateAgentDef,
  type AgentDef,
  type SaveAgentDefPayload,
} from '@/api/agent-defs';
import {
  canAccessTuning,
  hasToolsOf,
  thinkingToApi,
  thinkingToForm,
  validateTuning,
  buildTuningAuditEntry,
  buildTuningFieldDiffs,
  pruneTuningAuditEntries,
  type ThinkingFormValue,
  type TuningAuditEntry,
  type TuningFieldDiff,
  type TuningFields,
} from '@/utils/tuning-params';
import { defaultAgentForm, defToForm } from '@/utils/agent-def-form';
import { useUserStore } from '@/stores/user';
import CapabilityConfigurator from './CapabilityConfigurator.vue';
import AgentTuningPanel from './AgentTuningPanel.vue';
import TuningAuditList from './TuningAuditList.vue';
import AgentStrategyPreview from './AgentStrategyPreview.vue';
import { fetchDictItems } from '@/api/dict';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const canManage = userStore.hasPermission('agents:manage');
/** B3 门禁：调参入口/区块（高级卡）管理员及以上可见（S5；用户 2026-10-29 拍板放开 admin） */
const canTune = computed(() => canAccessTuning(userStore.roles));

const routeId = computed(() => String(route.params.id ?? ''));
const isCreate = computed(() => routeId.value === 'new');

const loading = ref(false);
const saving = ref(false);
/** 失败态**主文案**（业务结论，禁技术串 —— page-spec §2.1） */
const loadError = ref('');
/** 失败态**次文案**（下一步动作建议） */
const loadErrorHint = ref('');
/** 失败态**技术细节**（axios/后端原始串，折叠展示，仅排障用） */
const loadErrorDetail = ref('');

function clearLoadError(): void {
  loadError.value = '';
  loadErrorHint.value = '';
  loadErrorDetail.value = '';
}

/**
 * 失败态文案三拆（D4）。
 * 关键点：**原始错误串只进 detail**，不再当主文案 —— 之前 `loadError = err.message` 会把
 * 「Network Error」「timeout of 10000ms exceeded」这类串直接怼到页面正中。
 * 404（定义不存在）与网络/服务异常给不同的「怎么办」。
 */
function setLoadError(e: unknown): void {
  const err = e as {
    response?: { status?: number; data?: { message?: string } };
    code?: string;
    message?: string;
  };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message || err?.message || err?.code || '';
  loadErrorDetail.value = [status ? `HTTP ${status}` : '', raw].filter(Boolean).join(' · ');
  if (status === 404) {
    loadError.value = '未找到该 Agent 定义';
    loadErrorHint.value = '它可能已被删除。请返回列表重新选择，或确认链接中的 ID 是否正确。';
    return;
  }
  if (status === 403) {
    loadError.value = '无权查看该 Agent 定义';
    loadErrorHint.value = '当前账号缺少查看权限，请联系管理员开通。';
    return;
  }
  loadError.value = '加载失败：无法获取该 Agent 定义';
  loadErrorHint.value = '请检查网络连接后重试；若反复失败，请把下方技术细节反馈给管理员。';
}
const currentDef = ref<AgentDef | null>(null);
/** 两卡展开态：基础默认展开，高级默认折叠（page-spec v2） */
const activeCards = ref<string[]>(['basic']);

const form = reactive<SaveAgentDefPayload>(defaultAgentForm());
const thinkingForm = ref<ThinkingFormValue>('null');
const keywordsInput = ref<string[]>([]);
const tuningErrors = ref<Partial<Record<'temperature' | 'maxTokens' | 'topP' | 'maxSteps', string>>>({});
const auditEntries = ref<TuningAuditEntry[]>([]);
/** 内联确认条：'' 关闭 / 'discard' 放弃更改 / 'back' 返回拦截（v2 §1 不用弹窗） */
const confirmBar = ref<'' | 'discard' | 'back'>('');
/** 对比表展开态（B2c「查看对比」，就地展开，不用弹窗） */
const diffOpen = ref(false);

/**
 * 载入那一刻的调参五控件快照 —— 未保存变更对比的**基线**（B2c）。
 *
 * 为什么不复用 `currentDef`：
 * ① 新建态（`/agents/definitions/new`）根本没有 `currentDef`，基线得是默认表单；
 * ② 保存成功后 `load()` 会刷新 `currentDef`，若拿它当基线，则「保存前 vs 保存后」的对比
 *    会被抹平；基线必须钉在**载入那一刻**，与 `dirty` 判定的 `loadSnapshot` 同口径。
 *
 * 初值直接取当前表单（此刻就是 `defaultAgentForm()`），**不再手抄一份默认值** ——
 * 手抄等于给默认值开第二个真相源，`defaultAgentForm()` 一改这里就悄悄漂移。
 * （`load()` 在 onMounted 里必跑，applyDef 会再钉一次；这里只是保证首次渲染前有合法值。）
 */
const baselineTuning = ref<TuningFields>(currentTuningFields());

/**
 * 未保存参数的字段级差异（page-spec v2 §4）。
 * 🔴 变更条计数与字段 badge **同源于此**，不许两处各算一套 —— 规格要求「口径必须一致」。
 * 只含真正下发给模型的 4 个参数；`maxSteps` 不在其中（引擎编排轮数，非模型 API 参数）。
 */
const tuningDiffs = computed<TuningFieldDiff[]>(() =>
  buildTuningFieldDiffs(baselineTuning.value, currentTuningFields()),
);

/**
 * 面板 badge 的数据源：新建态一律给空数组。
 * 新建没有「原值」，任何填写都会算成「未配置 → x」，摆出来只会让人困惑。
 */
const panelDiffs = computed<TuningFieldDiff[]>(() => (isCreate.value ? [] : tuningDiffs.value));

/**
 * 变更归零时把对比表收起（B2c 交互毛刺）。
 *
 * 不这么做的话：用户点开对比 → 全部还原（diffs 归零、表随 v-if 消失）→ 再改一个参数 →
 * 表会**自动弹开**（diffOpen 还留着 true），用户没点过任何东西。展开态是用户意图，
 * 而「归零」意味着这一轮对比结束了，意图应随之作废。
 */
watch(
  () => tuningDiffs.value.length,
  (n) => {
    if (!n) diffOpen.value = false;
  },
);

/** 表单快照（脏态判定）：载入时记 baseline，之后对比 */
function snapshot(): string {
  return JSON.stringify({
    id: form.id,
    name: form.name,
    description: form.description,
    keywords: keywordsInput.value,
    model: form.model,
    capabilities: form.capabilities,
    systemPrompt: form.systemPrompt,
    memory: form.memory,
    streaming: form.streaming,
    maxSteps: form.maxSteps,
    temperature: form.temperature,
    maxTokens: form.maxTokens,
    topP: form.topP,
    thinking: thinkingForm.value,
  });
}
let loadSnapshot = '';
/** 是否有未保存的修改（放弃更改二次确认 / 返回拦截的判据） */
const dirty = computed(() => snapshot() !== loadSnapshot);

/** 挂工具判定（联动①②输入）：随能力配置实时变化 */
const hasTools = computed(() =>
  hasToolsOf(form.tools, (form.capabilities || []).filter((c) => c.enabled !== false)),
);

/**
 * 模型下拉来自字典 llm_models（可用性以字典为准），hy3 由专用通道承载固定列出。
 */
const modelOptions = ref<Array<{ value: string; label: string }>>([{ value: 'hy3', label: 'hy3（混元）' }]);
async function loadModelOptions(): Promise<void> {
  try {
    const res = await fetchDictItems('llm_models', { pageSize: 200 });
    modelOptions.value = [
      { value: 'hy3', label: 'hy3（混元）' },
      ...res.items
        .filter((i) => i.enabled && i.value !== 'hy3')
        .map((i) => ({ value: i.value, label: `${i.label}（${i.value}）` })),
    ];
  } catch {
    /* 保持兜底：只列 hy3 */
  }
}

function unwrap(res: unknown): unknown {
  // request 拦截器已 unwrap {code,data,message}；这里再兼容 res?.data
  const r = res as { data?: unknown } | null | undefined;
  return r?.data ?? r;
}

/** 载入定义 → 表单（或新建默认态）；并记录 baseline 快照（脏态判定） */
function applyDef(def: AgentDef | null) {
  if (!def) {
    Object.assign(form, defaultAgentForm());
    thinkingForm.value = 'null';
    keywordsInput.value = [];
  } else {
    const state = defToForm(def);
    Object.assign(form, state.form);
    thinkingForm.value = state.thinking;
    keywordsInput.value = state.keywordsInput;
  }
  tuningErrors.value = {};
  confirmBar.value = '';
  // B2c：基线与 loadSnapshot 同一时刻钉住；对比表收起（换了基线，旧的展开态无意义）
  baselineTuning.value = currentTuningFields();
  diffOpen.value = false;
  loadSnapshot = snapshot();
}

async function load(): Promise<void> {
  if (isCreate.value) {
    currentDef.value = null;
    clearLoadError();
    applyDef(null);
    return;
  }
  loading.value = true;
  clearLoadError();
  try {
    const res = await getAgentDef(routeId.value);
    const def = unwrap(res) as AgentDef | null;
    if (!def || !def.id) {
      loadError.value = '未找到该 Agent 定义';
      loadErrorHint.value = '它可能已被删除。请返回列表重新选择，或确认链接中的 ID 是否正确。';
      return;
    }
    currentDef.value = def;
    applyDef(def);
  } catch (e: unknown) {
    setLoadError(e);
  } finally {
    loading.value = false;
  }
}

function goBack(): void {
  // 返回拦截：有未保存修改先出内联确认条（v2 状态矩阵「未保存离开拦截」）
  if (dirty.value) {
    confirmBar.value = 'back';
    return;
  }
  void router.push('/agents/definitions');
}

/** 放弃更改：二次确认（内联确认条），确认后还原打开时值；无修改时给可观察反馈 */
function resetForm(): void {
  if (!dirty.value) {
    message.info('没有未保存的修改');
    return;
  }
  confirmBar.value = 'discard';
}

/** 确认条主操作：discard=还原（新建则回列表）/ back=返回列表 */
function confirmBarOk(): void {
  const act = confirmBar.value;
  confirmBar.value = '';
  if (act === 'back') {
    void router.push('/agents/definitions');
    return;
  }
  if (isCreate.value) {
    void router.push('/agents/definitions');
    return;
  }
  applyDef(currentDef.value);
  message.success('已还原为载入时的值');
}

/** 五控件当前值（审计与校验用） */
function currentTuningFields(): TuningFields {
  return {
    temperature: form.temperature ?? null,
    maxTokens: form.maxTokens ?? null,
    topP: form.topP ?? null,
    thinking: thinkingForm.value,
    maxSteps: form.maxSteps,
  };
}

async function save(): Promise<void> {
  if (!form.id.trim() || !form.name.trim()) {
    message.warning('Agent ID 和名称必填');
    return;
  }
  // C7-b 互斥 + 值域预防性校验（真相源仍在后端）
  if (canTune.value) {
    const v = validateTuning({
      temperature: form.temperature ?? null,
      maxTokens: form.maxTokens ?? null,
      topP: form.topP ?? null,
      maxSteps: form.maxSteps,
    });
    if (!v.ok) {
      // 字段级红字 + 保存被拒，**不清已填值**；展开高级卡让用户就地修
      tuningErrors.value = v.errors;
      if (!activeCards.value.includes('advanced')) activeCards.value = [...activeCards.value, 'advanced'];
      message.error(v.errors.temperature || v.errors.topP || v.errors.maxTokens || v.errors.maxSteps || '调参校验未通过');
      return;
    }
    tuningErrors.value = {};
  }

  const beforeTuning = currentDef.value
    ? {
        temperature: currentDef.value.temperature ?? null,
        maxTokens: currentDef.value.maxTokens ?? null,
        topP: currentDef.value.topP ?? null,
        thinking: thinkingToForm(currentDef.value.thinking),
        maxSteps: currentDef.value.maxSteps,
      }
    : null;

  saving.value = true;
  try {
    // tags 选择器中间态落 payload 前同步；thinking 三态 → API 形状（budget 不下发）
    form.keywords = keywordsInput.value.map((k) => k.trim()).filter(Boolean);
    form.thinking = thinkingToApi(thinkingForm.value);
    const afterTuning = currentTuningFields();

    if (isCreate.value) {
      await createAgentDef(form);
      message.success('已创建草稿，点击"发布"生效');
    } else {
      await updateAgentDef(routeId.value, form);
      // D4：保存成功仅 Toast，不自动跳转
      message.success('已保存（如修改了 prompt，需点"发布"才生效）');
    }

    // S6 审计条目：改前→改后字段 diff + 运行时生效值（高级卡审计区展示）
    if (canTune.value && beforeTuning) {
      const entry = buildTuningAuditEntry({
        agentId: form.id,
        agentName: form.name,
        operator: userStore.userInfo?.nickname || userStore.userInfo?.username || '超级管理员',
        before: beforeTuning,
        after: afterTuning,
        hasTools: hasTools.value,
      });
      if (entry.diffs.length > 0) {
        // D4 留存期：写入即 prune 掉超过 7 天的条目（不只是隐藏，内存真收敛）
        auditEntries.value = pruneTuningAuditEntries([entry, ...auditEntries.value]);
      }
    }

    if (isCreate.value) {
      // 新建成功：跳转该定义详情页（后续编辑在同一页面形态）
      await router.replace(`/agents/definitions/${form.id}`);
    } else {
      // 就地刷新版本号等元数据
      await load();
    }
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } }; message?: string };
    const msg = err?.response?.data?.message || err?.message || '保存失败';
    message.error(msg);
    if (/temperature|topP|互斥/i.test(msg)) {
      // D6：红字也是产品文案 —— 用业务词（Temperature / Top P），不用字段名，也不写「互斥校验」
      tuningErrors.value = {
        ...tuningErrors.value,
        temperature: 'Temperature 与 Top P 只能填一个',
        topP: 'Temperature 与 Top P 只能填一个',
      };
      if (!activeCards.value.includes('advanced')) activeCards.value = [...activeCards.value, 'advanced'];
    }
  } finally {
    saving.value = false;
  }
}

// 同组件内切换路由参数（列表点另一条）时重载
watch(
  () => route.params.id,
  () => {
    if (route.name === 'AgentDefDetail' || route.name === 'AgentDefCreate') void load();
  },
);

onMounted(() => {
  void load();
  void loadModelOptions();
});
</script>

<style scoped>
.cfm-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--ws-warning-100, #fef3dc);
  border: 1px solid var(--ws-warning-500, #f5a623);
  border-radius: var(--ws-radius-sm, 6px);
  font-size: 13px;
}
.cfm-text {
  flex: 1;
  color: var(--ws-text-primary, #1a1a1a);
}
.def-cards {
  margin-top: 8px;
}
/* ===== D1（P1，2026-11-06 盲测）：基础配置卡的 hint 与参数面板同规格 =====
   page-spec v2 §3.2：hint = 12px / --ws-text-secondary / 控件下方 6px。
   盲测发现基础卡（用途说明 / 路由关键词 / 流式输出等 extra）同样是 antd 默认的
   14px + #A3A3A3（= --ws-text-tertiary，§6 明令不得承载说明文字）+ 上间距 0
   → 属**系统性**偏差，不是个别字段。这里与 AgentTuningPanel 用同一组覆写值。
   仍然只用 scoped `:deep()`，不动全局 antd 变量/ConfigProvider token。 */
.def-cards :deep(.ant-form-item-extra) {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
/* ===== D4：加载失败态（业务文案做主，技术细节折叠） ===== */
.load-fail {
  max-width: 560px;
  margin: 0 auto;
  text-align: center;
}
.load-fail-main {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ws-text-primary, #1a1a1a);
}
.load-fail-hint {
  margin: 0;
  font-size: 12px;
  line-height: 20px;
  color: var(--ws-text-secondary, #525252);
}
.load-fail-tech {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
.load-fail-tech summary {
  cursor: pointer;
  color: var(--ws-text-tertiary, #a3a3a3);
}
.load-fail-tech code {
  display: block;
  margin-top: 4px;
  padding: 4px 8px;
  background: var(--ws-bg-subtle, #f2f2f2);
  border-radius: var(--ws-radius-sm, 6px);
  font-family: var(--ws-font-mono);
  word-break: break-all;
  text-align: left;
}
/* ===== B2c：未保存变更条 + diff 表 =====
   原型 `.diffbar`（:186-199）/ `.difftable`（:194-199）：sticky 吸顶、品牌色边框、圆角、轻阴影；
   diff 表是变更条下方的虚线分隔续块，不是第二张卡片 —— 这里照原型，别自作主张加边框背景。
   注意 sticky 依赖最近滚动祖先。本块挂在 `<a-spin>` 之外，祖先链上目前没有 overflow 容器，
      但【未在微前端环境实测】（评审期没有运行环境）——「滚到底部仍吸住」这句话在没有真实
      截图/DOM 断言前不能当结论写。首次运行时须实测；将来若把页面内容挪进带 overflow 的容器，
      这里会静默退化成普通块（sticky 不报错，只是不生效）。
   token：以下 --ws-* 均已在 packages/ui/src/tokens.css 声明，故不写裸 hex 兜底
   —— 兜底会把「变量名写错/漏声明」这类错误盖住（page-spec §9 已记过这个教训）。 */
.diff-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  position: sticky;
  top: 0;
  z-index: 6;
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ws-text-primary);
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-brand-400);
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card);
}
.diff-bar .ic {
  width: var(--ws-icon-inline);
  height: var(--ws-icon-inline);
  flex: 0 0 var(--ws-icon-inline);
  stroke: var(--ws-brand-600);
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.diff-bar .sp {
  flex: 1;
}
.diff-table {
  margin-bottom: 12px;
  padding: 8px 12px 0;
  border-top: 1px dashed var(--ws-border);
}
.diff-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px 0;
  font-size: 12px;
}
.diff-row .dk {
  flex: 0 0 150px;
  color: var(--ws-text-secondary);
}
.diff-row .dv,
.diff-row .dn {
  flex: 0 0 150px;
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ws-text-secondary);
}
.diff-row .dn {
  flex: 1;
  font-weight: 500;
  color: var(--ws-text-primary);
}
.diff-row .arw {
  color: var(--ws-text-secondary);
}
.debug-slot {
  border: 1px dashed var(--ws-border, #e5e5e5);
  border-radius: var(--ws-radius-md, 8px);
  padding: 16px;
  min-height: 320px;
  display: flex;
  flex-direction: column;
}
.debug-slot-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: var(--ws-text-primary, #1a1a1a);
}
</style>
