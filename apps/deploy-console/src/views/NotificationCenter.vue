<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { notificationApi, systemSettingsApi } from '@/api'
import { message } from 'ant-design-vue'

interface NotifyRow {
  id: string
  event: string
  env: string
  moduleKey: string
  versionTag: string | null
  status: string
  detail: string
  operator: string | null
  delivery: Record<string, string> | null
  createdAt: string
}

const loading = ref(false)
const rows = ref<NotifyRow[]>([])
const filterEvent = ref<string | undefined>(undefined)
const channels = ref<{ webhookUrl: string | null; wecomUrl: string | null } | null>(null)

const EVENT_LABELS: Record<string, string> = {
  'pipeline.succeeded': '发布成功',
  'pipeline.failed': '发布失败',
  'pipeline.auto-rollback': '自动回滚',
  'pipeline.rejected': '发布被拒（并发）',
  'deploy.pending-approval': '发布待审批',
  'deploy.approved': '审批通过',
  'deploy.rejected': '审批拒绝',
}

const filtered = computed(() => {
  if (!filterEvent.value) return rows.value
  return rows.value.filter((r) => r.event === filterEvent.value)
})

const statusColor = (status: string) =>
  status === 'success' ? 'green' : status === 'failed' ? 'red' : 'orange'

function eventLabel(e: string) {
  return EVENT_LABELS[e] || e
}

function deliveryText(d: Record<string, string> | null) {
  if (!d || Object.keys(d).length === 0) return '站内'
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${v.startsWith('ok') ? '已送达' : '失败'}`)
    .join(' · ')
}

function formatTime(ts: string) {
  return dayjs(ts).format('MM-DD HH:mm:ss')
}

async function load() {
  loading.value = true
  try {
    rows.value = await notificationApi.list(200)
  } catch {
    message.error('加载通知历史失败')
  } finally {
    loading.value = false
  }
}

async function loadChannels() {
  try {
    channels.value = await systemSettingsApi.getNotifyChannels()
  } catch {
    /* 静默 */
  }
}

onMounted(() => {
  load()
  loadChannels()
})
</script>

<template>
  <div>
    <a-card title="通知中心" :loading="loading">
      <template #extra>
        <a-space>
          <a-tag color="green">站内通知：开启</a-tag>
          <a-tag v-if="channels?.webhookUrl" color="blue">Webhook：已配置</a-tag>
          <a-tag v-else color="default">Webhook：未配置</a-tag>
          <a-tag v-if="channels?.wecomUrl" color="blue">企业微信：已配置</a-tag>
          <a-tag v-else color="default">企业微信：未配置</a-tag>
          <a-button size="small" @click="load">刷新</a-button>
        </a-space>
      </template>

      <div style="margin-bottom: 12px;">
        <a-space>
          <span style="color: #888;">事件类型：</span>
          <a-select
            v-model:value="filterEvent"
            placeholder="全部"
            allow-clear
            style="width: 180px;"
          >
            <a-select-option
              v-for="(label, value) in EVENT_LABELS"
              :key="value"
              :value="value"
            >
              {{ label }}
            </a-select-option>
          </a-select>
          <span style="color: #888;">共 {{ filtered.length }} 条</span>
        </a-space>
      </div>

      <a-table :data-source="filtered" row-key="id" size="small" :pagination="{ pageSize: 15 }">
        <a-table-column title="时间">
          <template #default="{ record }">{{ formatTime(record.createdAt) }}</template>
        </a-table-column>
        <a-table-column title="事件">
          <template #default="{ record }">
            <a-tag :color="statusColor(record.status)">{{ eventLabel(record.event) }}</a-tag>
          </template>
        </a-table-column>
        <a-table-column title="环境" data-index="env" width="70" />
        <a-table-column title="模块" data-index="moduleKey" />
        <a-table-column title="版本" data-index="versionTag" />
        <a-table-column title="操作人" data-index="operator" />
        <a-table-column title="详情" data-index="detail">
          <template #default="{ record }">
            <span :style="record.status === 'failed' ? 'color:#cf1322;' : ''">
              {{ record.detail }}
            </span>
          </template>
        </a-table-column>
        <a-table-column title="送达" width="170">
          <template #default="{ record }">
            <span style="color: #888; font-size: 12px;">
              {{ deliveryText(record.delivery) }}
            </span>
          </template>
        </a-table-column>
      </a-table>
    </a-card>
  </div>
</template>
