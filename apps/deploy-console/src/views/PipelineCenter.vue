<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()

// ===== 状态 / 时间展示 =====
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

// 模块类型标签（用于卡片头）
const TYPE_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'backend', label: '后端服务', color: 'blue' },
  { value: 'frontend', label: '前端模块', color: 'green' },
  { value: 'micro-frontend', label: '微前端', color: 'purple' },
  { value: 'mini-app', label: '小程序', color: 'orange' },
]
function typeLabel(type: string) {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label || type
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

// ===== 流水线（流程定义）列表 =====
const templates = ref<PipelineTemplate[]>([])
const summaryMap = ref<Record<string, { total: number; ok: number; latest: PipelineItem | null }>>({})
const loading = ref(false)
let timer: number | undefined

const TPL_STAGES = [
  { key: 'check', label: '校验（安全基线）', core: true },
  { key: 'pull', label: '拉取代码' },
  { key: 'build', label: '构建' },
  { key: 'upload', label: '投递' },
  { key: 'restart', label: '重启' },
  { key: 'version', label: '写版本（发布语义）', core: true },
  { key: 'pointer', label: '切指针（发布语义）', core: true },
  { key: 'verify', label: '探活验证' },
  { key: 'cleanup', label: '清理旧版本' },
]
const TPL_ALL_KEYS = TPL_STAGES.map((s) => s.key)

function approvalText(a: string) {
  const map: Record<string, string> = { inherit: '沿用环境规则', always: '始终审批', never: '免除审批' }
  return map[a] || a
}
function targetText(t: string) {
  const map: Record<string, string> = { auto: '自动', local: '本机', remote: '远程' }
  return map[t] || t
}
function stepSummary(t: PipelineTemplate) {
  const total = TPL_STAGES.length
  const active = t.steps && t.steps.length ? t.steps.length : total
  return `${active}/${total} 步${t.skipVerify ? ' · 跳过探活' : ''}${
    t.rollbackOnFailure === 'none' ? ' · 失败不回滚' : ''
  }`
}

async function loadSummary() {
  try {
    summaryMap.value = await pipelineApi.summary()
  } catch {
    /* 首页概览失败不阻塞 */
  }
}
async function loadTemplates() {
  loading.value = true
  try {
    const list = await pipelineTemplateApi.list()
    templates.value = list
  } catch {
    message.error('加载流水线失败')
  } finally {
    loading.value = false
  }
}
async function refreshAll() {
  await Promise.all([loadTemplates(), loadSummary()])
}
// 轻量轮询：有实例运行/待跑时刷新摘要
function tick() {
  stopPolling()
  timer = window.setInterval(async () => {
    await loadSummary()
    const running = Object.values(summaryMap.value).some(
      (s) => s.latest && ['running', 'pending', 'pending-approval'].includes(s.latest.status),
    )
    if (!running) stopPolling()
  }, 3000)
}
function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}
function hasRunning() {
  return Object.values(summaryMap.value).some(
    (s) => s.latest && ['running', 'pending', 'pending-approval'].includes(s.latest.status),
  )
}

function gotoDetail(t: PipelineTemplate) {
  router.push(`/pipelines/${t.id}`)
}

// ===== 新建 / 编辑弹窗 =====
const modal = ref({
  open: false,
  editing: null as PipelineTemplate | null,
  name: '',
  description: '',
  steps: TPL_ALL_KEYS as string[],
  rollbackOnFailure: 'previous' as string,
  approval: 'inherit' as string,
  defaultTarget: 'auto' as string,
})
const saving = ref(false)

