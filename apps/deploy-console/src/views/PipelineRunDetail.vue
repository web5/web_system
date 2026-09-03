<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import { pipelineApi, stageCommandApi, type PipelineItem } from '@/api'
import ProgressFlow from '@/components/pipeline/ProgressFlow.vue'
import PipelineRunLogs from '@/components/pipeline/PipelineRunLogs.vue'
import StageCommandDrawer, {
  type StageScriptItem,
} from '@/components/pipeline/StageCommandDrawer.vue'
import {
  STEP_LABELS,
  durationMs,
  formatTime,
  isLive,
  statusColor,
  statusText,
} from '@/components/pipeline/pipeline.stages'

const route = useRoute()
const router = useRouter()

const tplId = computed(() => String(route.params.id || ''))
const runId = computed(() => String(route.params.runId || ''))
const goBack = () => (tplId.value ? router.push(`/pipelines/${tplId.value}`) : router.back())

// ===== 实例数据 =====
const instance = ref<PipelineItem | null>(null)
const loading = ref(false)
const notFound = ref(false)
let timer: number | undefined

async function loadRun() {
  loading.value = true
  try {
    instance.value = await pipelineApi.get(runId.value)
    notFound.value = false
  } catch {
    notFound.value = true
    stopPolling()
  } finally {
    loading.value = false
  }
}
function startPolling() {
  stopPolling()
  timer = window.setInterval(async () => {
    await loadRun()
    if (!isLive(instance.value)) stopPolling()
  }, 3000)
}
function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}
onMounted(async () => {
  await loadRun()
  if (isLive(instance.value)) startPolling()
})
onUnmounted(stopPolling)

// ===== 日志过滤（点击进度流节点定位阶段） =====
const logKeyword = ref('')
function onStageClick(stage: string) {
  // 定位到该阶段相关日志（「[build] $ …」等命令行为主）
  logKeyword.value = stage
  message.info(`已按阶段「${STEP_LABELS[stage] || stage}」过滤日志，可清除关键字恢复`)
}

// ===== 阶段命令抽屉 =====
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
async function onCommandClick(stage: string) {
  const p = instance.value
  if (!p) return
  await ensureScriptView(p.moduleKey)
  const list = scriptViewMap.value[p.moduleKey] || []
  cmdItem.value = list.find((it) => it.stage === stage) ?? null
  cmdOpen.value = true
}

// ===== 探活/验证结果摘要 =====
const healthSummary = computed<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(() => {
  const p = instance.value
  const r = (p?.result ?? {}) as Record<string, any>
  if (p?.moduleKey && (r.healthCheck || r.artifactOk !== undefined || r.manifestVersion)) {
    if (r.healthCheck) {
      const h = r.healthCheck
      return {
        type: h.ok === false ? 'error' : h.ok === true ? 'success' : 'warning',
        text: `后端探活：port=${h.port ?? 'n/a'}，ok=${h.ok ?? 'n/a'}${h.note ? `（${h.note}）` : ''}${
          h.checkedAt ? ` · ${formatTime(new Date(h.checkedAt).getTime())}` : ''
        }`,
      }
    }
    const bits: string[] = []
    if (r.artifactOk !== undefined) bits.push(`产物可访问: ${r.artifactOk ? '是' : '否'}`)
    if (r.manifestVersion) bits.push(`manifest 版本: ${r.manifestVersion}`)
    return bits.length ? { type: 'info', text: bits.join(' · ') } : null
  }
  return null
})

