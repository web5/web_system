<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import { monitorApi, type MonitorEnv, type Pm2HostGroup } from '@/api'

interface HealthItem {
  service: string
  address: string
  hostName?: string
  status: 'up' | 'down'
  response?: string
  responseTime: number
  error?: string
}

/** 取后端给出的真因（北京：后端 message 已含主机/用户/密钥路径） */
function errText(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.message || fallback
}

// ===== 环境页签（来自主机管理，不再硬编码）=====
const envs = ref<MonitorEnv[]>([])
const activeKey = ref('')
const healthList = ref<HealthItem[]>([])
const pm2Groups = ref<Pm2HostGroup[]>([])
const loadingHealth = ref(false)
const loadingPm2 = ref(false)
/** 顶部诊断横幅：任一主机取数失败即出现（真因 + 恢复入口） */
const bannerError = ref('')
/** 展开中的分组（= 组名数组；数据到达后默认全部展开，见 page-spec §6.1 实现注意） */
const activePanels = ref<string[]>([])

// 自动刷新（失败时保留上次数据，不清空表格）
const autoRefresh = ref(true)
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 日志抽屉
const logDrawerVisible = ref(false)
const logService = ref('')
const logContent = ref<string[]>([])
const logLoading = ref(false)

async function loadEnvs() {
  try {
    envs.value = await monitorApi.envs()
    // 当前页签不在可管列表里（环境被回收/归属变更）→ 落到第一个
    if (!envs.value.some((e) => e.id === activeKey.value)) {
      activeKey.value = envs.value[0]?.id || ''
    }
  } catch (e) {
    // 拿不到环境列表通常是 CONSOLE_INSTANCE / 主机管理未配置，直接把真因顶到页面
    envs.value = []
    activeKey.value = ''
    bannerError.value = errText(e, '获取可管环境失败')
  }
}

// 加载健康状态
async function loadHealth() {
  if (!activeKey.value) return
  loadingHealth.value = true
  try {
    healthList.value = await monitorApi.health(activeKey.value)
  } catch (e) {
    // 保留上次数据：不清空，只把原因顶到横幅
    bannerError.value = errText(e, '获取健康状态失败')
  } finally {
    loadingHealth.value = false
  }
}

// 加载 PM2 进程（按主机分组）
async function loadPm2() {
  if (!activeKey.value) return
  loadingPm2.value = true
  try {
    pm2Groups.value = await monitorApi.pm2Hosts(activeKey.value)
    // 默认全部展开（activeKey 须绑定组名数组，占位 key 会导致面板懒加载不渲染）
    activePanels.value = pm2Groups.value.map((g) => g.name)
    // 横幅取第一台失败主机的真因
    const failed = pm2Groups.value.find((g) => !g.ok)
    bannerError.value = failed
      ? `${failed.name}（${failed.host}）：${failed.error || '取数失败'}`
      : ''
  } catch (e) {
    // 保留上次数据：不清空，只把原因顶到横幅
    bannerError.value = errText(e, '获取 PM2 进程失败')
  } finally {
    loadingPm2.value = false
  }
}

// 加载所有数据
async function loadAll() {
  await loadEnvs()
  await Promise.all([loadHealth(), loadPm2()])
}

function onTabChange() {
  // 切环境：清空上一环境数据，避免串数据
  healthList.value = []
  pm2Groups.value = []
  bannerError.value = ''
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
    const res = await monitorApi.logs(activeKey.value, service, 100)
    logContent.value = res.lines
  } catch (e) {
    message.error(errText(e, '获取日志失败'))
  } finally {
    logLoading.value = false
  }
}

// 切换自动刷新
function toggleAutoRefresh(checked: boolean) {
  if (checked) startAutoRefresh()
  else stopAutoRefresh()
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
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB'
  return mb.toFixed(0) + ' MB'
}

