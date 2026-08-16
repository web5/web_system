<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { moduleApi } from '@/api'

const router = useRouter()

const services = ref<any[]>([])
const loading = ref(false)

async function loadServices() {
  loading.value = true
  try {
    const list = await moduleApi.list()
    services.value = list.filter((m: any) => m.type === 'backend')
  } catch {
    message.error('加载服务列表失败')
  } finally {
    loading.value = false
  }
}

function gotoDetail(row: any) {
  router.push(`/services/${row.key}`)
}

const typeLabel = (t: string) =>
  ({ backend: '后端服务', frontend: '前端模块', 'micro-frontend': '微前端模块', 'mini-app': '小程序' }[t] || t)

onMounted(loadServices)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>服务管理</h2>
      <p>后端服务列表，展示服务 key、名称、简介等元信息。点击服务行进入详情，维护该服务在多个环境的「服务环境」（服务地址 + 服务器组）。</p>
    </div>

    <a-card :loading="loading">
      <div style="margin-bottom: 12px; display: flex; justify-content: space-between;">
        <span>共 {{ services.length }} 个后端服务</span>
        <a-button @click="loadServices">刷新</a-button>
      </div>

      <a-table
        :columns="[
          { title: '服务 key', dataIndex: 'key', key: 'key', width: 180 },
          { title: '服务名', dataIndex: 'name', key: 'name', width: 180 },
          { title: '服务简介', dataIndex: 'description', key: 'description' },
          { title: '类型', dataIndex: 'type', key: 'type', width: 140 },
          { title: '操作', key: 'action', width: 80 },
        ]"
        :data-source="services"
        :pagination="false"
        :row-key="(r: any) => r.key"
        size="small"
        :locale="{ emptyText: '暂无后端服务，请先在「模块管理」创建 backend 模块' }"
        :custom-row="(record: any) => ({ onClick: () => gotoDetail(record), style: 'cursor: pointer' })"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'key'">
            <a style="color: #1677ff;">{{ record.key }}</a>
          </template>
          <template v-else-if="column.key === 'description'">
            <span :style="record.description ? '' : 'color: #ccc'">{{ record.description || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag color="blue">{{ typeLabel(record.type) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click.stop="gotoDetail(record)">详情</a-button>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>