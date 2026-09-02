<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { monitorApi, environmentApi } from '@/api'

interface Target {
  id: string
  name: string
  isLocal?: boolean
}

interface Pm2Proc {
  name: string
  status: string
  cpu: number
  memory: number
  restarts: number
  uptime: number
}

// ===== 目标选择 =====
const targets = ref<Target[]>([])
const targetId = ref('local')
const isLocal = computed(() => targetId.value === 'local')
const currentTarget = computed(() => targets.value.find((t) => t.id === targetId.value))

// ===== 服务列表 =====
const procs = ref<Pm2Proc[]>([])
const serviceName = ref<string | undefined>(undefined)
const loadingPm2 = ref(false)

async function loadTargets() {
  try {
    const envs = await environmentApi.list()
    targets.value = [
      { id: 'local', name: '本机', isLocal: true },
      ...envs.map((e) => ({ id: e.id, name: e.name })),
    ]
  } catch {
    message.error('加载目标失败')
  }
}

async function loadPm2() {
  loadingPm2.value = true
  try {
    procs.value = isLocal.value ? await monitorApi.localPm2() : await monitorApi.pm2(targetId.value)
    if (!serviceName.value || !procs.value.some((p) => p.name === serviceName.value)) {
      serviceName.value = procs.value[0]?.name
    }
  } catch (e) {
    message.error((e as Error).message || '加载进程列表失败')
    procs.value = []
    serviceName.value = undefined
  } finally {
    loadingPm2.value = false
  }
}

watch(targetId, () => loadPm2())

// ===== 端口检测 =====
const portValue = ref<number | undefined>(6200)
const portChecking = ref(false)
const portResult = ref<{ port: number; occupied: boolean; lines: string[] } | null>(null)

async function checkPort() {
  if (!portValue.value) {
    message.warning('请输入端口号')
    return
  }
  portChecking.value = true
  portResult.value = null
  try {
    portResult.value = isLocal.value
      ? await monitorApi.localPort(portValue.value)
      : await monitorApi.port(targetId.value, portValue.value)
  } catch (e) {
    message.error((e as Error).message || '检测失败')
  } finally {
    portChecking.value = false
  }
}

// ===== 进程重启 =====
const restarting = ref(false)
const restartOutput = ref('')
async function restartService() {
  if (!serviceName.value) {
    message.warning('请先选择服务')
    return
  }
  Modal.confirm({
    title: `重启服务 ${serviceName.value}`,
    content: `对 ${currentTarget.value?.name ?? targetId.value}（${targetId.value}）执行 pm2 restart ${serviceName.value}？`,
    okText: '重启',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      restarting.value = true
      restartOutput.value = ''
      try {
        const res = isLocal.value
          ? await monitorApi.restartLocal(serviceName.value!)
          : await monitorApi.restart(targetId.value, serviceName.value!)
        restartOutput.value = res.output || '（无输出）'
        message.success('重启完成')
        await loadPm2()
      } catch (e) {
        message.error((e as Error).message || '重启失败')
      } finally {
        restarting.value = false
      }
    },
  })
}

// ===== 日志检索 =====
const keyword = ref('')
const logLines = ref(300)
const searching = ref(false)
const logResult = ref<{ logs: string[]; matched?: number } | null>(null)
const logError = ref('')

async function searchLogs() {
  if (!serviceName.value) {
    message.warning('请先选择服务')
    return
  }
  searching.value = true
  logError.value = ''
  logResult.value = null
  try {
    const kw = keyword.value.trim()
    logResult.value = isLocal.value
      ? await monitorApi.searchLocalLogs(serviceName.value!, kw, logLines.value)
      : await monitorApi.searchLogs(targetId.value, serviceName.value!, kw, logLines.value)
    if (logResult.value.logs.length === 0) logError.value = kw ? '无匹配行' : '（无日志）'
  } catch (e) {
    logError.value = (e as Error).message || '日志拉取失败'
  } finally {
    searching.value = false
  }
}

const currentProc = computed(() => procs.value.find((p) => p.name === serviceName.value))

