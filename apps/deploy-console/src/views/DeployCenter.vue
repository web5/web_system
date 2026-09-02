<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { deployApi, environmentApi, pipelineApi, type PipelineItem } from '@/api'
import dayjs from 'dayjs'
import PipelineSubmit from '@/components/PipelineSubmit.vue'

const router = useRouter()

// ===== 环境 =====
const env = ref('dev')
const environments = ref<{ id: string; name: string }[]>([])

// ===== 数据 =====
const modules = ref<any[]>([])
const curMap = ref<Record<string, any>>({})
const plMap = ref<Record<string, PipelineItem>>({})
const loading = ref(false)

const TYPE_OPTIONS: Record<string, { label: string; color: string }> = {
  backend: { label: '后端', color: 'blue' },
  frontend: { label: '前端', color: 'green' },
  'micro-frontend': { label: '微前端', color: 'purple' },
  'mini-app': { label: '小程序', color: 'orange' },
}
const rows = computed(() =>
  modules.value
    .filter((m: any) => m.enabled !== false)
    .map((m: any) => ({ ...m, cur: curMap.value[m.key], pl: plMap.value[m.key] })),
)

function pipelineStatusColor(status: string) {
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
function pipelineStatusText(status: string) {
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
function fmt(ts?: string | number) {
  if (ts === undefined || ts === null || ts === '') return '—'
  const d = dayjs(typeof ts === 'string' && /^\d{13}$/.test(ts) ? Number(ts) : ts)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(ts)
}

// ===== 加载 =====
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
async function loadBoard() {
  loading.value = true
  try {
    const [curList, plList] = await Promise.all([
      deployApi.currentVersions(env.value),
      pipelineApi.list({ env: env.value, limit: 300 }),
    ])
    const cm: Record<string, any> = {}
    for (const v of curList) cm[v.moduleKey] = v
    curMap.value = cm
    const pm: Record<string, PipelineItem> = {}
    for (const p of plList) {
      if (!pm[p.moduleKey]) pm[p.moduleKey] = p
    }
    plMap.value = pm
  } catch {
    message.error('加载发布状态失败')
  } finally {
    loading.value = false
  }
}
async function onEnvChange() {
  await loadBoard()
}

// ===== 发起发布（抽屉，走流水线） =====
const releaseOpen = ref(false)
const releaseModuleKey = ref('')
function openRelease(row: any) {
  releaseModuleKey.value = row.key
  releaseOpen.value = true
}
function onSubmitted() {
  void loadBoard()
}
function gotoDetail(row: any) {
  router.push(`/modules/${row.key}`)
}

onMounted(async () => {
  await loadEnvironments()
  await loadModules()
  await loadBoard()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>发布中心</h2>
      <p>发布看板：按「环境 × 模块」查看当前部署版本与最近一次发布结果。发布动作统一走发布流水线。</p>
    </div>

    <!-- 环境选择 -->
    <a-card style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <a-space>
          <span>环境:</span>
          <a-select v-model:value="env" style="width: 200px;" @change="onEnvChange">
            <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
              {{ e.name }}（{{ e.id }}）
            </a-select-option>
          </a-select>
          <a-button :loading="loading" @click="loadBoard">刷新</a-button>
        </a-space>
        <a-button type="link" @click="$router.push('/pipelines')">流水线管理</a-button>
      </div>
      <a-alert
        type="info"
        show-icon
        style="margin-top: 12px;"
        message="发布统一通过「流水线」执行（校验 → 拉码 → 构建 → 投递/重启 → 写版本 → 切指针 → 探活）。模块详情中可查看版本历史与回滚。"
      />
    </a-card>

    <!-- 发布看板 -->
    <a-card :loading="loading" title="发布状态">
      <a-table
        :columns="[
          { title: '模块', dataIndex: 'name', key: 'name' },
          { title: '类型', dataIndex: 'type', key: 'type', width: 90 },
          { title: `当前版本（${env}）`, key: 'cur', width: 190 },
          { title: '部署时间', key: 'deployedAt', width: 160 },
          { title: '部署人', key: 'deployedBy', width: 110 },
          { title: '最近流水线执行', key: 'pl', ellipsis: true },
          { title: '操作', key: 'action', width: 190 },
        ]"
        :data-source="rows"
        :pagination="false"
        row-key="key"
        size="small"
        :locale="{ emptyText: '暂无模块' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <a style="color: #1677ff;" @click="gotoDetail(record)">{{ record.name }}</a>
            <span style="color: #999; margin-left: 6px; font-family: monospace;">{{ record.key }}</span>
            <a-tag v-if="record.builtin" color="gold" style="margin-left: 4px; font-size: 11px;">内置</a-tag>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="TYPE_OPTIONS[record.type]?.color || 'default'">
              {{ TYPE_OPTIONS[record.type]?.label || record.type }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'cur'">
            <a-tag :color="record.cur?.currentVersion ? 'purple' : 'default'">
              {{ record.cur?.currentVersion || '未部署' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'deployedAt'">
            <span style="color: #666;">{{ fmt(record.cur?.deployedAt) }}</span>
          </template>
          <template v-else-if="column.key === 'deployedBy'">
            {{ record.cur?.deployedBy || '—' }}
          </template>
          <template v-else-if="column.key === 'pl'">
            <template v-if="record.pl">
              <a-tag :color="pipelineStatusColor(record.pl.status)" style="margin-right: 4px;">
                {{ pipelineStatusText(record.pl.status) }}
              </a-tag>
              <span style="color: #555;">{{ record.pl.templateName || '默认' }} · v{{ record.pl.versionTag || '—' }}</span>
              <span style="color: #999; margin-left: 6px;">{{ fmt(record.pl.startTime) }}</span>
            </template>
            <span v-else style="color: #bbb;">暂无流水线执行</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="primary" size="small" :danger="env === 'prod'" @click="openRelease(record)">
                发起发布
              </a-button>
              <a-button type="link" size="small" @click="gotoDetail(record)">模块详情</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 发起发布抽屉 -->
    <PipelineSubmit
      v-model:open="releaseOpen"
      :initial-env="env"
      :initial-module-key="releaseModuleKey"
      @submitted="onSubmitted"
    />
  </div>
</template>
