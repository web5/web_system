<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  moduleApi,
  deployApi,
  environmentApi,
  serverApi,
  stageCommandApi,
  pipelineApi,
  pipelineTemplateApi,
  type StageAction,
} from '@/api'
import PipelineSubmit from '@/components/PipelineSubmit.vue'

const route = useRoute()
const router = useRouter()
const moduleKey = computed(() => String(route.params.key || ''))

const moduleInfo = ref<any>(null)
const moduleLoading = ref(false)

const data = ref<{
  environments: any[]
  versionHistory: any[]
} | null>(null)
const dataLoading = ref(false)

const TYPE_LABELS: Record<string, string> = {
  backend: '后端服务',
  frontend: '前端模块',
  'micro-frontend': '微前端模块',
  'mini-app': '小程序',
}

const SOURCE_LABELS: Record<string, { label: string; color: string; tip: string }> = {
  // 模块已配置 shell（真相源在 DB）
  configured: { label: '模块脚本', color: 'blue', tip: '本模块在「阶段命令」表中自定义了 shell，发布时执行' },
  // 流程内置兜底（未配置）
  builtin: { label: '流程内置', color: 'default', tip: '未配置 shell，将由流水线内置逻辑兜底' },
  // 必填阶段未配置（=发布终止）
  'required-unset': {
    label: '必填·未配置',
    color: 'red',
    tip: 'build 阶段必须配置 shell，未配置 = 发布立即终止',
  },
  // 语义真相源（不允许用户改）
  semantic: { label: '语义真相源', color: 'purple', tip: '由流水线固定执行（version/pointer），不允许改' },
}

// 后端模块 → 后台 tab，前端模块 → 前端 tab
const showBackendTab = computed(() => moduleInfo.value?.type === 'backend')
const showFrontendTab = computed(() =>
  ['frontend', 'micro-frontend', 'mini-app'].includes(moduleInfo.value?.type),
)
// 所有可发布模块（backend/frontend/micro-frontend）都展示「发布脚本」Tab
const showScriptTab = computed(() =>
  ['backend', 'frontend', 'micro-frontend'].includes(moduleInfo.value?.type),
)
// 默认激活的 tab
const activeTab = ref<string>('')

// 默认展开哪几个阶段：build/release/verify 等常调的核心阶段默认展开，让运维不用挨个点
const expandedStages = ref<Record<string, boolean>>({})
function toggleStep(stage: string) {
  expandedStages.value[stage] = !expandedStages.value[stage]
}

// ===== 发布脚本（9 阶段流水线视图） =====
type ScriptViewItem = {
  stage: string
  source: 'configured' | 'builtin' | 'required-unset' | 'semantic'
  command: string | null
  enabled: boolean
  timeoutSec: number | null
  updatedAt: string | null
  updatedBy: string | null
  title: string
  builtin: string
  commandMode: 'base' | 'required' | 'override' | 'none'
  /** v4 多操作；单命令形态后端已包装成 1 个操作 */
  actions?: StageAction[]
}
const scriptView = ref<ScriptViewItem[]>([])
const scriptLoading = ref(false)
async function loadScriptView() {
  if (!showScriptTab.value) return
  scriptLoading.value = true
  try {
    scriptView.value = await stageCommandApi.scriptView(moduleKey.value)
    // 默认展开核心阶段（build/pull/verify）；让运维一进 Tab 就能看到「最重要的命令」
    // 而不必挨个点击。其余阶段按需展开。
    expandedStages.value = {
      pull: true,
      build: true,
      verify: true,
      cleanup: true,
    }
  } catch {
    // 静默：脚本视图是只读辅助，挂了不阻断模块详情
  } finally {
    scriptLoading.value = false
  }
}
function copyCmd(cmd: string) {
  // navigator.clipboard 在 https/local 才可用；可用范围外回退提示
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(cmd)
      .then(() => message.success('已复制'))
      .catch(() => message.warning('复制失败，请手动选择'))
  } else {
    message.warning('当前环境不支持剪贴板，请手动选择')
  }
}

