<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  pipelinesApi,
  pipelineStepApi,
  pipelineVarApi,
  pipelineRunsApi,
  deployApi,
  type PipelineTemplate,
  type PipelineVar,
  type TemplateNode,
  PLATFORM_NODE_KEYS,
} from '@/api'
import UserSelect from '@web-system/ui/components/UserSelect.vue'
import type { UserSelectLoadResult } from '@web-system/ui/components/UserSelect.types'
import StageActionsEditor, { type EditorItem } from '@/components/pipeline/StageActionsEditor.vue'
import PipelineVarPanel from '@/components/pipeline/PipelineVarPanel.vue'
import VarReferenceTable from '@/components/pipeline/VarReferenceTable.vue'
import { isShellNode, nodeDisplayName } from '@/components/pipeline/pipeline.stages'

/**
 * 编辑流水线（定义态）。
 *
 * 用户 2026-09-15 批注后的交互：
 *  - 列表页「编辑 / 新建」进本页，**不再弹窗**（新建态 = 路由 pipelines/new/edit，无 id）；
 *  - `key` 新建时可填，**保存成功后只读**（它是产物命名空间的一段路径）；
 *  - 节点信息与脚本放**右侧抽屉**：三 Tab = 节点 / 变量 / 参数（写脚本时随手查键名）；
 *  - **git 是普通 shell 节点**：脚本可编辑；git 的登录/密钥/权限归「git 信息维护层」。
 */
const route = useRoute()
const router = useRouter()
const isCreate = computed(() => route.name === 'PipelineEditCreate')
const tplId = computed(() => (isCreate.value ? '' : String(route.params.id || '')))

const tpl = ref<PipelineTemplate | null>(null)
/** 编辑页当前 Tab：base=基本信息 / flow=流程编排 / params=参数 / vars=变量 */
const pageTab = ref('base')
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)

// ── 基本信息 ──
const metaDraft = ref({
  name: '',
  key: '',
  moduleKey: 'admin',
  env: 'local',
  enabled: true,
  approval: 'inherit' as 'inherit' | 'always' | 'never',
  rollbackOnFailure: 'previous' as 'previous' | 'none',
  defaultTarget: 'auto' as 'auto' | 'local' | 'remote',
  approvers: [] as string[],
})

/** 人员选择器数据源：持有 deploy:pipeline:approve 的系统用户 */
const loadApprovers = async (): Promise<UserSelectLoadResult> => {
  const r = await pipelineRunsApi.approvers()
  return { users: r.users ?? [], degraded: !!r.degraded, reason: r.reason }
}

const ENV_OPTIONS = [
  { value: 'local', label: '本地环境（local）' },
  { value: 'dev', label: '开发环境（dev）' },
  { value: 'prod', label: '生产环境（prod）' },
]

// ── 节点编排 ──
const nodeDraft = ref<TemplateNode[]>([])
const selNodeKey = ref('')
const editingItem = ref<EditorItem | null>(null)
const dragKey = ref('')
const dropSide = ref<'l' | 'r'>('r')
let justDragged = false

// ── 模块列表（新建时选归属模块）──
const modules = ref<{ key: string; name: string; type: string }[]>([])

// ── 右侧抽屉：节点 / 变量 / 参数 ──
const drawerOpen = ref(false)
const drawerTab = ref<'node' | 'vars' | 'params'>('node')
/** 节点脚本编辑器（按钮行外置到抽屉 footer） */
const stageRef = ref<{ save: () => Promise<void>; validate: () => Promise<void> } | null>(null)
const nodeSaving = ref(false)
/** 审批节点在模板层类型里还没建模（避免动到别人正在编辑的 api 文件），这里就地取宽类型 */
const apNode = computed(() => (selectedNode.value || {}) as any)

/** 抽屉底部「取消」= 关闭抽屉（用户 2026-09-15；原来是只清表单、抽屉不关） */
function closeDrawer() {
  drawerOpen.value = false
}
async function validateNode() {
  await stageRef.value?.validate()
}
/** 抽屉底部「保存」：先存脚本（shell 节点），节点结构有改动再整条流水线落库 */
async function saveNodeFromDrawer() {
  if (!selectedNode.value) { message.warning('先选择一个节点'); return }
  if (isCreate.value) { message.warning('先「创建」流水线，再保存节点脚本'); return }
  nodeSaving.value = true
  try {
    if (selectedNode.value.kind === 'shell') await stageRef.value?.save()
    if (dirty.value) await save()
  } finally {
    nodeSaving.value = false
  }
}

