<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineApi,
  environmentApi,
  deployApi,
  pipelineTemplateApi,
  stageCommandApi,
  type PipelineItem,
  type PipelineTemplate,
} from '@/api'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const tplId = computed(() => String(route.params.id || ''))

// ===== 通用展示 =====
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
  return ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '—'
}
function durationMs(p: PipelineItem) {
  if (!p.endTime) return Date.now() - p.startTime
  return p.endTime - p.startTime
}
function stepList(p: PipelineItem) {
  return (p.steps && p.steps.length
    ? p.steps
    : ['check', 'pull', 'build', 'upload', 'restart', 'version', 'pointer', 'verify', 'cleanup']) as string[]
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

const tpl = ref<PipelineTemplate | null>(null)
const history = ref<PipelineItem[]>([])
const loading = ref(false)
const activeTab = ref('latest')
let timer: number | undefined

const latest = computed(() => history.value[0] || null)
const runTotal = computed(() => history.value.length)
const runOk = computed(() => history.value.filter((p) => p.status === 'succeeded').length)

async function loadTpl() {
  try {
    const all = await pipelineTemplateApi.list()
    const found = all.find((t) => t.id === tplId.value)
    if (!found) {
      message.error('流水线不存在或已被删除')
      router.replace('/pipelines')
      return
    }
    tpl.value = found
  } catch {
    message.error('加载流水线失败')
  }
}
async function loadHistory(limit = 200) {
  loading.value = true
  try {
    history.value = await pipelineApi.list({ templateId: tplId.value, limit })
  } catch {
    message.error('加载执行记录失败')
  } finally {
    loading.value = false
  }
}
function isLive(p?: PipelineItem | null) {
  return !!p && ['running', 'pending', 'pending-approval'].includes(p.status)
}
function startPolling() {
  stopPolling()
  timer = window.setInterval(async () => {
    await loadHistory(50)
    if (!isLive(history.value[0])) stopPolling()
  }, 3000)
}
function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

// ===== 实例操作（重试/取消/审批/转全量） =====
async function afterChange() {
  await loadHistory(50)
  if (isLive(history.value[0])) startPolling()
}
function handleRetry(p: PipelineItem) {
  const isSucceeded = p.status === 'succeeded'
  Modal.confirm({
    title: isSucceeded ? '再次发布' : '重试发布',
    content: isSucceeded
      ? `以相同参数再次发布（${p.env} / ${p.moduleKey}，分支 ${p.gitBranch || '-'}，commit ${p.gitCommit || '-'}）？将重新执行一次完整发布。`
      : `以相同参数重新提交（${p.env} / ${p.moduleKey}，分支 ${p.gitBranch || '-'}）？原实例记录保留。`,
    okText: isSucceeded ? '再次发布' : '重试',
    cancelText: '取消',
    onOk: async () => {
      try {
        const res = await pipelineApi.retry(p.id)
        message.success(`已重新提交: ${res.jobId}`)
        await afterChange()
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '重试失败')
      }
    },
  })
}
function handleCancel(p: PipelineItem) {
  Modal.confirm({
    title: p.status === 'pending-approval' ? '撤回审批请求' : '确认取消',
    content:
      p.status === 'pending-approval'
        ? `撤回 ${p.id} 的发布审批请求？撤回后需重新提交。`
        : `确定取消实例 ${p.id} 吗？正在执行的阶段会中断。`,
    okText: p.status === 'pending-approval' ? '撤回' : '取消任务',
    okType: 'danger',
    cancelText: '返回',
    onOk: async () => {
      try {
        await pipelineApi.cancel(p.id)
        message.success('已请求取消')
        await loadHistory(50)
      } catch {
        message.error('取消失败')
      }
    },
  })
}
function handlePromote(p: PipelineItem) {
  Modal.confirm({
    title: '灰度转全量',
    content: `将把 ${p.env} / ${p.moduleKey} 的全量指针切到 ${p.versionTag}，并禁用灰度规则。确认？`,
    okText: '转全量',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelineApi.promote(p.id)
        message.success('已转全量')
        await loadHistory(50)
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '转全量失败')
      }
    },
  })
}
const review = ref<{ p: PipelineItem; action: 'approve' | 'reject' } | null>(null)
const reviewComment = ref('')
const reviewing = ref(false)
function openApprove(p: PipelineItem) {
  reviewComment.value = ''
  review.value = { p, action: 'approve' }
}
function openReject(p: PipelineItem) {
  reviewComment.value = ''
  review.value = { p, action: 'reject' }
}
async function submitReview() {
  if (!review.value) return
  if (review.value.action === 'reject' && !reviewComment.value.trim()) {
    message.warning('拒绝必须填写审批意见')
    return
  }
  reviewing.value = true
  try {
    if (review.value.action === 'approve') {
      await pipelineApi.approve(review.value.p.id, reviewComment.value.trim() || undefined)
      message.success('已审批通过，发布开始执行')
    } else {
      await pipelineApi.reject(review.value.p.id, reviewComment.value.trim())
      message.success('已拒绝该发布')
    }
    review.value = null
    await afterChange()
  } catch (e: any) {
    message.error(e?.response?.data?.message || e?.message || '操作失败')
  } finally {
    reviewing.value = false
  }
}

