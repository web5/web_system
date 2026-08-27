<template>
  <a-page-header title="Agents" sub-title="Agent 运行记录 · 统一 debug 与提示词优化">
    <template #extra>
      <a-button type="primary" :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

  <a-row :gutter="16">
    <!-- 左栏：agents 列表 -->
    <a-col :xs="24" :md="8" :lg="6">
      <a-card title="Agents" size="small" :bordered="true" class="agent-card">
        <a-empty v-if="!agents.length && !loading" description="暂无 agent run 记录" />
        <template v-else>
          <div v-for="scene in sceneOptions" :key="scene" class="agent-scene-group">
            <div class="agent-scene-title">
              {{ scene }}
              <span class="agent-scene-count">{{ sceneAgents(scene).length }}</span>
            </div>
            <a-list
              :data-source="sceneAgents(scene)"
              :loading="loading"
              size="small"
              :split="false"
            >
              <template #renderItem="{ item }">
                <a-list-item
                  :class="['agent-item', { active: filterAgentId === item.agentId }]"
                  @click="selectAgent(item.agentId)"
                >
                  <a-list-item-meta>
                    <template #title>
                      <a-tag
                        :color="sceneTagColor(sceneOf(item.agentId))"
                        class="agent-scene-tag"
                      >{{ sceneOf(item.agentId) }}</a-tag>
                      <span class="agent-name">{{ item.agentName || item.agentId }}</span>
                      <a-tag v-if="item.errorCount > 0" color="red" class="agent-tag">
                        {{ item.errorCount }} 错
                      </a-tag>
                    </template>
                    <template #description>
                      <span class="agent-meta">
                        共 {{ item.total }} 次 · 最近 {{ formatRelative(item.lastRunAt) }}
                      </span>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </div>
        </template>
      </a-card>
    </a-col>

    <!-- 右栏：runs 列表 -->
    <a-col :xs="24" :md="16" :lg="18">
      <a-card size="small" :bordered="true">
        <a-form layout="inline" :model="filters" class="filter-bar">
          <a-form-item label="场景">
            <a-select
              v-model:value="filterScene"
              placeholder="全部场景"
              allow-clear
              style="width: 140px"
              @change="selectScene($event)"
            >
              <a-select-option v-for="s in sceneOptions" :key="s" :value="s">{{ s }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="Agent">
            <a-input
              v-model:value="filters.agentId"
              placeholder="agentId"
              allow-clear
              style="width: 180px"
              @change="reload"
            />
          </a-form-item>
          <a-form-item label="用户">
            <a-input
              v-model:value="filters.userId"
              placeholder="userId"
              allow-clear
              style="width: 160px"
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
              placeholder="搜索 userInput"
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
              <a-button type="link" size="small" @click="goDetail(record.id)">
                原始数据
              </a-button>
            </template>
          </template>
        </a-table>
      </a-card>
    </a-col>
  </a-row>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import { listAgents, listAgentRuns, type AgentSummary, type AgentRunListItem } from '@/api/agents';

/**
 * Agent 场景映射（业务认知，维护在 admin 展示层）。
 * 当 agent 增多时在此登记 agentId → 业务场景，便于在调试页快速定位。
 */
const AGENT_SCENE_MAP: Record<string, string> = {
  'contract-risk': '合同风险',
  bianbian: 'AI 创作',
};
const UNKNOWN_SCENE = '其他';

function sceneOf(agentId: string): string {
  return AGENT_SCENE_MAP[agentId] || UNKNOWN_SCENE;
}

const sceneOptions = computed(() => {
  const set = new Set<string>();
  agents.value.forEach((a) => set.add(sceneOf(a.agentId)));
  return Array.from(set).sort();
});

/** 某场景下的 agent 列表 */
function sceneAgents(scene: string) {
  return agents.value.filter((a) => sceneOf(a.agentId) === scene);
}

/** 场景标签颜色（按场景名稳定映射） */
function sceneTagColor(scene: string): string {
  const palette: Record<string, string> = {
    合同风险: 'blue',
    'AI 创作': 'purple',
    其他: 'default',
  };
  return palette[scene] || 'default';
}

const router = useRouter();
const loading = ref(false);
const agents = ref<AgentSummary[]>([]);
const runs = ref<AgentRunListItem[]>([]);
const total = ref(0);
const filterAgentId = ref<string | null>(null);
const filterScene = ref<string>('');

const filters = reactive<{
  agentId: string;
  userId: string;
  status?: 'ok' | 'error';
  keyword: string;
  page: number;
  pageSize: number;
}>({
  agentId: '',
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
  { title: 'Agent', dataIndex: 'agentId', width: 140, ellipsis: true },
  { title: '用户', dataIndex: 'userId', width: 100 },
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
  return dayjs(s).format('YYYY-MM-DD HH:mm:ss');
}
function formatRelative(s: string) {
  const diff = Date.now() - new Date(s).getTime();
  const s2 = Math.floor(diff / 1000);
  if (s2 < 60) return `${s2} 秒前`;
  const m = Math.floor(s2 / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 按场景筛选：选中某场景 → 把 agentId 设为该场景下第一个 agent，并标记场景 */
function selectScene(scene: string) {
  filterScene.value = filterScene.value === scene ? '' : scene;
  if (filterScene.value) {
    const first = agents.value.find((a) => sceneOf(a.agentId) === filterScene.value);
    filterAgentId.value = first?.agentId ?? null;
    filters.agentId = filterAgentId.value || '';
  } else {
    filterAgentId.value = null;
    filters.agentId = '';
  }
  reload();
}

function selectAgent(id: string) {
  filterAgentId.value = filterAgentId.value === id ? null : id;
  filters.agentId = filterAgentId.value || '';
  if (filterAgentId.value) {
    filterScene.value = sceneOf(filterAgentId.value);
  }
  reload();
}

function resetFilters() {
  filterAgentId.value = null;
  filterScene.value = '';
  filters.agentId = '';
  filters.userId = '';
  filters.status = undefined;
  filters.keyword = '';
  filters.page = 1;
  reload();
}

function handleTableChange(pag: any) {
  filters.page = pag.current;
  filters.pageSize = pag.pageSize;
  loadRuns();
}

async function reload() {
  filters.page = 1;
  await Promise.all([loadAgents(), loadRuns()]);
}

async function loadAgents() {
  try {
    const res: any = await listAgents();
    // request 拦截器已 unwrap，返回的实际就是 data
    agents.value = (res?.data || res || []) as AgentSummary[];
  } catch (e) {
    agents.value = [];
  }
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
  } catch (e) {
    runs.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function goDetail(id: string) {
  router.push({ name: 'AgentRunDetail', params: { id } });
}

onMounted(() => {
  reload();
});
</script>

<style scoped>
.agent-card {
  min-height: 400px;
}
.agent-scene-group {
  margin-bottom: 8px;
}
.agent-scene-title {
  font-size: 12px;
  font-weight: 600;
  color: #999;
  padding: 8px 4px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.agent-scene-count {
  background: #f0f0f0;
  color: #999;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 400;
}
.agent-scene-tag {
  margin-right: 4px;
}
.agent-item {
  cursor: pointer;
  transition: background 0.15s;
}
.agent-item:hover {
  background: #f5f5f5;
}
.agent-item.active {
  background: #e6f4ff;
  border-left: 3px solid #1677ff;
}
.agent-name {
  font-weight: 600;
  margin-right: 8px;
}
.agent-tag {
  margin-left: 4px;
}
.agent-meta {
  font-size: 12px;
  color: #999;
}
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
