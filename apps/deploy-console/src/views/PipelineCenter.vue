<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineApi,
  environmentApi,
  deployApi,
  pipelineTemplateApi,
  type PipelineItem,
  type PipelineTemplate,
} from '@/api'
import dayjs from 'dayjs'
import PipelineTemplateManager from '@/components/PipelineTemplateManager.vue'

// ===== 筛选 =====
const env = ref('dev')
const environments = ref<{ id: string; name: string }[]>([])

// ===== 可选模块（仅微前端可走流水线）=====
interface ModuleItem {
  key: string
  name: string
  type: string
}
const modules = ref<ModuleItem[]>([])
const microFrontendModules = computed(() => modules.value.filter((m) => m.type === 'micro-frontend'))

// ===== 流水线模板（全局定义，执行时选模块；list 返回该模块可用=全局+专属） =====
const templates = ref<PipelineTemplate[]>([])
const templateId = ref<string | undefined>(undefined)
const tplMgrOpen = ref(false)

// 执行步骤详情辅助（按实例 steps 快照渲染各步状态）
const STEP_LABELS: Record<string, string> = {
  check: '校验',
  pull: '拉取代码',
  build: '构建',
  upload: '投递',
  restart: '重启',
  version: '写版本',
  pointer: '切指针',
  verify: '探活',
  cleanup: '清理',
}
const STEP_COLORS: Record<string, string> = {
  done: 'success',
  running: 'processing',
  error: 'error',
  pending: 'default',
}
function stepList(p: PipelineItem) {
  return (p.steps && p.steps.length ? p.steps : ['check', 'pull', 'build', 'upload', 'restart', 'version', 'pointer', 'verify', 'cleanup']) as string[]
}
function stepState(p: PipelineItem, s: string): 'done' | 'running' | 'error' | 'pending' {
  if (p.status === 'succeeded') return 'done'
  const list = stepList(p)
  const cur = list.indexOf(p.stage ?? '')
  const i = list.indexOf(s)
  if (p.status === 'failed' || p.status === 'cancelled') {
    if (i < 0) return 'pending'
    return i < cur ? 'done' : i === cur ? 'error' : 'pending'
  }
  if (p.status === 'pending-approval' || cur < 0 || i < 0) return 'pending'
  return i < cur ? 'done' : i === cur ? 'running' : 'pending'
}

// ===== 提交表单 =====
const form = ref({
  moduleKey: '',
  branch: 'master',
  commitId: undefined as string | undefined,
  mode: 'direct' as 'direct' | 'grayscale',
  grayscaleType: 'percent' as 'percent' | 'user-list' | 'header',
  percentValue: 10,
  userIds: '',
  headerKey: 'x-canary',
  headerValues: 'on',
  target: 'local' as 'local' | 'remote',
})
const submitting = ref(false)

// 可发布版本（回滚候选）
const releases = ref<
  { versionTag: string; note?: string; releasedAt?: string; source?: 'db' | 'artifact' }[]
>([])

// ===== 流水线列表 =====
const pipelines = ref<PipelineItem[]>([])
const loading = ref(false)
let timer: number | undefined

const STAGE_LABEL: Record<string, string> = {
  check: '校验',
  build: '构建',
  upload: '投递',
  version: '版本表',
  pointer: '切指针',
  verify: '验证',
  cleanup: '清理',
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: 'blue',
    'pending-approval': 'orange',
    running: 'processing',
    succeeded: 'success',
    failed: 'error',
    cancelled: 'default',
  }
  return map[status] || 'default'
}
function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '等待中',
    'pending-approval': '待审批',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    cancelled: '已取消',
  }
  return map[status] || status
}
function formatTime(ts?: number) {
  return ts ? dayjs(ts).format('MM-DD HH:mm:ss') : '—'
}
function durationMs(p: PipelineItem) {
  if (!p.endTime) return Date.now() - p.startTime
  return p.endTime - p.startTime
}

async function loadEnvironments() {
  try {
    environments.value = await environmentApi.list()
    if (!environments.value.find((e) => e.id === env.value)) {
      env.value = environments.value[0]?.id || 'dev'
    }
  } catch {
    message.error('加载环境列表失败')
  }
}

async function loadModules() {
  try {
    modules.value = await deployApi.modules()
    if (!form.value.moduleKey && microFrontendModules.value.length) {
      form.value.moduleKey = microFrontendModules.value[0].key
    }
  } catch {
    message.error('加载模块列表失败')
  }
}

async function loadReleases() {
  try {
    releases.value = await pipelineApi.releases(env.value, form.value.moduleKey)
  } catch {
    releases.value = []
  }
}