// ===== 实例操作（与流水线详情一致） =====
async function afterChange() {
  await loadRun()
  if (isLive(instance.value)) startPolling()
}
function handleRetry() {
  const p = instance.value
  if (!p) return
  Modal.confirm({
    title: p.status === 'succeeded' ? '再次发布' : '重试发布',
    content:
      p.status === 'succeeded'
        ? `以相同参数再次发布（${p.env} / ${p.moduleKey}，分支 ${p.gitBranch || '-'}）？`
        : `以相同参数重新提交（${p.env} / ${p.moduleKey}）？原实例记录保留。`,
    okText: p.status === 'succeeded' ? '再次发布' : '重试',
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
function handleCancel() {
  const p = instance.value
  if (!p) return
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
        await afterChange()
      } catch {
        message.error('取消失败')
      }
    },
  })
}
function handlePromote() {
  const p = instance.value
  if (!p) return
  Modal.confirm({
    title: '灰度转全量',
    content: `将把 ${p.env} / ${p.moduleKey} 的全量指针切到 ${p.versionTag}，并禁用灰度规则。确认？`,
    okText: '转全量',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelineApi.promote(p.id)
        message.success('已转全量')
        await afterChange()
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '转全量失败')
      }
    },
  })
}
const reviewOpen = ref(false)
const reviewAction = ref<'approve' | 'reject'>('approve')
const reviewComment = ref('')
const reviewing = ref(false)
function openReview(action: 'approve' | 'reject') {
  reviewAction.value = action
  reviewComment.value = ''
  reviewOpen.value = true
}
async function submitReview() {
  const p = instance.value
  if (!p) return
  if (reviewAction.value === 'reject' && !reviewComment.value.trim()) {
    message.warning('拒绝必须填写审批意见')
    return
  }
  reviewing.value = true
  try {
    if (reviewAction.value === 'approve') {
      await pipelineApi.approve(p.id, reviewComment.value.trim() || undefined)
      message.success('已审批通过，发布开始执行')
    } else {
      await pipelineApi.reject(p.id, reviewComment.value.trim())
      message.success('已拒绝该发布')
    }
    reviewOpen.value = false
    await afterChange()
  } catch (e: any) {
    message.error(e?.response?.data?.message || e?.message || '操作失败')
  } finally {
    reviewing.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <a-button type="link" @click="goBack">← 返回</a-button>
      <h2 style="margin: 0;">发布执行详情</h2>
      <a-tag v-if="instance?.templateName" color="blue">{{ instance.templateName }}</a-tag>
      <a-tag v-if="instance" color="default" style="font-family: monospace;">
        {{ String(instance.id).slice(-12) }}
      </a-tag>
      <a-tag v-if="instance" :color="statusColor(instance.status)" style="font-size: 13px;">
        {{ statusText(instance.status) }}
      </a-tag>
    </div>

    <a-spin :spinning="loading">
      <a-empty v-if="notFound" description="执行记录不存在或已被清理">
        <template #description>
          <span>执行记录不存在或已被清理</span>
          <br />
          <a-button style="margin-top: 8px;" @click="goBack">返回流水线</a-button>
        </template>
      </a-empty>

      <template v-if="instance">
        <!-- 元信息 -->
        <a-card size="small" style="margin-bottom: 12px;">
          <a-descriptions :column="4" size="small" bordered>
            <a-descriptions-item label="环境 / 模块">{{ instance.env }} / {{ instance.moduleKey }}</a-descriptions-item>
            <a-descriptions-item label="版本">{{ instance.versionTag || '—' }}</a-descriptions-item>
            <a-descriptions-item label="分支">{{ instance.gitBranch || '—' }}</a-descriptions-item>
            <a-descriptions-item label="commit">{{ instance.gitCommit || '—' }}</a-descriptions-item>
            <a-descriptions-item label="操作人">{{ instance.operator || '—' }}</a-descriptions-item>
            <a-descriptions-item label="开始">{{ formatTime(instance.startTime) }}</a-descriptions-item>
            <a-descriptions-item label="结束">{{ formatTime(instance.endTime) }}</a-descriptions-item>
            <a-descriptions-item label="耗时">{{ (durationMs(instance) / 1000).toFixed(1) }}s</a-descriptions-item>
          </a-descriptions>
          <div v-if="instance.error" style="margin-top: 10px;">
            <a-alert type="error" show-icon :message="instance.error" />
          </div>
          <a-alert
            v-if="healthSummary"
            :type="healthSummary.type"
            show-icon
            :message="healthSummary.text"
            style="margin-top: 10px;"
          />
        </a-card>

        <!-- 进度流程图 -->
        <a-card size="small" style="margin-bottom: 12px;" title="执行进度">
          <ProgressFlow
            :instance="instance"
            @stage-click="onStageClick"
            @command-click="onCommandClick"
          />
        </a-card>

        <!-- 操作 -->
        <div v-if="instance" style="margin-bottom: 12px;">
          <a-space>
            <a-button
              v-if="['running', 'pending'].includes(instance.status)"
              danger
              @click="handleCancel"
            >取消</a-button>
            <a-button v-if="instance.status === 'pending-approval'" danger @click="handleCancel">
              撤回审批
            </a-button>
            <template v-if="instance.status === 'pending-approval'">
              <a-button type="primary" @click="openReview('approve')">审批通过</a-button>
              <a-button danger @click="openReview('reject')">拒绝</a-button>
            </template>
            <a-button
              v-if="['failed', 'cancelled', 'succeeded'].includes(instance.status)"
              @click="handleRetry"
            >
              {{ instance.status === 'succeeded' ? '再次发布' : '重试' }}
            </a-button>
            <a-button
              v-if="instance.mode === 'grayscale' && instance.status === 'succeeded'"
              type="primary"
              @click="handlePromote"
            >灰度转全量</a-button>
          </a-space>
        </div>

        <!-- 日志 -->
        <a-card size="small" title="执行日志">
          <PipelineRunLogs :lines="instance.logs || []" :keyword="logKeyword" />
        </a-card>
      </template>
    </a-spin>

    <!-- 审批弹窗 -->
    <a-modal
      :open="reviewOpen"
      :title="reviewAction === 'approve' ? '审批通过' : '拒绝发布'"
      :confirm-loading="reviewing"
      @ok="submitReview"
      @cancel="reviewOpen = false"
    >
      <p v-if="instance" style="margin-bottom: 12px; color: #666;">
        {{ instance.env }} / {{ instance.moduleKey }}
        <template v-if="instance.versionTag">@ {{ instance.versionTag }}</template>
        · 提交人 {{ instance.operator || '-' }}
      </p>
      <a-textarea
        v-model:value="reviewComment"
        :rows="3"
        :placeholder="reviewAction === 'reject' ? '请填写拒绝原因（必填）' : '审批意见（可选）'"
      />
    </a-modal>

    <!-- 阶段命令抽屉 -->
    <StageCommandDrawer v-model:open="cmdOpen" :item="cmdItem" />
  </div>
</template>
