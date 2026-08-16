<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { deployApi, environmentApi } from '@/api'
import dayjs from 'dayjs'

// ===== 环境 =====
const env = ref('dev')
const environments = ref<{ id: string; name: string; host: string; builtin: boolean }[]>([])

// 模块列表（来自后端 /deploy/modules，与 deploy.sh 共用 modules.json）
interface DeployModule {
  key: string
  name: string
  type: 'backend' | 'frontend'
  dir: string
  pm2?: string
  publicPath?: string
  buildCmd?: string
}
const modules = ref<DeployModule[]>([])
const modulesLoading = ref(false)

// 当前环境各模块当前版本（「不同环境指定不同版本」展示）
const currentVersions = ref<Record<string, any>>({})

// 版本记录（DB）
const versions = ref<any[]>([])
const versionsLoading = ref(false)

// 任务状态
const deployingKey = ref('')
const currentTaskId = ref('')
const taskStatus = ref('')
const taskLogs = ref<string[]>([])
const logPanelRef = ref<HTMLElement | null>(null)
let eventSource: EventSource | null = null

function statusTagClass(status: string) {
  const map: Record<string, string> = {
    pending: 'status-tag-pending',
    running: 'status-tag-running',
    success: 'status-tag-success',
    failed: 'status-tag-failed',
  }
  return map[status] || ''
}
function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '等待中',
    running: '运行中',
    success: '成功',
    failed: '失败',
  }
  return map[status] || status
}
function typeTag(type: string) {
  return type === 'backend' ? '后端' : '前端'
}
function currentVersionOf(key: string) {
  return currentVersions.value[key]?.currentVersion || '—'
}

// ===== 部署 =====
function handleDeployModule(key: string) {
  if (env.value === 'prod') {
    Modal.confirm({
      title: '确认部署',
      content: `确认要部署模块 ${key} 到生产环境吗？此操作将影响线上服务。`,
      okText: '确认部署',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => runDeploy(key, true),
    })
  } else {
    runDeploy(key, false)
  }
}
async function runDeploy(key: string, confirm: boolean) {
  deployingKey.value = key
  try {
    const res = await deployApi.deploy(env.value, key, confirm)
    currentTaskId.value = res.taskId
    taskLogs.value = []
    taskStatus.value = 'pending'
    connectSSE(res.taskId)
    message.info(`部署任务已启动: ${key} → ${env.value}`)
  } catch {
    message.error('启动部署失败')
  } finally {
    deployingKey.value = ''
  }
}

// ===== 回滚（选历史版本）=====
function handleRollback(record: any) {
  if (env.value === 'prod') {
    Modal.confirm({
      title: '确认回滚',
      content: `确认要将 ${env.value} 环境回滚到版本 ${record.versionTag}（${record.component}）吗？`,
      okText: '确认回滚',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => doRollback(record.versionTag, record.component, true),
    })
  } else {
    doRollback(record.versionTag, record.component, false)
  }
}
async function doRollback(tag: string, component: string, confirm: boolean) {
  try {
    const res = await deployApi.rollback(env.value, tag, confirm)
    currentTaskId.value = res.taskId
    taskLogs.value = []
    taskStatus.value = 'pending'
    connectSSE(res.taskId)
    message.info('回滚任务已启动')
  } catch {
    message.error('启动回滚失败')
  }
}

// ===== SSE =====
function connectSSE(taskId: string) {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  eventSource = new EventSource(`/api/deploy/stream/${taskId}`)
  eventSource.onmessage = async (event) => {
    if (event.data === '[DONE]') {
      eventSource?.close()
      eventSource = null
      deployingKey.value = ''
      loadCurrentVersions()
      loadVersions()
      return
    }
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'log') {
        taskLogs.value.push(data.line)
        await nextTick()
        if (logPanelRef.value) logPanelRef.value.scrollTop = logPanelRef.value.scrollHeight
      } else if (data.type === 'status') {
        taskStatus.value = data.status
      }
    } catch {
      taskLogs.value.push(event.data)
    }
  }
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
    deployingKey.value = ''
  }
}