async function loadTemplates() {
  templateId.value = undefined
  try {
    templates.value = await pipelineTemplateApi.list(form.value.moduleKey)
    if (templates.value.length) templateId.value = templates.value[0].id
  } catch {
    templates.value = []
  }
}

async function handleRetry(p: PipelineItem) {
  const isSucceeded = p.status === 'succeeded'
  Modal.confirm({
    title: isSucceeded ? '再次发布' : '重试发布',
    content: isSucceeded
      ? `以相同参数再次发布（${p.env} / ${p.moduleKey}，分支 ${p.gitBranch || '-'}，模板 ${
          p.templateName || '默认'
        }，commit ${p.gitCommit || '-'}）？将重新执行一次完整发布。`
      : `以相同参数重新提交（${p.env} / ${p.moduleKey}，分支 ${p.gitBranch || '-'}，模板 ${
          p.templateName || '默认'
        }）？原实例记录保留。`,
    okText: isSucceeded ? '再次发布' : '重试',
    cancelText: '取消',
    onOk: async () => {
      try {
        const res = await pipelineApi.retry(p.id)
        message.success(`已重新提交: ${res.jobId}`)
        await loadPipelines()
        if (res.status !== 'pending-approval') startPolling()
      } catch (e) {
        message.error((e as Error).message || '重试失败')
      }
    },
  })
}

async function loadPipelines() {
  try {
    pipelines.value = await pipelineApi.list({ env: env.value, limit: 20 })
  } catch {
    message.error('加载流水线列表失败')
  }
}

function buildGrayscaleRule(): Record<string, unknown> | undefined {
  if (form.value.mode !== 'grayscale') return undefined
  if (form.value.grayscaleType === 'percent') {
    return { type: 'percent', value: Number(form.value.percentValue) }
  }
  if (form.value.grayscaleType === 'user-list') {
    const ids = form.value.userIds.split(/[,\s]+/).filter(Boolean)
    if (!ids.length) throw new Error('灰度用户名单不能为空')
    return { type: 'user-list', userIds: ids }
  }
  const values = form.value.headerValues.split(/[,\s]+/).filter(Boolean)
  if (!values.length) throw new Error('灰度请求头取值不能为空')
  return { type: 'header', key: form.value.headerKey, values }
}

function doSubmit(confirm: boolean) {
  submitting.value = true
  const run = async () => {
    try {
      const rule = buildGrayscaleRule()
      const res = await pipelineApi.submit({
        env: env.value,
        moduleKey: form.value.moduleKey,
        branch: form.value.branch || 'master',
        commitId: form.value.commitId || undefined,
        mode: form.value.mode,
        target: form.value.target,
        grayscaleRule: rule,
        templateId: templateId.value || undefined,
        confirm,
      })
      if ((res as any).status === 'pending-approval') {
        message.info(`已提交审批（${res.jobId}），审批通过后将自动发布`)
      } else {
        message.success(`流水线已提交: ${res.jobId}`)
      }
      await loadPipelines()
      startPolling()
    } catch (e) {
      message.error((e as Error).message || '提交流水线失败')
    } finally {
      submitting.value = false
    }
  }
  void run()
}

function handleSubmit() {
  if (!form.value.moduleKey) {
    message.warning('请选择要发布的模块')
    return
  }
  const isProd = env.value === 'prod'
  const desc = form.value.commitId
    ? `发布 ${form.value.moduleKey} 到 ${env.value}（分支 ${form.value.branch} @ ${form.value.commitId}）`
    : `发布 ${form.value.moduleKey} 到 ${env.value}（分支 ${form.value.branch} 最新提交）`
  if (isProd) {
    Modal.confirm({
      title: '确认发布到生产环境',
      content: `${desc}。生产发布需审批：提交后将进入「待审批」状态，审批通过才会执行。确认提交？`,
      okText: '提交审批',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => doSubmit(true),
    })
    return
  }
  doSubmit(false)
}

// ===== 审批（待审批流水线：通过/拒绝） =====
const review = ref<{ pipeline: PipelineItem; action: 'approve' | 'reject' } | null>(null)
const reviewComment = ref('')
const reviewing = ref(false)

function openApprove(p: PipelineItem) {
  reviewComment.value = ''
  review.value = { pipeline: p, action: 'approve' }
}
function openReject(p: PipelineItem) {
  reviewComment.value = ''
  review.value = { pipeline: p, action: 'reject' }
}