// 格式化响应时间（浮点精度串如 29.052000000000003 → 29.1）
function fmtMs(v: number) {
  return Number.isFinite(v) ? v.toFixed(1) : '0'
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
  if (autoRefresh.value) startAutoRefresh()
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>服务监控</h2>
      <p>按环境查看服务状态与 PM2 进程；可管环境来自「基础设施 → 主机管理」</p>
    </div>

    <a-card>
      <!-- 环境页签 + 自动刷新开关 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <a-tabs v-model:activeKey="activeKey" @change="onTabChange">
          <a-tab-pane v-for="e in envs" :key="e.id" :tab="e.name || e.id" />
        </a-tabs>
        <a-space>
          <span style="color: rgba(0,0,0,0.45); font-size: 13px;">自动刷新（10秒）</span>
          <a-switch v-model:checked="autoRefresh" @change="toggleAutoRefresh" />
          <a-button @click="loadAll">手动刷新</a-button>
        </a-space>
      </div>

      <!-- 顶部诊断横幅：取数失败时给真因（区分「连不上主机」与「服务离线」） -->
      <a-alert
        v-if="bannerError"
        type="error"
        show-icon
        :message="bannerError"
        style="margin-bottom: 16px;"
      >
        <template #action>
          <a-button size="small" @click="loadAll">重试</a-button>
          <router-link to="/hosts" style="margin-left: 8px;">
            <a-button size="small" type="link">去主机管理检查</a-button>
          </router-link>
        </template>
      </a-alert>

      <!-- 无可管环境 -->
      <a-empty
        v-if="!envs.length"
        description="暂无可管环境：「主机管理」里没有归属本控制台且启用的主机"
        style="margin: 32px 0;"
      >
        <router-link to="/hosts">
          <a-button type="primary">去主机管理登记</a-button>
        </router-link>
      </a-empty>

      <template v-if="envs.length">
        <!-- 服务状态 -->
        <h3 style="margin-bottom: 12px; font-size: 16px;">服务状态</h3>
        <a-table
          :columns="[
            { title: '服务名', dataIndex: 'service', key: 'service' },
            { title: '主机', dataIndex: 'hostName', key: 'hostName', width: 140 },
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
            <template v-if="column.key === 'hostName'">
              <span class="ws-mono">{{ record.hostName || '-' }}</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="healthStatusTag(record.status)">
                {{ record.status === 'up' ? '在线' : '离线' }}
              </a-tag>
              <a-tooltip v-if="record.error" :title="record.error">
                <span style="color: rgba(0,0,0,0.45); font-size: 12px;">{{ record.response }}</span>
              </a-tooltip>
            </template>
            <template v-if="column.key === 'responseTime'">
              {{ fmtMs(record.responseTime) }} ms
            </template>
            <template v-if="column.key === 'action'">
              <a-button type="link" size="small" @click="viewLogs(record.service)">
                查看日志
              </a-button>
            </template>
          </template>
        </a-table>

        <!-- PM2 进程：按主机分组，逐台取数 -->
        <h3 style="margin-bottom: 12px; font-size: 16px;">PM2 进程</h3>
        <a-collapse
          v-model:activeKey="activePanels"
          :bordered="false"
          style="background: transparent;"
          :class="{ 'mon-single': pm2Groups.length === 1 }"
        >
          <a-collapse-panel
            v-for="g in pm2Groups"
            :key="g.name"
          >
            <template #header>
              <span style="display: flex; align-items: center; gap: 6px; font-size: 12px; flex-wrap: wrap;">
                <b class="ws-mono">{{ g.name }}</b>
                <span style="color: rgba(0,0,0,0.45);">·</span>
                <span class="ws-mono">{{ g.host }}</span>
                <span style="color: rgba(0,0,0,0.45);">·</span>
                <a-tag color="default">{{ g.scope }}</a-tag>
                <span style="color: rgba(0,0,0,0.45);">·</span>
                <a-tag color="default">{{ g.runtime }}</a-tag>
                <span style="color: rgba(0,0,0,0.45);">·</span>
                <span v-if="g.ok">{{ g.procs.length }} 个进程 · 取数 {{ g.tookMs }} ms</span>
                <span v-else style="color: #cf1322;">取数失败</span>
              </span>
            </template>

            <!-- 不可达主机：分组仍出现，给真因 + 恢复入口 -->
            <a-alert
              v-if="!g.ok"
              type="error"
              show-icon
              :message="g.error || '取数失败'"
              :description="`主机组 ${g.name}（${g.host}）`"
            >
              <template #action>
                <a-button size="small" @click="loadPm2">重试</a-button>
                <router-link to="/hosts" style="margin-left: 8px;">
                  <a-button size="small" type="link">去主机管理检查</a-button>
                </router-link>
              </template>
            </a-alert>

            <a-table
              v-else
              :columns="[
                { title: '进程名', dataIndex: 'name', key: 'name' },
                { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
                { title: 'CPU', dataIndex: 'cpu', key: 'cpu', width: 80 },
                { title: '内存', dataIndex: 'memory', key: 'memory', width: 120 },
                { title: '运行时间', dataIndex: 'uptime', key: 'uptime', width: 120 },
                { title: '重启次数', dataIndex: 'restarts', key: 'restarts', width: 100 },
                { title: '操作', key: 'action', width: 120 },
              ]"
              :data-source="g.procs"
              :pagination="false"
              row-key="name"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'status'">
                  <a-tag :color="pm2StatusTag(record.status)">{{ record.status }}</a-tag>
                </template>
                <template v-if="column.key === 'cpu'">{{ record.cpu }}%</template>
                <template v-if="column.key === 'memory'">{{ formatMemory(record.memory) }}</template>
                <template v-if="column.key === 'uptime'">{{ formatUptime(record.uptime) }}</template>
                <template v-if="column.key === 'action'">
                  <a-button type="link" size="small" @click="viewLogs(record.name)">
                    查看日志
                  </a-button>
                </template>
              </template>
            </a-table>
          </a-collapse-panel>
        </a-collapse>
        <div v-if="!pm2Groups.length && !loadingPm2" style="color: rgba(0,0,0,0.45); font-size: 13px;">
          暂无进程数据
        </div>
      </template>
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
          <div v-if="logContent.length === 0" style="color: #666;">暂无日志</div>
          <div v-for="(line, idx) in logContent" :key="idx" class="log-line">
            {{ line }}
          </div>
        </div>
      </a-spin>
    </a-drawer>
  </div>
</template>

<style scoped>
/* 仅 1 台主机时分组头弱化（信息保留，视觉不抢戏）—— 已确认口径
   不新增 !important（ui-interface 规则）：改用「类 + 后代」提高特异性覆盖 antd */
.mon-single div.ant-collapse-item div.ant-collapse-header {
  padding-top: 4px;
  padding-bottom: 4px;
  color: var(--ws-text-tertiary, rgba(0, 0, 0, 0.45));
}
.mon-single div.ant-collapse-item span.ant-collapse-arrow {
  opacity: 0.45;
}
</style>