// ── 变量（本条流水线）──
const vars = ref<PipelineVar[]>([])

/**
 * 默认节点序列（新建态）：拉取代码 → 构建 → 发布确认 → 发布
 *
 * 注意：审批节点的 `approvers` / `onReject` 目前只在后端 `ApprovalNode` 里建模，
 * 前端 api 的 `TemplateNode` 还没跟上（改了会碰到别人正在编辑的同一文件），
 * 所以这里就地断言 —— 后端 normalizeNodes 会正常接收。
 */
function defaultNodes(): TemplateNode[] {
  return [
    { kind: 'shell', key: 'git', label: '拉取代码' },
    { kind: 'shell', key: 'build', label: '构建' },
    { kind: 'approval', key: 'gate', label: '发布确认', approvers: [], onReject: 'abort' } as TemplateNode,
    { kind: 'shell', key: 'release', label: '发布' },
  ]
}

const isPlatformNode = (key: string) => (PLATFORM_NODE_KEYS as readonly string[]).includes(key)

async function load() {
  loading.value = true
  try {
    try {
      const mods = await deployApi.modules()
      modules.value = (mods as any[]).filter((m) =>
        ['backend', 'frontend', 'micro-frontend'].includes(m.type),
      )
    } catch {
      modules.value = []
    }

    if (isCreate.value) {
      tpl.value = null
      metaDraft.value = {
        name: '',
        key: '',
        moduleKey: modules.value[0]?.key || 'admin',
        env: 'local',
        enabled: true,
        approval: 'inherit',
        rollbackOnFailure: 'previous',
        defaultTarget: 'auto',
        approvers: [],
      }
      nodeDraft.value = defaultNodes()
      vars.value = []
      selNodeKey.value = ''
      editingItem.value = null
      dirty.value = false
      return
    }

    tpl.value = await pipelinesApi.list().then(
      (all) => all.find((t) => t.id === tplId.value) || null,
    )
    if (!tpl.value) {
      message.error('流水线不存在')
      router.replace({ name: 'PipelineCenter' })
      return
    }
    metaDraft.value = {
      name: tpl.value.name,
      key: (tpl.value as any).key || 'default',
      moduleKey: (tpl.value as any).moduleKey || '*',
      env: (tpl.value as any).env || 'local',
      enabled: tpl.value.enabled !== false,
      approval: tpl.value.approval,
      rollbackOnFailure: tpl.value.rollbackOnFailure || 'previous',
      defaultTarget: ((tpl.value as any).defaultTarget || 'auto') as 'auto' | 'local' | 'remote',
      approvers: (tpl.value as any).approvers ? [...(tpl.value as any).approvers] : [],
    }
    nodeDraft.value =
      tpl.value.nodes && tpl.value.nodes.length
        ? JSON.parse(JSON.stringify(tpl.value.nodes))
        : legacyToNodes()
    // 审批节点字段补默认值（旧数据可能没有），保证抽屉里的单选有选中项
    nodeDraft.value.forEach((n) => {
      if (n.kind === 'approval') {
        const a = n as any
        a.approvers ||= []
        a.timeoutAction ||= 'abort'
        a.onReject ||= 'abort'
      }
    })
    selNodeKey.value = ''
    editingItem.value = null
    dirty.value = false
    await loadVars()
  } catch {
    message.error('加载流水线失败')
  } finally {
    loading.value = false
  }
}

function legacyToNodes(): TemplateNode[] {
  const base = (tpl.value?.steps ?? null)?.length
    ? (tpl.value!.steps as string[])
    : ['check', 'pull', 'build', 'upload', 'restart', 'verify', 'cleanup']
  // 终态：git 是普通 shell 节点；version/pointer 不再生成（写版本 = 发布节点的 service action，
  // 切指针 = 模块管理里的部署动作）
  const nodes: TemplateNode[] = [{ kind: 'shell', key: 'git', label: '拉取代码' }]
  for (const s of base) {
    if (s === 'pull' || s === 'git' || s === 'version' || s === 'pointer') continue
    if (s === 'verify' && tpl.value?.skipVerify) continue
    nodes.push({
      kind: 'shell',
      key: s,
      label: ({ check: '校验', build: '构建', upload: '投递', restart: '重启', verify: '探活', cleanup: '清理' } as Record<string, string>)[s] || s,
      optional: s !== 'build',
    })
  }
  return nodes
}

