<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { auditApi } from '@/api'
import dayjs from 'dayjs'

interface AuditChange {
  field: string
  before?: unknown
  after?: unknown
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
  changes?: AuditChange[]
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
  { title: '变更', dataIndex: 'changes', key: 'changes', width: 90 },
  { title: '详情', dataIndex: 'detail', key: 'detail', ellipsis: true },
]

// ===== 变更 diff 抽屉 =====
const diffVisible = ref(false)
const diffRecord = ref<AuditItem | null>(null)
function openDiff(record: AuditItem) {
  diffRecord.value = record
  diffVisible.value = true
}
function valText(v: unknown): string {
  if (v === null || v === undefined) return '（空）'
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

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
          <template v-if="column.key === 'changes'">
            <a-button
              v-if="record.changes?.length"
              type="link"
              size="small"
              @click="openDiff(record)"
            >
              {{ record.changes.length }} 处变更 →
            </a-button>
            <span v-else style="color: #bbb;">—</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 变更明细抽屉 -->
    <a-drawer v-model:open="diffVisible" title="变更明细（前后 diff）" placement="right" :width="680">
      <template v-if="diffRecord">
        <a-descriptions :column="2" size="small" bordered style="margin-bottom: 16px;">
          <a-descriptions-item label="时间">{{ formatTime(diffRecord.timestamp) }}</a-descriptions-item>
          <a-descriptions-item label="操作人">{{ diffRecord.user }}</a-descriptions-item>
          <a-descriptions-item label="操作">{{ diffRecord.action }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(diffRecord.status)">{{ diffRecord.status }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="环境">{{ diffRecord.env?.toUpperCase() || '-' }}</a-descriptions-item>
          <a-descriptions-item label="模块">{{ diffRecord.component || '-' }}</a-descriptions-item>
          <a-descriptions-item label="详情" :span="2">{{ diffRecord.detail }}</a-descriptions-item>
        </a-descriptions>

        <a-empty v-if="!(diffRecord.changes || []).length" description="无字段级变更记录" />
        <div
          v-for="c in diffRecord.changes || []"
          :key="c.field"
          style="margin-bottom: 14px;"
        >
          <div style="font-weight: 600; margin-bottom: 4px; font-size: 13px;">{{ c.field }}</div>
          <div style="display: flex; gap: 8px; align-items: flex-start;">
            <div
              style="flex: 1; background: #fff1f0; border: 1px solid #ffa39e; border-radius: 4px;
                     padding: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap;
                     word-break: break-all; max-height: 220px; overflow: auto;"
            >
              {{ valText(c.before) }}
            </div>
            <span style="color: #aaa; margin-top: 8px;">→</span>
            <div
              style="flex: 1; background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 4px;
                     padding: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap;
                     word-break: break-all; max-height: 220px; overflow: auto;"
            >
              {{ valText(c.after) }}
            </div>
          </div>
        </div>
      </template>
    </a-drawer>
  </div>
</template>
