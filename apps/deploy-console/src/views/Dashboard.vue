<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { environmentApi, auditApi, metricsApi } from '@/api'
import EChart from '@/components/EChart.vue'
import { uiTokens } from '@web-system/ui'

interface EnvInfo {
  env: string
  server: string
  services: string[]
  publicUrl: string
  deployDir: string
}

interface AuditItem {
  id: number
  timestamp: string
  user: string
  action: string
  env: string
  component: string
  status: string
  detail: string
}

const envList = ref<EnvInfo[]>([])
const recentActions = ref<AuditItem[]>([])
const loading = ref(false)

// 加载环境信息
async function loadEnvs() {
  try {
    const list = await environmentApi.list()
    envList.value = list.map((e: any) => ({
      env: e.id,
      server: e.host,
      services: Object.keys(e.ports || {}),
      publicUrl: e.publicUrl || '',
      deployDir: e.remoteDir,
    }))
  } catch {
    // 静默处理
  }
}

// 加载最近操作
async function loadRecentActions() {
  loading.value = true
  try {
    const res = await auditApi.list(1, 10)
    recentActions.value = res.data
  } catch {
    // 静默处理
  } finally {
    loading.value = false
  }
}

// 格式化时间
function formatTime(ts: string) {
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

// 状态标签颜色
function statusColor(status: string) {
  const map: Record<string, string> = {
    success: 'green',
    failed: 'red',
    running: 'orange',
    pending: 'blue',
  }
  return map[status] || 'default'
}

// 图表/状态语义色（Backlog H：echarts 不解析 CSS var，从 uiTokens 常量取值；light 语义色两主题通用）
const CHART_COLOR = {
  success: uiTokens.colors.success.light[500], // #398E4A
  error: uiTokens.colors.error.light[500], // #E5484D
  warning: uiTokens.colors.warning.light[500], // #F5A623
  neutral: uiTokens.roles.light.textTertiary, // #A3A3A3
}

// ===== 发布度量（数据源为 deploy_pipelines 聚合，无额外埋点）=====
const RANGES = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
]

const metricDays = ref(30)
const metricEnv = ref<string | undefined>(undefined)
const metricLoading = ref(false)
const overview = ref<Awaited<ReturnType<typeof metricsApi.overview>> | null>(null)
const trend = ref<Awaited<ReturnType<typeof metricsApi.trend>>>([])
const stageFailures = ref<Awaited<ReturnType<typeof metricsApi.stageFailures>>>([])
const failures = ref<Awaited<ReturnType<typeof metricsApi.failures>>>([])
const drillStage = ref<string | null>(null)

const queryParams = computed(() => ({
  env: metricEnv.value,
  from: dayjs().subtract(metricDays.value, 'day').startOf('day').valueOf(),
  to: Date.now(),
}))

const successRateText = computed(() => {
  const r = overview.value?.successRate
  // null = 还没有终态记录，显示"—"而不是 0%，否则会被误读成"全部失败"
  return r === null || r === undefined ? '—' : `${(r * 100).toFixed(1)}%`
})

const successRateColor = computed(() => {
  const r = overview.value?.successRate
  if (r === null || r === undefined) return CHART_COLOR.neutral
  if (r >= 0.9) return CHART_COLOR.success
  if (r >= 0.7) return CHART_COLOR.warning
  return CHART_COLOR.error
})

const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['成功', '失败'] },
  grid: { left: 40, right: 16, top: 34, bottom: 26 },
  xAxis: { type: 'category', data: trend.value.map((t) => t.date) },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      name: '成功',
      type: 'bar',
      stack: 'total',
      itemStyle: { color: CHART_COLOR.success },
      data: trend.value.map((t) => t.succeeded),
    },
    {
      name: '失败',
      type: 'bar',
      stack: 'total',
      itemStyle: { color: CHART_COLOR.error },
      data: trend.value.map((t) => t.failed),
    },
  ],
}))

const stageOption = computed(() => {
  // 横向条形：category 轴自下而上，反转后最大值显示在顶部
  const reversed = [...stageFailures.value].reverse()
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 76, right: 30, top: 10, bottom: 22 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: reversed.map((s) => s.stage) },
    series: [
      { type: 'bar', itemStyle: { color: CHART_COLOR.error }, data: reversed.map((s) => s.count) },
    ],
  }
})

async function loadMetrics() {
  metricLoading.value = true
  try {
    const [o, t, s] = await Promise.all([
      metricsApi.overview(queryParams.value),
      metricsApi.trend(queryParams.value),
      metricsApi.stageFailures(queryParams.value),
    ])
    overview.value = o
    trend.value = t
    stageFailures.value = s
  } catch {
    // 静默：度量是增强视图，加载失败不应影响环境总览
  } finally {
    metricLoading.value = false
  }
}

/** 下钻：点某个失败阶段 → 看具体哪几次失败、错误是什么 */
async function onStageClick(params: { name: string }) {
  if (!params.name) return
  drillStage.value = params.name
  try {
    failures.value = await metricsApi.failures({
      ...queryParams.value,
      stage: params.name,
      limit: 50,
    })
  } catch {
    failures.value = []
  }
}

function clearDrill() {
  drillStage.value = null
  failures.value = []
}