async function submitReview() {
  if (!review.value) return
  if (review.value.action === 'reject' && !reviewComment.value.trim()) {
    message.warning('拒绝必须填写审批意见')
    return
  }
  reviewing.value = true
  try {
    const res =
      review.value.action === 'approve'
        ? await pipelineApi.approve(review.value.pipeline.id, reviewComment.value.trim() || undefined)
        : await pipelineApi.reject(review.value.pipeline.id, reviewComment.value.trim())
    message.success(review.value.action === 'approve' ? '已审批通过，发布开始执行' : '已拒绝该发布')
    review.value = null
    await loadPipelines()
    if (res.status === 'approved') startPolling()
  } catch (e) {
    message.error((e as Error).message || '操作失败')
  } finally {
    reviewing.value = false
  }
}

async function handleCancel(p: PipelineItem) {
  Modal.confirm({
    title: p.status === 'pending-approval' ? '撤回审批请求' : '确认取消',
    content:
      p.status === 'pending-approval'
        ? `撤回 ${p.id} 的发布审批请求？撤回后需重新提交。`
        : `确定取消流水线 ${p.id} 吗？正在执行的阶段会中断。`,
    okText: p.status === 'pending-approval' ? '撤回' : '取消任务',
    okType: 'danger',
    cancelText: '返回',
    onOk: async () => {
      try {
        await pipelineApi.cancel(p.id)
        message.success('已请求取消')
        await loadPipelines()
      } catch {
        message.error('取消失败')
      }
    },
  })
}

async function handlePromote(p: PipelineItem) {
  Modal.confirm({
    title: '灰度转全量',
    content: `将把 ${p.env} / ${p.moduleKey} 的全量指针切到 ${p.versionTag}，并禁用灰度规则。确认？`,
    okText: '转全量',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelineApi.promote(p.id)
        message.success('已转全量')
        await loadPipelines()
      } catch (e) {
        message.error((e as Error).message || '转全量失败')
      }
    },
  })
}

// ===== 日志 =====
const logVisible = ref(false)
const logRecord = ref<PipelineItem | null>(null)
async function showLogs(p: PipelineItem) {
  try {
    logRecord.value = await pipelineApi.get(p.id)
  } catch {
    logRecord.value = p
  }
  logVisible.value = true
}

// ===== 轮询（仅在有运行中任务时刷新）=====
function startPolling() {
  stopPolling()
  timer = window.setInterval(async () => {
    await loadPipelines()
    if (!pipelines.value.some((p) => p.status === 'running' || p.status === 'pending')) {
      stopPolling()
    }
  }, 3000)
}
function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

async function onEnvChange() {
  await Promise.all([loadReleases(), loadPipelines()])
}
async function onModuleChange() {
  await Promise.all([loadReleases(), loadTemplates()])
}