function fmtUptime(ms: number) {
  if (!ms) return '-'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
function fmtMem(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(0)}MB` : '-'
}

onMounted(async () => {
  await loadTargets()
  await loadPm2()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>自助诊断</h2>
      <p>端口检测 / 进程重启 / 日志检索，全部在页面完成，无需 SSH</p>
    </div>

    <a-card style="margin-bottom: 16px;">
      <a-space wrap align="center">
        <span style="color: #888;">诊断目标：</span>
        <a-select
          v-model:value="targetId"
          style="width: 200px;"
          :options="targets.map((t) => ({ label: t.name + '（' + t.id + '）', value: t.id }))"
        />
        <a-select
          v-model:value="serviceName"
          placeholder="选择服务"
          style="width: 240px;"
          :loading="loadingPm2"
          show-search
          option-filter-prop="label"
          :options="procs.map((p) => ({ label: `${p.name}（${p.status}）`, value: p.name }))"
        />
        <a-button @click="loadPm2">刷新进程</a-button>
      </a-space>
    </a-card>

    <a-row :gutter="16">
      <!-- 端口检测 -->
      <a-col :span="8">
        <a-card title="端口占用检测" size="small">
          <a-space>
            <a-input-number v-model:value="portValue" :min="1" :max="65535" style="width: 130px;" />
            <a-button type="primary" :loading="portChecking" @click="checkPort">检测</a-button>
          </a-space>
          <div v-if="portResult" style="margin-top: 12px;">
            <a-tag :color="portResult.occupied ? 'red' : 'green'" style="font-size: 13px;">
              端口 {{ portResult.port }} {{ portResult.occupied ? '已被占用' : '空闲' }}
            </a-tag>
            <pre
              v-if="portResult.lines.length"
              style="margin-top: 8px; background: #1e1e1e; color: #d4d4d4; padding: 10px;
                     border-radius: 4px; font-size: 12px; max-height: 220px; overflow: auto;"
            >{{ portResult.lines.join('\n') }}</pre>
          </div>
        </a-card>
      </a-col>

      <!-- 进程信息 + 重启 -->
      <a-col :span="8">
        <a-card title="进程信息" size="small" :loading="loadingPm2">
          <template v-if="currentProc">
            <a-descriptions :column="2" size="small" bordered>
              <a-descriptions-item label="服务">{{ currentProc.name }}</a-descriptions-item>
              <a-descriptions-item label="状态">
                <a-tag :color="currentProc.status === 'online' ? 'green' : 'red'">
                  {{ currentProc.status }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="CPU">{{ currentProc.cpu ?? 0 }}%</a-descriptions-item>
              <a-descriptions-item label="内存">{{ fmtMem(currentProc.memory ?? 0) }}</a-descriptions-item>
              <a-descriptions-item label="重启次数">{{ currentProc.restarts ?? 0 }}</a-descriptions-item>
              <a-descriptions-item label="运行时长">{{ fmtUptime(currentProc.uptime ?? 0) }}</a-descriptions-item>
            </a-descriptions>
            <a-button danger :loading="restarting" block style="margin-top: 12px;" @click="restartService">
              重启服务
            </a-button>
            <pre
              v-if="restartOutput"
              style="margin-top: 8px; background: #1e1e1e; color: #d4d4d4; padding: 10px;
                     border-radius: 4px; font-size: 12px; max-height: 160px; overflow: auto;"
            >{{ restartOutput }}</pre>
          </template>
          <a-empty v-else description="请先选择服务" />
        </a-card>
      </a-col>

      <!-- 日志检索 -->
      <a-col :span="8">
        <a-card title="日志检索" size="small">
          <a-space>
            <a-input
              v-model:value="keyword"
              placeholder="关键词（留空=最近日志）"
              style="width: 160px;"
              allow-clear
              @press-enter="searchLogs"
            />
            <a-select v-model:value="logLines" style="width: 90px;">
              <a-select-option :value="100">100 行</a-select-option>
              <a-select-option :value="300">300 行</a-select-option>
              <a-select-option :value="1000">1000 行</a-select-option>
            </a-select>
            <a-button type="primary" :loading="searching" @click="searchLogs">检索</a-button>
          </a-space>
          <div v-if="logResult?.matched !== undefined" style="margin-top: 8px;">
            <a-tag color="blue">命中 {{ logResult.matched }} 行</a-tag>
          </div>
          <pre
            v-if="logResult?.logs.length"
            style="margin-top: 8px; background: #1e1e1e; color: #d4d4d4; padding: 10px;
                   border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-break: break-all;
                   max-height: 300px; overflow: auto;"
          >{{ logResult.logs.join('\n') }}</pre>
          <div v-if="logError" style="margin-top: 8px; color: #cf1322;">{{ logError }}</div>
          <a-empty v-if="!logResult && !logError" style="margin-top: 12px;" description="检索本服务最近日志或按关键词过滤" />
        </a-card>
      </a-col>
    </a-row>

    <a-alert
      type="info"
      show-icon
      style="margin-top: 16px;"
      message="重启为运维操作，均留审计记录（可在审计日志页按 monitor.restart 查看）；服务名与关键词均做注入防护。"
    />
  </div>
</template>
