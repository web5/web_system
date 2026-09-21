<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineRunsApi,
  environmentApi,
  deployApi,
  pipelinesApi,
  stageCommandApi,
  type PipelineItem,
  type PipelineTemplate,
} from '@/api'
import dayjs from 'dayjs'
import BranchSelect from '@/components/BranchSelect.vue'
// 流水线的编辑 / 新建走独立页面（PipelineEdit），列表页不再有新建/编辑弹窗，
// 因此这里不再需要 UserSelect（人员选择器已挪到编辑页的「基本信息」里）。
import {
  statusColor as stageStatusColor,
  statusText as stageStatusText,
  stepState as stageStepState,
  APPROVAL_STATUSES,
  isApprovalPending,
  toMs,
} from '@/components/pipeline/pipeline.stages'

const router = useRouter()
const route = useRoute()

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

// 状态展示与审批判定统一走 components/pipeline/pipeline.stages（单一真相源）
function statusColor(status: string) {
  return stageStatusColor(status)
}
function statusText(status: string) {
  return stageStatusText(status)
}
// bigint 时间戳到前端是字符串，必须先 Number 归一（否则 dayjs 误解析成 1797 年，规格 §10.1）
function formatTime(ts?: number | string) {
  const n = toMs(ts)
  return n ? dayjs(n).format('MM-DD HH:mm:ss') : '—'
}
function durationMs(p: PipelineItem) {
  const start = toMs(p.startTime)
  const end = toMs(p.endTime)
  return end ? end - start : Date.now() - start
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
/** 节点序列预览（v5 nodes 优先；legacy 回退九阶段名） */
function nodeSeqText(t: PipelineTemplate) {
  const nodes: any[] = (t as any).nodes || []
  if (nodes.length) return nodes.map((n: any) => n.label || n.key).join(' → ')
  const steps: string[] = (t as any).steps || []
  if (steps.length) return steps.map((s) => STEP_LABELS[s] || s).join(' → ')
  return TPL_ALL_KEYS.map((s) => STEP_LABELS[s] || s).join(' → ')
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
    summaryMap.value = await pipelineRunsApi.summary()
  } catch {
    /* 首页概览失败不阻塞 */
  }
}
async function loadTemplates() {
  loading.value = true
  try {
    const list = await pipelinesApi.list()
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
/** 仍在运行 / 等待审批的实例（挂起态也要继续轮询，审批可能在别处发生） */
function hasLiveLatest(): boolean {
  return Object.values(summaryMap.value).some(
    (s) => s.latest && ['running', 'pending', ...APPROVAL_STATUSES].includes(s.latest.status),
  )
}
function tick() {
  stopPolling()
  timer = window.setInterval(async () => {
    await loadSummary()
    if (!hasLiveLatest()) stopPolling()
  }, 3000)
}
function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}
function hasRunning() {
  return hasLiveLatest()
}

function gotoDetail(t: PipelineTemplate) {
  router.push(`/pipelines/${t.id}`)
}

// ===== 新建 / 编辑：进独立编辑页（用户 2026-09-15：列表页不再弹窗）=====
/**
 * 新建流水线：先选「前端 / 后台」—— 按类型载入初始四节点，
 * 构建命令按类型预填（用户 2026-09-15 原型定稿）。
 */
const newTypeOpen = ref(false)
function openCreate() {
  newTypeOpen.value = true
}
function confirmCreate(type: 'fe' | 'be') {
  newTypeOpen.value = false
  router.push({ name: 'PipelineEditCreate', query: { moduleType: type } })
}
function openEdit(t: PipelineTemplate) {
  router.push({ name: 'PipelineEdit', params: { id: t.id } })
}

/** 「可审批人」加载器已随编辑弹窗挪到 PipelineEdit（提交抽屉里不需要选人） */
async function duplicate(t: PipelineTemplate) {
  try {
    await pipelinesApi.duplicate(t.id)
    message.success(`已复制为「${t.name} 副本」`)
    await refreshAll()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '复制失败')
  }
}
async function toggle(t: PipelineTemplate) {
  try {
    await pipelinesApi.update(t.id, { enabled: !t.enabled })
    await refreshAll()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '操作失败')
  }
}
function remove(t: PipelineTemplate) {
  Modal.confirm({
    title: '删除流水线',
    content: `删除「${t.name}」？已提交的执行记录（实例）不受影响，仍可在本页「全部执行记录」中查看。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelinesApi.remove(t.id)
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
/** 可发布版本候选：versionTag=完整引用（展示用），commit=纯短哈希（提交用） */
const releases = ref<{ versionTag: string; commit?: string; note?: string }[]>([])
/** 分支最近提交（git log origin/<branch>）：提交抽屉的 Commit 候选——历史版本下拉里看不到刚 push 的提交（用户 2026-09-21 反馈） */
const branchCommits = ref<{ hash: string; short: string; subject: string; author: string; date: string }[]>([])
const loadingCommits = ref(false)
const availTemplates = ref<PipelineTemplate[]>([])

/**
 * 分支提交内存缓存（切回已看过的分支秒显；后端另有 SWR 缓存，这里省掉一次往返）。
 * key = 分支名。
 */
const commitCache = new Map<string, typeof branchCommits.value>()
/** 请求序号：分支快速连点时，只有最后一次的响应能落到界面（防旧响应覆盖新分支的列表） */
let commitSeq = 0

/**
 * 加载「分支最近提交」。
 *
 * 2026-09-21 优化（切换分支级联卡顿）：后端改为「秒回本地引用 + 后台 fetch」（见
 * `PipelineService.listBranchCommits`），前端这里配合三件事 ——
 * ① 竞态保护：连点分支时旧响应不覆盖新列表；② 分支级内存缓存：切回秒显；
 * ③ 首次（无缓存）拿到本地引用后 1.5s 补取一次，把后台 fetch 到的最新提交自动补上。
 */
async function loadBranchCommits() {
  const branch = (form.value.branch || 'master').trim()
  if (!branch || !form.value.moduleKey) { branchCommits.value = []; return }
  const seq = ++commitSeq
  const cached = commitCache.get(branch)
  // 命中缓存先渲染（不闪 loading），随后仍静默刷新
  branchCommits.value = cached ?? []
  loadingCommits.value = !cached
  try {
    const rows = await pipelineRunsApi.branchCommits(branch, 20)
    if (seq !== commitSeq) return // 已被更晚的分支请求取代
    branchCommits.value = rows
    commitCache.set(branch, rows)
    if (!cached) {
      // 首次返回的是本地引用：补取一次（此时后台 fetch 已完成）让「刚 push 的提交」自动出现
      setTimeout(() => { if (seq === commitSeq) void loadBranchCommits() }, 1500)
    }
  } catch {
    if (seq === commitSeq && !cached) branchCommits.value = []
  } finally {
    if (seq === commitSeq) loadingCommits.value = false
  }
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
  } catch {
    message.error('加载模块列表失败')
  }
}
async function loadReleases() {
  try {
    releases.value = await pipelineRunsApi.releases(env.value, form.value.moduleKey)
  } catch {
    releases.value = []
  }
}
async function loadAvailTemplates() {
  try {
    const all = (await pipelinesApi.list(form.value.moduleKey)) || []
    // 双域重构后环境是**动态创建**的（envId 自增：1/2/3…），给每个新环境都建一条流水线不可维护。
    // 因此模板只按**模块**绑定，环境是运行期参数：本环境绑定的模板优先排序，其余作为候选。
    const score = (t: any) => (t.env === env.value ? 0 : !t.env ? 1 : 2)
    availTemplates.value = [...all].sort((a: any, b: any) => score(a) - score(b))
    // 当前选中的模板已不在候选里（切换环境/模块后）→ 重新选：行内锁定的优先，否则取排序第一条
    const stillValid = availTemplates.value.some((t) => t.id === form.value.templateId)
    if (!stillValid) {
      const lockId = lockTemplateId.value
      lockTemplateId.value = ''
      form.value.templateId = lockId || availTemplates.value[0]?.id || undefined
    }
  } catch (e: any) {
    availTemplates.value = []
    message.error(e?.response?.data?.message || '加载流水线列表失败')
  }
}
function openSubmit(initKey?: string, fixedTplId?: string, tplEnv?: string) {
  form.value.moduleKey = initKey || availableModules.value[0]?.key || ''
  fixedTemplateId.value = fixedTplId || ''
  // 模板绑定的环境 = 抽屉打开时的**默认环境**（可改）；只有它未变时才锁定模板
  lockedTplEnv.value = tplEnv || ''
  fixedEnv.value = tplEnv || ''
  fixedModuleKey.value = fixedTplId ? (initKey || '') : ''
  if (fixedEnv.value) env.value = fixedEnv.value
  form.value.templateId = fixedTplId || undefined
  form.value.branch = 'master'
  form.value.commitId = undefined
  form.value.mode = 'direct'
  submitOpen.value = true
  void loadModules().then(() => {
    if (!form.value.moduleKey && availableModules.value.length) {
      form.value.moduleKey = availableModules.value[0].key
    }
    return Promise.all([loadReleases(), loadAvailTemplates(), loadBranchCommits()])
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
      if (s?.latest && (!latest || toMs(s.latest.startTime) > toMs(latest.startTime))) {
        latest = s.latest
      }
    }
    return { module: m, templates: ts, total, ok, latest }
  }),
)

// ===== 摊平「模块×流水线」流水线记录 + 四维筛选 =====
interface PipelineRow {
  tpl: PipelineTemplate
  module: any
  total: number
  ok: number
  latest: PipelineItem | null
}
const pipelineRows = computed<PipelineRow[]>(() => {
  const rows: PipelineRow[] = []
  for (const m of availableModules.value) {
    const ts = templates.value.filter(
      (t: any) => !t.moduleKey || t.moduleKey === '*' || t.moduleKey === m.key,
    )
    for (const t of ts) {
      const s = summaryMap.value[t.id]
      rows.push({
        tpl: t,
        module: m,
        total: s?.total || 0,
        ok: s?.ok || 0,
        latest: s?.latest || null,
      })
    }
  }
  return rows
})

// 筛选状态（点「查询」才生效；「重置」清空）
const fKeyword = ref('')
const fModule = ref('')
const fEnv = ref('all')
const fType = ref('all')
const fStatus = ref('all')
const appliedFilters = ref({ keyword: '', module: '', env: 'all', type: 'all', status: 'all' })
function doSearch() {
  appliedFilters.value = {
    keyword: fKeyword.value.trim().toLowerCase(),
    module: fModule.value,
    env: fEnv.value,
    type: fType.value,
    status: fStatus.value,
  }
}
function resetFilters() {
  fKeyword.value = ''
  fModule.value = ''
  fEnv.value = 'all'
  fType.value = 'all'
  fStatus.value = 'all'
  doSearch()
}
/** 环境筛选：来自真实环境列表（含自建环境 1/2/3…），不再硬编码 local/dev/prod */
const ENV_FILTERS = computed(() => [
  { value: 'all', label: '全部环境' },
  ...environments.value.map((e) => ({ value: e.id, label: e.id })),
])
const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'running', label: '运行中' },
  { value: 'none', label: '从未执行' },
]
const filteredRows = computed<PipelineRow[]>(() => {
  const f = appliedFilters.value
  const rows = pipelineRows.value.filter((r) => {
    if (f.keyword) {
      // 环境也进关键词（搜 "prod" 直接命中最近发过生产的那几条）
      const hay =
        `${r.module.name} ${r.tpl.name || ''} ${r.tpl.moduleKey || ''} ${r.module.key} ${r.latest?.env || ''}`.toLowerCase()
      if (!hay.includes(f.keyword)) return false
    }
    // 流水线已**不绑定环境**（环境是提交时的运行期参数）：按「最近一次执行所在环境」过滤
    if (f.env !== 'all' && (r.latest?.env || '') !== f.env) return false
    if (f.module && r.module.key !== f.module) return false
    if (f.type === 'builtin' && !r.tpl.builtin) return false
    if (f.type === 'custom' && r.tpl.builtin) return false
    // 状态筛选用「全部」= 不过滤；'none' = 从未执行（latest 为空）；其余精确匹配
    if (f.status && f.status !== 'all') {
      const st = r.latest?.status || null
      if (f.status === 'none') {
        if (st !== null) return false
      } else if (st !== f.status) {
        return false
      }
    }
    return true
  })
  // 默认排序（规格 §10）：最近执行时间倒序（最新在上），从未执行（无实例）的统一置尾；
  // 时间相同或均无实例时保持「模块 × 流水线」原序 —— Array#sort 稳定，刷新不跳行。
  rows.sort((a, b) => toMs(b.latest?.startTime) - toMs(a.latest?.startTime))
  return rows
})
/** 流水线展示名：默认 = 模块名；流水线名非空且与模块名不同时追加「 · 流水线名」 */
function rowName(r: PipelineRow): string {
  const t = (r.tpl.name || '').trim()
  if (t && !r.module.name.includes(t) && t !== '默认') return `${r.module.name} · ${t}`
  return r.module.name
}

// 行内「执行」：打开发起抽屉并预选该流水线 —— 模块与流水线锁定，
// **环境只是默认值，可改**（双域重构后环境是运行期参数：envId 动态创建，不再为每个环境建流水线）
const lockTemplateId = ref('')
const fixedTemplateId = ref('')
const fixedEnv = ref('')
/** 被锁定模板所属的环境：环境被改动后解除模板锁定，允许另选模板 */
const lockedTplEnv = ref('')
const fixedModuleKey = ref('')
/** 模板是否仍保持锁定：来自行内执行、且用户没有改环境（无 env 的模板视为环境无关） */
const templateLocked = computed(
  () => !!fixedTemplateId.value && (!lockedTplEnv.value || lockedTplEnv.value === env.value),
)
function executeTpl(r: PipelineRow) {
  lockTemplateId.value = r.tpl.id
  openSubmit(r.module.key, r.tpl.id, r.tpl.env || '')
}
function gotoPipelineDetail(r: PipelineRow) {
  router.push(`/pipelines/${r.tpl.id}`)
}

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
  // 双域重构后：按类型跳到对应域的详情（后端服务 → 服务详情；应用 → 应用详情）
  router.push(m?.type === 'backend' ? `/services/${m.key}` : `/apps/${m.key}`)
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
  await Promise.all([loadReleases(), loadAvailTemplates(), loadBranchCommits()])
}

/** Commit 候选过滤：分支提交匹配短哈希/说明/作者，历史版本匹配 versionTag（show-search 输入短哈希直达） */
function filterCommitOption(input: string, option: any) {
  const text = `${option.value ?? ''} ${option.title ?? ''}`.toLowerCase()
  return text.includes(input.trim().toLowerCase())
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
      const res = await pipelineRunsApi.submit({
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

// ===== 全部执行记录（全局浏览，含早期未关联流水线快照的实例） =====
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
  // 与详情页同一套判定（含节点级挂起：已执行节点显示 done，停在待审批节点）
  return stageStepState(p, s)
}
async function loadPl() {
  plLoading.value = true
  try {
    plList.value = await pipelineRunsApi.list(plEnv.value ? { env: plEnv.value, limit: 50 } : { limit: 50 })
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
        const res = await pipelineRunsApi.retry(p.id)
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
    title: p.status === 'awaiting-approval' ? '终止挂起中的发布' : isApprovalPending(p.status) ? '撤回审批请求' : '确认取消',
    content:
      p.status === 'awaiting-approval'
        ? `终止 ${p.id} 吗？它已执行到「${p.stage || '-'}」节点并在等待审批，终止后已执行的动作不会回滚，需重新提交发布。`
        : `确定取消实例 ${p.id} 吗？`,
    okText: '确认',
    okType: 'danger',
    cancelText: '返回',
    onOk: async () => {
      try {
        await pipelineRunsApi.cancel(p.id)
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
        await pipelineRunsApi.promote(p.id)
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
      await pipelineRunsApi.approve(review.value.p.id, reviewComment.value.trim() || undefined)
      message.success('已审批通过，发布开始执行')
    } else {
      await pipelineRunsApi.reject(review.value.p.id, reviewComment.value.trim())
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

  // 域详情页「部署」跳转过来：带 module + env（+ submit=1）直接打开发起抽屉
  // （应用详情 / 服务详情是用户发起部署的自然入口，环境在此选定）
  const q = route.query
  const qModule = typeof q.module === 'string' ? q.module : undefined
  const qEnv = typeof q.env === 'string' ? q.env : undefined
  if (qModule || qEnv) {
    if (qEnv && environments.value.some((e) => e.id === qEnv)) env.value = qEnv
    openSubmit(qModule)
  }
})
onUnmounted(stopPolling)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>发布流水线</h2>
      <p>
        流水线 = 可复用的<b>流程定义</b>：节点可编排（如 拉取代码 → 构建 → 发布确认 → 发布），
        节点内可挂 shell 脚本或平台工具（写版本 / 重启 / 探活…）。<br />
        流水线<b>不绑定环境</b> —— 环境在发起发布时选择（含自建环境）；每次发布 = 执行一次并产生一条执行记录
        （提交即快照当时的节点与命令）。点击流水线可查看节点编排与全部历史。
      </p>
    </div>

    <!-- 筛选表单（五维度：关键词 / 模块 / 环境 / 类型 / 状态）+ 新建流水线 -->
    <a-card size="small" style="margin-bottom: 12px;">
      <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
        <a-input
          v-model:value="fKeyword"
          allow-clear
          placeholder="搜索流水线名 / 模块名 / key"
          style="width: 220px;"
          @press-enter="doSearch"
        />
        <a-select
          v-model:value="fModule"
          placeholder="全部模块"
          allow-clear
          style="width: 170px;"
        >
          <a-select-option v-for="m in availableModules" :key="m.key" :value="m.key">
            {{ m.name }}（{{ m.key }}）
          </a-select-option>
        </a-select>
        <a-select v-model:value="fEnv" style="width: 120px;">
          <a-select-option v-for="o in ENV_FILTERS" :key="o.value" :value="o.value">
            {{ o.label }}
          </a-select-option>
        </a-select>
        <a-select v-model:value="fType" style="width: 120px;">
          <a-select-option value="all">全部类型</a-select-option>
          <a-select-option value="builtin">内置</a-select-option>
          <a-select-option value="custom">自定义</a-select-option>
        </a-select>
        <a-select v-model:value="fStatus" style="width: 140px;">
          <a-select-option v-for="o in STATUS_FILTERS" :key="o.value" :value="o.value">
            {{ o.label }}
          </a-select-option>
        </a-select>
        <a-button type="primary" @click="doSearch">查询</a-button>
        <a-button @click="resetFilters">重置</a-button>
        <div style="flex: 1;" />
        <a-button :loading="loading" @click="refreshAll">刷新</a-button>
        <a-button type="primary" @click="openCreate">+ 新建流水线</a-button>
      </div>
    </a-card>

    <!-- 流水线记录表格（摊平「模块 × 流水线」） -->
    <a-card size="small" :loading="loading">
      <a-table
        :columns="[
          { title: '流水线名称', key: 'name', width: 250 },
          { title: '类型', key: 'type', width: 90 },
          { title: '模块', key: 'module', width: 130 },
          { title: '环境', key: 'env', width: 90 },
          { title: '节点序列', key: 'nodes' },
          { title: '最近执行', key: 'recent' },
          { title: '成功率', key: 'stat', width: 110 },
          { title: '操作', key: 'action', width: 180 },
        ]"
        :data-source="filteredRows"
        :pagination="{ pageSize: 15, showTotal: (t: number) => `共 ${t} 条` }"
        :row-key="(r: any) => `${r.module.key}:${r.tpl.id}`"
        size="small"
        :locale="{ emptyText: '没有匹配的流水线' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <a-tooltip :title="record.tpl.description || ''">
              <span style="font-weight: 500; cursor: pointer; color: #1677ff;" @click="gotoPipelineDetail(record)">
                {{ rowName(record) }}
              </span>
            </a-tooltip>
            <div style="font-size: 12px; color: #999;">
              <template v-if="!record.tpl.enabled"><a-tag color="default" style="font-size: 11px;">已停用</a-tag> </template>
              <template v-if="record.tpl.skipVerify"><a-tag color="cyan" style="font-size: 11px;">跳过探活</a-tag> </template>
              <template v-if="record.tpl.approval === 'always'"><a-tag color="orange" style="font-size: 11px;">始终审批</a-tag> </template>
            </div>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="record.tpl.builtin ? 'blue' : 'orange'">
              {{ record.tpl.builtin ? '内置' : '自定义' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'module'">
            <span style="font-family: monospace; font-size: 12px; color: #555;">{{ record.module.key }}</span>
            <div style="font-size: 12px; color: #bbb;">{{ typeLabel(record.module.type) }}</div>
          </template>
          <template v-else-if="column.key === 'env'">
            <!-- 流水线不绑定环境：环境在提交时选（近期执行过一次则回显该环境，便于对账） -->
            <a-tooltip :title="'流水线不绑定环境，提交时选择（含自建环境）'">
              <a-tag v-if="record.latest?.env" color="blue">{{ record.latest.env }}</a-tag>
              <span v-else style="color: #bbb; font-size: 12px;">运行时选</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'nodes'">
            <span style="color: #666; font-size: 12px;">{{ nodeSeqText(record.tpl) }}</span>
          </template>
          <template v-else-if="column.key === 'recent'">
            <template v-if="record.latest">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <a-tag :color="statusColor(record.latest.status)" style="margin-right: 0;">
                  {{ statusText(record.latest.status) }}
                </a-tag>
                <span style="color: #666; font-size: 12px;">{{ record.latest.env }}</span>
                <span v-if="record.latest.versionTag" style="color: #888; font-size: 12px;">
                  v{{ record.latest.versionTag }}
                </span>
                <span v-if="record.latest.stage" style="color: #888; font-size: 12px;">
                  · {{ STEP_LABELS[record.latest.stage] || record.latest.stage }}
                </span>
              </div>
              <div style="font-size: 12px; color: #bbb;">{{ formatTime(record.latest.startTime) }}</div>
            </template>
            <span v-else style="color: #bbb; font-size: 12px;">从未执行</span>
          </template>
          <template v-else-if="column.key === 'stat'">
            <span style="font-size: 12px; color: #666;">{{ record.total }} 次 · 成功 {{ record.ok }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space size="small">
              <a-button type="link" size="small" @click="gotoPipelineDetail(record)">详情</a-button>
              <a-button type="link" size="small" @click="openEdit(record.tpl)">编辑</a-button>
              <a-button type="link" size="small" :disabled="!record.tpl.enabled" @click="executeTpl(record)">
                执行
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 新建流水线：先选模块类型（前端 / 后台）→ 初始流水线按类型预填构建命令 -->
    <a-modal v-model:open="newTypeOpen" title="新建流水线 · 选择模块类型" :footer="null" width="520">
      <div style="margin-bottom: 14px; color: var(--ws-text-tertiary); font-size: 12px;">
        按类型载入初始流水线（拉取代码 → 构建 → 发布确认 → 发布），构建命令按类型预填，可改。
      </div>
      <div style="display: flex; gap: 12px;">
        <a-button block style="height: auto; padding: 14px;" @click="confirmCreate('fe')">
          <div style="font-weight: 600;">前端（micro-frontend）</div>
          <div style="font-size: 12px; color: var(--ws-text-tertiary);">初始构建：npx vite build</div>
        </a-button>
        <a-button block style="height: auto; padding: 14px;" @click="confirmCreate('be')">
          <div style="font-weight: 600;">后台（backend）</div>
          <div style="font-size: 12px; color: var(--ws-text-tertiary);">初始构建：npm ci + npx tsc</div>
        </a-button>
      </div>
    </a-modal>

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
              <div class="field-hint">
                环境是运行期参数，可在此改（含自建环境 1/2/3…）；默认取所选流水线绑定的环境
              </div>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="模块（后端/前端/微前端均可走流水线发布）" required>
              <a-select
                v-model:value="form.moduleKey"
                placeholder="选择模块"
                :disabled="!!fixedModuleKey"
                @change="onModuleChange"
              >
                <a-select-option v-for="m in availableModules" :key="m.key" :value="m.key">
                  {{ m.name }}（{{ m.key }}）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item v-if="!templateLocked" label="使用流水线" required>
          <a-select v-model:value="form.templateId" placeholder="选择流水线">
            <a-select-option v-for="t in availTemplates" :key="t.id" :value="t.id">
              {{ t.name }}<template v-if="t.env"> · {{ t.env }}</template>
              <template v-if="t.builtin">（默认）</template>
              <template v-if="t.approval === 'always'">（强制审批）</template>
              <template v-if="t.approval === 'never'">（免审批）</template>
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-else label="使用流水线">
          <a-tag color="blue">
            {{ availTemplates.find((t) => t.id === fixedTemplateId)?.name || '本流水线' }}
          </a-tag>
          <span class="field-hint-inline">环境已改为 {{ env }}，将按同一流水线流程发布到该环境</span>
        </a-form-item>

        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="分支">
              <!-- 分支下拉（origin/*），避免手输写错；见 BranchSelect 组件头注释 -->
              <BranchSelect v-model="form.branch" :module-key="form.moduleKey" @update:model-value="loadBranchCommits" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="Commit（留空=分支最新提交）">
              <a-select
                v-model:value="form.commitId"
                show-search
                allow-clear
                :loading="loadingCommits"
                placeholder="留空=最新；可从分支提交列表选，或输入短哈希"
                :filter-option="filterCommitOption"
              >
                <a-select-opt-group label="分支最近提交（刚 push 的在这里）">
                  <a-select-option v-for="c in branchCommits" :key="c.hash" :value="c.short" :title="c.subject">
                    {{ c.short }} · {{ c.subject }}<span class="opt-meta">（{{ c.author }} · {{ c.date }}）</span>
                  </a-select-option>
                  <a-select-option v-if="!branchCommits.length" :value="'__none__'" disabled>
                    {{ loadingCommits ? '加载分支提交中…' : '未取到分支提交（仍可留空=最新，或直接输入短哈希）' }}
                  </a-select-option>
                </a-select-opt-group>
                <a-select-opt-group v-if="releases.length" label="历史发布版本（产物已存在，可复用跳过构建）">
                  <a-select-option v-for="r in releases" :key="r.versionTag" :value="r.commit || r.versionTag">
                    {{ r.versionTag }}{{ r.note ? ` · ${r.note}` : '' }}
                  </a-select-option>
                </a-select-opt-group>
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

    <!-- 全部执行记录抽屉（全局浏览；流水线归属见流水线详情页历史） -->
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
          { title: '流水线 ID', dataIndex: 'id', key: 'id', width: 140 },
          { title: '名称', key: 'name', width: 150 },
          { title: '模块', key: 'module', width: 170 },
          { title: '环境', dataIndex: 'env', key: 'env', width: 80 },
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
          <template v-else-if="column.key === 'name'">
            <!-- 流水线名称缺省回填模块名（design §13：name ?? moduleKey） -->
            {{ record.templateName || record.moduleKey }}
          </template>
          <template v-else-if="column.key === 'module'">
            <a-tag :color="record.mode === 'grayscale' ? 'orange' : 'blue'" style="margin-right: 4px;">
              {{ record.mode === 'grayscale' ? '灰度' : '全量' }}
            </a-tag>
            {{ record.moduleKey }}
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
              <template v-if="isApprovalPending(record.status)">
                <a-button type="link" size="small" @click="openApprove(record)">通过</a-button>
                <a-button type="link" size="small" danger @click="openReject(record)">拒绝</a-button>
              </template>
              <a-button
                v-if="record.status === 'running' || record.status === 'pending' || record.status === 'awaiting-approval'"
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
          <a-descriptions-item label="流水线">{{ logRecord.templateName || '—' }}</a-descriptions-item>
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
.field-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
  line-height: 1.7;
}
.field-hint-inline {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.tpl-card {
  height: 100%;
}
.tpl-card :deep(.ant-card-body) {
  display: flex;
  flex-direction: column;
}
</style>