async function loadModule() {
  moduleLoading.value = true
  try {
    moduleInfo.value = await moduleApi.get(moduleKey.value)
    activeTab.value = showBackendTab.value ? 'backend' : 'frontend'
  } catch {
    message.error('加载模块详情失败')
  } finally {
    moduleLoading.value = false
  }
}

async function loadDeployments() {
  dataLoading.value = true
  try {
    data.value = await deployApi.moduleDeployments(moduleKey.value)
  } catch {
    message.error('加载部署数据失败')
  } finally {
    dataLoading.value = false
  }
}

// ===== 发起发布（按流水线：构建 + 投递 + 切指针 + 探活） =====
const publishOpen = ref(false)
function openPublish() {
  publishOpen.value = true
}
async function onPublished() {
  await loadDeployments()
}

// ===== 回滚 = 以该版本 commit 重新走流水线发布（重建到旧版本代码） =====
const rollbacking = ref(false)
async function doRollback(row: any) {
  rollbacking.value = true
  try {
    const tpls = await pipelineTemplateApi.list(moduleKey.value)
    if (!tpls.length) {
      message.error('该模块没有可用流水线，无法发起回滚发布')
      return
    }
    const templateId = tpls[0].id
    const res = await pipelineApi.submit({
      env: row.env,
      moduleKey: moduleKey.value,
      commitId: row.versionTag,
      mode: 'direct',
      templateId,
      confirm: row.env === 'prod',
    })
    message.success(`已提交回滚发布（${(res as any).jobId}），将以 ${row.versionTag} 重新构建部署`)
    await loadDeployments()
    // 流水线异步执行，稍后自动刷新一次拿最新状态
    setTimeout(() => void loadDeployments(), 3000)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '回滚发布提交失败')
  } finally {
    rollbacking.value = false
  }
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('zh-CN')
}

// ===== 服务环境（backend 模块：各环境服务地址 + 服务器组；原「服务管理」能力已并入） =====
const svcLoading = ref(false)
const envList = ref<any[]>([])
const serverNameOptions = ref<string[]>([])
const svcOverview = ref<any | null>(null)

async function loadServiceEnv() {
  if (moduleInfo.value?.type !== 'backend') return
  svcLoading.value = true
  try {
    const [rows, envs, servers] = await Promise.all([
      serverApi.serviceOverview(),
      environmentApi.list(),
      serverApi.listServers(),
    ])
    envList.value = envs
    serverNameOptions.value = Array.from(new Set(servers.map((s: any) => s.serverName)))
    svcOverview.value = rows.find((r: any) => r.serviceName === moduleKey.value) || {
      serviceName: moduleKey.value,
      serviceType: moduleInfo.value.type || 'backend',
      environments: envs.map((e: any) => ({ envId: e.id, address: '', serverName: '', port: undefined })),
    }
  } catch {
    message.error('加载服务环境失败')
  } finally {
    svcLoading.value = false
  }
}

function svcEnvName(envId: string): string {
  const e = envList.value.find((x) => x.id === envId)
  return e ? `${e.name}（${e.id}）` : envId
}

async function saveAddress(envRow: any, val: string) {
  const env = envList.value.find((e) => e.id === envRow.envId)
  if (!env) return
  const ports = { ...(env.ports || {}) }
  const trimmed = (val || '').trim()
  if (trimmed) {
    ports[moduleKey.value] = trimmed
  } else {
    delete ports[moduleKey.value]
  }
  try {
    await environmentApi.update(envRow.envId, { ports })
    message.success(`已更新 ${moduleKey.value}@${envRow.envId} 地址`)
    envRow.address = trimmed
    env.ports = ports
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存地址失败')
  }
}

