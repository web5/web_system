<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineTemplateApi,
  pipelineStepApi,
  deployApi,
  type PipelineTemplate,
  type TemplateNode,
  PLATFORM_NODE_KEYS,
  PLATFORM_NODE_LABELS,
} from '@/api'
import StageActionsEditor, { type EditorItem } from '@/components/pipeline/StageActionsEditor.vue'

const route = useRoute()
const router = useRouter()
const tplId = computed(() => String(route.params.id || ''))

const tpl = ref<PipelineTemplate | null>(null)
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)

// ── 基本信息 ──
const metaDraft = ref({
  name: '',
  key: '',
  description: '',
  enabled: true,
  approval: 'inherit' as 'inherit' | 'always' | 'never',
  rollbackOnFailure: 'previous' as 'previous' | 'none',
})

// ── 节点编排 ──
const nodeDraft = ref<TemplateNode[]>([])
const selNodeKey = ref('')
const editingItem = ref<EditorItem | null>(null)
const dragKey = ref('')
const dropSide = ref<'l' | 'r'>('r')
let justDragged = false

// ── 模块预览 ──
const modules = ref<{ key: string; name: string; type: string }[]>([])
const previewModule = ref('')

const isPlatformNode = (key: string) => (PLATFORM_NODE_KEYS as readonly string[]).includes(key)

async function load() {
  loading.value = true
  try {
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
      description: tpl.value.description || '',
      enabled: tpl.value.enabled,
      approval: tpl.value.approval,
      rollbackOnFailure: tpl.value.rollbackOnFailure || 'previous',
    }
    // nodes 草稿（旧模板无 nodes → 预转存）
    nodeDraft.value =
      tpl.value.nodes && tpl.value.nodes.length
        ? JSON.parse(JSON.stringify(tpl.value.nodes))
        : legacyToNodes()
    selNodeKey.value = ''
    editingItem.value = null
    dirty.value = false
    // 加载模块列表（按模块预览用）
    try {
      const mods = await deployApi.modules()
      modules.value = (mods as any[]).filter((m) =>
        ['backend', 'frontend', 'micro-frontend'].includes(m.type),
      )
      if (modules.value.length) previewModule.value = modules.value[0].key
    } catch {
      modules.value = []
    }
  } catch {
    message.error('加载流水线失败')
  } finally {
    loading.value = false
  }
}