// ── 节点操作 ──
function nodeOf(key: string): TemplateNode | undefined {
  return nodeDraft.value.find((n) => n.key === key)
}
/** 可配置的节点：shell / approval（终态只有这两类） */
const selectedNode = computed(() => {
  const n = nodeOf(selNodeKey.value)
  return n && (n.kind === 'shell' || n.kind === 'approval') ? n : null
})

function onNodeClick(key: string) {
  if (justDragged) return
  selNodeKey.value = key
  drawerTab.value = 'node'
  drawerOpen.value = true
  void loadNodeScript(key)
}

async function loadNodeScript(key: string) {
  if (!tplId.value) {
    // 新建态：命令还没落库（保存后再配）
    editingItem.value = null
    return
  }
  try {
    const row = await pipelineStepApi.get(tplId.value, key)
    editingItem.value = {
      stage: key,
      source: row?.command?.trim() || row?.actions?.length ? 'configured' : 'required-unset',
      command: row?.command ?? null,
      actions: row?.actions ?? [],
      enabled: !!row?.enabled,
      timeoutSec: row?.timeoutSec ?? null,
      locked: !!(row as { locked?: boolean } | null)?.locked,
    }
  } catch {
    editingItem.value = null
    message.error(`读取 ${key} 命令失败`)
  }
}

function addNode(slot: number) {
  const used = new Set(nodeDraft.value.map((n) => n.key))
  let k = 'node'; let i = 2
  while (used.has(k)) k = `node-${i++}`
  nodeDraft.value.splice(slot, 0, { kind: 'shell', key: k, label: '新节点', optional: false })
  selNodeKey.value = k
  editingItem.value = null
  drawerTab.value = 'node'
  drawerOpen.value = true
  dirty.value = true
  setTimeout(() => {
    const el = document.getElementById(`edLabel-${k}`) as HTMLInputElement | null
    el?.focus()
  }, 100)
}

function askDeleteNode(key: string) {
  const n = nodeOf(key)
  if (!n) return
  const isWatch = !!n.watchdog
  Modal.confirm({
    title: `删除节点「${n.label}」`,
    content: isWatch
      ? '该节点是 watchdog（自动回滚锚点）。删除后它失败将不再触发自动回滚。确认删除？'
      : '该节点将从流水线移除，发布不再执行该步骤。确认删除？',
    okText: '确认删除',
    okType: 'danger',
    onOk: () => {
      nodeDraft.value = nodeDraft.value.filter((x) => x.key !== key)
      if (selNodeKey.value === key) { selNodeKey.value = ''; editingItem.value = null }
      dirty.value = true
      message.success(`已删除节点 ${key}`)
    },
  })
}

function renameLabel(key: string, val: string) {
  const n = nodeOf(key)
  if (n) { n.label = val || '新节点'; dirty.value = true }
}

function renameKey(oldKey: string, val: string) {
  const k = (val || '').trim()
  if (!k || !/^[A-Za-z0-9_-]{1,32}$/.test(k) || isPlatformNode(k) || nodeDraft.value.some((n) => n.key === k && n.key !== oldKey)) {
    message.warning('key 非法 / 占用平台保留字 / 重复')
    return
  }
  const n = nodeOf(oldKey)
  if (!n) return
  n.key = k
  if (selNodeKey.value === oldKey) selNodeKey.value = k
  dirty.value = true
  void loadNodeScript(k)
}

/** 策略开关（optional / watchdog）暂不上 UI（用户 2026-09-15），保留函数以便后续接回 */
function toggleOptional(key: string, on: boolean) {
  const n = nodeOf(key)
  if (n) { n.optional = on; dirty.value = true }
}

/** 见 toggleOptional：策略 UI 先收起 */
function toggleWatchdog(key: string, on: boolean) {
  nodeDraft.value.forEach((x) => {
    if (isShellNode(x)) x.watchdog = false
  })
  const n = nodeOf(key)
  if (n) { (n as any).watchdog = on; dirty.value = true }
}