// ===== 日志抽屉（查看历史实例完整执行详情） =====
const logVisible = ref(false)
const logRecord = ref<PipelineItem | null>(null)
function showLogs(p: PipelineItem) {
  logRecord.value = p
  logVisible.value = true
}

// ===== 阶段命令查看（点击步骤标签打开） =====
// 拉取模块「发布脚本」视图；点击步骤标签弹出该阶段的命令/内置说明。
//
// 此处展示的是模块**当前**配置的命令，而非执行时实际下发的快照；
// 真实下发命令还可通过日志中 `[stage] $ ...` 行回溯，二者结合即可定位。
const scriptViewMap = ref<Record<string, any[]>>({})
const cmdModalOpen = ref(false)
const cmdModalStage = ref('')
const cmdModalItem = ref<any>(null)
async function ensureScriptView(moduleKey: string) {
  if (!moduleKey || scriptViewMap.value[moduleKey]) return
  try {
    scriptViewMap.value[moduleKey] = await stageCommandApi.scriptView(moduleKey)
  } catch {
    scriptViewMap.value[moduleKey] = []
  }
}
async function openStageCmd(record: PipelineItem, stage: string) {
  await ensureScriptView(record.moduleKey)
  const list = scriptViewMap.value[record.moduleKey] || []
  cmdModalItem.value = list.find((it: any) => it.stage === stage) ?? null
  cmdModalStage.value = stage
  cmdModalOpen.value = true
}
function copyCmd(cmd: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(cmd).then(
      () => message.success('已复制'),
      () => message.warning('复制失败，请手动选择'),
    )
  } else {
    message.warning('当前环境不支持剪贴板，请手动选择')
  }
}

// ===== 立即发布（按当前流水线提交新实例） =====
const releaseOpen = ref(false)
const submitting = ref(false)
const environments = ref<{ id: string; name: string }[]>([])
const modules = ref<any[]>([])
const availableModules = computed(() => modules.value.filter((m: any) => m.enabled !== false))
const relForm = ref({
  env: 'dev',
  moduleKey: '',
  branch: 'master',
  commitId: undefined as string | undefined,
  mode: 'direct' as 'direct' | 'grayscale',
})
const releases = ref<{ versionTag: string; note?: string }[]>([])
async function loadEnvironments() {
  try {
    environments.value = await environmentApi.list()
    if (!environments.value.find((e) => e.id === relForm.value.env)) {
      relForm.value.env = environments.value[0]?.id || 'dev'
    }
  } catch {
    message.error('加载环境列表失败')
  }
}
async function loadModules() {
  try {
    modules.value = await deployApi.modules()
    if (!relForm.value.moduleKey && availableModules.value.length) {
      relForm.value.moduleKey = availableModules.value[0].key
    }
  } catch {
    message.error('加载模块列表失败')
  }
}
async function loadReleases() {
  try {
    releases.value = await pipelineApi.releases(relForm.value.env, relForm.value.moduleKey)
  } catch {
    releases.value = []
  }
}
function openRelease() {
  relForm.value.moduleKey = availableModules.value[0]?.key || ''
  relForm.value.branch = 'master'
  relForm.value.commitId = undefined
  relForm.value.mode = 'direct'
  releaseOpen.value = true
  void Promise.all([loadModules(), loadReleases()])
}
async function onRelEnvChange() {
  await loadReleases()
}
function submitRelease() {
  if (!relForm.value.moduleKey) {
    message.warning('请选择模块')
    return
  }
  submitting.value = true
  const run = async () => {
    try {
      const res = await pipelineApi.submit({
        env: relForm.value.env,
        moduleKey: relForm.value.moduleKey,
        branch: relForm.value.branch || 'master',
        commitId: relForm.value.commitId || undefined,
        mode: relForm.value.mode,
        templateId: tplId.value,
        confirm: relForm.value.env === 'prod',
      })
      if ((res as any).status === 'pending-approval') {
        message.info(`已提交审批（${res.jobId}），审批通过后将自动发布`)
      } else {
        message.success(`已提交: ${res.jobId}`)
      }
      releaseOpen.value = false
      await afterChange()
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '提交流水线失败')
    } finally {
      submitting.value = false
    }
  }
  void run()
}

