<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { cleanupScanApi, environmentApi, type CleanupScanRow } from '@/api'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'

/**
 * 清理巡检（诊断 #18 / #10 的观测面板）。
 *
 * 定位：**只回答「如果开开关会删什么」，本身一条都不删**。
 * 保留策略与远端产物清理都是不可逆动作，正确姿势是先连续观察若干天，
 * 数字稳定了再开开关 —— 本页就是给这若干天提供可对比的记录。
 */

const rows = ref<CleanupScanRow[]>([])
const loading = ref(false)
const running = ref<'retention' | 'remote' | ''>('')

// 筛选
const filterKind = ref<string | undefined>(undefined)
const filterEnv = ref<string | undefined>(undefined)

// 远端巡检参数
const remoteEnv = ref('prod')
const remoteModule = ref<string | undefined>(undefined)
const environments = ref<{ id: string; name: string }[]>([])

const kindOptions = [
  { label: '全部类型', value: undefined },
  { label: '数据保留（库表）', value: 'retention' },
  { label: '远端产物（版本目录）', value: 'remote' },
]
const envOptions = computed(() => [
  { label: '全部环境', value: undefined },
  ...environments.value.map((e) => ({ label: e.name, value: e.id })),
])

// 详情抽屉
const detailOpen = ref(false)
const detail = ref<CleanupScanRow | null>(null)

const columns = [
  { title: '巡检时间', dataIndex: 'scanTime', key: 'scanTime', width: 170 },
  { title: '类型', dataIndex: 'kind', key: 'kind', width: 130 },
  { title: '环境', dataIndex: 'env', key: 'env', width: 90 },
  { title: '组件/维度', dataIndex: 'component', key: 'component', width: 180, ellipsis: true },
  { title: '结论', dataIndex: 'status', key: 'status', width: 110 },
  { title: '候选', dataIndex: 'candidateCount', key: 'candidateCount', width: 90 },
  { title: '已删', dataIndex: 'deletedCount', key: 'deletedCount', width: 90 },
  { title: '操作人', dataIndex: 'operator', key: 'operator', width: 110 },
  { title: '操作', key: 'action', width: 90 },
]

const statusMeta: Record<string, { color: string; text: string }> = {
  'dry-run': { color: 'blue', text: '只观测' },
  deleted: { color: 'orange', text: '已删除' },
  skipped: { color: 'default', text: '跳过' },
  error: { color: 'red', text: '出错' },
}

function kindText(kind: string) {
  return kind === 'retention' ? '数据保留' : kind === 'remote' ? '远端产物' : kind
}

function formatTime(ms: number) {
  return ms ? dayjs(ms).format('YYYY-MM-DD HH:mm:ss') : '-'
}

async function loadEnvironments() {
  try {
    environments.value = await environmentApi.list()
    if (!environments.value.some((e) => e.id === remoteEnv.value) && environments.value.length) {
      remoteEnv.value = environments.value[environments.value.length - 1].id
    }
  } catch {
    environments.value = []
  }
}

async function loadData() {
  loading.value = true
  try {
    rows.value = await cleanupScanApi.list({
      kind: filterKind.value,
      env: filterEnv.value,
      limit: 100,
    })
  } catch (e: any) {
    message.error(e?.message || '巡检记录加载失败')
  } finally {
    loading.value = false
  }
}

async function runRetention() {
  running.value = 'retention'
  try {
    const r = await cleanupScanApi.runRetention()
    message.success(`数据保留巡检完成：候选 ${r.scan.candidateCount} 条${r.scan.deletedCount ? `、已删 ${r.scan.deletedCount} 条` : '（未删除）'}`)
    await loadData()
  } catch (e: any) {
    message.error(e?.message || '数据保留巡检失败')
  } finally {
    running.value = ''
  }
}

async function runRemote() {
  running.value = 'remote'
  try {
    const r = await cleanupScanApi.runRemote(remoteEnv.value, remoteModule.value || undefined)
    const total = r.outcomes.reduce((s, o) => s + o.remove.length, 0)
    message.success(
      r.outcomes.length
        ? `远端巡检完成（${remoteEnv.value}）：${r.outcomes.length} 个模块、候选 ${total} 个（未删除）`
        : `远端巡检完成（${remoteEnv.value}）：该环境没有已知模块`,
    )
    await loadData()
  } catch (e: any) {
    message.error(e?.message || '远端产物巡检失败')
  } finally {
    running.value = ''
  }
}

function openDetail(row: CleanupScanRow) {
  detail.value = row
  detailOpen.value = true
}

/** 候选清单里最后一条可能是截断标记，单独挑出来提示 */
const detailItems = computed(() => {
  const items = detail.value?.items ?? []
  const marker = items.filter((i) => i.startsWith('…'))
  return { list: items.filter((i) => !i.startsWith('…')), marker }
})