// ── 拖拽 ──
function onDragStart(key: string, e: DragEvent) {
  if (isPlatformNode(key)) { e.preventDefault(); return }
  dragKey.value = key
  dirty.value = true
}
function onDragEnd() { dragKey.value = '' }
function onDragOver(e: DragEvent) {
  e.preventDefault()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropSide.value = e.clientX < r.left + r.width / 2 ? 'l' : 'r'
}
function onDrop(target: string, e: DragEvent) {
  e.preventDefault()
  if (!dragKey.value) return
  const key = dragKey.value
  const from = nodeDraft.value.findIndex((n) => n.key === key)
  if (from < 0) return
  nodeDraft.value.splice(from, 1)
  let to = nodeDraft.value.findIndex((n) => n.key === target)
  if (dropSide.value === 'r') to++
  nodeDraft.value.splice(to, 0, nodeDraft.value.find((n) => n.key === key)!)
  justDragged = true
  setTimeout(() => { justDragged = false }, 100)
  dirty.value = true
}

// ── 保存 ──
function nodesError(): string {
  const keys = nodeDraft.value.map((n) => n.key)
  if (!keys.length) return '至少需要一个节点'
  if (new Set(keys).size !== keys.length) return '节点 key 不能重复'
  if (nodeDraft.value.some((n) => isPlatformNode(n.key))) return '节点 key 不能占用平台保留字（version / pointer）'
  return ''
}

/**
 * 新建时选的模块类型（前端 / 后台）—— 列表页选择后带在 query 上，
 * 决定构建节点的初始脚本（用户 2026-09-15 原型：预填，可改）。
 */
const moduleType = computed(() => {
  const q = String(route.query.moduleType || '')
  return q === 'fe' ? 'fe' : q === 'be' ? 'be' : ''
})

function buildScriptFor(t: string) {
  return t === 'fe'
    ? 'set -euo pipefail\ncd "${RELEASE_DIR}"\nRELEASE_TAG="${TPL_KEY:-default}/${COMMIT_ID}" npx vite build\necho \'{"artifactPath":"/static/modules/${PUBLIC_PATH}/${TPL_KEY:-default}/${COMMIT_ID}/"}\' > "$WS_RESULT_FILE"'
    : 'set -euo pipefail\ncd "${RELEASE_DIR}"\nnpm ci\nnpx tsc -p tsconfig.json\necho \'{"artifactPath":"dist/"}\' > "$WS_RESULT_FILE"'
}

async function prefillBuildScript(id: string) {
  const t = moduleType.value
  if (!t) return
  try {
    await pipelineStepApi.save(id, 'build', { command: buildScriptFor(t), timeoutSec: 900 })
  } catch {
    // 预填失败不阻塞创建（用户可自己在节点抽屉里改脚本）
  }
}