onMounted(async () => {
  await Promise.all([loadTpl(), loadEnvironments()])
  await loadHistory(200)
  if (isLive(history.value[0])) startPolling()
})
onUnmounted(stopPolling)
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <a-button type="link" @click="router.back()">← 返回</a-button>
      <h2 style="margin: 0;">流水线详情</h2>
      <template v-if="tpl">
        <a-tag color="blue" style="font-size: 14px;">{{ tpl.name }}</a-tag>
        <a-tag v-if="tpl.builtin" color="blue">默认</a-tag>
        <a-tag v-if="!tpl.enabled" color="default">已停用</a-tag>
        <a-tag v-if="tpl.approval === 'always'" color="orange">始终审批</a-tag>
        <a-tag v-if="tpl.approval === 'never'" color="red">免审批</a-tag>
        <a-tag v-if="tpl.skipVerify" color="cyan">跳过探活</a-tag>
      </template>
    </div>

    <template v-if="tpl">
      <!-- 概览 -->
      <a-card size="small" style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div style="color: #666;">
            {{ tpl.description || '（无说明）' }}
            <div style="margin-top: 6px; font-size: 12px; color: #999;">
              活动步骤 {{ stepList({ steps: tpl.steps || null, status: 'succeeded' } as any).length }}/9 ·
              探活失败{{ tpl.rollbackOnFailure === 'none' ? '不回滚' : '自动回滚' }} · 投递默认{{
                tpl.defaultTarget === 'auto' ? '自动' : tpl.defaultTarget === 'local' ? '本机' : '远程'
              }}
            </div>
          </div>
          <div style="display: flex; gap: 24px;">
            <div style="text-align: center;">
              <div style="font-size: 22px; font-weight: 600;">{{ runTotal }}</div>
              <div style="font-size: 12px; color: #999;">执行次数</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 22px; font-weight: 600; color: #52c41a;">{{ runOk }}</div>
              <div style="font-size: 12px; color: #999;">成功次数</div>
            </div>
            <div style="display: flex; align-items: center;">
              <a-button type="primary" :disabled="!availableModules.length" @click="openRelease">
                按此流水线发布
              </a-button>
            </div>
          </div>
        </div>
      </a-card>

      <a-card size="small" :loading="loading">
        <a-tabs v-model:activeKey="activeTab">
          <!-- 最新执行 -->
          <a-tab-pane key="latest" tab="最新执行">
            <a-empty v-if="!latest" description="该流水线还没有执行记录">
              <template #description>
                <span>该流水线还没有执行记录</span>
                <br />
                <a-button type="primary" style="margin-top: 8px;" :disabled="!availableModules.length" @click="openRelease">
                  立即发起一次发布
                </a-button>
              </template>
            </a-empty>

            <template v-if="latest">
              <!-- 元信息 -->
              <a-descriptions :column="3" size="small" bordered style="margin-bottom: 12px;">
                <a-descriptions-item label="状态">
                  <a-tag :color="statusColor(latest.status)">{{ statusText(latest.status) }}</a-tag>
                  <a-tag v-if="latest.mode === 'grayscale'" color="orange">灰度</a-tag>
                  <a-tag v-if="latest.reuseArtifact" color="cyan">复用产物</a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="环境 / 模块">{{ latest.env }} / {{ latest.moduleKey }}</a-descriptions-item>
                <a-descriptions-item label="版本">{{ latest.versionTag || '—' }}</a-descriptions-item>
                <a-descriptions-item label="分支">{{ latest.gitBranch || '—' }}</a-descriptions-item>
                <a-descriptions-item label="commit">{{ latest.gitCommit || '—' }}</a-descriptions-item>
                <a-descriptions-item label="操作人">{{ latest.operator || '—' }}</a-descriptions-item>
                <a-descriptions-item label="开始">{{ formatTime(latest.startTime) }}</a-descriptions-item>
                <a-descriptions-item label="结束">{{ formatTime(latest.endTime) }}</a-descriptions-item>
                <a-descriptions-item label="耗时">{{ (durationMs(latest) / 1000).toFixed(1) }}s</a-descriptions-item>
              </a-descriptions>

              <!-- 执行步骤 -->
              <div style="margin-bottom: 12px;">
                <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">
                  执行步骤（{{ stepList(latest).length }} 步）
                  <a-tag v-if="latest.rollbackOnFailure === 'none'" style="margin-left: 4px;">失败不回滚</a-tag>
                  <a-tag color="cyan" style="margin-left: 4px;">点击标签查看命令</a-tag>
                </div>
                <a-space wrap :size="6">
                  <a-tag
                    v-for="s in stepList(latest)"
                    :key="s"
                    :color="STEP_COLORS[stepState(latest, s)]"
                    style="margin-right: 0; cursor: pointer;"
                    @click="openStageCmd(latest, s)"
                  >
                    {{ STEP_LABELS[s] || s }}
                  </a-tag>
                </a-space>
                <div v-if="latest.progress?.message" style="margin-top: 6px; color: #888; font-size: 12px;">
                  {{ latest.progress.message }}
                </div>
              </div>

              <a-alert
                v-if="latest.error"
                type="error"
                show-icon
                :message="latest.error"
                style="margin-bottom: 12px;"
              />

              <!-- 日志 -->
              <div
                style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                       font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 50vh; overflow: auto;"
              >{{ (latest.logs || []).join('\n') || '（暂无日志）' }}</div>

              <!-- 操作 -->
              <div style="margin-top: 12px;">
                <a-space>
                  <a-button
                    v-if="['running', 'pending', 'pending-approval'].includes(latest.status)"
                    danger
                    @click="handleCancel(latest)"
                  >
                    {{ latest.status === 'pending-approval' ? '撤回审批' : '取消' }}
                  </a-button>
                  <template v-if="latest.status === 'pending-approval'">
                    <a-button type="primary" @click="openApprove(latest)">审批通过</a-button>
                    <a-button danger @click="openReject(latest)">拒绝</a-button>
                  </template>
                  <a-button
                    v-if="['failed', 'cancelled', 'succeeded'].includes(latest.status)"
                    @click="handleRetry(latest)"
                  >
                    {{ latest.status === 'succeeded' ? '再次发布' : '重试' }}
                  </a-button>
                  <a-button
                    v-if="latest.mode === 'grayscale' && latest.status === 'succeeded'"
                    type="primary"
                    @click="handlePromote(latest)"
                  >
                    灰度转全量
                  </a-button>
                  <a-button @click="showLogs(latest)">全屏日志</a-button>
                </a-space>
              </div>
            </template>
          </a-tab-pane>

          <!-- 历史记录 -->
          <a-tab-pane key="history" tab="历史记录">
            <a-table
              :columns="[
                { title: '实例', dataIndex: 'id', key: 'id', width: 130 },
                { title: '环境/模块', key: 'who', width: 170 },
                { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 110 },
                { title: '模式', key: 'mode', width: 80 },
                { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
                { title: '阶段/结果', key: 'stage', ellipsis: true },
                { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
                { title: '开始时间', dataIndex: 'startTime', key: 'startTime', width: 150 },
                { title: '操作', key: 'action', width: 240 },
              ]"
              :data-source="history"
              :loading="loading"
              :pagination="{ pageSize: 10 }"
              row-key="id"
              size="small"
              :locale="{ emptyText: '暂无执行记录' }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'id'">
                  <a-tooltip :title="record.id">
                    <span style="font-family: monospace;">{{ String(record.id).slice(-12) }}</span>
                  </a-tooltip>
                </template>
                <template v-else-if="column.key === 'who'">
                  {{ record.env }} / {{ record.moduleKey }}
                </template>
                <template v-else-if="column.key === 'mode'">
                  <a-tag :color="record.mode === 'grayscale' ? 'orange' : 'blue'">
                    {{ record.mode === 'grayscale' ? '灰度' : '全量' }}
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'status'">
                  <a-tag :color="statusColor(record.status)">{{ statusText(record.status) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'stage'">
                  <span style="color: #666;">
                    {{ STEP_LABELS[record.stage] || record.stage || '—' }}
                    <span v-if="record.reuseArtifact">（复用产物）</span>
                    <span v-if="record.error" style="color: #cf1322;"> · {{ record.error }}</span>
                  </span>
                </template>
                <template v-else-if="column.key === 'startTime'">
                  {{ formatTime(record.startTime) }}
                </template>
                <template v-else-if="column.key === 'action'">
                  <a-space size="small" wrap>
                    <a-button type="link" size="small" @click="showLogs(record)">查看</a-button>
                    <a-button
                      v-if="['failed', 'cancelled', 'succeeded'].includes(record.status)"
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
                      v-if="['running', 'pending'].includes(record.status)"
                      type="link"
                      size="small"
                      danger
                      @click="handleCancel(record)"
                    >
                      取消
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
          </a-tab-pane>
        </a-tabs>
      </a-card>
    </template>

    <!-- 审批弹窗 -->
    <a-modal
      :open="!!review"
      :title="review?.action === 'approve' ? '审批通过' : '拒绝发布'"
      :confirm-loading="reviewing"
      @ok="submitReview"
      @cancel="review = null"
    >
      <p v-if="review" style="margin-bottom: 12px; color: #666;">
        {{ review.p.env }} / {{ review.p.moduleKey }}
        <template v-if="review.p.versionTag">@ {{ review.p.versionTag }}</template>
        · 提交人 {{ review.p.operator || '-' }}
      </p>
      <a-textarea
        v-model:value="reviewComment"
        :rows="3"
        :placeholder="review?.action === 'reject' ? '请填写拒绝原因（必填）' : '审批意见（可选）'"
      />
    </a-modal>

    <!-- 日志抽屉 -->
    <a-drawer v-model:open="logVisible" title="执行详情" placement="right" :width="760">
      <template v-if="logRecord">
        <a-descriptions :column="2" size="small" bordered style="margin-bottom: 12px;">
          <a-descriptions-item label="实例">{{ logRecord.id }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(logRecord.status)">{{ statusText(logRecord.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="环境/模块">{{ logRecord.env }} / {{ logRecord.moduleKey }}</a-descriptions-item>
          <a-descriptions-item label="版本">{{ logRecord.versionTag || '-' }}</a-descriptions-item>
          <a-descriptions-item label="分支">{{ logRecord.gitBranch || '-' }}</a-descriptions-item>
          <a-descriptions-item label="提交">{{ logRecord.gitCommit || '-' }}</a-descriptions-item>
          <a-descriptions-item label="操作人">{{ logRecord.operator || '-' }}</a-descriptions-item>
          <a-descriptions-item label="耗时">{{ (durationMs(logRecord) / 1000).toFixed(1) }}s</a-descriptions-item>
        </a-descriptions>

        <div style="margin-bottom: 12px;">
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">
            执行步骤（{{ stepList(logRecord).length }} 步）
            <a-tag color="cyan" style="margin-left: 6px;">点击查看命令</a-tag>
          </div>
          <a-space wrap :size="6">
            <a-tag
              v-for="s in stepList(logRecord)"
              :key="s"
              :color="STEP_COLORS[stepState(logRecord, s)]"
              style="margin-right: 0; cursor: pointer;"
              @click="openStageCmd(logRecord, s)"
            >
              {{ STEP_LABELS[s] || s }}
            </a-tag>
          </a-space>
          <div v-if="logRecord.progress?.message" style="margin-top: 6px; color: #888; font-size: 12px;">
            {{ logRecord.progress.message }}
          </div>
          <a-alert v-if="logRecord.error" type="error" show-icon :message="logRecord.error" style="margin-top: 8px;" />
        </div>

        <div
          style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                 font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 60vh; overflow: auto;"
        >{{ (logRecord.logs || []).join('\n') || '（无日志）' }}</div>
      </template>
    </a-drawer>

    <!-- 立即发布弹窗 -->
    <a-modal
      :open="releaseOpen"
      title="按此流水线发起发布"
      :confirm-loading="submitting"
      @ok="submitRelease"
      @cancel="releaseOpen = false"
      :width="640"
    >
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="环境" required>
              <a-select v-model:value="relForm.env" @change="onRelEnvChange">
                <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
                  {{ e.name }}（{{ e.id }}）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="模块" required>
              <a-select v-model:value="relForm.moduleKey" placeholder="选择模块" @change="loadReleases">
                <a-select-option v-for="m in availableModules" :key="m.key" :value="m.key">
                  {{ m.name }}（{{ m.key }}）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="分支">
              <a-input v-model:value="relForm.branch" placeholder="master" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="Commit（留空=最新）">
              <a-select v-model:value="relForm.commitId" allow-clear placeholder="留空=分支最新提交">
                <a-select-option v-for="r in releases" :key="r.versionTag" :value="r.versionTag">
                  {{ r.versionTag }}{{ r.note ? ` · ${r.note}` : '' }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="模式">
          <a-radio-group v-model:value="relForm.mode">
            <a-radio value="direct">全量</a-radio>
            <a-radio value="grayscale">灰度（按 10% 比例，如需用户名单/请求头请在流水线首页发起）</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-alert
          v-if="relForm.env === 'prod'"
          type="warning"
          show-icon
          message="发布到生产环境将进入审批流程，审批通过后才执行。"
        />
      </a-form>
    </a-modal>

    <!-- 阶段命令查看 modal（点击步骤标签触发） -->
    <a-modal
      v-model:open="cmdModalOpen"
      :title="`阶段命令：${cmdModalItem?.title || cmdModalStage}`"
      :footer="null"
      :width="720"
    >
      <template v-if="cmdModalItem">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="color: #999; font-family: monospace;">{{ cmdModalItem.stage }}</span>
          <a-tag v-if="cmdModalItem.source === 'configured'" color="blue">模块脚本</a-tag>
          <a-tag v-else-if="cmdModalItem.source === 'required-unset'" color="red">必填·未配置</a-tag>
          <a-tag v-else-if="cmdModalItem.source === 'semantic'" color="purple">语义真相源</a-tag>
          <a-tag v-else color="default">流程内置</a-tag>
          <a-tag v-if="cmdModalItem.timeoutSec" color="cyan">
            超时 {{ cmdModalItem.timeoutSec }}s
          </a-tag>
        </div>

        <template v-if="cmdModalItem.source === 'configured' && cmdModalItem.command">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 12px; color: #999;">shell 命令（DB 真相源）</span>
            <a-button size="small" type="link" @click="copyCmd(cmdModalItem.command)">复制</a-button>
          </div>
          <pre
            style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                   font-family: monospace; font-size: 12px; white-space: pre-wrap;
                   max-height: 360px; overflow: auto; margin: 0;"
          >{{ cmdModalItem.command }}</pre>
          <div v-if="cmdModalItem.builtin" style="margin-top: 8px; color: #666; font-size: 12px;">
            <span style="color: #999;">叠加流程内置：</span>{{ cmdModalItem.builtin }}
          </div>
        </template>

        <a-alert
          v-else-if="cmdModalItem.source === 'required-unset'"
          type="error"
          show-icon
          :message="cmdModalItem.builtin"
        />
        <a-alert
          v-else
          :type="cmdModalItem.source === 'semantic' ? 'warning' : 'info'"
          show-icon
          :message="cmdModalItem.builtin"
        />
      </template>
    </a-modal>
  </div>
</template>