onMounted(async () => {
  await loadEnvironments()
  await loadData()
})
</script>

<template>
  <div class="page">
    <a-alert type="info" show-icon banner style="margin-bottom: 16px">
      <template #message>
        本页<strong>只观测、不删除</strong>：回答「如果现在打开清理开关，会删掉什么」。
        结论会落库，可连续观察多天再决定开不开
        <code>RETENTION_ENABLED</code> / <code>REMOTE_CLEANUP_ENABLED</code>。
      </template>
    </a-alert>

    <a-card :bordered="false" title="巡检记录">
      <template #extra>
        <a-space>
          <a-select v-model:value="filterKind" :options="kindOptions" style="width: 170px" @change="loadData" />
          <a-select v-model:value="filterEnv" :options="envOptions" style="width: 130px" @change="loadData" />
          <a-button @click="loadData">刷新</a-button>
        </a-space>
      </template>

      <a-space style="margin-bottom: 16px" wrap>
        <a-button type="primary" :loading="running === 'retention'" @click="runRetention">
          跑一次数据保留巡检
        </a-button>
        <a-space>
          <a-select v-model:value="remoteEnv" :options="environments.map((e) => ({ label: e.name, value: e.id }))" style="width: 130px" />
          <a-input v-model:value="remoteModule" placeholder="模块 key（留空=全部）" style="width: 200px" />
          <a-button :loading="running === 'remote'" @click="runRemote">跑一次远端产物巡检</a-button>
        </a-space>
      </a-space>

      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="{ pageSize: 10 }"
        row-key="id"
        size="middle"
      >
        <template #emptyText>
          <a-empty description="还没有巡检记录 —— 先跑一次（不会删任何东西）" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'scanTime'">{{ formatTime((record as CleanupScanRow).scanTime) }}</template>
          <template v-else-if="column.key === 'kind'">{{ kindText((record as CleanupScanRow).kind) }}</template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusMeta[(record as CleanupScanRow).status]?.color || 'default'">
              {{ statusMeta[(record as CleanupScanRow).status]?.text || (record as CleanupScanRow).status }}
            </a-tag>
            <a-tag v-if="(record as CleanupScanRow).dryRun" color="green">未删除</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a @click="openDetail(record as CleanupScanRow)">详情</a>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-drawer v-model:open="detailOpen" :title="`巡检详情 · ${detail?.id || ''}`" width="720">
      <template v-if="detail">
        <a-descriptions :column="2" bordered size="small" style="margin-bottom: 16px">
          <a-descriptions-item label="类型">{{ kindText(detail.kind) }}</a-descriptions-item>
          <a-descriptions-item label="环境">{{ detail.env }}</a-descriptions-item>
          <a-descriptions-item label="组件/维度">{{ detail.component }}</a-descriptions-item>
          <a-descriptions-item label="操作人">{{ detail.operator || '-' }}</a-descriptions-item>
          <a-descriptions-item label="候选总数">{{ detail.candidateCount }}</a-descriptions-item>
          <a-descriptions-item label="实删数">{{ detail.deletedCount }}</a-descriptions-item>
          <a-descriptions-item label="巡检时间">{{ formatTime(detail.scanTime) }}</a-descriptions-item>
          <a-descriptions-item label="结论">{{ detail.status }}</a-descriptions-item>
          <a-descriptions-item label="说明" :span="2">{{ detail.reason || '-' }}</a-descriptions-item>
        </a-descriptions>

        <h4>分维度汇总</h4>
        <a-table
          :columns="[
            { title: '维度', dataIndex: 'key', key: 'key' },
            { title: '候选', dataIndex: 'candidates', key: 'candidates', width: 80 },
            { title: '已删', dataIndex: 'deleted', key: 'deleted', width: 80 },
            { title: '受保护', dataIndex: 'protectedRows', key: 'protectedRows', width: 90 },
            { title: '扫描到', dataIndex: 'scanned', key: 'scanned', width: 90 },
            { title: '备注', dataIndex: 'note', key: 'note' },
          ]"
          :data-source="detail.summary || []"
          :pagination="false"
          row-key="key"
          size="small"
        />

        <template v-if="detailItems.list.length">
          <h4 style="margin-top: 16px">候选清单（{{ detailItems.list.length }} 条）</h4>
          <div class="item-list">
            <a-tag v-for="it in detailItems.list" :key="it">{{ it }}</a-tag>
          </div>
          <a-alert v-if="detailItems.marker.length" type="warning" show-icon :message="detailItems.marker[0]" style="margin-top: 8px" />
        </template>
      </template>
    </a-drawer>
  </div>
</template>

<style scoped>
.page {
  padding: 4px;
}
.item-list {
  max-height: 320px;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
h4 {
  margin: 0 0 8px;
  font-weight: 600;
}
</style>