async function saveServerName(envRow: any, val: string) {
  try {
    await serverApi.createRoute({
      envId: envRow.envId,
      serviceName: moduleKey.value,
      serverName: val || '',
      port: envRow.port,
    })
    message.success(`已更新 ${moduleKey.value}@${envRow.envId} 服务器组`)
    envRow.serverName = val || ''
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存服务器组失败')
  }
}

// ===== 阶段命令编辑（v4 多操作） =====
/** 正在编辑的阶段（空 = 未编辑） */
const editStage = ref('')
/** 编辑中的操作序列（深拷贝，避免污染只读视图） */
const draft = ref<StageAction[]>([])
/** 当前聚焦的操作下标 */
const actIdx = ref(0)
const saving = ref(false)

function startEdit(item: ScriptViewItem) {
  if (item.source === 'semantic') {
    message.warning('version / pointer 是发布语义真相源，不可编辑')
    return
  }
  editStage.value = item.stage
  actIdx.value = 0
  const acts = (item.actions || []) as StageAction[]
  // 单命令形态（后端已包装成 1 个操作）与多操作形态在此统一为可编辑序列
  draft.value = acts.length
    ? JSON.parse(JSON.stringify(acts))
    : [
        {
          id: 'a1',
          type: 'shell' as const,
          name: '主操作',
          code: item.command || '',
          timeoutSec: item.timeoutSec || undefined,
        },
      ]
}

function cancelEdit() {
  editStage.value = ''
  draft.value = []
  actIdx.value = 0
}

function addAction() {
  draft.value.push({
    id: `a${draft.value.length + 1}_${Date.now().toString(36)}`,
    type: 'shell',
    name: '新操作',
    code: '# 在此编写脚本',
    timeoutSec: 60,
    cont: false,
  })
  actIdx.value = draft.value.length - 1
}

function delAction(i: number) {
  if (draft.value[i]?.builtin) {
    message.warning('内置操作不可删除')
    return
  }
  draft.value.splice(i, 1)
  if (actIdx.value >= draft.value.length) actIdx.value = Math.max(0, draft.value.length - 1)
}

async function validateDraft() {
  const shells = draft.value.filter((a) => a.type === 'shell' && a.code?.trim())
  if (!shells.length) {
    message.warning('没有可校验的 shell 操作')
    return
  }
  try {
    for (const a of shells) {
      await stageCommandApi.validate(moduleKey.value, editStage.value, a.code as string)
    }
    message.success(`语法校验通过（${shells.length} 个 shell 操作）`)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '语法校验失败')
  }
}