onMounted(() => {
  loadEnvs()
  loadRecentActions()
  loadMetrics()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>环境总览</h2>
      <p>查看各环境运行状态及最近操作</p>
    </div>

    <!-- 发布度量 -->
    <a-card title="发布度量" style="margin-bottom: 24px;" :loading="metricLoading">
      <template #extra>
        <a-space>
          <a-select
            v-model:value="metricEnv"
            placeholder="全部环境"
            allow-clear
            style="width: 130px;"
            @change="loadMetrics"
          >
            <a-select-option v-for="e in envList" :key="e.env" :value="e.env">
              {{ e.env }}
            </a-select-option>
          </a-select>
          <a-select v-model:value="metricDays" style="width: 110px;" @change="loadMetrics">
            <a-select-option v-for="r in RANGES" :key="r.value" :value="r.value">
              {{ r.label }}
            </a-select-option>
          </a-select>
          <a-button size="small" @click="loadMetrics">刷新</a-button>
        </a-space>
      </template>

      <a-row :gutter="16" style="margin-bottom: 16px;">
        <a-col :xs="12" :md="6">
          <a-statistic title="发布总数" :value="overview?.total ?? 0" />
        </a-col>
        <a-col :xs="12" :md="6">
          <a-statistic
            title="成功率"
            :value="successRateText"
            :value-style="{ color: successRateColor }"
          />
        </a-col>
        <a-col :xs="12" :md="6">
          <a-statistic title="平均时长(秒)" :value="overview?.avgDurationSec ?? '—'" />
        </a-col>
        <a-col :xs="12" :md="6">
          <a-statistic title="P95 时长(秒)" :value="overview?.p95DurationSec ?? '—'" />
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :xs="24" :lg="14">
          <div style="font-weight: 500; margin-bottom: 8px;">发布趋势</div>
          <EChart :option="trendOption" height="240px" />
        </a-col>
        <a-col :xs="24" :lg="10">
          <div style="font-weight: 500; margin-bottom: 8px;">
            失败阶段分布
            <span style="font-weight: 400; color: var(--ws-text-tertiary); font-size: 12px;">（点击条形下钻）</span>
          </div>
          <EChart :option="stageOption" height="240px" @chart-click="onStageClick" />
        </a-col>
      </a-row>

      <!-- 失败下钻：从"某阶段失败 N 次"到"具体哪几次、错误是什么" -->
      <template v-if="drillStage">
        <a-divider style="margin: 12px 0;" />
        <div
          style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
        >
          <span>
            <b>{{ drillStage }}</b> 阶段失败明细
            <a-tag color="red" style="margin-left: 6px;">{{ failures.length }} 条</a-tag>
          </span>
          <a-button size="small" @click="clearDrill">收起</a-button>
        </div>
        <a-table :data-source="failures" row-key="id" size="small" :pagination="{ pageSize: 8 }">
          <a-table-column title="时间">
            <template #default="{ record }">
              {{ formatTime(new Date(record.startTime).toISOString()) }}
            </template>
          </a-table-column>
          <a-table-column title="模块" data-index="moduleKey" />
          <a-table-column title="环境" data-index="env" />
          <a-table-column title="版本" data-index="versionTag" />
          <a-table-column title="操作人" data-index="operator" />
          <a-table-column title="错误信息">
            <template #default="{ record }">
              <span style="color: var(--ws-error-500);">{{ record.error || '—' }}</span>
            </template>
          </a-table-column>
        </a-table>
      </template>
    </a-card>

    <!-- 环境卡片 -->
    <a-row :gutter="16" style="margin-bottom: 24px;">
      <a-col
        v-for="env in envList"
        :key="env.env"
        :xs="24"
        :lg="12"
      >
        <a-card class="env-card" :title="env.env.toUpperCase() + ' 环境'">
          <template #extra>
            <a-tag :color="env.env === 'prod' ? 'red' : 'green'">
              {{ env.env === 'prod' ? '生产' : '开发' }}
            </a-tag>
          </template>
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="服务器">
              {{ env.server }}
            </a-descriptions-item>
            <a-descriptions-item label="服务数量">
              {{ env.services?.length || 0 }} 个
            </a-descriptions-item>
            <a-descriptions-item label="访问地址">
              <a :href="env.publicUrl" target="_blank">{{ env.publicUrl }}</a>
            </a-descriptions-item>
            <a-descriptions-item label="部署目录">
              {{ env.deployDir }}
            </a-descriptions-item>
          </a-descriptions>
          <div style="margin-top: 12px;">
            <a-tag
              v-for="svc in env.services"
              :key="svc"
              color="blue"
              style="margin-bottom: 4px;"
            >
              {{ svc }}
            </a-tag>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 最近操作 -->
    <a-card title="最近操作" :loading="loading">
      <a-list
        :data-source="recentActions"
        :locale="{ emptyText: '暂无操作记录' }"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <span style="font-weight: 500;">{{ item.user }}</span>
                <span style="margin-left: 8px; color: var(--ws-text-secondary);">
                  执行了 {{ item.action }}
                </span>
                <a-tag v-if="item.env" color="blue" style="margin-left: 8px;">
                  {{ item.env }}
                </a-tag>
                <a-tag v-if="item.component" style="margin-left: 4px;">
                  {{ item.component }}
                </a-tag>
              </template>
              <template #description>
                <a-tag :color="statusColor(item.status)">{{ item.status }}</a-tag>
                <span style="margin-left: 8px; color: var(--ws-text-secondary);">
                  {{ item.detail }}
                </span>
              </template>
              <template #avatar>
                <span style="color: var(--ws-text-secondary); font-size: 12px;">
                  {{ formatTime(item.timestamp) }}
                </span>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </a-card>
  </div>
</template>
