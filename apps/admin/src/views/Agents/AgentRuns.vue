<template>
  <a-page-header
    :title="`${agentName || agentId} 的对话记录`"
    sub-title="查看该 Agent 的每次运行：原始输入、输出、工具调用"
    @back="goBack"
  >
    <template #extra>
      <a-button type="link" @click="goManage">定义管理</a-button>
      <a-button type="primary" :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

  <a-card :bordered="true">
    <!-- 过滤栏 -->
    <a-form layout="inline" :model="filters" class="filter-bar">
      <a-form-item label="Agent">
        <a-select
          v-model:value="filters.agentId"
          placeholder="全部"
          allow-clear
          style="width: 200px"
          @change="onAgentChange"
        >
          <a-select-option v-for="a in allAgents" :key="a.agentId" :value="a.agentId">
            {{ a.agentName || a.agentId }}
          </a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="用户">
        <a-input
          v-model:value="filters.userId"
          placeholder="userId"
          allow-clear
          style="width: 140px"
          @change="reload"
        />
      </a-form-item>
      <a-form-item label="状态">
        <a-select
          v-model:value="filters.status"
          placeholder="全部"
          allow-clear
          style="width: 120px"
          @change="reload"
        >
          <a-select-option value="ok">成功</a-select-option>
          <a-select-option value="error">失败</a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="关键字">
        <a-input
          v-model:value="filters.keyword"
          placeholder="搜索用户输入"
          allow-clear
          style="width: 200px"
          @press-enter="reload"
        />
      </a-form-item>
      <a-form-item>
        <a-button type="primary" @click="reload">查询</a-button>
        <a-button style="margin-left: 8px" @click="resetFilters">重置</a-button>
      </a-form-item>
    </a-form>

    <!-- run 列表 -->
    <a-table
      :columns="columns"
      :data-source="runs"
      :loading="loading"
      :pagination="pagination"
      row-key="id"
      size="small"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'status'">
          <a-tag :color="record.status === 'ok' ? 'green' : 'red'">
            {{ record.status === 'ok' ? '成功' : '失败' }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'userInputPreview'">
          <a-tooltip :title="record.userInputPreview">
            <span class="cell-truncate">{{ record.userInputPreview || '—' }}</span>
          </a-tooltip>
        </template>
        <template v-else-if="column.dataIndex === 'finalAnswerPreview'">
          <a-tooltip :title="record.finalAnswerPreview || '—'">
            <span class="cell-truncate">{{ record.finalAnswerPreview || '—' }}</span>
          </a-tooltip>
        </template>
        <template v-else-if="column.dataIndex === 'durationMs'">
          {{ record.durationMs != null ? `${record.durationMs} ms` : '—' }}
        </template>
        <template v-else-if="column.dataIndex === 'source'">
          <a-tag :color="record.source === 'ai-service' ? 'blue' : 'purple'">
            {{ record.source }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'createdAt'">
          {{ formatDateTime(record.createdAt) }}
        </template>
        <template v-else-if="column.dataIndex === 'actions'">
          <a-button type="link" size="small" @click="goDetail(record)">原始数据</a-button>
        </template>
      </template>
    </a-table>
  </a-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import dayjs from 'dayjs';
import { listAgents, listAgentRuns, type AgentSummary, type AgentRunListItem } from '@/api/agents';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const runs = ref<AgentRunListItem[]>([]);
const total = ref(0);
const allAgents = ref<AgentSummary[]>([]);

// 初始 agentId 来自路由参数；后续可在过滤栏切换
const initialAgentId = String(route.params.agentId || '');
const agentId = ref(initialAgentId);
const agentName = ref('');

const filters = reactive<{
  agentId: string;
  userId: string;
  status?: 'ok' | 'error';
  keyword: string;
  page: number;
  pageSize: number;
}>({
  agentId: initialAgentId,
  userId: '',
  status: undefined,
  keyword: '',
  page: 1,
  pageSize: 20,
});

const pagination = computed(() => ({
  current: filters.page,
  pageSize: filters.pageSize,
  total: total.value,
  showSizeChanger: true,
  showTotal: (t: number) => `共 ${t} 条`,
}));

const columns = [
  { title: '会话 ID', dataIndex: 'conversationId', width: 200, ellipsis: true },
  { title: '用户', dataIndex: 'userId', width: 90 },
  { title: '状态', dataIndex: 'status', width: 80 },
  { title: '来源', dataIndex: 'source', width: 100 },
  { title: '步骤', dataIndex: 'stepCount', width: 70 },
  { title: '耗时', dataIndex: 'durationMs', width: 90 },
  { title: '用户输入（预览）', dataIndex: 'userInputPreview', ellipsis: true },
  { title: 'AI 回答（预览）', dataIndex: 'finalAnswerPreview', ellipsis: true },
  { title: '时间', dataIndex: 'createdAt', width: 150 },
  { title: '操作', dataIndex: 'actions', width: 100, fixed: 'right' as const },
];

function formatDateTime(s: string) {
  return s ? dayjs(s).format('YYYY-MM-DD HH:mm:ss') : '—';
}

async function loadAllAgents() {
  try {
    const res: any = await listAgents();
    allAgents.value = (res?.data || res || []) as AgentSummary[];
    // 依据路由 agentId 找中文名
    const cur = allAgents.value.find((a) => a.agentId === filters.agentId);
    if (cur) agentName.value = cur.agentName || cur.agentId;
  } catch {
    allAgents.value = [];
  }
}

function onAgentChange(value?: string) {
  filters.agentId = value || '';
  if (filters.agentId) {
    const cur = allAgents.value.find((a) => a.agentId === filters.agentId);
    agentName.value = cur?.agentName || cur?.agentId || '';
    agentId.value = filters.agentId;
    // 同步 URL，方便刷新/分享
    router.replace({ name: 'AgentRuns', params: { agentId: filters.agentId } });
  }
  reload();
}

async function loadRuns() {
  loading.value = true;
  try {
    const res: any = await listAgentRuns({
      agentId: filters.agentId || undefined,
      userId: filters.userId || undefined,
      status: filters.status,
      keyword: filters.keyword || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    });
    const data = res?.data || res;
    runs.value = (data?.items || []) as AgentRunListItem[];
    total.value = data?.total || 0;
  } catch {
    runs.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function handleTableChange(pag: any) {
  filters.page = pag.current;
  filters.pageSize = pag.pageSize;
  loadRuns();
}

function resetFilters() {
  filters.agentId = filters.agentId; // 保留当前 agent
  filters.userId = '';
  filters.status = undefined;
  filters.keyword = '';
  filters.page = 1;
  reload();
}

function reload() {
  filters.page = 1;
  loadRuns();
}

function goDetail(record: AgentRunListItem) {
  router.push({
    name: 'AgentRunDetail',
    params: { agentId: filters.agentId, id: record.id },
  });
}

function goBack() {
  router.push({ name: 'AgentOverview' });
}

function goManage() {
  router.push({ name: 'AgentDefList' });
}

onMounted(async () => {
  await loadAllAgents();
  reload();
});
</script>

<style scoped>
.filter-bar {
  margin-bottom: 16px;
}
.cell-truncate {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