async function saveDraft() {
  if (!draft.value.length) {
    message.warning('至少需要一个操作')
    return
  }
  if (draft.value.some((a) => !a.name?.trim())) {
    message.warning('每个操作都需要名称')
    return
  }
  if (new Set(draft.value.map((a) => a.id)).size !== draft.value.length) {
    message.warning('操作 id 不能重复')
    return
  }
  saving.value = true
  try {
    // 以 actions 数组整体提交；command 回填首个 shell 脚本（后端非空约束）
    const firstShell = draft.value.find((a) => a.type === 'shell' && a.code?.trim())
    await stageCommandApi.save(moduleKey.value, editStage.value, {
      actions: draft.value,
      command: firstShell?.code?.trim() || '',
    })
    message.success(`已保存（${draft.value.length} 个操作）`)
    cancelEdit()
    await loadScriptView()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadModule()
  await loadServiceEnv()
  await loadDeployments()
  // 脚本视图：依赖 moduleInfo.type（决定 showScriptTab），故放最后加载
  await loadScriptView()
})
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px;">
      <a-button type="link" @click="router.back()">← 返回</a-button>
      <h2 style="margin: 0;">模块详情</h2>
      <a-tag v-if="moduleInfo" color="blue">{{ moduleInfo.key }}</a-tag>
      <a-tag v-if="moduleInfo?.builtin" color="gold">内置</a-tag>
    </div>

    <!-- 模块元信息 -->
    <a-card v-if="moduleInfo" :loading="moduleLoading" style="margin-bottom: 16px;">
      <a-descriptions :column="3" size="small" bordered>
        <a-descriptions-item label="名称">{{ moduleInfo.name }}</a-descriptions-item>
        <a-descriptions-item label="类型">
          <a-tag>{{ TYPE_LABELS[moduleInfo.type] || moduleInfo.type }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="代码目录">{{ moduleInfo.dir }}</a-descriptions-item>
        <a-descriptions-item label="默认部署环境">
          {{ moduleInfo.defaultEnv || '—' }}
        </a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.pm2" label="pm2 进程">{{ moduleInfo.pm2 }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.publicPath" label="publicPath">{{ moduleInfo.publicPath }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.buildCmd" label="buildCmd">{{ moduleInfo.buildCmd }}</a-descriptions-item>
        <a-descriptions-item label="启用">
          <a-tag :color="moduleInfo.enabled !== false ? 'green' : 'default'">
            {{ moduleInfo.enabled !== false ? '启用' : '禁用' }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>
      <div style="margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <a-button type="primary" @click="openPublish">发起发布</a-button>
        <span style="color: #999; font-size: 12px;">
          按流水线发布：git 拉取 → 构建 → 投递 → 切指针 → 探活；需要先 commit &amp; push
        </span>
      </div>
    </a-card>

    <!-- 前端 / 后台 tab -->
    <a-card v-if="moduleInfo" :loading="dataLoading">
      <a-tabs v-model:active-key="activeTab">
        <!-- 后台 tab -->
        <a-tab-pane v-if="showBackendTab" key="backend" tab="后台">
          <h3 style="margin-bottom: 12px; font-size: 15px;">当前部署（环境 × 版本）</h3>
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
              { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion' },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '部署时间', dataIndex: 'deployedAt', key: 'deployedAt', width: 180 },
              { title: '部署人', dataIndex: 'deployedBy', key: 'deployedBy', width: 120 },
            ]"
            :data-source="data?.environments || []"
            :pagination="false"
            row-key="envId"
            size="small"
            :locale="{ emptyText: '该模块在所有环境均未部署' }"
          />

          <h3 style="margin: 24px 0 12px; font-size: 15px;">版本历史（可回滚）</h3>
          <a-table
            :columns="[
              { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 200 },
              { title: '环境', dataIndex: 'env', key: 'env', width: 100 },
              { title: 'git commit', dataIndex: 'gitCommit', key: 'gitCommit', width: 140 },
              { title: '发布时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 180 },
              { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '操作', key: 'action', width: 100 },
            ]"
            :data-source="data?.versionHistory || []"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无版本历史' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'releasedAt'">{{ fmtDate(record.releasedAt) }}</template>
              <template v-else-if="column.key === 'action'">
                <a-popconfirm
                  :title="`以 ${record.versionTag} 重新走流水线发布（回滚到该版本代码）？`"
                  ok-text="回滚发布"
                  cancel-text="取消"
                  :ok-button-props="{ loading: rollbacking }"
                  @confirm="doRollback(record)"
                >
                  <a-button type="link" size="small">回滚到此版本</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 服务环境 tab（backend 模块：各环境服务地址 + 服务器组） -->
        <a-tab-pane v-if="showBackendTab" key="service-env" tab="服务环境">
          <a-card :loading="svcLoading" :bordered="false" size="small">
            <p style="color: #666; margin-bottom: 12px;">
              该服务在所有环境的「服务环境」。环境在「环境管理」中增删，此处自动同步列出；逐个编辑服务地址（ip:端口）和服务器组。
            </p>
            <a-table
              :columns="[
                { title: '环境', dataIndex: 'envId', key: 'envId', width: 200 },
                { title: '服务地址（ip:端口）', key: 'address', width: 360 },
                { title: '服务器组', key: 'serverName', width: 260 },
              ]"
              :data-source="svcOverview?.environments || []"
              :pagination="false"
              :row-key="(r: any) => r.envId"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'envId'">
                  {{ svcEnvName(record.envId) }}
                </template>
                <template v-else-if="column.key === 'address'">
                  <a-input
                    :value="record.address"
                    placeholder="如 127.0.0.1:6000 或 dev.kedouai.com"
                    style="width: 320px;"
                    @press-enter="(e: any) => saveAddress(record, e.target.value)"
                    @blur="(e: any) => { const v = e.target.value; if (v !== record.address) saveAddress(record, v) }"
                  />
                </template>
                <template v-else-if="column.key === 'serverName'">
                  <a-select
                    :value="record.serverName || undefined"
                    placeholder="选择服务器组"
                    allow-clear
                    style="width: 220px;"
                    @change="(v: any) => saveServerName(record, v || '')"
                  >
                    <a-select-option v-for="n in serverNameOptions" :key="n" :value="n">
                      {{ n }}
                    </a-select-option>
                  </a-select>
                </template>
              </template>
            </a-table>
          </a-card>
        </a-tab-pane>

        <!-- 前端 tab -->
        <a-tab-pane v-if="showFrontendTab" key="frontend" tab="前端">
          <h3 style="margin-bottom: 12px; font-size: 15px;">当前部署（环境 × 版本）</h3>
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
              { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion' },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '部署时间', dataIndex: 'deployedAt', key: 'deployedAt', width: 180 },
              { title: '部署人', dataIndex: 'deployedBy', key: 'deployedBy', width: 120 },
            ]"
            :data-source="data?.environments || []"
            :pagination="false"
            row-key="envId"
            size="small"
            :locale="{ emptyText: '该模块在所有环境均未部署' }"
          />

          <h3 style="margin: 24px 0 12px; font-size: 15px;">版本历史（可回滚）</h3>
          <a-table
            :columns="[
              { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 200 },
              { title: '环境', dataIndex: 'env', key: 'env', width: 100 },
              { title: 'git commit', dataIndex: 'gitCommit', key: 'gitCommit', width: 140 },
              { title: '发布时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 180 },
              { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '操作', key: 'action', width: 100 },
            ]"
            :data-source="data?.versionHistory || []"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无版本历史' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'releasedAt'">{{ fmtDate(record.releasedAt) }}</template>
              <template v-else-if="column.key === 'action'">
                <a-popconfirm
                  :title="`以 ${record.versionTag} 重新走流水线发布（回滚到该版本代码）？`"
                  ok-text="回滚发布"
                  cancel-text="取消"
                  :ok-button-props="{ loading: rollbacking }"
                  @confirm="doRollback(record)"
                >
                  <a-button type="link" size="small">回滚到此版本</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 两个 tab 都不显示时的兜底 -->
        <a-empty v-if="!showBackendTab && !showFrontendTab" description="该模块类型暂不支持版本管理" />

        <!-- 阶段命令 tab（每模块每阶段一条 shell，DB 为唯一真相源） -->
        <!--
          「发布脚本」Tab：展示本模块 9 阶段实际命令——
            - 已配置 = 显示 shell（可复制）+ 模块脚本标记
            - 未配置走流程内置 = 显示 builtin 说明 + 流程内置标记
            - build 必填未配置 = 红色「必填·未配置」（发布将失败）
            - version/pointer = 紫色「语义真相源」（不可改）
          让运维不用点进每条流水线就明白「我现在发布这个模块实际会发生什么」。
        -->
        <a-tab-pane v-if="showScriptTab" key="script" tab="发布脚本">
          <a-spin :spinning="scriptLoading">
            <a-alert
              type="info"
              show-icon
              style="margin-bottom: 12px;"
              message="发布流水线 9 阶段，每阶段要么由模块自定义（脚本在「模块脚本」列），要么由流水线内置逻辑兜底。点击展开看命令原文或内置说明。"
            />
            <a-empty
              v-if="!scriptLoading && scriptView.length === 0"
              description="暂无脚本视图"
            />
            <div v-else>
              <div
                v-for="item in scriptView"
                :key="item.stage"
                style="border: 1px solid #f0f0f0; border-radius: 6px; margin-bottom: 10px; background: #fff;"
              >
                <!-- 阶段标题行：序号 / 阶段 / 来源标签 -->
                <div
                  style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; cursor: pointer; background: #fafafa; border-radius: 6px 6px 0 0;"
                  @click="toggleStep(item.stage)"
                >
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                    <span style="color: #999; font-family: monospace; font-size: 12px;">{{ item.stage }}</span>
                    <span style="font-weight: 600;">{{ item.title }}</span>
                    <a-tooltip :title="SOURCE_LABELS[item.source]?.tip || ''">
                      <a-tag :color="SOURCE_LABELS[item.source]?.color || 'default'" style="margin-right: 0;">
                        {{ SOURCE_LABELS[item.source]?.label || item.source }}
                      </a-tag>
                    </a-tooltip>
                    <span
                      v-if="item.source === 'required-unset'"
                      style="color: #cf1322; font-size: 12px;"
                    >⚠ 发布时将立即终止</span>
                  </div>
                  <a-space>
                    <a-tag v-if="(item.actions?.length ?? 0) > 1" color="geekblue">
                      {{ item.actions?.length }} 个操作
                    </a-tag>
                    <a-tag v-if="item.timeoutSec" color="cyan">超时 {{ item.timeoutSec }}s</a-tag>
                    <span style="color: #999; font-size: 12px;" v-if="item.updatedBy">
                      最近编辑：{{ item.updatedBy }}
                    </span>
                    <a-button
                      v-if="item.source !== 'semantic'"
                      size="small"
                      type="link"
                      @click.stop="startEdit(item)"
                    >编辑操作</a-button>
                  </a-space>
                </div>
                <!-- 展开区：命令原文 / 内置说明 -->
                <div
                  v-show="expandedStages[item.stage]"
                  style="padding: 12px; border-top: 1px solid #f0f0f0;"
                >
                  <template v-if="item.source === 'configured' && item.command">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <span style="font-size: 12px; color: #999;">shell 命令（DB 真相源）</span>
                      <a-button size="small" type="link" @click="copyCmd(item.command)">复制</a-button>
                    </div>
                    <pre
                      style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                             font-family: monospace; font-size: 12px; white-space: pre-wrap;
                             max-height: 320px; overflow: auto; margin: 0;"
                    >{{ item.command }}</pre>
                    <div v-if="item.builtin" style="margin-top: 8px; color: #666; font-size: 12px;">
                      <span style="color: #999;">叠加流程内置：</span>{{ item.builtin }}
                    </div>
                  </template>
                  <template v-else-if="item.source === 'required-unset'">
                    <a-alert
                      type="error"
                      show-icon
                      :message="item.builtin"
                    />
                  </template>
                  <template v-else>
                    <a-alert
                      :type="item.source === 'semantic' ? 'warning' : 'info'"
                      show-icon
                      :message="item.builtin"
                    />
                  </template>

                  <!-- v4 多操作编辑器（点标题行「编辑操作」展开） -->
                  <template v-if="editStage === item.stage">
                    <a-divider orientation="left" style="margin: 14px 0 10px;">
                      操作序列（{{ draft.length }}）
                    </a-divider>
                    <div style="display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap;">
                      <!-- 操作列表 -->
                      <div style="width: 250px; flex-shrink: 0;">
                        <div
                          v-for="(a, i) in draft"
                          :key="a.id"
                          style="border: 1px solid #f0f0f0; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; cursor: pointer; background: #fff;"
                          :style="actIdx === i ? 'border-color:#1677ff; background:#e6f4ff;' : ''"
                          @click="actIdx = i"
                        >
                          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-family: monospace; color: #999; font-size: 11px;">op{{ i + 1 }}</span>
                            <a-tag :color="a.type === 'service' ? 'purple' : 'blue'" style="margin: 0;">
                              {{ a.type === 'service' ? '工具' : 'shell' }}
                            </a-tag>
                            <span style="font-size: 12px;">{{ a.name }}</span>
                            <a-tag v-if="a.cont" color="orange" style="margin: 0;">容错</a-tag>
                            <a-tag v-if="a.builtin" style="margin: 0;">内置</a-tag>
                          </div>
                        </div>
                        <a-space size="small">
                          <a-button size="small" @click="addAction">+ 操作</a-button>
                          <a-button size="small" danger :disabled="!draft.length" @click="delAction(actIdx)">
                            删除
                          </a-button>
                        </a-space>
                      </div>

                      <!-- 当前操作的编辑区 -->
                      <div style="flex: 1; min-width: 280px;">
                        <template v-if="draft[actIdx]">
                          <a-space size="small" style="margin-bottom: 8px;" wrap>
                            <a-input
                              v-model:value="draft[actIdx].name"
                              size="small"
                              style="width: 150px;"
                              placeholder="操作名称"
                            />
                            <a-select v-model:value="draft[actIdx].type" size="small" style="width: 96px;">
                              <a-select-option value="shell">shell</a-select-option>
                              <a-select-option value="service">工具</a-select-option>
                            </a-select>
                            <a-input-number
                              v-model:value="draft[actIdx].timeoutSec"
                              size="small"
                              :min="1"
                              style="width: 96px;"
                            />
                            <a-checkbox v-model:checked="draft[actIdx].cont">
                              容错（失败不中断）
                            </a-checkbox>
                          </a-space>

                          <a-textarea
                            v-if="draft[actIdx].type === 'shell'"
                            v-model:value="draft[actIdx].code"
                            :rows="10"
                            spellcheck="false"
                            placeholder="在此编写 shell 脚本，可用变量：${MODULE_KEY} ${PM2_NAME} ${PORT} ${PUBLIC_PATH} ${ARTIFACT_DIR} ${WS_RESULT_FILE}"
                            style="font-family: monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4;"
                          />
                          <template v-else>
                            <a-alert type="info" show-icon message="工具型操作由内置工具执行，无需脚本" />
                            <a-input
                              v-model:value="draft[actIdx].tool"
                              size="small"
                              placeholder="工具 code（deploy_tool_catalog.code）"
                              style="margin-top: 6px;"
                            />
                          </template>
                        </template>
                        <a-empty v-else description="暂无操作" />

                        <div style="margin-top: 10px;">
                          <a-space>
                            <a-button size="small" type="primary" :loading="saving" @click="saveDraft">
                              保存
                            </a-button>
                            <a-button size="small" @click="validateDraft">语法校验</a-button>
                            <a-button size="small" @click="cancelEdit">取消</a-button>
                          </a-space>
                        </div>
                        <div style="margin-top: 6px; color: #999; font-size: 12px;">
                          操作自上而下顺序执行；标记「容错」的操作失败不中断阶段，其余失败即阶段失败。
                          保存以 actions 数组整体提交。
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </a-spin>
        </a-tab-pane>

        <a-empty v-if="!showBackendTab && !showFrontendTab && !showScriptTab" description="该模块类型暂不支持版本管理" />
      </a-tabs>
    </a-card>

    <!-- 发起发布抽屉（按流水线：构建+投递+切指针+探活） -->
    <PipelineSubmit
      v-model:open="publishOpen"
      :initial-env="moduleInfo?.defaultEnv || undefined"
      :initial-module-key="moduleKey"
      @submitted="onPublished"
    />
  </div>
</template>