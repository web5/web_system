<script setup lang="ts">
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
import { configApi, auditApi } from '@/api'

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
    envList.value = await configApi.environments()
  } catch {
    // 静默处理
  }
}

// 加载最近操作
async function loadRecentActions() {
  loading.value = true
  try {
    const res = await auditApi.list(1, 10)
    recentActions.value = res.items
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

onMounted(() => {
  loadEnvs()
  loadRecentActions()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>环境总览</h2>
      <p>查看各环境运行状态及最近操作</p>
    </div>

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
                <span style="margin-left: 8px; color: rgba(0,0,0,0.45);">
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
                <span style="margin-left: 8px; color: rgba(0,0,0,0.45);">
                  {{ item.detail }}
                </span>
              </template>
              <template #avatar>
                <span style="color: rgba(0,0,0,0.45); font-size: 12px;">
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
