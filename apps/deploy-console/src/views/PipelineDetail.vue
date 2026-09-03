<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
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
import ProgressFlow from '@/components/pipeline/ProgressFlow.vue'
import PipelineRunLogs from '@/components/pipeline/PipelineRunLogs.vue'
import StageCommandDrawer, {
  type StageScriptItem,
} from '@/components/pipeline/StageCommandDrawer.vue'
import {
  STEP_LABELS,
  stepList,
  statusColor,
  statusText,
  formatTime,
  durationMs,
  isLive,
} from '@/components/pipeline/pipeline.stages'

const route = useRoute()
const router = useRouter()
const tplId = computed(() => String(route.params.id || ''))

const tpl = ref<PipelineTemplate | null>(null)
const history = ref<PipelineItem[]>([])
const loading = ref(false)
/** flow=执行流程（当前选中实例流程图）/ history=历史记录 */
const activeTab = ref<'flow' | 'history'>('flow')
let timer: number | undefined

// ===== 当前查看的实例（selectedRun：默认最新一次，?run= 可深链到任意历史） =====
const selectedRun = ref<PipelineItem | null>(null)
const selectedRunId = computed(() => selectedRun.value?.id || '')

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

/** 指定实例为「当前查看」，同步 URL ?run=（支持刷新/分享/前进后退） */
function pickRun(p: PipelineItem | null) {
  selectedRun.value = p
  if (p) {
    router.replace({ query: { ...route.query, run: p.id } })
  }
}
/** 从历史/接口解析目标实例并选中（优先 ?run=，缺省取最新一次） */
async function loadSelectedRun() {
  const qRun = String(route.query.run || '')
  const targetId = qRun || history.value[0]?.id || ''
  if (!targetId) {
    pickRun(null)
    return
  }
  let target = history.value.find((h) => h.id === targetId) || null
  if (!target) {
    try {
      target = await pipelineApi.get(targetId)
    } catch {
      target = null
    }
  }
  selectedRun.value = target
  if (!qRun && target) {
    // 默认选中最新：同步 URL 便于状态一致
    router.replace({ query: { ...route.query, run: target.id } })
  }
}

/** 历史表格「查看详情/点 ID」：切到流程图 Tab 并加载该实例 */
function viewRunInFlow(p: PipelineItem) {
  pickRun(p)
  activeTab.value = 'flow'
}

// ?run 变化（点浏览器前进/后退、外部深链）→ 重新选中
watch(
  () => route.query.run,
  async (v) => {
    if (v && v !== selectedRunId.value) {
      // history 已加载则本地命中，否则单拉
      const target = history.value.find((h) => h.id === v) || null
      if (target) {
        selectedRun.value = target
      } else {
        await loadSelectedRun()
      }
    }
  },
)

// 轮询：仅「当前查看实例」仍在运行/等待时 3s 拉最新，驱动流程图推进
async function pollTick() {
  if (!selectedRun.value) {
    stopPolling()
    return
  }
  const fresh = await pipelineApi.get(selectedRun.value.id).catch(() => null)
  if (!fresh) {
    stopPolling()
    return
  }
  // 同步到 selectedRun + 历史列表中的同一行
  selectedRun.value = fresh
  const idx = history.value.findIndex((h) => h.id === fresh.id)
  if (idx >= 0) history.value[idx] = fresh
  if (!isLive(fresh)) stopPolling()
}
function startPolling() {
  stopPolling()
  timer = window.setInterval(() => void pollTick(), 3000)
}
function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}
watch(
  () => selectedRun.value?.status,
  (s) => {
    if (isLive(selectedRun.value)) startPolling()
    else stopPolling()
  },
)

function copyRunId(p: PipelineItem) {
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(p.id)
      .then(() => message.success('实例 ID 已复制'))
      .catch(() => message.warning('复制失败，请手动选择'))
  } else {
    message.warning('当前环境不支持剪贴板，请手动选择')
  }
}