function openCreate() {
  modal.value = {
    open: true,
    editing: null,
    name: '',
    description: '',
    steps: [...TPL_ALL_KEYS],
    rollbackOnFailure: 'previous',
    approval: 'inherit',
    defaultTarget: 'auto',
  }
}
function openEdit(t: PipelineTemplate) {
  modal.value = {
    open: true,
    editing: t,
    name: t.name,
    description: t.description || '',
    steps: t.steps && t.steps.length ? [...t.steps] : [...TPL_ALL_KEYS],
    rollbackOnFailure: t.rollbackOnFailure ?? 'previous',
    approval: t.approval,
    defaultTarget: t.defaultTarget,
  }
}
async function saveTemplate() {
  const m = modal.value
  if (!m.name.trim()) {
    message.warning('流水线名必填')
    return
  }
  saving.value = true
  try {
    const orderedSteps = TPL_STAGES.filter((s) => m.steps.includes(s.key)).map((s) => s.key)
    const dto = {
      name: m.name.trim(),
      description: m.description.trim() || undefined,
      steps: orderedSteps,
      rollbackOnFailure: m.rollbackOnFailure as PipelineTemplate['rollbackOnFailure'],
      approval: m.approval as PipelineTemplate['approval'],
      defaultTarget: m.defaultTarget as PipelineTemplate['defaultTarget'],
    }
    if (m.editing) {
      await pipelineTemplateApi.update(m.editing.id, dto)
      message.success('流水线已更新')
    } else {
      await pipelineTemplateApi.create(dto)
      message.success('流水线已创建')
    }
    modal.value.open = false
    await refreshAll()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
async function duplicate(t: PipelineTemplate) {
  try {
    await pipelineTemplateApi.duplicate(t.id)
    message.success(`已复制为「${t.name} 副本」`)
    await refreshAll()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '复制失败')
  }
}
async function toggle(t: PipelineTemplate) {
  try {
    await pipelineTemplateApi.update(t.id, { enabled: !t.enabled })
    await refreshAll()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '操作失败')
  }
}
function remove(t: PipelineTemplate) {
  Modal.confirm({
    title: '删除流水线',
    content: `删除「${t.name}」？已提交的执行记录（实例）不受影响，仍可在发布中心查看。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelineTemplateApi.remove(t.id)
        message.success('已删除')
        await refreshAll()
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

// ===== 发起发布（抽屉内提交：选模块 + 本流水线/任意流水线 + 分支/commit） =====
const submitOpen = ref(false)
const submitting = ref(false)
const env = ref('dev')
const environments = ref<{ id: string; name: string }[]>([])
interface ModuleItem {
  key: string
  name: string
  type: string
  defaultEnv?: string
}
const modules = ref<ModuleItem[]>([])
/** 可发布模块：后端 / 前端 / 微前端（mini-app 不在流水线能力范围） */
const availableModules = computed(() =>
  modules.value.filter((m) => ['micro-frontend', 'frontend', 'backend'].includes(m.type)),
)
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
  templateId: undefined as string | undefined,
})
const releases = ref<{ versionTag: string; note?: string }[]>([])
const availTemplates = ref<PipelineTemplate[]>([])

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
async function loadAvailTemplates() {
  try {
    availTemplates.value = await pipelineTemplateApi.list(form.value.moduleKey)
    if (!form.value.templateId && availTemplates.value.length) {
      form.value.templateId = availTemplates.value[0].id
    }
  } catch {
    availTemplates.value = []
  }
}
function openSubmit(initKey?: string) {
  form.value.moduleKey = initKey || availableModules.value[0]?.key || ''
  form.value.templateId = undefined
  form.value.branch = 'master'
  form.value.commitId = undefined
  form.value.mode = 'direct'
  submitOpen.value = true
  void loadModules().then(() => {
    if (!form.value.moduleKey && availableModules.value.length) {
      form.value.moduleKey = availableModules.value[0].key
    }
    return Promise.all([loadReleases(), loadAvailTemplates()])
  })
}
// ===== 按模块查看（一模块一卡） =====
interface ModuleCard {
  module: any
  templates: PipelineTemplate[]
  total: number
  ok: number
  latest: PipelineItem | null
}
const moduleCards = computed<ModuleCard[]>(() =>
  availableModules.value.map((m) => {
    const ts = templates.value.filter(
      (t: any) => !t.moduleKey || t.moduleKey === '*' || t.moduleKey === m.key,
    )
    let latest: PipelineItem | null = null
    let total = 0
    let ok = 0
    for (const t of ts) {
      const s = summaryMap.value[t.id]
      total += s?.total || 0
      ok += s?.ok || 0
      if (s?.latest && (!latest || s.latest.startTime > latest.startTime)) {
        latest = s.latest
      }
    }
    return { module: m, templates: ts, total, ok, latest }
  }),
)

const mpOpen = ref(false)
const mpModule = ref<ModuleCard | null>(null)
function openModulePipelines(m: ModuleCard) {
  mpModule.value = m
  mpOpen.value = true
}
function openReleaseForModule(m: ModuleCard) {
  openSubmit(m.module.key)
}
function gotoModuleDetail(m: any) {
  router.push(`/modules/${m.key}`)
}

async function onEnvChange() {
  await Promise.all([loadReleases(), loadAvailTemplates()])
}
async function onModuleChange() {
  const mod = modules.value.find((m) => m.key === form.value.moduleKey)
  if (mod?.defaultEnv && environments.value.some((e) => e.id === mod.defaultEnv)) {
    env.value = mod.defaultEnv
  }
  // 灰度仅对前端/微前端（gateway resolveCanary 作用于页面静态资源）；后端服务只支持全量
  if (mod && mod.type === 'backend') form.value.mode = 'direct'
  await Promise.all([loadReleases(), loadAvailTemplates()])
}

/** 当前所选模块是否支持灰度（后端服务不支持） */
const canGrayscale = computed(() => {
  const m = modules.value.find((x) => x.key === form.value.moduleKey)
  return !!m && m.type !== 'backend'
})
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
        grayscaleRule: rule,
        templateId: form.value.templateId || undefined,
        confirm,
      })
      if ((res as any).status === 'pending-approval') {
        message.info(`已提交审批（${res.jobId}），审批通过后将自动发布`)
      } else {
        message.success(`已提交: ${res.jobId}`)
      }
      submitOpen.value = false
      await refreshAll()
      tick()
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '提交流水线失败')
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
  if (!form.value.templateId) {
    message.warning('请选择要使用的流水线')
    return
  }
  const isProd = env.value === 'prod'
  const desc = `按「${
    availTemplates.value.find((t) => t.id === form.value.templateId)?.name || '流水线'
  }」发布 ${form.value.moduleKey} 到 ${env.value}（分支 ${form.value.branch}${
    form.value.commitId ? ` @ ${form.value.commitId}` : ' 最新'
  }）`
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

// ===== 全部执行记录（全局浏览，含早期未关联模板快照的实例） =====
const plOpen = ref(false)
const plEnv = ref('')
const plList = ref<PipelineItem[]>([])
const plLoading = ref(false)
const logVisible = ref(false)
const logRecord = ref<PipelineItem | null>(null)
const STEP_COLORS: Record<string, string> = {
  done: 'success',
  running: 'processing',
  error: 'error',
  pending: 'default',
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
async function loadPl() {
  plLoading.value = true
  try {
    plList.value = await pipelineApi.list(plEnv.value ? { env: plEnv.value, limit: 50 } : { limit: 50 })
  } catch {
    message.error('加载执行记录失败')
  } finally {
    plLoading.value = false
  }
}
function openRecords() {
  plEnv.value = environments.value[0]?.id || ''
  plOpen.value = true
  void loadPl()
}
function showLogs(p: PipelineItem) {
  logRecord.value = p
  logVisible.value = true
}

// ===== 阶段命令查看（点击步骤标签打开） =====
// 复用 ModuleDetail 的脚本视图，按需加载某个 module 的 stage 命令集合；
// 模块有 9 阶段，按 stage→item 索引，取点击的那条直接展示。
//
// 注意：这里展示的是模块**当前**已配置的命令，而非执行实例快照。
// 执行时使用的命令可从流水线日志 / dist/index.js 的 ts 推断；
// 当前命令 = 运维维护的最新真相，给运维调试和核对变更更直接。
// 若未来需要「执行快照」，建议在 deploy_pipeline_execution_commands
// （deploy_pipelines 下挂 JSON / 关联表）落库；先做到当前可读，演进可控。
const scriptViewMap = ref<Record<string, { source: string; command: string | null; builtin: string; title: string }[]>>({})
const cmdModalOpen = ref(false)
const cmdModalStage = ref<string>('')
const cmdModalItem = ref<any>(null)

async function ensureScriptView(moduleKey: string) {
  if (!moduleKey || scriptViewMap.value[moduleKey]) return
  try {
    scriptViewMap.value[moduleKey] = (await stageCommandApi.scriptView(moduleKey)) as any
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
function plRetry(p: PipelineItem) {
  const isSucceeded = p.status === 'succeeded'
  Modal.confirm({
    title: isSucceeded ? '再次发布' : '重试发布',
    content: isSucceeded
      ? `以相同参数再次发布（${p.env} / ${p.moduleKey}，分支 ${p.gitBranch || '-'}）？`
      : `以相同参数重新提交（${p.env} / ${p.moduleKey}）？原实例记录保留。`,
    okText: isSucceeded ? '再次发布' : '重试',
    cancelText: '取消',
    onOk: async () => {
      try {
        const res = await pipelineApi.retry(p.id)
        message.success(`已重新提交: ${res.jobId}`)
        await Promise.all([loadPl(), refreshAll()])
        tick()
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '重试失败')
      }
    },
  })
}
function plCancel(p: PipelineItem) {
  Modal.confirm({
    title: p.status === 'pending-approval' ? '撤回审批请求' : '确认取消',
    content: `确定取消实例 ${p.id} 吗？`,
    okText: '确认',
    okType: 'danger',
    cancelText: '返回',
    onOk: async () => {
      try {
        await pipelineApi.cancel(p.id)
        message.success('已请求取消')
        await Promise.all([loadPl(), refreshAll()])
      } catch {
        message.error('取消失败')
      }
    },
  })
}
function plPromote(p: PipelineItem) {
  Modal.confirm({
    title: '灰度转全量',
    content: `将把 ${p.env} / ${p.moduleKey} 的全量指针切到 ${p.versionTag}，并禁用灰度规则。确认？`,
    okText: '转全量',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelineApi.promote(p.id)
        message.success('已转全量')
        await Promise.all([loadPl(), refreshAll()])
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
    await Promise.all([loadPl(), refreshAll()])
  } catch (e: any) {
    message.error(e?.response?.data?.message || e?.message || '操作失败')
  } finally {
    reviewing.value = false
  }
}

onMounted(async () => {
  // 模块列表是卡片区数据源（moduleCards 按模块一卡）——缺失时页面恒为空态「暂无可发布模块」
  await Promise.all([refreshAll(), loadEnvironments(), loadModules()])
  if (hasRunning()) tick()
})
onUnmounted(stopPolling)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>发布流水线</h2>
      <p>流水线 = 可复用的流程定义（校验 → 拉码 → 构建 → 投递 → 重启 → 写版本 → 切指针 → 探活 → 清理）。
        每次发布 = 基于某条流水线执行一次，产生一条执行记录（实例）。点击流水线可查看其最近执行与全部历史。</p>
    </div>

    <!-- 工具栏 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div>
        <a-button :loading="loading" @click="refreshAll">刷新</a-button>
      </div>
      <a-space>
        <a-button @click="openRecords">执行记录</a-button>
        <a-button type="primary" @click="openSubmit" :disabled="!availableModules.length">发起发布</a-button>
      </a-space>
    </div>

    <!-- 流水线卡片列表（按模块一卡） -->
    <a-spin :spinning="loading">
      <a-row :gutter="[16, 16]" v-if="moduleCards.length">
        <a-col
          v-for="mc in moduleCards"
          :key="mc.module.key"
          :xs="24"
          :sm="12"
          :lg="8"
          :xl="6"
        >
          <a-card
            hoverable
            size="small"
            class="tpl-card"
            @click="gotoModuleDetail(mc.module)"
          >
            <!-- 头部：模块名 -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div style="min-width: 0;">
                <div style="font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  {{ mc.module.name }}
                </div>
                <div style="margin-top: 4px;">
                  <a-tag color="blue" style="font-size: 11px;">{{ typeLabel(mc.module.type) }}</a-tag>
                  <a-tag v-if="mc.module.builtin" color="gold" style="font-size: 11px;">内置</a-tag>
                </div>
              </div>
              <span
                style="color: #999; font-size: 12px; flex-shrink: 0; font-family: monospace;"
              >{{ mc.module.key }}</span>
            </div>

            <!-- 最近执行摘要（按模块聚合） -->
            <div
              v-if="mc.latest"
              style="background: #fafafa; border: 1px solid #f0f0f0; border-radius: 6px; padding: 8px 10px; margin-top: 8px;"
            >
              <div style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
                <a-tag :color="statusColor(mc.latest.status)" style="margin-right: 0;">
                  {{ statusText(mc.latest.status) }}
                </a-tag>
                <span style="color: #555;">{{ mc.latest.env }}</span>
                <span v-if="mc.latest.templateName" style="color: #888;">
                  · {{ mc.latest.templateName }}
                </span>
              </div>
              <div style="font-size: 12px; color: #888; margin-top: 4px; display: flex; justify-content: space-between;">
                <span>
                  v{{ mc.latest.versionTag || '—' }}
                  <template v-if="mc.latest.stage">
                    · {{ STEP_LABELS[mc.latest.stage] || mc.latest.stage }}
                  </template>
                </span>
                <span>{{ formatTime(mc.latest.startTime) }}</span>
              </div>
            </div>
            <div
              v-else
              style="color: #bbb; font-size: 12px; padding: 8px 0;"
            >该模块暂无发布记录</div>

            <!-- 底部统计 + 操作 -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
              <span style="font-size: 12px; color: #999;">
                共 {{ mc.total }} 次 · 成功 {{ mc.ok }}
              </span>
              <a-space size="small" @click.stop>
                <a-button type="link" size="small" @click="gotoModuleDetail(mc.module)">模块详情</a-button>
                <a-button type="link" size="small" @click="openReleaseForModule(mc)">发布</a-button>
              </a-space>
            </div>
          </a-card>
        </a-col>
      </a-row>
      <a-empty v-else-if="!loading" description="暂无可发布模块" />
    </a-spin>

    <!-- 发起发布抽屉 -->
    <a-drawer
      :open="submitOpen"
      title="发起发布"
      placement="right"
      :width="720"
      @close="submitOpen = false"
    >
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="环境" required>
              <a-select v-model:value="env" @change="onEnvChange">
                <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
                  {{ e.name }}（{{ e.id }}）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="模块（后端/前端/微前端均可走流水线发布）" required>
              <a-select
                v-model:value="form.moduleKey"
                placeholder="选择模块"
                @change="onModuleChange"
              >
                <a-select-option v-for="m in availableModules" :key="m.key" :value="m.key">
                  {{ m.name }}（{{ m.key }}）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item label="使用流水线" required>
          <a-select v-model:value="form.templateId" placeholder="选择流水线">
            <a-select-option v-for="t in availTemplates" :key="t.id" :value="t.id">
              {{ t.name }}
              <template v-if="t.builtin">（默认）</template>
              <template v-if="t.approval === 'always'">（强制审批）</template>
              <template v-if="t.approval === 'never'">（免审批）</template>
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="分支">
              <a-input v-model:value="form.branch" placeholder="master" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="Commit（留空=分支最新提交）">
              <a-select
                v-model:value="form.commitId"
                allow-clear
                placeholder="留空=最新"
              >
                <a-select-option v-for="r in releases" :key="r.versionTag" :value="r.versionTag">
                  {{ r.versionTag }}{{ r.note ? ` · ${r.note}` : '' }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item v-if="canGrayscale" label="模式">
          <a-radio-group v-model:value="form.mode">
            <a-radio value="direct">全量</a-radio>
            <a-radio value="grayscale">灰度</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="form.mode === 'grayscale'" label="灰度规则">
          <a-space wrap>
            <a-select v-model:value="form.grayscaleType" style="width: 130px;">
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
            />
            <a-input
              v-if="form.grayscaleType === 'user-list'"
              v-model:value="form.userIds"
              placeholder="用户 ID，逗号分隔"
              style="width: 260px;"
            />
            <template v-if="form.grayscaleType === 'header'">
              <a-input v-model:value="form.headerKey" placeholder="请求头名" style="width: 140px;" />
              <a-input v-model:value="form.headerValues" placeholder="取值，逗号分隔" style="width: 140px;" />
            </template>
          </a-space>
        </a-form-item>

        <a-alert
          type="info"
          show-icon
          style="margin-bottom: 12px;"
          message="产物投递由系统自动决定：测试环境(local/dev)=本机，正式发布按配置投递到生产服务器。发布基于远程仓库分支 + commit（隔离发布目录 git 拉取），请先 commit & push 再发布"
        />
        <a-button
          type="primary"
          :loading="submitting"
          :danger="env === 'prod'"
          block
          @click="handleSubmit"
        >
          提交{{ env === 'prod' ? '（生产，需审批）' : '发布' }}
        </a-button>
      </a-form>
    </a-drawer>

    <!-- 全部执行记录抽屉（全局浏览；流水线归属见模板详情页历史） -->
    <a-drawer
      :open="plOpen"
      title="执行记录"
      placement="right"
      :width="920"
      @close="plOpen = false"
    >
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <a-space>
          <span>环境</span>
          <a-select
            v-model:value="plEnv"
            allow-clear
            placeholder="全部"
            style="width: 160px;"
            @change="loadPl"
          >
            <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
              {{ e.name }}（{{ e.id }}）
            </a-select-option>
          </a-select>
        </a-space>
        <a-button :loading="plLoading" @click="loadPl">刷新</a-button>
      </div>
      <a-table
        :columns="[
          { title: '实例', dataIndex: 'id', key: 'id', width: 140 },
          { title: '环境/模块', key: 'who', width: 170 },
          { title: '模板', dataIndex: 'templateName', key: 'templateName', width: 110 },
          { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 110 },
          { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
          { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
          { title: '开始时间', dataIndex: 'startTime', key: 'startTime', width: 150 },
          { title: '操作', key: 'action', width: 210 },
        ]"
        :data-source="plList"
        :loading="plLoading"
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
            <a-tag :color="record.mode === 'grayscale' ? 'orange' : 'blue'" style="margin-right: 0;">
              {{ record.mode === 'grayscale' ? '灰度' : '全量' }}
            </a-tag>
            {{ record.env }} / {{ record.moduleKey }}
          </template>
          <template v-else-if="column.key === 'templateName'">
            {{ record.templateName || '—' }}
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">{{ statusText(record.status) }}</a-tag>
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
                @click="plRetry(record)"
              >
                {{ record.status === 'succeeded' ? '再次发布' : '重试' }}
              </a-button>
              <template v-if="record.status === 'pending-approval'">
                <a-button type="link" size="small" @click="openApprove(record)">通过</a-button>
                <a-button type="link" size="small" danger @click="openReject(record)">拒绝</a-button>
              </template>
              <a-button
                v-if="record.status === 'running' || record.status === 'pending'"
                type="link"
                size="small"
                danger
                @click="plCancel(record)"
              >
                取消
              </a-button>
              <a-button
                v-if="record.mode === 'grayscale' && record.status === 'succeeded'"
                type="link"
                size="small"
                @click="plPromote(record)"
              >
                转全量
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-drawer>

    <!-- 实例日志抽屉 -->
    <a-drawer v-model:open="logVisible" title="执行详情" placement="right" :width="720">
      <template v-if="logRecord">
        <a-descriptions :column="2" size="small" bordered style="margin-bottom: 12px;">
          <a-descriptions-item label="实例">{{ logRecord.id }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(logRecord.status)">{{ statusText(logRecord.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="环境/模块">{{ logRecord.env }} / {{ logRecord.moduleKey }}</a-descriptions-item>
          <a-descriptions-item label="模板">{{ logRecord.templateName || '—' }}</a-descriptions-item>
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
          <a-alert
            v-if="logRecord.error"
            type="error"
            show-icon
            :message="logRecord.error"
            style="margin-top: 8px;"
          />
        </div>
        <div
          style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                 font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 60vh; overflow: auto;"
        >{{ (logRecord.logs || []).join('\n') || '（无日志）' }}</div>
      </template>
    </a-drawer>

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
  </div>

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
</template>

<style scoped>
.tpl-card {
  height: 100%;
}
.tpl-card :deep(.ant-card-body) {
  display: flex;
  flex-direction: column;
}
</style>
