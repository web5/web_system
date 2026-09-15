<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineTemplateApi,
  pipelineStepApi,
  pipelineVarApi,
  pipelineApi,
  deployApi,
  type PipelineTemplate,
  type PipelineVar,
  type TemplateNode,
  PLATFORM_NODE_KEYS,
} from '@/api'
import UserSelect from '@web-system/ui/components/UserSelect.vue'
import type { UserSelectLoadResult } from '@web-system/ui/components/UserSelect.types'
import StageActionsEditor, { type EditorItem } from '@/components/pipeline/StageActionsEditor.vue'
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
  const r = await pipelineApi.approvers()
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

// ── 变量（本条流水线）──
const vars = ref<PipelineVar[]>([])
const varForm = ref({ id: '', key: '', value: '', isSecret: false, description: '' })
const varSaving = ref(false)
const editingVar = computed(() => !!varForm.value.id)

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

    tpl.value = await pipelineTemplateApi.list().then(
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
      const created = await pipelineTemplateApi.create({
        ...dto,
        key: metaDraft.value.key,
        moduleKey: metaDraft.value.moduleKey,
      } as any)
      dirty.value = false
      message.success('流水线已创建，key 已锁定')
      router.replace({ name: 'PipelineEdit', params: { id: created.id } })
      await load()
    } else {
      await pipelineTemplateApi.update(tplId.value, dto)
      dirty.value = false
      message.success('流水线已保存')
      await load()
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
        await pipelineTemplateApi.remove(tplId.value)
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

function resetVarForm() {
  varForm.value = { id: '', key: '', value: '', isSecret: false, description: '' }
}

function editVar(v: PipelineVar) {
  varForm.value = {
    id: v.id,
    key: v.key,
    value: '',
    isSecret: !!v.isSecret,
    description: v.description || '',
  }
}

async function submitVar() {
  const f = varForm.value
  if (!f.key.trim()) { message.warning('变量键必填'); return }
  varSaving.value = true
  try {
    if (f.id) {
      await pipelineVarApi.update(f.id, {
        key: f.key.trim(),
        // 密钥留空 = 不更新（后端语义）
        ...(f.value ? { value: f.value } : {}),
        isSecret: f.isSecret,
        description: f.description,
      })
    } else {
      await pipelineVarApi.create(tplId.value, {
        key: f.key.trim(),
        value: f.value,
        isSecret: f.isSecret,
        description: f.description,
      })
    }
    resetVarForm()
    await loadVars()
    message.success('变量已保存')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存变量失败')
  } finally {
    varSaving.value = false
  }
}

function removeVar(v: PipelineVar) {
  Modal.confirm({
    title: `删除变量「${v.key}」`,
    content: '删除后节点脚本里的 ${' + v.key + '} 会取不到值。确认删除？',
    okText: '确认删除',
    okType: 'danger',
    onOk: async () => {
      try {
        await pipelineVarApi.remove(v.id)
        await loadVars()
        message.success('变量已删除')
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

// ── 参数（只读，写脚本时查阅）──
/** 平台注入的内置变量（引擎侧固定注入，不可改） */
const BUILTIN_VARS = [
  { key: 'RELEASE_DIR', desc: '发布根目录（目标机上的代码根）' },
  { key: 'MODULE_KEY', desc: '当前模块 key' },
  { key: 'MODULE_DIR', desc: '模块在仓库里的目录名' },
  { key: 'MODULE_TYPE', desc: '模块类型（frontend / micro-frontend / backend）' },
  { key: 'BRANCH', desc: '本次发布的分支' },
  { key: 'COMMIT_ID', desc: '本次发布的 commit（也是版本号）' },
  { key: 'STAGE', desc: '当前节点 key' },
  { key: 'DEPLOY_ENV', desc: '目标环境（local / dev / prod）' },
]

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

    <!-- 基本信息 -->
    <a-card size="small" title="基本信息" style="margin-bottom: 16px;">
      <template #extra>
        <span class="muted-text">命令归属本流水线后，key 是产物命名空间的一段路径</span>
      </template>
      <div class="info-grid">
        <div class="info-field">
          <label>流水线名</label>
          <a-input v-model:value="metaDraft.name" style="width: 200px;" @change="dirty = true" />
        </div>
        <div class="info-field">
          <label>流水线 key（slug）</label>
          <a-input
            v-model:value="metaDraft.key"
            :disabled="!isCreate"
            style="width: 160px;"
            class="mono-input"
            @change="dirty = true"
          />
          <span v-if="!isCreate" class="muted-text">已保存，不可修改</span>
        </div>
        <div class="info-field">
          <label>适用模块</label>
          <a-select
            v-if="isCreate"
            v-model:value="metaDraft.moduleKey"
            style="width: 180px;"
            @change="dirty = true"
          >
            <a-select-option value="*">全部模块（全局）</a-select-option>
            <a-select-option v-for="m in modules" :key="m.key" :value="m.key">
              {{ m.name }}（{{ m.type }}）
            </a-select-option>
          </a-select>
          <div v-else class="mono-text">
            {{ metaDraft.moduleKey === '*' ? '全部模块（全局）' : metaDraft.moduleKey }}
          </div>
        </div>
        <div class="info-field">
          <label>环境</label>
          <a-select v-model:value="metaDraft.env" style="width: 170px;" @change="dirty = true">
            <a-select-option v-for="e in ENV_OPTIONS" :key="e.value" :value="e.value">{{ e.label }}</a-select-option>
          </a-select>
        </div>
        <div class="info-field">
          <label>启用</label>
          <a-switch v-model:checked="metaDraft.enabled" @change="dirty = true" />
        </div>
        <div class="info-field">
          <label>审批</label>
          <a-radio-group v-model:value="metaDraft.approval" button-style="solid" size="small" @change="dirty = true">
            <a-radio-button value="inherit">继承环境</a-radio-button>
            <a-radio-button value="always">始终</a-radio-button>
            <a-radio-button value="never">从不</a-radio-button>
          </a-radio-group>
        </div>
        <div class="info-field">
          <label>失败回滚</label>
          <a-radio-group v-model:value="metaDraft.rollbackOnFailure" button-style="solid" size="small" @change="dirty = true">
            <a-radio-button value="previous">回滚上一版本</a-radio-button>
            <a-radio-button value="none">不回滚</a-radio-button>
          </a-radio-group>
        </div>
        <div class="info-field">
          <label>投递目标</label>
          <a-radio-group v-model:value="metaDraft.defaultTarget" button-style="solid" size="small" @change="dirty = true">
            <a-radio-button value="auto">自动</a-radio-button>
            <a-radio-button value="local">本机</a-radio-button>
            <a-radio-button value="remote">远程</a-radio-button>
          </a-radio-group>
        </div>
        <div class="info-field" style="min-width: 320px; flex: 1;">
          <label>审批人（不选 = 所有持权限者）</label>
          <UserSelect
            v-model="metaDraft.approvers"
            :load="loadApprovers"
            degraded-text="未获取到可审批人名单：任何能登录控制台的人都能审批"
            placeholder="选择可审批的人"
            @change="dirty = true"
          />
        </div>
      </div>
      <a-alert type="info" show-icon style="margin-top: 14px;">
        <template #message>
          变量属于本条流水线：写脚本时用 <span class="mono-text">${'{'}KEY{'}'}</span> 引用；
          点任意节点在右侧抽屉可随时切「变量 / 参数」查键名。
        </template>
      </a-alert>
    </a-card>

    <!-- 流程编排 -->
    <a-card size="small" style="margin-bottom: 16px;">
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
      </div>
    </a-card>
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
            <div v-if="selectedNode.kind === 'approval'" class="config-field">
              <label>说明</label>
              <span class="muted-text">审批节点：执行到它挂起流水线等人工决议（审批人 / 超时动作）</span>
            </div>
            <!--
              节点「策略」（optional / watchdog）先不上（用户 2026-09-15：小特性后续有需要再加）——
              已配过的值仍在节点数据里保留，只是不给 UI 入口。
            -->
          </div>

          <div v-if="isCreate" class="empty-hint" style="margin-top: 12px;">
            新建态：先「创建」流水线，再回来配节点脚本（命令按流水线落库）
          </div>
          <div v-else style="margin-top: 12px;">
            <StageActionsEditor
              v-if="editingItem"
              :template-id="tplId"
              :item="editingItem"
              :simple="true"
              @saved="() => { if (selNodeKey) void loadNodeScript(selNodeKey) }"
              @cancel="editingItem = null"
            />
            <a-empty v-else :description="`读取 ${selectedNode.key} 命令中…`" />
          </div>
        </template>
        <div v-else class="empty-hint">
          点画布上的节点来配置：节点名 / key / 策略 + 脚本与操作序列
        </div>
      </a-tab-pane>

      <!-- Tab 2：变量（本条流水线，可增删改） -->
      <a-tab-pane key="vars" tab="变量">
        <div v-if="isCreate" class="empty-hint">新建态：先「创建」流水线，再配变量</div>
        <template v-else>
          <div class="var-form">
            <a-input v-model:value="varForm.key" placeholder="键（如 PUBLISH_PATH）" style="width: 190px;" size="small" />
            <a-input
              v-model:value="varForm.value"
              :placeholder="editingVar ? '值（留空 = 不更新，密钥不回显）' : '值'"
              style="width: 240px;"
              size="small"
            />
            <a-input v-model:value="varForm.description" placeholder="说明" style="width: 160px;" size="small" />
            <a-checkbox v-model:checked="varForm.isSecret">密钥</a-checkbox>
            <a-button type="primary" size="small" :loading="varSaving" @click="submitVar">
              {{ editingVar ? '保存' : '添加' }}
            </a-button>
            <a-button v-if="editingVar" size="small" @click="resetVarForm">取消</a-button>
          </div>

          <a-table
            :data-source="vars"
            :pagination="false"
            size="small"
            row-key="id"
            style="margin-top: 12px;"
          >
            <a-table-column title="键" data-index="key" :width="190">
              <template #default="{ record }"><span class="mono-text">{{ record.key }}</span></template>
            </a-table-column>
            <a-table-column title="值" :width="180">
              <template #default="{ record }">
                <span class="mono-text">{{ record.isSecret ? '********' : record.value }}</span>
              </template>
            </a-table-column>
            <a-table-column title="说明" data-index="description" />
            <a-table-column title="密钥" :width="70">
              <template #default="{ record }">
                <a-tag :color="record.isSecret ? 'orange' : 'default'">{{ record.isSecret ? '是' : '否' }}</a-tag>
              </template>
            </a-table-column>
            <a-table-column title="操作" :width="120">
              <template #default="{ record }">
                <a @click="editVar(record)">编辑</a>
                <a-divider type="vertical" />
                <a style="color: var(--ws-error-500);" @click="removeVar(record)">删除</a>
              </template>
            </a-table-column>
            <template #emptyText>
              <div class="empty-hint">未定义变量 · 节点脚本里的 ${'{'}KEY{'}'} 会取不到值</div>
            </template>
          </a-table>
          <div class="muted-text" style="margin-top: 10px;">
            变量属于本条流水线（不单独成页）；密钥只写入不回显，留空保存 = 不更新。
          </div>
        </template>
      </a-tab-pane>

      <!-- Tab 3：参数（只读，写脚本时查阅） -->
      <a-tab-pane key="params" tab="参数">
        <div class="muted-text" style="margin-bottom: 8px;">
          注入优先级（后者覆盖前者）：平台内置 → 配置中心 → 流水线变量 → 节点内联
        </div>
        <a-table :data-source="BUILTIN_VARS" :pagination="false" size="small" row-key="key">
          <a-table-column title="内置变量" data-index="key" :width="190">
            <template #default="{ record }">
              <span class="var-chip" @click="insertVar('${' + record.key + '}')">{{ record.key }}</span>
            </template>
          </a-table-column>
          <a-table-column title="说明" data-index="desc" />
        </a-table>

        <div class="t" style="margin: 16px 0 8px; font-weight: 600;">本条流水线的变量</div>
        <a-table :data-source="vars" :pagination="false" size="small" row-key="id">
          <a-table-column title="键" data-index="key" :width="190">
            <template #default="{ record }">
              <span class="var-chip" @click="insertVar('${' + record.key + '}')">{{ record.key }}</span>
            </template>
          </a-table-column>
          <a-table-column title="当前值" :width="200">
            <template #default="{ record }">
              <span class="mono-text">{{ record.isSecret ? '********' : record.value }}</span>
            </template>
          </a-table-column>
          <a-table-column title="说明" data-index="description" />
          <template #emptyText>
            <div class="empty-hint">还没有变量 · 去「变量」Tab 添加</div>
          </template>
        </a-table>
        <div class="muted-text" style="margin-top: 10px;">
          点键名可直接插入到当前节点的脚本末尾（${'{'}KEY{'}'} 形式）。
        </div>
      </a-tab-pane>
    </a-tabs>
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