// ===== 实例操作（重试/取消/审批/转全量/删除） =====
async function afterChange() {
  await loadHistory(200)
  await loadSelectedRun()
  if (isLive(selectedRun.value)) startPolling()
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
async function handleRemove(p: PipelineItem) {
  Modal.confirm({
    title: '删除执行记录',
    content: `确定删除实例 ${p.id} 的记录吗？仅从历史列表移除，不影响当前版本指针与产物。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '返回',
    onOk: async () => {
      try {
        await pipelineApi.remove(p.id)
        message.success('已删除执行记录')
        await loadHistory(200)
        // 删除的恰好是当前查看实例 → 回落到最新一次
        if (selectedRunId.value === p.id) {
          await loadSelectedRun()
        }
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '删除失败')
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

// ===== 阶段命令抽屉（点击进度流节点「命令」） =====
const scriptViewMap = ref<Record<string, StageScriptItem[]>>({})
const cmdOpen = ref(false)
const cmdItem = ref<StageScriptItem | null>(null)
async function ensureScriptView(moduleKey: string) {
  if (!moduleKey || scriptViewMap.value[moduleKey]) return
  try {
    scriptViewMap.value[moduleKey] = (await stageCommandApi.scriptView(moduleKey)) as StageScriptItem[]
  } catch {
    scriptViewMap.value[moduleKey] = []
  }
}
// ===== 阶段详情抽屉（三合一：命令/日志/结果） =====
const cmdInitialTab = ref<'command' | 'logs' | 'result'>('command')
/** 底部执行日志关键字过滤（节点点击联动） */
const logKeyword = ref('')
async function openStageDrawer(stage: string, tab: 'command' | 'logs' | 'result' = 'command') {
  const p = selectedRun.value
  if (!p) return
  await ensureScriptView(p.moduleKey)
  const list = scriptViewMap.value[p.moduleKey] || []
  cmdItem.value = list.find((it) => it.stage === stage) ?? null
  cmdInitialTab.value = tab
  cmdOpen.value = true
}
/** 点流程图节点 → 打开抽屉「执行日志」Tab + 底部日志同步过滤 */
function onStageClick(stage: string) {
  logKeyword.value = stage
  void openStageDrawer(stage, 'logs')
}
/** 点节点下「命令」入口 → 打开抽屉「命令」Tab */
function onCommandClick(stage: string) {
  void openStageDrawer(stage, 'command')
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
  // 默认选中：?run= 指定的历史实例，缺省 = 最新一次；running 由 watch 自动轮询
  await loadSelectedRun()
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
          <!-- 执行流程（当前查看实例，默认最新一次） -->
          <a-tab-pane key="flow" tab="执行流程">
            <a-empty v-if="!selectedRun" description="该流水线还没有执行记录">
              <template #description>
                <span>该流水线还没有执行记录</span>
                <br />
                <a-button type="primary" style="margin-top: 8px;" :disabled="!availableModules.length" @click="openRelease">
                  立即发起一次发布
                </a-button>
              </template>
            </a-empty>

            <template v-if="selectedRun">
              <!-- 摘要条：正在看哪个实例 -->
              <div
                style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
                       background: #fafafa; border: 1px solid #f0f0f0; border-radius: 6px;
                       padding: 8px 12px; margin-bottom: 12px; font-size: 13px;"
              >
                <span style="color: #1677ff; font-family: monospace; cursor: pointer;" title="点击复制实例 ID" @click="copyRunId(selectedRun)">
                  #{{ String(selectedRun.id).slice(-12) }}
                </span>
                <a-tag :color="statusColor(selectedRun.status)" style="margin-right: 0;">
                  {{ statusText(selectedRun.status) }}
                </a-tag>
                <span style="color: #666;">{{ selectedRun.env }} / {{ selectedRun.moduleKey }}</span>
                <template v-if="selectedRun.gitBranch">
                  <span style="color: #888;">{{ selectedRun.gitBranch }}@{{ selectedRun.gitCommit || '—' }}</span>
                </template>
                <span v-if="selectedRun.operator" style="color: #888;">· {{ selectedRun.operator }}</span>
                <span style="margin-left: auto; color: #999; font-size: 12px;">
                  {{ formatTime(selectedRun.startTime) }}
                  <template v-if="selectedRun.endTime || ['succeeded', 'failed', 'cancelled'].includes(selectedRun.status)">
                    · {{ (durationMs(selectedRun) / 1000).toFixed(1) }}s
                  </template>
                </span>
              </div>

              <!-- 进度流程图（点击节点看该阶段详情） -->
              <ProgressFlow
                :instance="selectedRun"
                @stage-click="onStageClick"
                @command-click="onCommandClick"
              />

              <div v-if="selectedRun.error" style="margin-top: 12px;">
                <a-alert type="error" show-icon :message="selectedRun.error" />
              </div>

              <!-- 操作（作用于当前查看实例：停止/重试/审批/转全量） -->
              <div style="margin-top: 12px;">
                <a-space>
                  <a-button
                    v-if="['running', 'pending'].includes(selectedRun.status)"
                    danger
                    @click="handleCancel(selectedRun)"
                  >停止</a-button>
                  <a-button v-if="selectedRun.status === 'pending-approval'" danger @click="handleCancel(selectedRun)">
                    撤回审批
                  </a-button>
                  <template v-if="selectedRun.status === 'pending-approval'">
                    <a-button type="primary" @click="openApprove(selectedRun)">审批通过</a-button>
                    <a-button danger @click="openReject(selectedRun)">拒绝</a-button>
                  </template>
                  <a-button
                    v-if="['failed', 'cancelled', 'succeeded'].includes(selectedRun.status)"
                    @click="handleRetry(selectedRun)"
                  >
                    {{ selectedRun.status === 'succeeded' ? '再次发布' : '重试' }}
                  </a-button>
                  <a-button
                    v-if="selectedRun.mode === 'grayscale' && selectedRun.status === 'succeeded'"
                    type="primary"
                    @click="handlePromote(selectedRun)"
                  >灰度转全量</a-button>
                </a-space>
              </div>

              <!-- 日志 -->
              <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">执行日志</div>
                <PipelineRunLogs :lines="selectedRun.logs || []" :keyword="logKeyword" />
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
                { title: '操作', key: 'action', width: 300 },
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
                  <a-tooltip :title="`点击查看该实例的执行流程：${record.id}`">
                    <span style="font-family: monospace; cursor: pointer; color: #1677ff;" @click="viewRunInFlow(record)">
                      {{ String(record.id).slice(-12) }}
                    </span>
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
                    <a-button type="link" size="small" @click="viewRunInFlow(record)">详情</a-button>
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
                    >取消</a-button>
                    <a-button
                      v-if="record.mode === 'grayscale' && record.status === 'succeeded'"
                      type="link"
                      size="small"
                      @click="handlePromote(record)"
                    >转全量</a-button>
                    <a-button
                      v-if="!['running', 'pending', 'pending-approval'].includes(record.status)"
                      type="link"
                      size="small"
                      danger
                      @click="handleRemove(record)"
                    >删除</a-button>
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

    <!-- 阶段命令抽屉 -->
    <StageCommandDrawer
      v-model:open="cmdOpen"
      :item="cmdItem"
      :instance="selectedRun"
      :initial-tab="cmdInitialTab"
    />
  </div>
</template>