function legacyToNodes(): TemplateNode[] {
  const base = (tpl.value?.steps ?? null)?.length
    ? (tpl.value!.steps as string[])
    : ['check', 'pull', 'build', 'upload', 'restart', 'version', 'pointer', 'verify', 'cleanup']
  const nodes: TemplateNode[] = [{ kind: 'platform', key: 'git' }]
  for (const s of base) {
    if (s === 'pull' || s === 'git') continue
    if (s === 'version') { nodes.push({ kind: 'platform', key: 'version' }); continue }
    if (s === 'pointer') { nodes.push({ kind: 'platform', key: 'pointer' }); continue }
    if (s === 'verify' && tpl.value?.skipVerify) continue
    nodes.push({
      kind: 'script',
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
const selectedNode = computed(() => {
  const n = nodeOf(selNodeKey.value)
  return n && n.kind === 'script' ? n : null
})

function onNodeClick(key: string) {
  if (justDragged) return
  if (isPlatformNode(key)) {
    message.warning('git / 写版本号（version/pointer）是发布语义真相源，平台托管，不可编辑')
    return
  }
  selNodeKey.value = key
  void loadNodeScript(key)
}

async function loadNodeScript(key: string) {
  try {
    const row = await pipelineStepApi.get(tplId.value, key)
    editingItem.value = {
      stage: key,
      source: row?.command?.trim() || row?.actions?.length ? 'configured' : 'required-unset',
      command: row?.command ?? null,
      actions: row?.actions ?? [],
      enabled: !!row?.enabled,
      timeoutSec: row?.timeoutSec ?? null,
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
  nodeDraft.value.splice(slot, 0, { kind: 'script', key: k, label: '新节点', optional: false })
  selNodeKey.value = k
  editingItem.value = null
  dirty.value = true
  void loadNodeScript(k)
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

function toggleOptional(key: string, on: boolean) {
  const n = nodeOf(key)
  if (n) { n.optional = on; dirty.value = true }
}

function toggleWatchdog(key: string, on: boolean) {
  nodeDraft.value.forEach((x) => {
    if (x.kind === 'script') x.watchdog = false
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
  if (!keys.includes('git')) return '「git」必须保留'
  if (keys.indexOf('version') > keys.indexOf('pointer')) return '「version」必须排在「pointer」之前'
  if (new Set(keys).size !== keys.length) return '节点 key 不能重复'
  return ''
}

async function save() {
  const err = nodesError()
  if (err) { message.warning(err); return }
  saving.value = true
  try {
    await pipelineTemplateApi.update(tplId.value, {
      name: metaDraft.value.name,
      key: metaDraft.value.key,
      description: metaDraft.value.description,
      enabled: metaDraft.value.enabled,
      approval: metaDraft.value.approval,
      rollbackOnFailure: metaDraft.value.rollbackOnFailure,
      nodes: nodeDraft.value,
    } as any)
    dirty.value = false
    message.success('流水线已保存')
    router.push({ name: 'PipelineDetail', params: { id: tplId.value } })
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (dirty.value) {
    Modal.confirm({
      title: '放弃修改？',
      content: '当前编辑内容尚未保存，离开后将丢失。',
      okText: '放弃修改',
      okType: 'danger',
      cancelText: '继续编辑',
      onOk: () => router.push({ name: 'PipelineDetail', params: { id: tplId.value } }),
    })
  } else {
    router.push({ name: 'PipelineDetail', params: { id: tplId.value } })
  }
}

// ── 变量预览 ──
const VARS = ['{MODULE_KEY}', '{MODULE_TYPE}', '{MODULE_DIR}', '{RELEASE_DIR}', '{BRANCH}', '{COMMIT_ID}', '{STAGE}', '{DEPLOY_ENV}']
const previewOut = ref('')

function insertVar(v: string) {
  const item = editingItem.value
  if (!item?.actions?.length) { message.warning('请先添加一个 shell 操作'); return }
  const shell = item.actions.find((a) => a.type === 'shell')
  if (shell) { shell.code = (shell.code || '') + v; dirty.value = true }
}

function renderPreview() {
  const item = editingItem.value
  if (!item?.actions?.length) { previewOut.value = '（无 shell 操作可预览）'; return }
  const shell = item.actions.find((a) => a.type === 'shell')
  if (!shell?.code) { previewOut.value = '（无 shell 操作可预览）'; return }
  const m = modules.value.find((x) => x.key === previewModule.value)
  previewOut.value = `# ${(m?.name || previewModule.value)} · ${selNodeKey.value}\n${shell.code}`
    .replace(/\{MODULE_KEY\}/g, m?.key || 'admin')
    .replace(/\{MODULE_TYPE\}/g, m?.type || 'micro-frontend')
    .replace(/\{MODULE_DIR\}/g, 'apps/admin')
    .replace(/\{RELEASE_DIR\}/g, '/Users/geekwen/web_system_release')
    .replace(/\{BRANCH\}/g, 'feature/x')
    .replace(/\{COMMIT_ID\}/g, 'abc1234')
    .replace(/\{STAGE\}/g, selNodeKey.value)
    .replace(/\{DEPLOY_ENV\}/g, 'local')
}

onMounted(() => { void load() })
</script>

<template>
  <div v-if="!loading && tpl">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <a-breadcrumb style="margin-bottom: 8px">
          <a-breadcrumb-item>
            <router-link :to="{ name: 'PipelineCenter' }">流水线</router-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item>
            <router-link :to="{ name: 'PipelineDetail', params: { id: tplId } }">{{ tpl.name }}</router-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item>编辑</a-breadcrumb-item>
        </a-breadcrumb>
        <h1 class="page-title">
          {{ metaDraft.name }}
          <a-tag v-if="tpl.builtin" color="purple">内置 · 不可改名</a-tag>
        </h1>
        <div class="page-sub">编辑流水线 · 定义态（基本信息 / 流程编排 / 节点命令）· 未保存离开会确认</div>
      </div>
      <div class="page-actions">
        <a-tooltip v-if="tpl.builtin" title="内置默认流水线不可删除">
          <a-button danger disabled>删除流水线</a-button>
        </a-tooltip>
        <a-button v-else danger @click="message.info('删除流水线（原型演示）')">删除流水线</a-button>
        <a-button @click="goBack">取消</a-button>
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
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
          <a-input v-model:value="metaDraft.name" :disabled="tpl.builtin" style="width: 200px;" @change="dirty = true" />
        </div>
        <div class="info-field">
          <label>流水线 key（slug）</label>
          <a-input v-model:value="metaDraft.key" style="width: 160px;" class="mono-input" @change="dirty = true" />
        </div>
        <div class="info-field">
          <label>适用模块</label>
          <div>{{ tpl.moduleKey === '*' ? '全部模块（全局流水线）' : tpl.moduleKey }}</div>
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
      </div>
      <a-alert type="info" show-icon style="margin-top: 14px;">
        <template #message>
          产物路径 = 模块 × 流水线 key × 版本：
          <span class="mono-text">modules/admin/{{ metaDraft.key }}/1a2b3c4/</span>
          <br />全局线服务多模块时，命令差异用 <b>{'{MODULE_*}'}</b> 变量表达；差异大就「复制为专用线」。
        </template>
      </a-alert>
    </a-card>

    <!-- 流程编排 -->
    <a-card size="small" style="margin-bottom: 16px;">
      <template #title>
        流程编排
        <span class="muted-text" style="margin-left: 8px;">platform 锁定不可增删 · script 可增删、配命令</span>
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
            :class="{ plat: n.kind === 'platform', watch: n.watchdog, sel: selNodeKey === n.key }"
            :draggable="n.kind !== 'platform'"
            @click="onNodeClick(n.key)"
            @dragstart="onDragStart(n.key, $event)"
            @dragend="onDragEnd"
            @dragover="onDragOver($event)"
            @drop="onDrop(n.key, $event)"
          >
            <span class="flow-seq">{{ i + 1 }}</span>
            <span v-if="n.watchdog" class="watchdog-badge">wd</span>
            <button
              v-if="n.kind === 'script'"
              class="node-del"
              @click.stop="askDeleteNode(n.key)"
            >×</button>
            <span class="flow-name">{{ n.label || PLATFORM_NODE_LABELS[n.key] || n.key }}</span>
            <span class="flow-key">{{ n.kind === 'platform' ? (PLATFORM_NODE_LABELS[n.key] ? n.key : n.key) : n.key }}</span>
          </div>
        </template>
      </div>
      <div class="muted-text" style="margin-top: 8px;">
        点 script 节点在下方「节点命令」配置；点连接线「+」在槽位插入节点；拖拽 script 节点重排。
      </div>
    </a-card>

    <!-- 节点命令 -->
    <a-card size="small">
      <template #title>
        节点命令
        <span v-if="selectedNode" class="muted-text" style="margin-left: 8px;">· 当前：{{ selectedNode.label }}（{{ selectedNode.key }}）</span>
      </template>
      <div v-if="!selectedNode" class="empty-hint">点击上方任意 script 节点配置其命令；platform 节点不可编辑</div>
      <template v-else>
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
          <div class="config-field">
            <label>策略</label>
            <a-checkbox
              :checked="!!selectedNode.optional"
              @change="(e: any) => toggleOptional(selectedNode!.key, e.target.checked)"
            >optional（未配命令时跳过）</a-checkbox>
            <a-checkbox
              :checked="!!selectedNode.watchdog"
              style="margin-left: 16px;"
              @change="(e: any) => toggleWatchdog(selectedNode!.key, e.target.checked)"
            >watchdog（失败自动回滚）</a-checkbox>
          </div>
        </div>

        <div v-if="tpl" style="margin-top: 12px;">
          <StageActionsEditor
            v-if="editingItem"
            :template-id="tpl.id"
            :item="editingItem"
            @saved="() => { if (selNodeKey) void loadNodeScript(selNodeKey) }"
            @cancel="editingItem = null"
          />
          <a-empty v-else :description="`读取 流水线 × ${selectedNode.key} 命令中…`" />
        </div>

        <!-- 变量预览 -->
        <div class="var-section">
          <div class="muted-text" style="margin-bottom: 6px;">可用变量（全局线服务多模块时用它表达模块差异）</div>
          <div class="var-chips">
            <span v-for="v in VARS" :key="v" class="var-chip" @click="insertVar(v)">{{ v }}</span>
          </div>
          <div style="display: flex; align-items: flex-end; gap: 12px; margin-top: 8px;">
            <div class="config-field">
              <label>按模块预览替换结果</label>
              <a-select v-model:value="previewModule" style="width: 200px;" size="small" @change="renderPreview">
                <a-select-option v-for="m in modules" :key="m.key" :value="m.key">
                  {{ m.name }}（{{ m.type }}）
                </a-select-option>
              </a-select>
            </div>
            <a-button size="small" @click="renderPreview">刷新预览</a-button>
          </div>
          <pre v-if="previewOut" class="preview-code">{{ previewOut }}</pre>
        </div>
      </template>
    </a-card>
  </div>
  <div v-else style="padding: 100px; text-align: center;">
    <a-spin size="large" />
  </div>
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
.flow-node.plat { border-color: var(--ws-purple-100); background: var(--ws-purple-50); }
.flow-node.watch { border-color: var(--ws-warning-100); }
.flow-name { display: block; font-size: 13px; font-weight: 600; color: var(--ws-text-primary); }
.flow-node.plat .flow-name { color: #722ED1; }
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
  border: 1.5px dashed var(--ws-gray-400); color: var(--ws-text-tertiary); font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-weight: 600; border: 1.5px dashed; background: none; }
.flow-plus:hover { border-color: var(--ws-brand-500); color: var(--ws-brand-500); }
.node-del { position: absolute; top: -8px; right: -8px; width: 18px; height: 18px; border-radius: 50%;
  background: var(--ws-error-500); color: #fff; border: none; font-size: 11px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .15s; }
.flow-node:hover .node-del { opacity: 1; }

/* 节点配置 */
.node-config-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.config-field { display: flex; flex-direction: column; gap: 4px; }
.config-field label { font-size: 12px; color: var(--ws-text-tertiary); }
.empty-hint { padding: 24px; text-align: center; color: var(--ws-text-tertiary); font-size: 13px; }

/* 变量预览 */
.var-section { margin-top: 16px; border-top: 1px dashed var(--ws-border-subtle); padding-top: 12px; }
.var-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.var-chip { font-size: 11px; background: var(--ws-bg-subtle); color: var(--ws-text-secondary);
  border-radius: 4px; padding: 2px 8px; cursor: pointer; font-family: var(--ws-font-mono); }
.var-chip:hover { background: var(--ws-brand-50); color: var(--ws-brand-500); }
.preview-code { background: #1E1E1E; color: #D4D4D4; border-radius: 8px; padding: 10px 12px;
  font-family: var(--ws-font-mono); font-size: 12px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-all; margin-top: 8px; }
</style>