// ===== 数据加载 =====
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
  modulesLoading.value = true
  try {
    modules.value = await deployApi.modules()
  } catch {
    message.error('加载模块列表失败')
  } finally {
    modulesLoading.value = false
  }
}
async function loadCurrentVersions() {
  try {
    const list = await deployApi.currentVersions(env.value)
    const map: Record<string, any> = {}
    for (const v of list) map[v.moduleKey] = v
    currentVersions.value = map
  } catch {
    // 非致命
  }
}
async function loadVersions() {
  versionsLoading.value = true
  try {
    versions.value = await deployApi.versions(env.value)
  } catch {
    message.error('加载版本记录失败')
  } finally {
    versionsLoading.value = false
  }
}

async function onEnvChange() {
  await Promise.all([loadCurrentVersions(), loadVersions()])
}

function formatDate(date: string) {
  return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '—'
}

onMounted(async () => {
  await loadEnvironments()
  await loadModules()
  await loadCurrentVersions()
  await loadVersions()
})

onUnmounted(() => {
  if (eventSource) eventSource.close()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>发布中心</h2>
      <p>按模块发布（前端打包 / 后端 Git），带环境 ID，不同环境可指定不同版本</p>
    </div>

    <!-- 环境选择 -->
    <a-card style="margin-bottom: 16px;">
      <span style="margin-right: 8px;">环境:</span>
      <a-select v-model:value="env" style="width: 200px;" @change="onEnvChange">
        <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
          {{ e.name }}（{{ e.id }}）
        </a-select-option>
      </a-select>
      <a-button style="margin-left: 16px;" :loading="modulesLoading" @click="loadModules">刷新模块</a-button>
      <a-button style="margin-left: 8px;" type="link" @click="$router.push('/environments')">环境管理</a-button>
    </a-card>

    <!-- 模块列表（含当前版本）-->
    <a-card title="可发布模块" style="margin-bottom: 16px;">
      <a-table
        :columns="[
          { title: '模块', dataIndex: 'name', key: 'name' },
          { title: '标识', dataIndex: 'key', key: 'key' },
          { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
          { title: `${env} 当前版本`, dataIndex: 'currentVersion', key: 'currentVersion', width: 200 },
          { title: '操作', key: 'action', width: 160 },
        ]"
        :data-source="modules"
        :loading="modulesLoading"
        :pagination="false"
        row-key="key"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'type'">
            <a-tag :color="record.type === 'backend' ? 'blue' : 'green'">{{ typeTag(record.type) }}</a-tag>
          </template>
          <template v-if="column.key === 'currentVersion'">
            <a-tag :color="currentVersionOf(record.key) === '—' ? 'default' : 'purple'">
              {{ currentVersionOf(record.key) }}
            </a-tag>
          </template>
          <template v-if="column.key === 'action'">
            <a-button
              type="primary"
              size="small"
              :danger="env === 'prod'"
              :loading="deployingKey === record.key"
              @click="handleDeployModule(record.key)"
            >
              部署到 {{ env.toUpperCase() }}
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 版本记录（按环境）-->
    <a-card title="版本记录（按环境）" style="margin-bottom: 16px;">
      <a-table
        :columns="[
          { title: '组件', dataIndex: 'component', key: 'component', width: 160 },
          { title: '版本标签', dataIndex: 'versionTag', key: 'versionTag' },
          { title: 'Git', dataIndex: 'gitCommit', key: 'gitCommit', width: 120 },
          { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
          { title: '时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 160 },
          { title: '操作', key: 'action', width: 100 },
        ]"
        :data-source="versions"
        :loading="versionsLoading"
        :pagination="{ pageSize: 10 }"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'releasedAt'">{{ formatDate(record.releasedAt) }}</template>
          <template v-if="column.key === 'action'">
            <a-button type="link" size="small" danger @click="handleRollback(record)">回滚</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 部署日志 -->
    <a-card title="部署日志">
      <div v-if="currentTaskId" style="margin-bottom: 12px;">
        <span style="margin-right: 8px;">任务 ID: {{ currentTaskId }}</span>
        <a-tag :class="statusTagClass(taskStatus)">{{ statusText(taskStatus) }}</a-tag>
      </div>
      <div ref="logPanelRef" class="log-panel" style="min-height: 200px;">
        <div v-if="taskLogs.length === 0" style="color: #666;">暂无日志输出...</div>
        <div v-for="(line, idx) in taskLogs" :key="idx" class="log-line">{{ line }}</div>
      </div>
    </a-card>
  </div>
</template>
