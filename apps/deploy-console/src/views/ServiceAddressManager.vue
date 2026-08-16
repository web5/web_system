<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { serverApi, environmentApi } from '@/api'

const router = useRouter()

// ============ 状态 ============
const services = ref<any[]>([]) // [{ serviceName, serviceType, environments: [...] }]
const loading = ref(false)
const envList = ref<any[]>([])
// 默认选中所有环境作为列
const selectedEnvs = ref<string[]>([])

async function loadOverview() {
  loading.value = true
  try {
    const [rows, envs] = await Promise.all([
      serverApi.serviceOverview(),
      environmentApi.list(),
    ])
    services.value = rows
    envList.value = envs
    if (selectedEnvs.value.length === 0 && envs.length) {
      selectedEnvs.value = envs.map((e) => e.id)
    }
  } catch {
    message.error('加载服务列表失败')
  } finally {
    loading.value = false
  }
}

// 表格列：服务名 + 选中的环境列 + 操作
const tableColumns = computed(() => {
  const envCols = selectedEnvs.value.map((envId) => {
    const e = envList.value.find((x) => x.id === envId)
    return {
      title: e?.name || envId,
      key: `env-${envId}`,
      envId,
      width: 180,
    }
  })
  return [
    { title: '服务名', dataIndex: 'serviceName', key: 'serviceName', width: 160, fixed: 'left' },
    ...envCols,
    { title: '操作', key: 'action', width: 80, fixed: 'right' },
  ]
})

// 给行加点击 → 跳详情
function onRowClick(row: any) {
  router.push(`/services/${row.serviceName}`)
}

function gotoDetail(row: any) {
  router.push(`/services/${row.serviceName}`)
}

// 行内单元格：服务在该环境的地址
function cellAddress(row: any, envId: string): string {
  const e = row.environments.find((x: any) => x.envId === envId)
  return e?.address || '—'
}

onMounted(loadOverview)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>服务管理</h2>
      <p>维护后端服务在各环境的「服务环境」（服务地址 + 服务器组）。表格列是环境，单元格是该服务在该环境的地址。点击服务行进入详情编辑。</p>
    </div>

    <a-card :loading="loading">
      <div style="margin-bottom: 12px;">
        <span style="margin-right: 8px; color: #888;">环境列：</span>
        <a-checkbox-group v-model:value="selectedEnvs" :options="envList.map(e => ({ label: e.name, value: e.id }))" />
      </div>

      <a-table
        :columns="tableColumns"
        :data-source="services"
        :pagination="false"
        :row-key="(r: any) => r.serviceName"
        size="small"
        :scroll="{ x: 600 }"
        :locale="{ emptyText: '暂无 backend 模块，请先在「模块管理」创建' }"
        :custom-row="(record: any) => ({ onClick: () => onRowClick(record), style: 'cursor: pointer' })"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'serviceName'">
            <a style="color: #1677ff;">{{ record.serviceName }}</a>
          </template>
          <template v-else-if="column.key?.startsWith('env-')">
            <span :style="cellAddress(record, column.envId) === '—' ? 'color: #ccc' : ''">
              {{ cellAddress(record, column.envId) }}
            </span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click.stop="gotoDetail(record)">详情</a-button>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>