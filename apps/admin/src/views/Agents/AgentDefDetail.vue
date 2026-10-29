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
    <template #extra>
      <template v-if="!isCreate && currentDef">
        <a-tag :color="currentDef.status === 'published' ? 'green' : 'orange'">
          {{ currentDef.status === 'published' ? '已发布' : '草稿' }}
        </a-tag>
        <a-tag>v{{ currentDef.version }}</a-tag>
      </template>
      <a-button @click="resetForm">放弃更改</a-button>
      <a-button type="primary" :loading="saving" :disabled="!canManage" @click="save">保存</a-button>
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

  <a-spin :spinning="loading">
    <a-empty v-if="loadError" :description="loadError" />
    <!-- 两卡：基础配置默认展开 / 高级默认折叠（page-spec v2 信息架构） -->
    <a-collapse v-else v-model:activeKey="activeCards" :bordered="true" class="def-cards">
      <!-- 卡片一 · 基础配置 -->
      <a-collapse-panel key="basic" header="基础配置">
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

      <!-- 卡片二 · 高级（默认折叠）：模型参数调试工作台（管理员及以上，S5 门禁） -->
      <a-collapse-panel v-if="canTune" key="advanced" header="高级 · 模型参数调试">
        <a-row :gutter="16">
          <!-- 左：生成参数面板（五控件 + 三条联动 + 策略预览） -->
          <a-col :span="12">
            <AgentTuningPanel
              v-model:temperature="form.temperature"
              v-model:max-tokens="form.maxTokens"
              v-model:top-p="form.topP"
              v-model:thinking="thinkingForm"
              v-model:max-steps="form.maxSteps"
              :has-tools="hasTools"
              :errors="tuningErrors"
            />
          </a-col>
          <!-- 右：调试台（分期：本期占位，消息组件契约见 page-spec v2 §2.1） -->
          <a-col :span="12">
            <div class="debug-slot">
              <div class="debug-slot-title">调试台</div>
              <a-empty description="对话试跑 / 调参测试用例表 · 分期建设中">
                <template #description>
                  <span>对话试跑 / 调参测试用例表 · 分期建设中</span>
                </template>
              </a-empty>
              <div class="debug-slot-note">
                落地契约（page-spec v2 §2.1）：Turn / Bubble / AnswerBlocks / ProcCard 与 Playground 同构，
                回答体只出 blocks，禁止 <code>&lt;br&gt;</code> 拼串；差异只通过 props（compact / 可切换 Agent / 运行状态）与 slots 表达。
              </div>
            </div>
          </a-col>
        </a-row>
        <!-- 审计 diff 展示（本次会话保存的调参记录） -->
        <TuningAuditList :visible="true" :entries="auditEntries" />
      </a-collapse-panel>
    </a-collapse>
  </a-spin>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
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
  pruneTuningAuditEntries,
  type ThinkingFormValue,
  type TuningAuditEntry,
  type TuningFields,
} from '@/utils/tuning-params';
import { defaultAgentForm, defToForm } from '@/utils/agent-def-form';
import { useUserStore } from '@/stores/user';
import CapabilityConfigurator from './CapabilityConfigurator.vue';
import AgentTuningPanel from './AgentTuningPanel.vue';
import TuningAuditList from './TuningAuditList.vue';
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
const loadError = ref('');
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
  loadSnapshot = snapshot();
}

async function load(): Promise<void> {
  if (isCreate.value) {
    currentDef.value = null;
    loadError.value = '';
    applyDef(null);
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    const res = await getAgentDef(routeId.value);
    const def = unwrap(res) as AgentDef | null;
    if (!def || !def.id) {
      loadError.value = '未找到该 Agent 定义';
      return;
    }
    currentDef.value = def;
    applyDef(def);
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } }; message?: string };
    loadError.value = err?.response?.data?.message || err?.message || '载入失败';
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
      tuningErrors.value = {
        ...tuningErrors.value,
        temperature: 'temperature 与 topP 只能填一个（互斥校验）',
        topP: 'temperature 与 topP 只能填一个（互斥校验）',
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
.debug-slot-note {
  margin-top: auto;
  padding: 8px 12px;
  background: var(--ws-bg-subtle, #f2f2f2);
  border-radius: var(--ws-radius-sm, 6px);
  font-size: 12px;
  line-height: 20px;
  color: var(--ws-text-secondary, #525252);
}
.debug-slot-note code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
