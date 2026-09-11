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
  pipelineStepApi,
  type PipelineItem,
  type PipelineTemplate,
  type TemplateNode,
  PLATFORM_NODE_KEYS,
  PLATFORM_NODE_LABELS,
} from '@/api'
import ProgressFlow from '@/components/pipeline/ProgressFlow.vue'
import PipelineRunLogs from '@/components/pipeline/PipelineRunLogs.vue'
import StageCommandDrawer, {
  type StageScriptItem,
} from '@/components/pipeline/StageCommandDrawer.vue'
import StageActionsEditor, {
  type EditorItem,
} from '@/components/pipeline/StageActionsEditor.vue'
import {
  stepList,
  stepLabelOf,
  statusColor,
  statusText,
  formatTime,
  durationMs,
  isLive,
  checkNodes,
  nodeDisplayName,
  legacyToNodes,
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
  } else {
    // 清空 ?run（删除/无目标时移除深链参数，避免残留指向失效 id）
    router.replace({ query: { ...route.query, run: undefined } })
  }
}
/**
 * 从历史/接口解析目标实例并选中（优先 ?run=，缺省取最新一次）。
 * 兜底：?run 指向已删除/不存在实例时，回落到最新一次并纠正 URL。
 */
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
  // 兜底：指定实例不存在/已被删除 → 回落到最新一次并清理 ?run
  if (!target) {
    const fallback = history.value[0] || null
    if (fallback) {
      selectedRun.value = fallback
      router.replace({ query: { ...route.query, run: fallback.id } })
      return
    }
    pickRun(null)
    return
  }
  selectedRun.value = target
  if (!qRun) {
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
  const run = selectedRun.value
  if (!run) {
    stopPolling()
    return
  }
  const id = run.id
  const fresh = await pipelineApi.get(id).catch(() => null)
  if (!fresh) {
    stopPolling()
    return
  }
  // 竞态防护：await 期间用户切到别的实例 → 丢弃本次结果，避免旧数据覆盖新选中
  if (selectedRunId.value !== id) return
  // 同步到 selectedRun + 历史列表中的同一行
  selectedRun.value = fresh
  const idx = history.value.findIndex((h) => h.id === id)
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
async function ensureScriptView(moduleKey: string, force = false) {
  if (!moduleKey) return
  if (!force && scriptViewMap.value[moduleKey]) return
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
  const found = list.find((it) => it.stage === stage) ?? null
  if (found) {
    cmdItem.value = found
    cmdInitialTab.value = tab
    cmdOpen.value = true
    return
  }
  // v5 nodes：script 节点 key 不在固定 9 阶段视图 → 按「模块 × key」读配置（git/version/pointer 平台节点给只读说明）
  const isPlat = (PLATFORM_NODE_KEYS as readonly string[]).includes(stage)
  if (isPlat) {
    cmdItem.value = {
      stage,
      source: 'semantic',
      command: null,
      actions: [],
      enabled: false,
      timeoutSec: null,
      updatedAt: null,
      updatedBy: null,
      title: PLATFORM_NODE_LABELS[stage] || stage,
      builtin: '平台托管节点：git/写版本号为发布语义真相源，命令由平台内置执行，不可配置。',
      commandMode: 'none',
    }
  } else {
    const row = await stageCommandApi.get(p.moduleKey, stage).catch(() => null)
    cmdItem.value = {
      stage,
      source: row?.command?.trim() || row?.actions?.length ? 'configured' : 'required-unset',
      command: row?.command ?? null,
      actions: row?.actions ?? [],
      enabled: !!row?.enabled,
      timeoutSec: row?.timeoutSec ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
      title: stepLabelOf(p, stage),
      builtin: row?.command?.trim() || row?.actions?.length ? '' : '该节点按「模块 × 节点 key」配置脚本；未配置时按节点 optional 决定跳过或失败。',
      commandMode: 'override',
    }
  }
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

// ===== 编辑流水线（nodes 编排：platform 锁定 + script 增删拖拽 + 节点脚本编辑） =====
const editOpen = ref(false)
const editSaving = ref(false)
/** 编辑态草稿：模板元信息 */
const metaDraft = ref({
  name: '',
  description: '',
  enabled: true,
  approval: 'inherit' as 'inherit' | 'always' | 'never',
  rollbackOnFailure: 'previous' as 'previous' | 'none',
  defaultTarget: 'auto' as 'auto' | 'local' | 'remote',
})
/** 编辑态草稿：nodes 序列（platform + script，保序；旧模板打开时预转存） */
const nodeDraft = ref<TemplateNode[]>([])
/** 当前选中的节点 key（点 script 节点后编辑 label/key/脚本；platform 不可选中） */
const selNodeKey = ref('')
/** 拖拽状态 */
const dragKey = ref('')
const dropSide = ref<'l' | 'r'>('r')
/** 节点命令编辑（R6：命令归属流水线，不再依赖作用模块） */
const editingItem = ref<EditorItem | null>(null)
const isPlatformNode = (key: string) => (PLATFORM_NODE_KEYS as readonly string[]).includes(key)

function openEditor() {
  if (!tpl.value) return
  metaDraft.value = {
    name: tpl.value.name,
    description: tpl.value.description || '',
    enabled: tpl.value.enabled,
    approval: tpl.value.approval,
    rollbackOnFailure: tpl.value.rollbackOnFailure || 'previous',
    defaultTarget: tpl.value.defaultTarget || 'auto',
  }
  // 旧模板（无 nodes）打开即预转存为 nodes 草稿（保存才落库；所见即转存后效果）
  nodeDraft.value = tpl.value.nodes && tpl.value.nodes.length
    ? JSON.parse(JSON.stringify(tpl.value.nodes))
    : legacyToNodes({
        steps: tpl.value.steps ?? null,
        skipVerify: !!tpl.value.skipVerify,
        rollbackOnFailure: tpl.value.rollbackOnFailure ?? 'previous',
      })
  selNodeKey.value = ''
  editingItem.value = null
  editOpen.value = true
}

/** 当前草稿节点（按 key） */
function nodeOf(key: string): TemplateNode | undefined {
  return nodeDraft.value.find((n) => n.key === key)
}

/** 选中的节点对象（未选中或 platform 时为 null） */
const selectedNode = computed<TemplateNode | null>(() => {
  const n = nodeOf(selNodeKey.value)
  return n && n.kind === 'script' ? n : null
})

/** nodes 语义校验（镜像后端 §14.5）：返回首条错误或空串 */
function nodesError(): string {
  const errs = checkNodes(nodeDraft.value)
  return errs.length ? errs[0] : ''
}

/** 拖拽结束立即屏蔽紧随的 click，避免「拖完节点顺手打开脚本编辑器」 */
let justDragged = false

/** 点击节点：script 可编辑；git 平台托管但**可只读查看**；version/pointer 不展示 */
function onNodeClick(key: string) {
  if (justDragged) return
  if (isPlatformNode(key) && key !== 'git') {
    message.warning('写版本号（version/pointer）是发布语义真相源，平台托管，不可编辑')
    return
  }
  selNodeKey.value = key
  void loadNodeScript(key)
}

/** 读取「流水线 × 节点 key」现有命令（R6：不再依赖作用模块） */
async function loadNodeScript(key: string) {
  if (!tpl.value) return
  try {
    const row = await pipelineStepApi.get(tpl.value.id, key)
    editingItem.value = {
      stage: key,
      source: row?.command?.trim() || row?.actions?.length ? 'configured' : 'required-unset',
      command: row?.command ?? null,
      actions: row?.actions ?? [],
      enabled: !!row?.enabled,
      timeoutSec: row?.timeoutSec ?? null,
      // 平台托管（locked）：编辑器据此渲染只读
      locked: !!(row as { locked?: boolean } | null)?.locked,
    }
  } catch {
    editingItem.value = null
    message.error(`读取流水线 × ${key} 命令失败`)
  }
}

/** 脚本保存成功后的刷新（保持选中态） */
async function onScriptEditorSaved() {
  if (selNodeKey.value) {
    await loadNodeScript(selNodeKey.value)
  }
}

/** 点顶部「+ 添加节点」或连接线「+」：直接落一个新 script 节点并选中编辑 */
function addScriptNode(slot: number) {
  const n: TemplateNode = { kind: 'script', key: nextNodeKey(), label: '新节点', optional: false }
  nodeDraft.value.splice(slot, 0, n)
  selNodeKey.value = n.key
  editingItem.value = null
  void loadNodeScript(n.key)
  // 下一帧聚焦 label 输入
  window.setTimeout(() => {
    const el = document.getElementById('edLabel-' + n.key) as HTMLInputElement | null
    el?.focus()
  }, 50)
}

function nextNodeKey(): string {
  const used = new Set(nodeDraft.value.map((n) => n.key))
  let i = 2
  let k = 'node'
  while (used.has(k)) k = 'node-' + i++
  return k
}

/** 节点 label / key 即改即同步（改 key 需重查脚本） */
function renameLabel(key: string, label: string) {
  const n = nodeOf(key)
  if (n) n.label = label || '新节点'
}
function renameKey(oldKey: string, val: string) {
  const k = (val || '').trim()
  if (!k) return
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(k) || isPlatformNode(k) || nodeDraft.value.some((n) => n.key === k && n.key !== oldKey)) {
    message.warning('key 非法 / 占用平台保留字 / 重复')
    return
  }
  const n = nodeOf(oldKey)
  if (!n) return
  n.key = k
  if (selNodeKey.value === oldKey) selNodeKey.value = k
  void loadNodeScript(k) // 新 key 可能有已存命令
}

/** optional / watchdog 开关 */
function toggleNodeOptional(key: string, on: boolean) {
  const n = nodeOf(key)
  if (n) n.optional = on
}
function toggleNodeWatchdog(key: string, on: boolean) {
  // watchdog 全局互斥：勾一个取消其它
  nodeDraft.value.forEach((x) => {
    if (x.kind === 'script') x.watchdog = false
  })
  const n = nodeOf(key)
  if (n) n.watchdog = on
}

/** 删除 script 节点（平台节点不可删）；watchdog 删除有后果确认 */
function askDeleteNode(key: string) {
  const n = nodeOf(key)
  if (!n) return
  const isWatch = !!n.watchdog
  const confirmTitle = isWatch
    ? `删除 watchdog 节点「${n.label || key}」？`
    : `删除 script 节点「${n.label || key}」？`
  const content = isWatch
    ? `该节点标记为 watchdog（自动回滚锚点）。删除后：此节点失败将不再触发自动回滚；若需保留自动回滚请先用其它 script 节点标记 watchdog。模块已配置的 ${key} 脚本会保留（孤儿标注）。`
    : `节点将从本流水线移除，发布不再执行该步骤。模块已配置的 ${key} 脚本会保留（孤儿标注）。`
  Modal.confirm({
    title: confirmTitle,
    content,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => doDeleteNode(key),
  })
}
function doDeleteNode(key: string) {
  nodeDraft.value = nodeDraft.value.filter((n) => n.key !== key)
  if (selNodeKey.value === key) {
    selNodeKey.value = ''
    editingItem.value = null
  }
  message.success(`已删除节点 ${key}`)
}

/** 拖拽重排（script 可拖；platform 不可） */
function dragStart(e: DragEvent, key: string) {
  if (isPlatformNode(key)) {
    e.preventDefault()
    return
  }
  dragKey.value = key
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  justDragged = true
  window.setTimeout(() => {
    justDragged = false
  }, 200)
}
function dragEnd() {
  dragKey.value = ''
}
function dragOver(e: DragEvent) {
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  dropSide.value = e.clientX < r.left + r.width / 2 ? 'l' : 'r'
}
function dragDrop(e: DragEvent, targetKey: string) {
  e.preventDefault()
  justDragged = true
  window.setTimeout(() => {
    justDragged = false
  }, 200)
  const moved = dragKey.value
  dragKey.value = ''
  if (!moved || moved === targetKey) return
  const seq = nodeDraft.value.map((n) => n.key)
  const from = seq.indexOf(moved)
  if (from < 0) return
  seq.splice(from, 1)
  let to = seq.indexOf(targetKey)
  if (dropSide.value === 'r') to += 1
  if (to < 0) to = seq.length
  const candidate = [...seq.slice(0, to), moved, ...seq.slice(to)]
  const errs = checkNodes(candidate.map((k) => nodeOf(k)!).filter(Boolean))
  if (errs.length) {
    message.warning(`不可移动：${errs[0]}`)
    return
  }
  // 按 candidate 顺序重排 nodeDraft
  const byKey = new Map(nodeDraft.value.map((n) => [n.key, n]))
  nodeDraft.value = candidate.map((k) => byKey.get(k)!).filter(Boolean)
}

/** 保存模板（元信息 + nodes） */
async function saveEditor() {
  if (!tpl.value) return
  const err = nodesError()
  if (err) {
    message.warning(err)
    return
  }
  editSaving.value = true
  try {
    const body: Record<string, any> = {
      // builtin 模板不可改名（后端 400）；改名仅自定义模板且名字确实变化时提交
      ...(tpl.value.builtin || metaDraft.value.name.trim() === tpl.value.name
        ? {}
        : { name: metaDraft.value.name.trim() }),
      description: metaDraft.value.description.trim() || undefined,
      enabled: metaDraft.value.enabled,
      approval: metaDraft.value.approval,
      rollbackOnFailure: metaDraft.value.rollbackOnFailure,
      defaultTarget: metaDraft.value.defaultTarget,
      nodes: nodeDraft.value,
    }
    await pipelineTemplateApi.update(tplId.value, body)
    message.success('流水线已保存')
    editOpen.value = false
    await loadTpl()
    await loadHistory(200)
    await loadSelectedRun()
  } catch (e: any) {
    message.error(e?.response?.data?.message || e?.message || '保存失败')
  } finally {
    editSaving.value = false
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
  // 默认选中：?run= 指定的历史实例，缺省 = 最新一次；running 由 watch 自动轮询
  await loadSelectedRun()
})
onUnmounted(stopPolling)
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <a-button type="link" @click="router.push('/pipelines')">← 返回</a-button>
      <h2 style="margin: 0;">流水线详情</h2>
      <template v-if="tpl">
        <a-tag color="blue" style="font-size: 14px;">{{ tpl.name }}</a-tag>
        <a-tag v-if="tpl.builtin" color="blue">默认</a-tag>
        <a-tag v-if="!tpl.enabled" color="default">已停用</a-tag>
        <a-tag v-if="tpl.approval === 'always'" color="orange">始终审批</a-tag>
        <a-tag v-if="tpl.approval === 'never'" color="red">免审批</a-tag>
        <a-tag v-if="tpl.skipVerify" color="cyan">跳过探活</a-tag>
      </template>
      <div style="flex: 1;" />
      <template v-if="tpl">
        <a-button type="primary" ghost @click="router.push({ name: 'PipelineEdit', params: { id: tplId } })">编辑流水线</a-button>
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
                    {{ stepLabelOf(record, record.stage || '') }}
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

    <!-- 编辑流水线抽屉（元信息 + 节点重排 + 节点脚本） -->
    <a-drawer
      :open="editOpen"
      title="编辑流水线"
      placement="right"
      :width="860"
      :footer-style="{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }"
      @close="editOpen = false"
    >
      <div style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
        <!-- 基本信息 -->
        <a-card size="small" title="基本信息" :bordered="false" style="background: #fafafa;">
          <a-form layout="vertical">
            <a-row :gutter="12">
              <a-col :span="12">
                <a-form-item label="流水线名">
                  <a-input v-model:value="metaDraft.name" :disabled="tpl?.builtin" />
                  <div v-if="tpl?.builtin" style="font-size: 12px; color: #999;">内置默认模板不可改名（可用「复制」另建）</div>
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="启用">
                  <a-switch v-model:checked="metaDraft.enabled" />
                </a-form-item>
              </a-col>
            </a-row>
            <a-form-item label="说明">
              <a-input v-model:value="metaDraft.description" placeholder="流水线用途 / 变更备注" />
            </a-form-item>
            <a-row :gutter="12">
              <a-col :span="8">
                <a-form-item label="探活失败">
                  <a-radio-group v-model:value="metaDraft.rollbackOnFailure">
                    <a-radio value="previous">自动回滚</a-radio>
                    <a-radio value="none">不回滚</a-radio>
                  </a-radio-group>
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="审批">
                  <a-radio-group v-model:value="metaDraft.approval">
                    <a-radio value="inherit">继承环境</a-radio>
                    <a-radio value="always">始终</a-radio>
                    <a-radio value="never">免审</a-radio>
                  </a-radio-group>
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="投递目标">
                  <a-radio-group v-model:value="metaDraft.defaultTarget">
                    <a-radio value="auto">自动</a-radio>
                    <a-radio value="local">本机</a-radio>
                    <a-radio value="remote">远程</a-radio>
                  </a-radio-group>
                </a-form-item>
              </a-col>
            </a-row>
          </a-form>
        </a-card>

        <!-- 流程编排：nodes 画布（连接线插孔 + 平台锁定 + script 增删拖拽） -->
        <a-card size="small" :bordered="false" style="background: #fafafa;">
          <template #title>
            流程编排
            <span style="font-weight: normal; font-size: 12px; color: #999; margin-left: 8px;">
              platform（git / 写版本号）锁定 · script 可拖拽 / 增删 / 配脚本 · 点连接线「+」直接落节点并选中编辑
            </span>
            <a-button
              style="margin-left: auto;"
              size="small"
              type="primary"
              ghost
              @click="addScriptNode(1)"
            >+ 添加节点</a-button>
          </template>

          <div class="v5-canvas">
            <template v-for="(n, i) in nodeDraft" :key="n.key">
              <!-- 前插槽（git 前不显示，git 恒首位） -->
              <div
                v-if="i > 0"
                class="v5-slot"
                title="在此位置插入节点"
                @click="addScriptNode(i)"
              >
                <div class="v5-line"></div>
                <button class="v5-plus" type="button">+</button>
              </div>
              <div
                class="v5-node"
                :class="{
                  'v5-plat': n.kind === 'platform',
                  'v5-watch': n.watchdog,
                  'v5-sel': selNodeKey === n.key,
                }"
                :draggable="n.kind === 'script'"
                @click="onNodeClick(n.key)"
                @dragstart="dragStart($event, n.key)"
                @dragend="dragEnd"
                @dragover="dragOver"
                @drop="dragDrop($event, n.key)"
              >
                <span class="v5-seq">{{ i + 1 }}</span>
                <span v-if="n.kind === 'platform'" class="v5-lock" title="发布语义，平台托管">🔒</span>
                <button
                  v-if="n.kind === 'script'"
                  class="v5-del"
                  type="button"
                  title="删除节点"
                  @click.stop="askDeleteNode(n.key)"
                >×</button>
                <span v-if="n.watchdog" class="v5-wbadge" title="失败触发自动回滚">⚠</span>
                <span class="v5-name">{{ nodeDisplayName(n) }}</span>
                <span class="v5-key">{{ n.kind === 'platform' ? PLATFORM_NODE_LABELS[n.key] || n.key : n.key }}</span>
              </div>
            </template>
            <span v-if="!nodeDraft.length" style="color:#bbb; font-size:12px;">请至少保留 git 与写版本号（platform 节点）</span>
          </div>

          <div v-if="nodesError()" style="margin-top: 8px;">
            <a-alert type="error" show-icon :message="`当前编排不可保存：${nodesError()}`" />
          </div>
        </a-card>

        <!-- 节点配置：label/key/optional/watchdog + 脚本（作用模块 × key） -->
        <a-card size="small" :bordered="false" style="background: #fafafa; flex: 1; min-height: 320px;">
          <template #title>
            节点配置
            <span style="font-weight: normal; font-size: 12px; color: #999; margin-left: 8px;">
              选中 script 节点编辑；git 可查看（平台托管只读）；写版本号不可选
            </span>
          </template>

          <!-- platform/git：平台托管脚本（locked），只读查看 -->
          <template v-if="!selectedNode && selNodeKey === 'git'">
            <a-alert
              type="info"
              show-icon
              style="margin-bottom: 12px;"
              message="git · 拉取代码：平台托管（locked）"
              description="脚本正文随平台代码维护（启动 / 发布时自动同步到数据库），页面仅可查看与语法校验。"
            />
            <div v-if="tpl">
              <StageActionsEditor
                v-if="editingItem"
                :template-id="tpl.id"
                :item="editingItem"
                :readonly="true"
                @cancel="editingItem = null"
              />
              <a-empty v-else description="读取 流水线 × git 命令中…" />
            </div>
            <a-empty v-else description="无可用流水线模板" />
          </template>

          <template v-else-if="selectedNode">
            <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; margin-bottom: 12px;">
              <div>
                <div class="muted" style="margin-bottom:6px;">label（即改同步画布）</div>
                <a-input
                  :id="`edLabel-${selectedNode.key}`"
                  :value="selectedNode.label"
                  style="width:170px;"
                  size="small"
                  @change="(e: any) => renameLabel(selectedNode!.key, e.target.value)"
                />
              </div>
              <div>
                <div class="muted" style="margin-bottom:6px;">key（模块脚本读写点，改后同步）</div>
                <a-input
                  :value="selectedNode.key"
                  style="width:170px; font-family: monospace;"
                  size="small"
                  @change="(e: any) => renameKey(selectedNode!.key, e.target.value)"
                />
              </div>
              <a-checkbox
                :checked="!!selectedNode.optional"
                @change="(e: any) => toggleNodeOptional(selectedNode!.key, e.target.checked)"
              >optional（未配脚本跳过）</a-checkbox>
              <a-checkbox
                :checked="!!selectedNode.watchdog"
                @change="(e: any) => toggleNodeWatchdog(selectedNode!.key, e.target.checked)"
              >watchdog（失败自动回滚）</a-checkbox>
              <a-button size="small" danger @click="askDeleteNode(selectedNode.key)">删除节点</a-button>
            </div>

            <div v-if="tpl">
              <StageActionsEditor
                v-if="editingItem"
                :template-id="tpl.id"
                :item="editingItem"
                @saved="onScriptEditorSaved"
                @cancel="editingItem = null"
              />
              <a-empty v-else :description="`读取 流水线 × ${selectedNode.key} 命令中…`" />
            </div>
            <a-empty v-else description="无可用流水线模板，无法编辑命令（可先保存节点结构）" />
          </template>

          <a-empty v-else description="点击上方节点：script 可配置，git 可查看（平台托管只读），写版本号不可选" />
        </a-card>
      </div>

      <template #footer>
        <span style="color:#999; font-size: 12px;">
          保存后按新流程生效；已运行中的发布仍按其提交时的快照执行
        </span>
        <span>
          <a-button style="margin-right: 8px;" @click="editOpen = false">取消</a-button>
          <a-button type="primary" :loading="editSaving" @click="saveEditor">保存流水线</a-button>
        </span>
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

