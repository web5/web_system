<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { message } from 'ant-design-vue'
import { serverApi, environmentApi } from '@/api'

// ============ 状态 ============
const overview = ref<any[]>([])
const loading = ref(false)
const envList = ref<any[]>([])
const serverNameOptions = ref<string[]>([])
const envFilter = ref<string | undefined>(undefined)

async function loadOverview() {
  loading.value = true
  try {
    const [rows, envs, servers] = await Promise.all([
      serverApi.serviceOverview(),
      environmentApi.list(),
      serverApi.listServers(),
    ])
    overview.value = rows
    envList.value = envs
    serverNameOptions.value = Array.from(new Set(servers.map((s) => s.serverName)))
  } catch {
    message.error('加载服务地址失败')
  } finally {
    loading.value = false
  }
}

const filteredRows = computed(() => {
  if (!envFilter.value) return overview.value
  return overview.value.filter((r) => r.envId === envFilter.value)
})

// ============ 编辑服务地址（写回 environments.ports） ============
async function saveAddress(row: any, val: string) {
  const env = envList.value.find((e) => e.id === row.envId)
  if (!env) return
  const ports = { ...(env.ports || {}) }
  const trimmed = (val || '').trim()
  if (trimmed) {
    ports[row.serviceName] = trimmed
  } else {
    delete ports[row.serviceName]
  }
  try {
    await environmentApi.update(row.envId, { ports })
    message.success(`已更新 ${row.serviceName}@${row.envId} 地址`)
    // 本地同步
    row.address = trimmed
    env.ports = ports
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存地址失败')
  }
}

// ============ 编辑服务器组（写回 env_service_routes） ============
async function saveServerName(row: any, val: string) {
  try {
    await serverApi.createRoute({
      envId: row.envId,
      serviceName: row.serviceName,
      serverName: val || '',
    })
    message.success(`已更新 ${row.serviceName}@${row.envId} 服务器组`)
    row.serverName = val || ''
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存服务器组失败')
  }
}

onMounted(loadOverview)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>服务管理</h2>
      <p>维护后端服务在各环境的「服务地址（ip:端口 / 域名）」和「服务器组」映射。地址写入环境 ports，服务器组写入环境服务路由。</p>
    </div>

    <a-card>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <a-space>
          <span>共 {{ filteredRows.length }} 条（服务 × 环境）</span>
          <a-select
            v-model:value="envFilter"
            placeholder="按环境筛选"
            allow-clear
            style="width: 200px;"
          >
            <a-select-option v-for="e in envList" :key="e.id" :value="e.id">
              {{ e.name }}（{{ e.id }}）
            </a-select-option>
          </a-select>
        </a-space>
        <a-button @click="loadOverview">刷新</a-button>
      </div>

      <a-table
        :columns="[
          { title: '服务名', dataIndex: 'serviceName', key: 'serviceName', width: 180, fixed: 'left' },
          { title: '环境', dataIndex: 'envId', key: 'envId', width: 100 },
          { title: '服务地址（ip:端口）', dataIndex: 'address', key: 'address', width: 300 },
          { title: '服务器组', dataIndex: 'serverName', key: 'serverName', width: 220 },
        ]"
        :data-source="filteredRows"
        :loading="loading"
        :pagination="false"
        :row-key="(r: any) => r.serviceName + ':' + r.envId"
        size="small"
        :scroll="{ x: 900 }"
        :locale="{ emptyText: '暂无数据，请先在「模块管理」创建 backend 模块' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'serviceName'">
            <strong>{{ record.serviceName }}</strong>
          </template>
          <template v-else-if="column.key === 'address'">
            <a-input
              :value="record.address"
              placeholder="如 127.0.0.1:6000"
              style="width: 260px;"
              @press-enter="(e: any) => saveAddress(record, e.target.value)"
              @blur="(e: any) => { const v = e.target.value; if (v !== record.address) saveAddress(record, v) }"
            />
          </template>
          <template v-else-if="column.key === 'serverName'">
            <a-select
              :value="record.serverName || undefined"
              placeholder="选择服务器组"
              allow-clear
              style="width: 180px;"
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
  </div>
</template>