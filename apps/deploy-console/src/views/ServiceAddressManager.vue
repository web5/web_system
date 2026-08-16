<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { serverApi, environmentApi } from '@/api'

// ============ 状态 ============
const services = ref<any[]>([]) // [{ serviceName, serviceType, environments: [...] }]
const loading = ref(false)
const envList = ref<any[]>([])
const serverNameOptions = ref<string[]>([])
const activeService = ref<string>('')

async function loadOverview() {
  loading.value = true
  try {
    const [rows, envs, servers] = await Promise.all([
      serverApi.serviceOverview(),
      environmentApi.list(),
      serverApi.listServers(),
    ])
    services.value = rows
    envList.value = envs
    serverNameOptions.value = Array.from(new Set(servers.map((s) => s.serverName)))
    if (rows.length && !activeService.value) {
      activeService.value = rows[0].serviceName
    }
  } catch {
    message.error('加载服务环境失败')
  } finally {
    loading.value = false
  }
}

function currentService(): any {
  return services.value.find((s) => s.serviceName === activeService.value)
}

function envName(envId: string): string {
  const e = envList.value.find((x) => x.id === envId)
  return e ? `${e.name}（${e.id}）` : envId
}

// ============ 编辑服务地址（写回 environments.ports） ============
async function saveAddress(envRow: any, val: string) {
  const env = envList.value.find((e) => e.id === envRow.envId)
  if (!env) return
  const ports = { ...(env.ports || {}) }
  const trimmed = (val || '').trim()
  if (trimmed) {
    ports[activeService.value] = trimmed
  } else {
    delete ports[activeService.value]
  }
  try {
    await environmentApi.update(envRow.envId, { ports })
    message.success(`已更新 ${activeService.value}@${envRow.envId} 地址`)
    envRow.address = trimmed
    env.ports = ports
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存地址失败')
  }
}

// ============ 编辑服务器组（写回 env_service_routes） ============
async function saveServerName(envRow: any, val: string) {
  try {
    await serverApi.createRoute({
      envId: envRow.envId,
      serviceName: activeService.value,
      serverName: val || '',
      port: envRow.port,
    })
    message.success(`已更新 ${activeService.value}@${envRow.envId} 服务器组`)
    envRow.serverName = val || ''
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
      <p>每个服务有多个「服务环境」（服务 × 环境）。服务环境 = 服务地址（ip:端口）+ 服务器组，逐服务用 tab 维护。</p>
    </div>

    <a-card :loading="loading">
      <a-tabs v-model:active-key="activeService" tab-position="left" type="editable-card" hide-add>
        <a-tab-pane v-for="s in services" :key="s.serviceName" :tab="s.serviceName">
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 160 },
              { title: '服务地址（ip:端口）', key: 'address', width: 320 },
              { title: '服务器组', key: 'serverName', width: 260 },
            ]"
            :data-source="s.environments"
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
                  style="width: 280px;"
                  @press-enter="(e: any) => saveAddress(record, e.target.value)"
                  @blur="(e: any) => { const v = e.target.value; if (v !== record.address) saveAddress(record, v) }"
                />
              </template>
              <template v-else-if="column.key === 'serverName'">
                <a-select
                  :value="record.serverName || undefined"
                  placeholder="选择服务器组"
                  allow-clear
                  style="width: 200px;"
                  @change="(v: any) => saveServerName(record, v || '')"
                >
                  <a-select-option v-for="n in serverNameOptions" :key="n" :value="n">
                    {{ n }}
                  </a-select-option>
                </a-select>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
      </a-tabs>

      <a-empty v-if="!services.length" description="暂无 backend 模块，请先在「模块管理」创建" style="margin: 40px 0;" />
    </a-card>
  </div>
</template>