<style scoped>
/* ---- v5 nodes 画布 ---- */
.v5-canvas {
  display: flex;
  align-items: center;
  overflow-x: auto;
  min-height: 74px;
  padding: 10px 2px 14px;
  flex-wrap: nowrap;
}
.v5-node {
  position: relative;
  flex-shrink: 0;
  min-width: 108px;
  padding: 8px 12px 9px;
  border: 1.5px solid #d9d9d9;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s;
  user-select: none;
}
.v5-node:hover {
  border-color: #f97316;
  transform: translateY(-1px);
}
.v5-node.v5-sel {
  border-color: #f97316;
  box-shadow: 0 0 0 3px #fff1e7;
}
.v5-node.v5-plat {
  border-color: #d3c4ef;
  background: #f9f0ff;
  cursor: not-allowed;
}
.v5-node.v5-watch {
  border-color: #f0d4a8;
  background: #fffbe6;
}
.v5-node.v5-plat .v5-name {
  color: #722ed1;
}
.v5-node.v5-plat .v5-key {
  color: #9254de;
}
.v5-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  padding: 0 2px;
}
.v5-key {
  display: block;
  font-size: 10px;
  color: #999;
  margin-top: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.v5-seq {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 1.5px solid #d9d9d9;
  font-size: 10px;
  font-weight: 700;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.v5-lock {
  position: absolute;
  top: -8px;
  right: 24px;
  font-size: 11px;
}
.v5-del {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e5484d;
  color: #fff;
  border: none;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.v5-node:hover .v5-del {
  opacity: 1;
}
.v5-wbadge {
  position: absolute;
  bottom: -8px;
  left: -8px;
  font-size: 10px;
  background: #e8833a;
  color: #fff;
  border-radius: 10px;
  padding: 1px 6px;
  font-weight: 600;
}
.v5-slot {
  position: relative;
  width: 30px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.v5-line {
  width: 30px;
  height: 2px;
  background: #d9d9d9;
}
.v5-slot::after {
  content: '';
  position: absolute;
  right: -1px;
  top: calc(50% - 3px);
  border-left: 6px solid #d9d9d9;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.v5-plus {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 1.5px dashed #c3cad3;
  color: #8a94a3;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  z-index: 2;
}
.v5-slot:hover .v5-plus {
  border-color: #f97316;
  border-style: solid;
  color: #f97316;
  background: #fff1e7;
}
</style>