async function save() {
  if (!metaDraft.value.name.trim()) { message.warning('流水线名必填'); return }
  if (isCreate.value && !metaDraft.value.key.trim()) { message.warning('流水线 key 必填'); return }
  const err = nodesError()
  if (err) { message.warning(err); return }
  saving.value = true
  try {
    const dto = {
      name: metaDraft.value.name,
      description: tpl.value?.description || '',
      env: metaDraft.value.env,
      enabled: metaDraft.value.enabled,
      approval: metaDraft.value.approval,
      rollbackOnFailure: metaDraft.value.rollbackOnFailure,
      defaultTarget: metaDraft.value.defaultTarget,
      approvers: metaDraft.value.approvers.length ? metaDraft.value.approvers : undefined,
      nodes: nodeDraft.value,
    } as any
    if (isCreate.value) {
      const created = await pipelinesApi.create({
        ...dto,
        key: metaDraft.value.key,
        moduleKey: metaDraft.value.moduleKey,
      } as any)
      // 按「前端 / 后台」预填构建节点脚本（用户 2026-09-15：新建时选类型 → 初始流水线带出构建命令）
      await prefillBuildScript(created.id)
      dirty.value = false
      message.success('流水线已创建，key 已锁定')
      router.replace({ name: 'PipelineEdit', params: { id: created.id } })
      await load()
    } else {
      await pipelinesApi.update(tplId.value, dto)
      dirty.value = false
      message.success('流水线已保存')
      const keepKey = selNodeKey.value
      await load()
      // 抽屉里保存后保持选中，别把用户选中的节点丢掉
      if (keepKey && nodeOf(keepKey)) {
        selNodeKey.value = keepKey
        drawerTab.value = 'node'
        await loadNodeScript(keepKey)
      }
    }
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removePipeline() {
  if (!tpl.value) return
  Modal.confirm({
    title: `删除流水线「${tpl.value.name}」`,
    content: '删除后该流水线及其节点命令一并移除，已有执行记录保留。确认删除？',
    okText: '确认删除',
    okType: 'danger',
    onOk: async () => {
      try {
        await pipelinesApi.remove(tplId.value)
        message.success('流水线已删除')
        router.push({ name: 'PipelineCenter' })
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

function goBack() {
  const to = { name: 'PipelineCenter' } as const
  if (dirty.value) {
    Modal.confirm({
      title: '放弃修改？',
      content: '当前编辑内容尚未保存，离开后将丢失。',
      okText: '放弃修改',
      okType: 'danger',
      cancelText: '继续编辑',
      onOk: () => router.push(to),
    })
  } else {
    router.push(to)
  }
}

// ── 变量（本条流水线）──
async function loadVars() {
  if (!tplId.value) { vars.value = []; return }
  try {
    vars.value = await pipelineVarApi.list(tplId.value)
  } catch {
    vars.value = []
  }
}

const insertVar = (v: string) => {
  const item = editingItem.value
  if (!item?.actions?.length) { message.warning('请先添加一个 shell 操作'); return }
  const shell = item.actions.find((a) => a.type === 'shell')
  if (shell) { shell.code = (shell.code || '') + v; dirty.value = true }
}

onMounted(() => { void load() })
</script>

<template>
  <div v-if="!loading && (tpl || isCreate)">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <a-breadcrumb style="margin-bottom: 8px">
          <a-breadcrumb-item>
            <router-link :to="{ name: 'PipelineCenter' }">流水线</router-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item>{{ isCreate ? '新建' : tpl?.name }}</a-breadcrumb-item>
          <a-breadcrumb-item>编辑</a-breadcrumb-item>
        </a-breadcrumb>
        <h1 class="page-title">{{ isCreate ? '新建流水线' : metaDraft.name }}</h1>
        <div class="page-sub">
          定义态：基本信息 / 流程编排 / 右侧抽屉（节点 · 变量 · 参数）· 未保存离开会确认
        </div>
      </div>
      <div class="page-actions">
        <a-button v-if="!isCreate" danger @click="removePipeline">删除流水线</a-button>
        <a-button @click="goBack">取消</a-button>
        <a-button type="primary" :loading="saving" @click="save">{{ isCreate ? '创建' : '保存' }}</a-button>
      </div>
    </div>

    <!-- 编辑页 Tab（2026-09-15 原型定稿）：基本信息 / 流程编排 / 参数 / 变量 —— 没有「历史记录」（那是实例页的） -->
    <a-tabs v-model:activeKey="pageTab">
      <!-- Tab 1：基本信息（只剩身份字段；行为配置都在节点上，编辑态整体锁定） -->
      <a-tab-pane key="base" tab="基本信息">
        <a-card size="small">
          <div class="info-grid">
            <div class="info-field">
              <label>流水线名</label>
              <a-input
                v-model:value="metaDraft.name"
                :disabled="!isCreate"
                style="width: 220px;"
                @change="dirty = true"
              />
            </div>
            <div class="info-field">
              <label>流水线 key（slug）{{ isCreate ? ' · 保存后不可修改' : ' · 已保存，不可修改' }}</label>
              <a-input
                v-model:value="metaDraft.key"
                :disabled="!isCreate"
                style="width: 180px;"
                class="mono-input"
                @change="dirty = true"
              />
            </div>
            <div class="info-field">
              <label>模块</label>
              <a-select
                v-model:value="metaDraft.moduleKey"
                :disabled="!isCreate"
                style="width: 200px;"
                @change="dirty = true"
              >
                <a-select-option v-for="m in modules" :key="m.key" :value="m.key">
                  {{ m.name }}（{{ m.key }}）
                </a-select-option>
              </a-select>
            </div>
            <div class="info-field">
              <label>环境</label>
              <a-select
                v-model:value="metaDraft.env"
                :disabled="!isCreate"
                style="width: 180px;"
                @change="dirty = true"
              >
                <a-select-option v-for="e in ENV_OPTIONS" :key="e.value" :value="e.value">{{ e.label }}</a-select-option>
              </a-select>
            </div>
            <div class="info-field">
              <label>启用</label>
              <a-switch v-model:checked="metaDraft.enabled" @change="dirty = true" />
            </div>
          </div>
          <a-alert type="info" show-icon style="margin-top: 14px;">
            <template #message>
              模块 / 环境决定投递机器：local = 本机，dev / prod = 远程（取「环境管理」的服务器配置，脚本用
              <span class="mono-text">${'{'}DEPLOY_HOST{'}'}</span>）。
              <b>审批（审批人 / 超时 / 拒绝后）在「发布确认」节点的抽屉里配置</b>、
              <b>失败自动回滚在节点上标 watchdog</b> —— 都在流水线各节点里设置，不放在基本信息。
              <span v-if="!isCreate">编辑态的基本信息（名 / key / 模块 / 环境）锁定不可改。</span>
            </template>
          </a-alert>
        </a-card>
      </a-tab-pane>

      <!-- Tab 2：流程编排 -->
      <a-tab-pane key="flow" tab="流程编排">
        <a-card size="small">
      <template #title>
        流程编排
        <span class="muted-text" style="margin-left: 8px;">节点可增删、拖拽排序；点节点在右侧抽屉配置脚本</span>
      </template>
      <template #extra>
        <a-button type="primary" size="small" @click="addNode(1)">+ 添加节点</a-button>
      </template>
      <div class="flow-canvas">
        <template v-for="(n, i) in nodeDraft" :key="n.key">
          <div v-if="i > 0" class="flow-slot" @click="addNode(i)">
            <div class="flow-arrow"></div>
            <button class="flow-plus">+</button>
          </div>
          <div
            class="flow-node"
            :class="{ watch: n.watchdog, sel: selNodeKey === n.key, approval: n.kind === 'approval' }"
            :draggable="isShellNode(n)"
            @click="onNodeClick(n.key)"
            @dragstart="onDragStart(n.key, $event)"
            @dragend="onDragEnd"
            @dragover="onDragOver($event)"
            @drop="onDrop(n.key, $event)"
          >
            <span class="flow-seq">{{ i + 1 }}</span>
            <span v-if="n.watchdog" class="watchdog-badge">wd</span>
            <button v-if="isShellNode(n)" class="node-del" @click.stop="askDeleteNode(n.key)">×</button>
            <span class="flow-name">{{ nodeDisplayName(n) }}</span>
            <span class="flow-key">{{ n.kind === 'approval' ? '审批' : n.key }}</span>
          </div>
        </template>
      </div>
      <div class="muted-text" style="margin-top: 8px;">
        拉取代码、构建、发布都是普通 shell 节点（脚本可编辑）；审批节点在抽屉里配审批人与超时动作。
        <b>改动由页头「保存」统一提交</b>（不再有单独的「保存顺序」按钮）。
      </div>
        </a-card>
      </a-tab-pane>

      <!-- Tab 3：参数（只读查阅，写脚本时对键名） -->
      <a-tab-pane key="params" tab="参数">
        <a-card size="small">
          <VarReferenceTable :vars="vars" />
        </a-card>
      </a-tab-pane>

      <!-- Tab 4：变量（本条流水线，可增删改） -->
      <a-tab-pane key="vars" tab="变量">
        <a-card size="small">
          <div v-if="isCreate" class="empty-hint" style="padding: 24px 0; text-align: center;">
            新建态：先「创建」流水线，再回来配变量
          </div>
          <PipelineVarPanel v-else :template-id="tplId" :vars="vars" @changed="loadVars" />
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
  <div v-else style="padding: 100px; text-align: center;">
    <a-spin size="large" />
  </div>

  <!-- 右侧抽屉：节点 / 变量 / 参数 -->
  <a-drawer
    v-model:open="drawerOpen"
    :width="640"
    :title="selectedNode ? `节点 · ${selectedNode.label}（${selectedNode.key}）` : '节点配置'"
    placement="right"
  >
    <a-tabs v-model:activeKey="drawerTab">
      <!-- Tab 1：节点 -->
      <a-tab-pane key="node" tab="节点">
        <template v-if="selectedNode">
          <div class="node-config-row">
            <div class="config-field">
              <label>节点名</label>
              <a-input
                :id="`edLabel-${selectedNode.key}`"
                :value="selectedNode.label"
                style="width: 170px;"
                size="small"
                @change="(e: any) => renameLabel(selectedNode!.key, e.target.value)"
              />
            </div>
            <div class="config-field">
              <label>节点 key</label>
              <a-input
                :value="selectedNode.key"
                style="width: 140px;"
                size="small"
                @change="(e: any) => renameKey(selectedNode!.key, e.target.value)"
              />
            </div>
            <!--
              watchdog（失败自动回滚锚点）：用户 2026-09-15 决定补回 UI。
              语义：只有标了 watchdog 的节点失败才会触发「回滚到上一版本」；
              未标任何节点 = 永不自动回滚。全局至多一个（打开新的会清掉旧的）。
              optional 仍未开放（保留在数据里，不给 UI 入口）。
            -->
            <div v-if="isShellNode(selectedNode)" class="config-field" style="min-width: 300px;">
              <label>失败自动回滚锚点（watchdog）</label>
              <div class="row" style="align-items: center; gap: 8px;">
                <a-switch
                  :checked="!!selectedNode.watchdog"
                  @change="(v: any) => toggleWatchdog(selectedNode!.key, !!v)"
                />
                <span class="muted-text">
                  {{ selectedNode.watchdog ? '本节点失败 → 回滚上一版本' : '未标记（该流水线不会自动回滚）' }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="isCreate" class="empty-hint" style="margin-top: 12px;">
            新建态：先「创建」流水线，再回来配节点脚本（命令按流水线落库）
          </div>

          <!-- 审批节点：审批配置（不该出现脚本编辑器） -->
          <template v-else-if="selectedNode.kind === 'approval'">
            <div class="node-config-row" style="margin-top: 12px;">
              <div class="config-field" style="min-width: 300px; flex: 1;">
                <label>审批人（不选 = 所有持权限者）</label>
                <UserSelect
                  :model-value="apNode.approvers || []"
                  :load="loadApprovers"
                  degraded-text="未获取到可审批人名单：任何能登录控制台的人都能审批"
                  placeholder="选择可审批的人"
                  @update:model-value="(v: string[]) => { apNode.approvers = v; dirty = true }"
                />
              </div>
              <div class="config-field">
                <label>超时（秒，留空=不超时）</label>
                <a-input-number
                  v-model:value="apNode.timeoutSec"
                  :min="1"
                  style="width: 140px;"
                  @change="dirty = true"
                />
              </div>
            </div>
            <div class="node-config-row" style="margin-top: 12px;">
              <div class="config-field">
                <label>超时未批</label>
                <a-radio-group v-model:value="apNode.timeoutAction" button-style="solid" size="small" @change="dirty = true">
                  <a-radio-button value="abort">终止</a-radio-button>
                  <a-radio-button value="auto-approve">自动通过</a-radio-button>
                </a-radio-group>
              </div>
              <div class="config-field">
                <label>拒绝后</label>
                <a-radio-group v-model:value="apNode.onReject" button-style="solid" size="small" @change="dirty = true">
                  <a-radio-button value="abort">终止</a-radio-button>
                  <a-radio-button value="rollback">回滚</a-radio-button>
                </a-radio-group>
              </div>
            </div>
          </template>

          <!-- shell 节点：脚本（编辑器自带按钮已隐藏，按钮统一放抽屉 footer） -->
          <div v-else style="margin-top: 12px;">
            <StageActionsEditor
              v-if="editingItem"
              ref="stageRef"
              :template-id="tplId"
              :item="editingItem"
              :simple="true"
              :hide-actions="true"
              @saved="() => { if (selNodeKey) void loadNodeScript(selNodeKey) }"
              @cancel="closeDrawer"
            />
            <a-empty v-else :description="`读取 ${selectedNode.key} 命令中…`" />
          </div>
        </template>
        <div v-else class="empty-hint">
          点画布上的节点来配置：节点名 / key / 策略 + 脚本与操作序列
        </div>
      </a-tab-pane>

      <!-- Tab 2：变量（本条流水线，可增删改）—— 与编辑页「变量」Tab 共用一个组件 -->
      <a-tab-pane key="vars" tab="变量">
        <div v-if="isCreate" class="empty-hint">新建态：先「创建」流水线，再配变量</div>
        <PipelineVarPanel v-else :template-id="tplId" :vars="vars" @changed="loadVars" />
      </a-tab-pane>

      <!-- Tab 3：参数（只读，写脚本时查阅）—— 与编辑页「参数」Tab 共用一个组件 -->
      <a-tab-pane key="params" tab="参数">
        <VarReferenceTable :vars="vars" @pick="insertVar" />
      </a-tab-pane>
    </a-tabs>

    <!-- 抽屉底部固定操作栏（用户 2026-09-15）：取消 = 关闭抽屉；语法校验只对 shell 节点显示 -->
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <a-button @click="closeDrawer">取消</a-button>
        <a-button v-if="selectedNode?.kind === 'shell'" @click="validateNode">语法校验</a-button>
        <a-button type="primary" :loading="nodeSaving" @click="saveNodeFromDrawer">保存</a-button>
      </div>
    </template>
  </a-drawer>
</template>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.page-sub { font-size: 12px; color: var(--ws-text-tertiary); margin-top: 4px; }
.page-actions { display: flex; gap: 10px; align-items: center; }
.muted-text { font-size: 12px; color: var(--ws-text-tertiary); font-weight: 400; }
.mono-text { font-family: var(--ws-font-mono); }

.info-grid { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.info-field { display: flex; flex-direction: column; gap: 4px; }
.info-field label { font-size: 12px; color: var(--ws-text-tertiary); }
.mono-input :deep(input) { font-family: var(--ws-font-mono); }

/* 流程画布 */
.flow-canvas { display: flex; align-items: center; overflow-x: auto; padding: 14px 4px; min-height: 80px; }
.flow-node { position: relative; min-width: 100px; padding: 8px 12px; border: 1.5px solid var(--ws-border);
  border-radius: 10px; background: var(--ws-bg-surface); cursor: pointer; flex-shrink: 0; text-align: center;
  transition: all .15s; user-select: none; }
.flow-node:hover { border-color: var(--ws-brand-500); transform: translateY(-1px); }
.flow-node.sel { border-color: var(--ws-brand-500); background: var(--ws-brand-50); }
.flow-node.approval { border-color: var(--ws-brand-500); }
.flow-node.watch { border-color: var(--ws-warning-100); }
.flow-name { display: block; font-size: 13px; font-weight: 600; color: var(--ws-text-primary); }
.flow-key { display: block; font-size: 10px; color: var(--ws-text-tertiary); margin-top: 2px;
  font-family: var(--ws-font-mono); }
.flow-seq { position: absolute; top: -8px; left: -8px; width: 18px; height: 18px; border-radius: 50%;
  background: var(--ws-bg-surface); border: 1.5px solid var(--ws-border); font-size: 10px; font-weight: 700;
  color: var(--ws-text-tertiary); display: flex; align-items: center; justify-content: center; }
.watchdog-badge { position: absolute; bottom: -8px; left: -8px; font-size: 10px; background: var(--ws-warning-500);
  color: #fff; border-radius: 8px; padding: 0 5px; font-weight: 600; }
.flow-slot { position: relative; width: 40px; height: 2px; flex-shrink: 0; display: flex; align-items: center; cursor: pointer; }
.flow-arrow { width: 40px; height: 2px; background: var(--ws-gray-300); }
.flow-plus { position: absolute; width: 18px; height: 18px; border-radius: 50%; background: var(--ws-bg-surface);
  color: var(--ws-text-tertiary); font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-weight: 600; border: 1.5px dashed; }
.flow-plus:hover { border-color: var(--ws-brand-500); color: var(--ws-brand-500); }
.node-del { position: absolute; top: -8px; right: -8px; width: 18px; height: 18px; border-radius: 50%;
  background: var(--ws-error-500); color: #fff; border: none; font-size: 11px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .15s; }
.flow-node:hover .node-del { opacity: 1; }

/* 抽屉内的节点配置 */
.node-config-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.config-field { display: flex; flex-direction: column; gap: 4px; }
.config-field label { font-size: 12px; color: var(--ws-text-tertiary); }
.empty-hint { padding: 24px; text-align: center; color: var(--ws-text-tertiary); font-size: 13px; }

/* 变量表单与 chips */
.var-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.var-chip { font-size: 11px; background: var(--ws-bg-subtle); color: var(--ws-text-secondary);
  border-radius: 4px; padding: 2px 8px; cursor: pointer; font-family: var(--ws-font-mono); }
.var-chip:hover { background: var(--ws-brand-50); color: var(--ws-brand-500); }
</style>
