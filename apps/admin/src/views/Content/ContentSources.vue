<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  listSources,
  createSource,
  updateSource,
  deleteSource,
  listPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  triggerCollect,
  listCollectRuns,
  collectHealth,
  type ContentSource,
  type ContentPipeline,
  type CollectRun,
  type CollectHealth,
  type TriggerResult,
} from '@/api/content';

const activeTab = ref<'sources' | 'pipelines' | 'runs'>('sources');

// 采集器类型 / 内容领域 / 管线类型枚举（与 content-hub 采集器注册表对齐）
const SOURCE_TYPES = [
  { value: 'arxiv', label: 'arxiv · arXiv 论文' },
  { value: 'sina_news', label: 'sina_news · 新浪财经快讯' },
  { value: 'eastmoney_news', label: 'eastmoney_news · 东方财富快讯' },
  { value: 'eastmoney_lhb', label: 'eastmoney_lhb · 东方财富龙虎榜' },
  { value: 'hackernews', label: 'hackernews · Hacker News' },
  { value: 'rss', label: 'rss · RSS 订阅' },
];
const CATEGORIES = ['论文', '财经', 'AI'];
const PIPELINE_TYPES = ['paper', 'ai-news'];
const PUBLISH_TARGETS = [
  { value: 'tencent_docs', label: '腾讯文档' },
  { value: 'wechat_mp', label: '公众号' },
];

const fmtTime = (s?: string) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

// ── 采集源 ──
const sources = ref<ContentSource[]>([]);
const sourceLoading = ref(false);
const sourceEditVisible = ref(false);
const sourceEditingId = ref<number | null>(null);
const sourceForm = reactive({
  code: '',
  name: '',
  type: 'rss',
  category: 'AI',
  configText: '{}',
  enabled: true,
});

async function loadSources() {
  sourceLoading.value = true;
  try {
    sources.value = await listSources();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    sourceLoading.value = false;
  }
}

function openSourceCreate() {
  sourceEditingId.value = null;
  Object.assign(sourceForm, { code: '', name: '', type: 'rss', category: 'AI', configText: '{}', enabled: true });
  sourceEditVisible.value = true;
}

function openSourceEdit(s: ContentSource) {
  sourceEditingId.value = s.id;
  Object.assign(sourceForm, {
    code: s.code,
    name: s.name,
    type: s.type,
    category: s.category ?? 'AI',
    configText: JSON.stringify(s.config ?? {}, null, 2),
    enabled: s.enabled,
  });
  sourceEditVisible.value = true;
}

