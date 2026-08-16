<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { moduleApi, deployApi } from '@/api'

const route = useRoute()
const router = useRouter()
const moduleKey = computed(() => String(route.params.key || ''))

const moduleInfo = ref<any>(null)
const moduleLoading = ref(false)

const data = ref<{
  environments: any[]
  versionHistory: any[]
} | null>(null)
const dataLoading = ref(false)

const TYPE_LABELS: Record<string, string> = {
  backend: '后端服务',
  frontend: '前端模块',
  'micro-frontend': '微前端模块',
  'mini-app': '小程序',
}

// 后端模块 → 后台 tab，前端模块 → 前端 tab
const showBackendTab = computed(() => moduleInfo.value?.type === 'backend')
const showFrontendTab = computed(() =>
  ['frontend', 'micro-frontend', 'mini-app'].includes(moduleInfo.value?.type),
)
// 默认激活的 tab
const activeTab = ref<string>('')

async function loadModule() {
  moduleLoading.value = true
  try {
    moduleInfo.value = await moduleApi.get(moduleKey.value)
    activeTab.value = showBackendTab.value ? 'backend' : 'frontend'
  } catch {
    message.error('加载模块详情失败')
  } finally {
    moduleLoading.value = false
  }
}

async function loadDeployments() {
  dataLoading.value = true
  try {
    data.value = await deployApi.moduleDeployments(moduleKey.value)
  } catch {
    message.error('加载部署数据失败')
  } finally {
    dataLoading.value = false
  }
}

async function doBuild() {
  try {
    const r = await deployApi.build(moduleKey.value)
    message.success(`构建任务已创建：${r.taskId}`)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '构建失败')
  }
}

async function doRollback(row: any) {
  try {
    await deployApi.rollback(row.env, row.versionTag, true)
    message.success(`已回滚 ${row.env} → ${row.versionTag}`)
    await loadDeployments()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '回滚失败')
  }
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('zh-CN')
}

onMounted(async () => {
  await Promise.all([loadModule(), loadDeployments()])
})
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px;">
      <a-button type="link" @click="router.back()">← 返回</a-button>
      <h2 style="margin: 0;">模块详情</h2>
      <a-tag v-if="moduleInfo" color="blue">{{ moduleInfo.key }}</a-tag>
      <a-tag v-if="moduleInfo?.builtin" color="gold">内置</a-tag>
    </div>

    <!-- 模块元信息 -->
    <a-card v-if="moduleInfo" :loading="moduleLoading" style="margin-bottom: 16px;">
      <a-descriptions :column="3" size="small" bordered>
        <a-descriptions-item label="名称">{{ moduleInfo.name }}</a-descriptions-item>
        <a-descriptions-item label="类型">
          <a-tag>{{ TYPE_LABELS[moduleInfo.type] || moduleInfo.type }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="代码目录">{{ moduleInfo.dir }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.pm2" label="pm2 进程">{{ moduleInfo.pm2 }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.publicPath" label="publicPath">{{ moduleInfo.publicPath }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.buildCmd" label="buildCmd">{{ moduleInfo.buildCmd }}</a-descriptions-item>
        <a-descriptions-item label="启用">
          <a-tag :color="moduleInfo.enabled !== false ? 'green' : 'default'">
            {{ moduleInfo.enabled !== false ? '启用' : '禁用' }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>
      <div style="margin-top: 12px;">
        <a-button type="primary" @click="doBuild">构建</a-button>
      </div>
    </a-card>

    <!-- 前端 / 后台 tab -->
    <a-card v-if="moduleInfo" :loading="dataLoading">
      <a-tabs v-model:active-key="activeTab">
        <!-- 后台 tab -->
        <a-tab-pane v-if="showBackendTab" key="backend" tab="后台">
          <h3 style="margin-bottom: 12px; font-size: 15px;">当前部署（环境 × 版本）</h3>
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
              { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion' },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '部署时间', dataIndex: 'deployedAt', key: 'deployedAt', width: 180 },
              { title: '部署人', dataIndex: 'deployedBy', key: 'deployedBy', width: 120 },
            ]"
            :data-source="data?.environments || []"
            :pagination="false"
            row-key="envId"
            size="small"
            :locale="{ emptyText: '该模块在所有环境均未部署' }"
          />

          <h3 style="margin: 24px 0 12px; font-size: 15px;">版本历史（可回滚）</h3>
          <a-table
            :columns="[
              { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 200 },
              { title: '环境', dataIndex: 'env', key: 'env', width: 100 },
              { title: 'git commit', dataIndex: 'gitCommit', key: 'gitCommit', width: 140 },
              { title: '发布时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 180 },
              { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '操作', key: 'action', width: 100 },
            ]"
            :data-source="data?.versionHistory || []"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无版本历史' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'releasedAt'">{{ fmtDate(record.releasedAt) }}</template>
              <template v-else-if="column.key === 'action'">
                <a-popconfirm
                  :title="`回滚 ${record.env} 到 ${record.versionTag}？`"
                  ok-text="回滚"
                  cancel-text="取消"
                  @confirm="doRollback(record)"
                >
                  <a-button type="link" size="small">回滚到此版本</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 前端 tab -->
        <a-tab-pane v-if="showFrontendTab" key="frontend" tab="前端">
          <h3 style="margin-bottom: 12px; font-size: 15px;">当前部署（环境 × 版本）</h3>
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
              { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion' },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '部署时间', dataIndex: 'deployedAt', key: 'deployedAt', width: 180 },
              { title: '部署人', dataIndex: 'deployedBy', key: 'deployedBy', width: 120 },
            ]"
            :data-source="data?.environments || []"
            :pagination="false"
            row-key="envId"
            size="small"
            :locale="{ emptyText: '该模块在所有环境均未部署' }"
          />

          <h3 style="margin: 24px 0 12px; font-size: 15px;">版本历史（可回滚）</h3>
          <a-table
            :columns="[
              { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 200 },
              { title: '环境', dataIndex: 'env', key: 'env', width: 100 },
              { title: 'git commit', dataIndex: 'gitCommit', key: 'gitCommit', width: 140 },
              { title: '发布时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 180 },
              { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '操作', key: 'action', width: 100 },
            ]"
            :data-source="data?.versionHistory || []"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无版本历史' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'releasedAt'">{{ fmtDate(record.releasedAt) }}</template>
              <template v-else-if="column.key === 'action'">
                <a-popconfirm
                  :title="`回滚 ${record.env} 到 ${record.versionTag}？`"
                  ok-text="回滚"
                  cancel-text="取消"
                  @confirm="doRollback(record)"
                >
                  <a-button type="link" size="small">回滚到此版本</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 两个 tab 都不显示时的兜底 -->
        <a-empty v-if="!showBackendTab && !showFrontendTab" description="该模块类型暂不支持版本管理" />
      </a-tabs>
    </a-card>
  </div>
</template>