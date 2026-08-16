<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { serverApi, environmentApi, moduleApi } from '@/api'

const route = useRoute()
const router = useRouter()
const serviceKey = computed(() => String(route.params.key || ''))

const loading = ref(false)
const envList = ref<any[]>([])
const serverNameOptions = ref<string[]>([])
const moduleInfo = ref<any>(null)
const overview = ref<any | null>(null) // 当前服务的 overview 项 { serviceName, environments }

async function load() {
  loading.value = true
  try {
    const [rows, envs, servers, mod] = await Promise.all([
      serverApi.serviceOverview(),
      environmentApi.list(),
      serverApi.listServers(),
      moduleApi.get(serviceKey.value),
    ])
    envList.value = envs
    serverNameOptions.value = Array.from(new Set(servers.map((s) => s.serverName)))
    moduleInfo.value = mod
    overview.value = rows.find((r: any) => r.serviceName === serviceKey.value) || {
      serviceName: serviceKey.value,
      serviceType: mod.type || 'backend',
      environments: envs.map((e) => ({ envId: e.id, address: '', serverName: '', port: undefined })),
    }
  } catch {
    message.error('加载服务详情失败')
  } finally {
    loading.value = false
  }
}

function envName(envId: string): string {
  const e = envList.value.find((x) => x.id === envId)
  return e ? `${e.name}（${e.id}）` : envId
}

async function saveAddress(envRow: any, val: string) {
  const env = envList.value.find((e) => e.id === envRow.envId)
  if (!env) return
  const ports = { ...(env.ports || {}) }
  const trimmed = (val || '').trim()
  if (trimmed) {
    ports[serviceKey.value] = trimmed
  } else {
    delete ports[serviceKey.value]
  }
  try {
    await environmentApi.update(envRow.envId, { ports })
    message.success(`已更新 ${serviceKey.value}@${envRow.envId} 地址`)
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
      serviceName: serviceKey.value,
      serverName: val || '',
      port: envRow.port,
    })
    message.success(`已更新 ${serviceKey.value}@${envRow.envId} 服务器组`)
    envRow.serverName = val || ''
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存服务器组失败')
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px;">
      <a-button type="link" @click="router.back()">← 返回</a-button>
      <h2 style="margin: 0;">服务详情</h2>
      <a-tag color="blue">{{ serviceKey }}</a-tag>
    </div>

    <!-- 服务元信息 -->
    <a-card v-if="moduleInfo" :loading="loading" style="margin-bottom: 16px;">
      <a-descriptions :column="3" size="small" bordered>
        <a-descriptions-item label="服务 key">{{ moduleInfo.key }}</a-descriptions-item>
        <a-descriptions-item label="服务名">{{ moduleInfo.name }}</a-descriptions-item>
        <a-descriptions-item label="类型">
          <a-tag color="blue">{{ moduleInfo.type }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="服务简介" :span="3">
          {{ moduleInfo.description || '—' }}
        </a-descriptions-item>
        <a-descriptions-item label="代码目录">{{ moduleInfo.dir }}</a-descriptions-item>
        <a-descriptions-item label="pm2 进程">{{ moduleInfo.pm2 || '—' }}</a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- 服务环境列表 -->
    <a-card :loading="loading" title="服务环境">
      <p style="color: #666; margin-bottom: 12px;">
        该服务在所有环境的「服务环境」。环境在「环境管理」中增删，此处自动同步列出；逐个编辑服务地址（ip:端口）和服务器组。
      </p>

      <a-table
        :columns="[
          { title: '环境', dataIndex: 'envId', key: 'envId', width: 200 },
          { title: '服务地址（ip:端口）', key: 'address', width: 360 },
          { title: '服务器组', key: 'serverName', width: 260 },
        ]"
        :data-source="overview?.environments || []"
        :pagination="false"
        :row-key="(r: any) => r.envId"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'envId'">
            {{ envName(record.envId) }}
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
  </div>
</template>