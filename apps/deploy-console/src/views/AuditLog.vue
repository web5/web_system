<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { auditApi } from '@/api'
import dayjs from 'dayjs'

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

const dataList = ref<AuditItem[]>([])
const total = ref(0)
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)

// 筛选条件
const filterEnv = ref<string | undefined>(undefined)
const filterAction = ref<string | undefined>(undefined)
const dateRange = ref<[string, string] | undefined>(undefined)

// 加载审计日志
async function loadData() {
  loading.value = true
  try {
    const res = await auditApi.list(currentPage.value, pageSize.value)
    total.value = res.total
    dataList.value = res.data
  } catch {
    // 静默处理
  } finally {
    loading.value = false
  }
}

// 分页变化
function handlePageChange(page: number, size: number) {
  currentPage.value = page
  pageSize.value = size
  loadData()
}

// 筛选
function handleFilter() {
  currentPage.value = 1
  loadData()
}

// 重置筛选
function handleReset() {
  filterEnv.value = undefined
  filterAction.value = undefined
  dateRange.value = undefined
  currentPage.value = 1
  loadData()
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
    pending: 'blue',
    running: 'orange',
  }
  return map[status] || 'default'
}

// 客户端筛选
const filteredData = ref<AuditItem[]>([])
function applyClientFilter() {
  filteredData.value = dataList.value.filter((item) => {
    if (filterEnv.value && item.env !== filterEnv.value) return false
    if (filterAction.value && item.action !== filterAction.value) return false
    if (dateRange.value) {
      const ts = dayjs(item.timestamp)
      if (
        ts.isBefore(dayjs(dateRange.value[0])) ||
        ts.isAfter(dayjs(dateRange.value[1]).add(1, 'day'))
      ) {
        return false
      }
    }
    return true
  })
}

// 监听筛选变化
import { watch } from 'vue'
watch([filterEnv, filterAction, dateRange, dataList], applyClientFilter, {
  immediate: true,
})

// 表格列定义
const columns = [
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180 },
  { title: '用户', dataIndex: 'user', key: 'user', width: 120 },
  { title: '操作', dataIndex: 'action', key: 'action', width: 120 },
  { title: '环境', dataIndex: 'env', key: 'env', width: 80 },
  { title: '组件', dataIndex: 'component', key: 'component', width: 120 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '详情', dataIndex: 'detail', key: 'detail', ellipsis: true },
]

onMounted(() => {
  loadData()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>审计日志</h2>
      <p>查看所有操作记录</p>
    </div>

    <a-card>
      <!-- 筛选区域 -->
      <a-space style="margin-bottom: 16px;" wrap>
        <a-select
          v-model:value="filterEnv"
          placeholder="环境"
          allow-clear
          style="width: 120px;"
          :options="[
            { label: '全部', value: undefined },
            { label: 'DEV', value: 'dev' },
            { label: 'PROD', value: 'prod' },
          ]"
        />
        <a-select
          v-model:value="filterAction"
          placeholder="操作类型"
          allow-clear
          style="width: 140px;"
          :options="[
            { label: '全部', value: undefined },
            { label: '部署', value: 'deploy' },
            { label: '回滚', value: 'rollback' },
            { label: '配置', value: 'config' },
            { label: '编辑', value: 'edit' },
          ]"
        />
        <a-range-picker v-model:value="dateRange" format="YYYY-MM-DD" />
        <a-button type="primary" @click="handleFilter">查询</a-button>
        <a-button @click="handleReset">重置</a-button>
      </a-space>

      <!-- 日志表格 -->
      <a-table
        :columns="columns"
        :data-source="filteredData"
        :loading="loading"
        :pagination="{
          current: currentPage,
          pageSize: pageSize,
          total: total,
          showSizeChanger: true,
          showTotal: (t: number) => `共 ${t} 条`,
          onChange: handlePageChange,
        }"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'timestamp'">
            {{ formatTime(record.timestamp) }}
          </template>
          <template v-if="column.key === 'env'">
            <a-tag :color="record.env === 'prod' ? 'red' : 'green'">
              {{ record.env?.toUpperCase() }}
            </a-tag>
          </template>
          <template v-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>
