<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import { monitorApi } from '@/api'

interface HealthItem {
  service: string
  address: string
  status: 'up' | 'down'
  response?: string
  responseTime: number
}

interface Pm2Item {
  name: string
  status: 'online' | 'stopped' | 'errored'
  cpu: number
  memory: number
  uptime: number
  restarts: number
}

const activeEnv = ref('dev')
const healthList = ref<HealthItem[]>([])
const pm2List = ref<Pm2Item[]>([])
const loadingHealth = ref(false)
const loadingPm2 = ref(false)

// 自动刷新
const autoRefresh = ref(true)
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 日志抽屉
const logDrawerVisible = ref(false)
const logService = ref('')
const logContent = ref<string[]>([])
const logLoading = ref(false)

// 加载健康状态
async function loadHealth() {
  loadingHealth.value = true
  try {
    healthList.value = await monitorApi.health(activeEnv.value)
  } catch {
    message.error('获取健康状态失败')
  } finally {
    loadingHealth.value = false
  }
}

// 加载 PM2 进程
async function loadPm2() {
  loadingPm2.value = true
  try {
    pm2List.value = await monitorApi.pm2(activeEnv.value)
  } catch {
    message.error('获取 PM2 进程失败')
  } finally {
    loadingPm2.value = false
  }
}

// 加载所有数据
function loadAll() {
  loadHealth()
  loadPm2()
}

// 查看日志
async function viewLogs(service: string) {
  logService.value = service
  logDrawerVisible.value = true
  logLoading.value = true
  logContent.value = []
  try {
    const res = await monitorApi.logs(activeEnv.value, service, 100)
    logContent.value = res.lines
  } catch {
    message.error('获取日志失败')
  } finally {
    logLoading.value = false
  }
}

// 切换自动刷新
function toggleAutoRefresh(checked: boolean) {
  if (checked) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
}

function startAutoRefresh() {
  if (refreshTimer) return
  refreshTimer = setInterval(loadAll, 10000)
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

// 健康状态标签
function healthStatusTag(status: string) {
  return status === 'up' ? 'success' : 'error'
}

// PM2 状态标签
function pm2StatusTag(status: string) {
  const map: Record<string, string> = {
    online: 'success',
    stopped: 'default',
    errored: 'error',
  }
  return map[status] || 'default'
}

// 格式化内存
function formatMemory(mb: number) {
  if (mb >= 1024) {
    return (mb / 1024).toFixed(2) + ' GB'
  }
  return mb.toFixed(0) + ' MB'
}

// 格式化运行时间
function formatUptime(sec: number) {
  if (sec >= 86400) {
    return Math.floor(sec / 86400) + '天' + Math.floor((sec % 86400) / 3600) + '小时'
  }
  if (sec >= 3600) {
    return Math.floor(sec / 3600) + '小时' + Math.floor((sec % 3600) / 60) + '分钟'
  }
  return Math.floor(sec / 60) + '分钟'
}

onMounted(() => {
  loadAll()
  if (autoRefresh.value) {
    startAutoRefresh()
  }
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>服务监控</h2>
      <p>查看服务运行状态和进程信息</p>
    </div>

    <a-card>
      <!-- 环境切换 + 自动刷新开关 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <a-tabs v-model:activeKey="activeEnv" @change="loadAll">
          <a-tab-pane key="dev" tab="DEV" />
          <a-tab-pane key="prod" tab="PROD" />
        </a-tabs>
        <a-space>
          <span style="color: rgba(0,0,0,0.45); font-size: 13px;">自动刷新（10秒）</span>
          <a-switch
            v-model:checked="autoRefresh"
            @change="toggleAutoRefresh"
          />
          <a-button @click="loadAll">手动刷新</a-button>
        </a-space>
      </div>

      <!-- 健康状态表 -->
      <h3 style="margin-bottom: 12px; font-size: 16px;">服务状态</h3>
      <a-table
        :columns="[
          { title: '服务名', dataIndex: 'service', key: 'service' },
          { title: '地址', dataIndex: 'address', key: 'address' },
          { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
          { title: '响应', dataIndex: 'response', key: 'response', width: 80 },
          { title: '响应时间', dataIndex: 'responseTime', key: 'responseTime', width: 120 },
          { title: '操作', key: 'action', width: 120 },
        ]"
        :data-source="healthList"
        :loading="loadingHealth"
        :pagination="false"
        row-key="service"
        size="small"
        style="margin-bottom: 24px;"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="healthStatusTag(record.status)">
              {{ record.status === 'up' ? '在线' : '离线' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'responseTime'">
            {{ record.responseTime }} ms
          </template>
          <template v-if="column.key === 'action'">
            <a-button
              type="link"
              size="small"
              @click="viewLogs(record.service)"
            >
              查看日志
            </a-button>
          </template>
        </template>
      </a-table>

      <!-- PM2 进程列表 -->
      <h3 style="margin-bottom: 12px; font-size: 16px;">PM2 进程</h3>
      <a-table
        :columns="[
          { title: '进程名', dataIndex: 'name', key: 'name' },
          { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
          { title: 'CPU', dataIndex: 'cpu', key: 'cpu', width: 80 },
          { title: '内存', dataIndex: 'memory', key: 'memory', width: 120 },
          { title: '运行时间', dataIndex: 'uptime', key: 'uptime', width: 120 },
          { title: '重启次数', dataIndex: 'restarts', key: 'restarts', width: 100 },
          { title: '操作', key: 'action', width: 120 },
        ]"
        :data-source="pm2List"
        :loading="loadingPm2"
        :pagination="false"
        row-key="name"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="pm2StatusTag(record.status)">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'cpu'">
            {{ record.cpu }}%
          </template>
          <template v-if="column.key === 'memory'">
            {{ formatMemory(record.memory) }}
          </template>
          <template v-if="column.key === 'uptime'">
            {{ formatUptime(record.uptime) }}
          </template>
          <template v-if="column.key === 'action'">
            <a-button
              type="link"
              size="small"
              @click="viewLogs(record.name)"
            >
              查看日志
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 日志抽屉 -->
    <a-drawer
      :open="logDrawerVisible"
      :title="`${logService} - 日志`"
      width="700"
      @close="logDrawerVisible = false"
    >
      <a-spin :spinning="logLoading">
        <div class="log-panel" style="max-height: calc(100vh - 160px);">
          <div v-if="logContent.length === 0" style="color: #666;">
            暂无日志
          </div>
          <div
            v-for="(line, idx) in logContent"
            :key="idx"
            class="log-line"
          >
            {{ line }}
          </div>
        </div>
      </a-spin>
    </a-drawer>
  </div>
</template>