async function submitSource() {
  if (!sourceForm.code.trim() || !sourceForm.name.trim()) {
    message.warning('code 与名称必填');
    return;
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(sourceForm.configText || '{}');
  } catch {
    message.warning('config 必须是合法 JSON');
    return;
  }
  const dto = {
    code: sourceForm.code.trim(),
    name: sourceForm.name.trim(),
    type: sourceForm.type,
    category: sourceForm.category,
    config,
    enabled: sourceForm.enabled,
  };
  try {
    if (sourceEditingId.value) {
      await updateSource(sourceEditingId.value, dto);
      message.success('采集源已更新');
    } else {
      await createSource(dto);
      message.success('采集源已创建');
    }
    sourceEditVisible.value = false;
    loadSources();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onDeleteSource(s: ContentSource) {
  try {
    await deleteSource(s.id);
    message.success('已删除');
    loadSources();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onToggleSource(s: ContentSource, checked: boolean) {
  try {
    await updateSource(s.id, { enabled: checked });
    message.success(checked ? '已启用' : '已停用');
    loadSources();
  } catch {
    /* request 拦截器已弹错 */
  }
}

// ── 手动触发采集 ──
const triggerVisible = ref(false);
const triggerSource = ref<ContentSource | null>(null);
const triggerLimit = ref(20);
const triggerLoading = ref(false);
const triggerResult = ref<TriggerResult | null>(null);

function openTrigger(s: ContentSource) {
  triggerSource.value = s;
  triggerLimit.value = 20;
  triggerResult.value = null;
  triggerVisible.value = true;
}

async function runTrigger() {
  if (!triggerSource.value) return;
  triggerLoading.value = true;
  try {
    triggerResult.value = await triggerCollect(triggerSource.value.code, triggerLimit.value);
    if (triggerResult.value.status === 'ok' || triggerResult.value.status === 'empty') {
      message.success(`采集完成（${triggerResult.value.status}）`);
      loadSources();
    }
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    triggerLoading.value = false;
  }
}

const sourceColumns = [
  { title: '编码', dataIndex: 'code', width: 150 },
  { title: '名称', dataIndex: 'name', width: 170 },
  { title: '类型', dataIndex: 'type', width: 150 },
  { title: '领域', dataIndex: 'category', width: 80 },
  { title: '私有配置', dataIndex: 'config', ellipsis: true },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 210 },
];

// ── 管线 ──
const pipelines = ref<ContentPipeline[]>([]);
const pipelineLoading = ref(false);
const pipelineEditVisible = ref(false);
const pipelineEditingId = ref<number | null>(null);
const pipelineForm = reactive({
  code: '',
  type: 'paper',
  title_template: '',
  cron: '0 9 * * *',
  llm_prompt: '',
  publish_targets: [] as string[],
  tencent_folder: '',
  enabled: true,
});

async function loadPipelines() {
  pipelineLoading.value = true;
  try {
    pipelines.value = await listPipelines();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    pipelineLoading.value = false;
  }
}

function openPipelineCreate() {
  pipelineEditingId.value = null;
  Object.assign(pipelineForm, {
    code: '', type: 'paper', title_template: '', cron: '0 9 * * *',
    llm_prompt: '', publish_targets: [], tencent_folder: '', enabled: true,
  });
  pipelineEditVisible.value = true;
}

function openPipelineEdit(p: ContentPipeline) {
  pipelineEditingId.value = p.id;
  Object.assign(pipelineForm, {
    code: p.code,
    type: p.type,
    title_template: p.title_template ?? '',
    cron: p.cron,
    llm_prompt: p.llm_prompt ?? '',
    publish_targets: p.publish_targets ?? [],
    tencent_folder: p.tencent_folder ?? '',
    enabled: p.enabled,
  });
  pipelineEditVisible.value = true;
}

async function submitPipeline() {
  if (!pipelineForm.code.trim() || !pipelineForm.cron.trim()) {
    message.warning('code 与 cron 必填');
    return;
  }
  const dto = {
    code: pipelineForm.code.trim(),
    type: pipelineForm.type,
    title_template: pipelineForm.title_template || null,
    cron: pipelineForm.cron.trim(),
    llm_prompt: pipelineForm.llm_prompt || null,
    publish_targets: pipelineForm.publish_targets,
    tencent_folder: pipelineForm.tencent_folder || null,
    enabled: pipelineForm.enabled,
  };
  try {
    if (pipelineEditingId.value) {
      await updatePipeline(pipelineEditingId.value, dto);
      message.success('管线已更新');
    } else {
      await createPipeline(dto);
      message.success('管线已创建');
    }
    pipelineEditVisible.value = false;
    loadPipelines();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onDeletePipeline(p: ContentPipeline) {
  try {
    await deletePipeline(p.id);
    message.success('已删除');
    loadPipelines();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onTogglePipeline(p: ContentPipeline, checked: boolean) {
  try {
    await updatePipeline(p.id, { enabled: checked });
    message.success(checked ? '已启用' : '已停用');
    loadPipelines();
  } catch {
    /* request 拦截器已弹错 */
  }
}

const pipelineColumns = [
  { title: '编码', dataIndex: 'code', width: 130 },
  { title: '类型', dataIndex: 'type', width: 90 },
  { title: 'cron', dataIndex: 'cron', width: 120 },
  { title: '标题模板', dataIndex: 'title_template', ellipsis: true },
  { title: '发布目标', key: 'publish_targets', width: 170 },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 140 },
];

// ── 采集记录 ──
const runs = ref<CollectRun[]>([]);
const runsTotal = ref(0);
const health = ref<CollectHealth | null>(null);
const runsLoading = ref(false);
const runsSourceCode = ref<string | undefined>(undefined);

async function loadRuns() {
  runsLoading.value = true;
  try {
    const [runsRes, healthRes] = await Promise.all([
      listCollectRuns(runsSourceCode.value, 50),
      collectHealth(7),
    ]);
    runs.value = runsRes.items;
    runsTotal.value = runsRes.total;
    health.value = healthRes;
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    runsLoading.value = false;
  }
}

const runsColumns = [
  { title: '源', dataIndex: 'source_code', width: 140 },
  { title: '源名称', dataIndex: 'source_name', width: 150 },
  { title: '触发', dataIndex: 'trigger_type', width: 90 },
  { title: '状态', dataIndex: 'status', width: 80 },
  { title: '条数', dataIndex: 'item_count', width: 70 },
  { title: '去重', dataIndex: 'dedup_count', width: 70 },
  { title: '失败', dataIndex: 'fail_count', width: 70 },
  { title: '耗时(ms)', dataIndex: 'duration_ms', width: 90 },
  { title: '开始时间', dataIndex: 'started_at', width: 160 },
  { title: '错误', dataIndex: 'error_message', ellipsis: true },
];

const healthSuccessRate = (h: CollectHealth | null) =>
  h ? `${Math.round(h.successRate * 100)}%` : '-';

onMounted(() => {
  loadSources();
  loadPipelines();
});
</script>

<template>
  <!-- 不包 a-config-provider，避免覆盖 shell antd 的默认 token（cssinjs 类名 hash 会变） -->
  <div class="page">
    <div class="header">
      <h2>内容采集源管理</h2>
      <div class="header-actions">
        <a-radio-group v-model:value="activeTab">
          <a-radio-button value="sources">采集源</a-radio-button>
          <a-radio-button value="pipelines">管线</a-radio-button>
          <a-radio-button value="runs">采集记录</a-radio-button>
        </a-radio-group>
        <a-button v-if="activeTab === 'sources'" type="primary" @click="openSourceCreate">添加采集源</a-button>
        <a-button v-else-if="activeTab === 'pipelines'" type="primary" @click="openPipelineCreate">添加管线</a-button>
      </div>
    </div>

    <!-- 采集源 -->
    <template v-if="activeTab === 'sources'">
      <a-table
        :columns="sourceColumns"
        :data-source="sources"
        :loading="sourceLoading"
        row-key="id"
        :pagination="false"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'type'">
            <a-tag color="blue">{{ record.type }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'category'">
            <a-tag :color="record.category === '财经' ? 'orange' : record.category === '论文' ? 'purple' : 'green'">
              {{ record.category ?? '-' }}
            </a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'config'">
            <span class="mono">{{ record.config ? JSON.stringify(record.config) : '-' }}</span>
          </template>
          <template v-else-if="column.key === 'enabled'">
            <a-switch :checked="record.enabled" @change="(checked: boolean) => onToggleSource(record, checked)" />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button size="small" type="primary" ghost :disabled="!record.enabled" @click="openTrigger(record)">触发</a-button>
              <a-button size="small" @click="openSourceEdit(record)">编辑</a-button>
              <a-popconfirm title="确定删除该采集源？" @confirm="onDeleteSource(record)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>

      <!-- 采集源编辑弹窗 -->
      <a-modal
        v-model:open="sourceEditVisible"
        :title="sourceEditingId ? '编辑采集源' : '添加采集源'"
        width="640px"
        @ok="submitSource"
      >
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="编码 code" required>
                <a-input v-model:value="sourceForm.code" placeholder="如 rss-wsj" :disabled="!!sourceEditingId" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="名称" required>
                <a-input v-model:value="sourceForm.name" placeholder="如 华尔街见闻 RSS" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="采集器类型" required>
                <a-select v-model:value="sourceForm.type">
                  <a-select-option v-for="t in SOURCE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="内容领域">
                <a-select v-model:value="sourceForm.category">
                  <a-select-option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="私有配置 config（JSON）">
            <a-textarea
              v-model:value="sourceForm.configText"
              :rows="6"
              placeholder='各源私有参数，如 rss：{"url":"https://..."}；arxiv：{"categories":"cs.AI","max_results":10}'
              class="mono"
            />
          </a-form-item>
          <a-form-item label="启用">
            <a-switch v-model:checked="sourceForm.enabled" />
          </a-form-item>
        </a-form>
      </a-modal>

      <!-- 手动触发弹窗 -->
      <a-modal
        v-model:open="triggerVisible"
        :title="`手动触发采集：${triggerSource?.name ?? ''}`"
        width="560px"
        :footer="null"
      >
        <a-form layout="vertical">
          <a-form-item label="采集条数上限">
            <a-input-number v-model:value="triggerLimit" :min="1" :max="100" style="width: 200px" />
          </a-form-item>
          <a-button type="primary" :loading="triggerLoading" @click="runTrigger">开始采集</a-button>
        </a-form>
        <template v-if="triggerResult">
          <a-divider>采集结果</a-divider>
          <pre class="result">{{ JSON.stringify(triggerResult, null, 2) }}</pre>
        </template>
      </a-modal>
    </template>

    <!-- 管线 -->
    <template v-else-if="activeTab === 'pipelines'">
      <a-table
        :columns="pipelineColumns"
        :data-source="pipelines"
        :loading="pipelineLoading"
        row-key="id"
        :pagination="false"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'type'">
            <a-tag :color="record.type === 'paper' ? 'purple' : 'green'">{{ record.type }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'cron'">
            <span class="mono">{{ record.cron }}</span>
          </template>
          <template v-else-if="column.key === 'publish_targets'">
            <a-space :size="4" wrap>
              <a-tag v-for="t in record.publish_targets ?? []" :key="t" color="geekblue">{{ t }}</a-tag>
            </a-space>
          </template>
          <template v-else-if="column.key === 'enabled'">
            <a-switch :checked="record.enabled" @change="(checked: boolean) => onTogglePipeline(record, checked)" />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button size="small" @click="openPipelineEdit(record)">编辑</a-button>
              <a-popconfirm title="确定删除该管线？" @confirm="onDeletePipeline(record)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>

      <!-- 管线编辑弹窗 -->
      <a-modal
        v-model:open="pipelineEditVisible"
        :title="pipelineEditingId ? '编辑管线' : '添加管线'"
        width="640px"
        @ok="submitPipeline"
      >
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="编码 code" required>
                <a-input v-model:value="pipelineForm.code" placeholder="如 daily_paper" :disabled="!!pipelineEditingId" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="类型" required>
                <a-select v-model:value="pipelineForm.type">
                  <a-select-option v-for="t in PIPELINE_TYPES" :key="t" :value="t">{{ t }}</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="cron 表达式" required>
                <a-input v-model:value="pipelineForm.cron" placeholder="0 9 * * *" class="mono" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="标题模板">
                <a-input v-model:value="pipelineForm.title_template" placeholder="每日论文速览 ｜ {{date}}" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="发布目标">
            <a-select v-model:value="pipelineForm.publish_targets" mode="multiple" placeholder="选择发布通道">
              <a-select-option v-for="t in PUBLISH_TARGETS" :key="t.value" :value="t.value">{{ t.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="腾讯文档目录">
                <a-input v-model:value="pipelineForm.tencent_folder" placeholder="每日论文学习" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="启用">
                <a-switch v-model:checked="pipelineForm.enabled" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="LLM prompt 模板">
            <a-textarea v-model:value="pipelineForm.llm_prompt" :rows="4" placeholder="可选，留空走默认" class="mono" />
          </a-form-item>
        </a-form>
      </a-modal>
    </template>

    <!-- 采集记录 -->
    <template v-else-if="activeTab === 'runs'">
      <a-space style="margin-bottom: 12px">
        <a-button type="primary" :loading="runsLoading" @click="loadRuns">刷新</a-button>
        <a-input
          v-model:value="runsSourceCode"
          placeholder="按源编码筛选（如 sina_news）"
          style="width: 220px"
          allow-clear
          @press-enter="loadRuns"
        />
      </a-space>

      <a-row :gutter="16" style="margin-bottom: 12px">
        <a-col :span="6">
          <a-card size="small">
            <a-statistic title="近 7 天采集批次" :value="health?.totalRuns ?? 0" />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic title="近 7 天成功率" :value="healthSuccessRate(health)" />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic title="今日失败次数" :value="health?.todayFailed ?? 0" :value-style="{ color: (health?.todayFailed ?? 0) > 0 ? '#cf1322' : undefined }" />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic title="静默失效源" :value="health?.staleSources?.length ?? 0" :value-style="{ color: (health?.staleSources?.length ?? 0) > 0 ? '#cf1322' : undefined }" />
          </a-card>
        </a-col>
      </a-row>

      <a-table
        :columns="runsColumns"
        :data-source="runs"
        :loading="runsLoading"
        row-key="id"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'status'">
            <a-tag :color="record.status === 'ok' ? 'green' : record.status === 'failed' ? 'red' : 'default'">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'trigger_type'">
            <a-tag :color="record.trigger_type === 'manual' ? 'blue' : 'default'">{{ record.trigger_type }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'started_at'">
            {{ fmtTime(record.started_at) }}
          </template>
          <template v-else-if="column.dataIndex === 'error_message'">
            <span class="mono" :title="record.error_message">{{ record.error_message ?? '-' }}</span>
          </template>
        </template>
      </a-table>
    </template>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.result {
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  padding: 12px;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-body);
}
</style>