onMounted(async () => {
  await loadEnvironments()
  await loadModules()
  await Promise.all([loadReleases(), loadTemplates()])
  await loadPipelines()
  if (pipelines.value.some((p) => p.status === 'running' || p.status === 'pending')) {
    startPolling()
  }
})
onUnmounted(stopPolling)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>流水线</h2>
      <p>流水线 = 独立流程定义（不绑定模块，可全局复用）。发布 = 选「模块 + 流水线 + 分支/commit」提交执行；实例可中断/重试，执行步骤实时可查</p>
    </div>

    <!-- 提交区 -->
    <a-card title="提交发布" style="margin-bottom: 16px;">
      <a-form layout="inline">
        <a-form-item label="环境">
          <a-select v-model:value="env" style="width: 160px;" @change="onEnvChange">
            <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
              {{ e.name }}（{{ e.id }}）
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="模块">
          <a-select
            v-model:value="form.moduleKey"
            style="width: 180px;"
            placeholder="选择模块"
            @change="onModuleChange"
          >
            <a-select-option v-for="m in microFrontendModules" :key="m.key" :value="m.key">
              {{ m.name }}（{{ m.key }}）
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="流水线">
          <a-space>
            <a-select v-model:value="templateId" style="width: 220px;" placeholder="默认">
              <a-select-option v-for="t in templates" :key="t.id" :value="t.id">
                {{ t.name }}
                <template v-if="t.builtin">（默认）</template>
                <template v-if="t.skipVerify">（跳过探活）</template>
                <template v-if="t.approval === 'always'">（强制审批）</template>
                <template v-if="t.approval === 'never'">（免审批）</template>
              </a-select-option>
            </a-select>
            <a-button size="small" @click="tplMgrOpen = true">管理</a-button>
          </a-space>
        </a-form-item>

        <a-form-item label="分支">
          <a-input v-model:value="form.branch" style="width: 160px;" placeholder="master" />
        </a-form-item>

        <a-form-item label="Commit">
          <a-select
            v-model:value="form.commitId"
            style="width: 240px;"
            allow-clear
            placeholder="留空=分支最新提交"
          >
            <a-select-option v-for="r in releases" :key="r.versionTag" :value="r.versionTag">
              {{ r.versionTag }}{{ r.source === 'artifact' ? ' · 磁盘产物' : '' }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="模式">
          <a-radio-group v-model:value="form.mode">
            <a-radio value="direct">全量</a-radio>
            <a-radio value="grayscale">灰度</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item label="投递">
          <a-radio-group v-model:value="form.target">
            <a-radio value="local">本机</a-radio>
            <a-radio value="remote">远程服务器</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="form.mode === 'grayscale'" label="灰度规则">
          <a-space>
            <a-select v-model:value="form.grayscaleType" style="width: 120px;">
              <a-select-option value="percent">百分比</a-select-option>
              <a-select-option value="user-list">用户名单</a-select-option>
              <a-select-option value="header">请求头</a-select-option>
            </a-select>
            <a-input-number
              v-if="form.grayscaleType === 'percent'"
              v-model:value="form.percentValue"
              :min="1"
              :max="100"
              addon-after="%"
              style="width: 120px;"
            />
            <a-input
              v-if="form.grayscaleType === 'user-list'"
              v-model:value="form.userIds"
              placeholder="用户 ID，逗号分隔"
              style="width: 220px;"
            />
            <template v-if="form.grayscaleType === 'header'">
              <a-input v-model:value="form.headerKey" placeholder="请求头名" style="width: 140px;" />
              <a-input v-model:value="form.headerValues" placeholder="取值，逗号分隔" style="width: 140px;" />
            </template>
          </a-space>
        </a-form-item>

        <a-form-item>
          <a-button type="primary" :loading="submitting" :danger="env === 'prod'" @click="handleSubmit">
            提交发布
          </a-button>
        </a-form-item>
        <a-form-item>
          <a-button :loading="loading" @click="loadPipelines">刷新列表</a-button>
        </a-form-item>
      </a-form>
      <a-alert
        type="info"
        show-icon
        style="margin-top: 8px;"
        message="发布基于远程仓库的分支 + commit（在隔离的发布目录 git 拉取），请先 commit & push 到仓库再发布"
      />
    </a-card>

    <!-- 流水线列表 -->
    <a-card title="流水线记录">
      <a-table
        :columns="[
          { title: '流水线', dataIndex: 'id', key: 'id', width: 180 },
          { title: '模块', dataIndex: 'moduleKey', key: 'moduleKey', width: 100 },
          { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 110 },
          { title: '模式', dataIndex: 'mode', key: 'mode', width: 90 },
          { title: '模板', key: 'template', width: 110 },
          { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
          { title: '阶段/进度', key: 'stage', width: 200 },
          { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
          { title: '耗时', key: 'duration', width: 90 },
          { title: '开始时间', key: 'startTime', width: 150 },
          { title: '操作', key: 'action', width: 200 },
        ]"
        :data-source="pipelines"
        :pagination="{ pageSize: 10 }"
        :loading="loading"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'id'">
            <a-tooltip :title="record.id">
              <span style="font-family: monospace;">{{ String(record.id).slice(-12) }}</span>
            </a-tooltip>
          </template>
          <template v-if="column.key === 'mode'">
            <a-tag :color="record.mode === 'grayscale' ? 'orange' : 'blue'">
              {{ record.mode === 'grayscale' ? '灰度' : '全量' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'template'">
            <span>{{ record.templateName || '默认' }}</span>
          </template>
          <template v-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">{{ statusText(record.status) }}</a-tag>
          </template>
          <template v-if="column.key === 'stage'">
            <div v-if="record.status === 'running' || record.status === 'pending'">
              <div style="font-size: 12px; margin-bottom: 2px;">
                {{ STAGE_LABEL[record.stage] || record.stage || '-' }}
                <span v-if="record.reuseArtifact" style="color: #999;">（复用产物）</span>
              </div>
              <a-progress
                :percent="Math.round(((record.progress?.current || 0) / (record.progress?.total || 7)) * 100)"
                size="small"
              />
              <div style="font-size: 12px; color: #888;">{{ record.progress?.message }}</div>
            </div>
            <span v-else style="color: #999;">
              {{ STAGE_LABEL[record.stage] || record.stage || '-' }}
              <span v-if="record.progress?.message" style="color: #888;">
                · {{ record.progress.message }}
              </span>
              <span v-if="record.error" style="color: #cf1322;"> · {{ record.error }}</span>
            </span>
          </template>
          <template v-if="column.key === 'duration'">
            {{ (durationMs(record) / 1000).toFixed(1) }}s
          </template>
          <template v-if="column.key === 'startTime'">
            {{ formatTime(record.startTime) }}
          </template>
          <template v-if="column.key === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="showLogs(record)">执行详情</a-button>
              <a-button
                v-if="
                  record.status === 'failed' ||
                  record.status === 'cancelled' ||
                  record.status === 'succeeded'
                "
                type="link"
                size="small"
                @click="handleRetry(record)"
              >
                {{ record.status === 'succeeded' ? '再次发布' : '重试' }}
              </a-button>
              <template v-if="record.status === 'pending-approval'">
                <a-button type="link" size="small" @click="openApprove(record)">通过</a-button>
                <a-button type="link" size="small" danger @click="openReject(record)">拒绝</a-button>
              </template>
              <a-button
                v-if="
                  record.status === 'running' ||
                  record.status === 'pending' ||
                  record.status === 'pending-approval'
                "
                type="link"
                size="small"
                danger
                @click="handleCancel(record)"
              >
                {{ record.status === 'pending-approval' ? '撤回' : '取消' }}
              </a-button>
              <a-button
                v-if="record.mode === 'grayscale' && record.status === 'succeeded'"
                type="link"
                size="small"
                @click="handlePromote(record)"
              >
                转全量
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 审批弹窗 -->
    <a-modal
      :open="!!review"
      :title="review?.action === 'approve' ? '审批通过' : '拒绝发布'"
      :confirm-loading="reviewing"
      @ok="submitReview"
      @cancel="review = null"
    >
      <p v-if="review" style="margin-bottom: 12px; color: #666;">
        {{ review.pipeline.env }} / {{ review.pipeline.moduleKey }}
        <template v-if="review.pipeline.versionTag">@ {{ review.pipeline.versionTag }}</template>
        · 提交人 {{ review.pipeline.operator || '-' }} · 分支
        {{ review.pipeline.gitBranch || '-' }}
      </p>
      <a-textarea
        v-model:value="reviewComment"
        :rows="3"
        :placeholder="
          review?.action === 'reject' ? '请填写拒绝原因（必填）' : '审批意见（可选）'
        "
      />
    </a-modal>

    <!-- 日志抽屉 -->
    <a-drawer
      v-model:open="logVisible"
      title="执行详情"
      placement="right"
      :width="760"
    >
      <template v-if="logRecord">
        <a-descriptions :column="2" size="small" bordered style="margin-bottom: 12px;">
          <a-descriptions-item label="流水线">{{ logRecord.id }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(logRecord.status)">{{ statusText(logRecord.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="环境/模块">
            {{ logRecord.env }} / {{ logRecord.moduleKey }}
          </a-descriptions-item>
          <a-descriptions-item label="版本">{{ logRecord.versionTag || '-' }}</a-descriptions-item>
          <a-descriptions-item label="分支">{{ logRecord.gitBranch || '-' }}</a-descriptions-item>
          <a-descriptions-item label="提交">{{ logRecord.gitCommit || '-' }}</a-descriptions-item>
          <a-descriptions-item label="模板">{{ logRecord.templateName || '默认' }}</a-descriptions-item>
        </a-descriptions>

        <!-- 执行步骤详情：按实例 steps 快照渲染各步状态 -->
        <div style="margin-bottom: 12px;">
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">
            执行步骤（{{ stepList(logRecord).length }} 步）
            <a-tag v-if="logRecord.rollbackOnFailure === 'none'" style="margin-left: 4px;">
              失败不回滚
            </a-tag>
          </div>
          <a-space wrap :size="6">
            <a-tag
              v-for="s in stepList(logRecord)"
              :key="s"
              :color="STEP_COLORS[stepState(logRecord, s)]"
              style="margin-right: 0;"
            >
              {{ STEP_LABELS[s] || s }}
            </a-tag>
          </a-space>
          <div v-if="logRecord.progress?.message" style="margin-top: 6px; color: #888; font-size: 12px;">
            {{ logRecord.progress.message }}
          </div>
        </div>

        <div
          style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                 font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 60vh; overflow: auto;"
        >{{ (logRecord.logs || []).join('\n') || '（无日志）' }}</div>
      </template>
    </a-drawer>

    <!-- 流水线模板管理（全局定义，从模块管理抽离） -->
    <PipelineTemplateManager
      :open="tplMgrOpen"
      @close="tplMgrOpen = false"
      @changed="loadTemplates"
    />
  </div>
</template>
