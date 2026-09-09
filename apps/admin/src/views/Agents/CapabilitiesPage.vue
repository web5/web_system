<template>
  <div class="cap-page">
    <div class="cap-head">
      <div>
        <h2>能力资产</h2>
        <p class="cap-sub">按 agent 汇总挂载的能力（只读聚合，编辑请回到各模块）</p>
      </div>
      <a-space>
        <a-select
          v-model:value="agentId"
          :options="agentOptions"
          placeholder="选择 Agent"
          style="width: 240px"
          :loading="loading"
          show-search
          option-filter-prop="label"
          @change="load"
        />
        <a-button :loading="loading" @click="load">刷新</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="cap-alert" :message="loadError" />

    <template v-if="current">
      <a-row :gutter="12" class="cap-stats">
        <a-col :span="6">
          <div class="cap-stat" :class="{ on: typeFilter === 'tool' }" @click="typeFilter = 'tool'">
            <div class="cap-stat-label">本地工具</div>
            <div class="cap-stat-value">{{ current.stats.tools }}</div>
            <div class="cap-stat-note">代码注册 · ToolRegistry</div>
          </div>
        </a-col>
        <a-col :span="6">
          <div class="cap-stat" :class="{ on: typeFilter === 'mcp' }" @click="typeFilter = 'mcp'">
            <div class="cap-stat-label">MCP 工具</div>
            <div class="cap-stat-value">{{ current.stats.mcp }}</div>
            <div class="cap-stat-note">mcp-gateway 远程</div>
          </div>
        </a-col>
        <a-col :span="6">
          <div class="cap-stat" :class="{ on: typeFilter === 'skill' }" @click="typeFilter = 'skill'">
            <div class="cap-stat-label">技能</div>
            <div class="cap-stat-value">{{ current.stats.skills }}</div>
            <div class="cap-stat-note">ai-service 技能库</div>
          </div>
        </a-col>
        <a-col :span="6">
          <div class="cap-stat" :class="{ on: typeFilter === 'knowledge' }" @click="typeFilter = 'knowledge'">
            <div class="cap-stat-label">知识集合</div>
            <div class="cap-stat-value">{{ current.stats.knowledge }}</div>
            <div class="cap-stat-note">knowledge-service</div>
          </div>
        </a-col>
      </a-row>

      <a-card :bordered="false" class="cap-table-card">
        <template #title>
          <span class="cap-card-title">能力明细（只读）</span>
          <span class="cap-version ws-mono" v-if="current.version != null">v{{ current.version }}</span>
        </template>
        <template #extra>
          <a-radio-group v-model:value="typeFilter" size="small" button-style="solid">
            <a-radio-button value="all">全部</a-radio-button>
            <a-radio-button value="tool">工具</a-radio-button>
            <a-radio-button value="mcp">MCP</a-radio-button>
            <a-radio-button value="skill">技能</a-radio-button>
            <a-radio-button value="knowledge">知识</a-radio-button>
          </a-radio-group>
        </template>

        <a-table
          :columns="columns"
          :data-source="filtered"
          :loading="loading"
          :pagination="false"
          size="middle"
          row-key="key"
          :locale="{ emptyText: ' ' }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'type'">
              <span class="cap-type-tag">{{ record.type }}</span>
            </template>
            <template v-else-if="column.dataIndex === 'name'">
              <span class="ws-mono">{{ record.name }}</span>
            </template>
            <template v-else-if="column.dataIndex === 'detail'">
              <span class="cap-detail">{{ record.detail }}</span>
            </template>
            <template v-else-if="column.dataIndex === 'source'">
              <span class="cap-source ws-mono">{{ record.source }}</span>
            </template>
            <template v-else-if="column.dataIndex === 'action'">
              <template v-if="record.type === 'mcp'">
                <a-tooltip :title="canViewMcp ? '' : '需要 mcp:view 权限'">
                  <a-button type="link" size="small" :disabled="!canViewMcp" @click="goMcp">去 MCP 管理</a-button>
                </a-tooltip>
              </template>
              <template v-else-if="record.type === 'skill'">
                <a-tooltip :title="canViewSkills ? '' : '需要 skills:view 权限'">
                  <a-button type="link" size="small" :disabled="!canViewSkills" @click="goSkills">去技能库</a-button>
                </a-tooltip>
              </template>
              <template v-else-if="record.type === 'knowledge'">
                <a-button type="link" size="small" @click="goKnowledge">去知识集合</a-button>
              </template>
              <span v-else class="cap-muted">—</span>
            </template>
          </template>
        </a-table>
        <a-empty
          v-if="!loading && current && filtered.length === 0"
          class="cap-empty"
          :description="typeFilter === 'all' ? '该 agent 未挂载任何能力，去定义管理配置 capabilities' : `该类型暂无能力（${typeFilter}）`"
        />
      </a-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import { fetchAgentCapabilities, type CapOverviewAgent } from '@/api/agent-capabilities';

interface CapRow {
  key: string;
  type: string;
  name: string;
  detail: string;
  source: string;
}

const router = useRouter();
const userStore = useUserStore();

const overviews = ref<CapOverviewAgent[]>([]);
const agentId = ref<string | undefined>(undefined);
const loading = ref(false);
const loadError = ref('');
const typeFilter = ref<'all' | 'tool' | 'mcp' | 'skill' | 'knowledge'>('all');

const canViewMcp = computed(() => userStore.hasPermission('mcp:view'));
const canViewSkills = computed(() => userStore.hasPermission('skills:view'));

const agentOptions = computed(() =>
  overviews.value.map((o) => ({ value: o.agentId, label: `${o.name}（${o.agentId}）` })),
);

const current = computed<CapOverviewAgent | undefined>(() => {
  if (!overviews.value.length) return undefined;
  return overviews.value.find((o) => o.agentId === agentId.value) ?? overviews.value[0];
});

const rows = computed<CapRow[]>(() => {
  const o = current.value;
  if (!o) return [];
  const list: CapRow[] = [];
  for (const t of o.tools) {
    list.push({ key: `tool-${t.name}`, type: 'tool', name: t.name, detail: t.name, source: t.source });
  }
  for (const m of o.mcp) {
    list.push({
      key: `mcp-${m.ref}`,
      type: 'mcp',
      name: m.name,
      detail: `${m.ref}${m.longRunning ? '（长任务）' : ''}`,
      source: m.source,
    });
  }
  for (const s of o.skills) {
    list.push({ key: `skill-${s.code}`, type: 'skill', name: s.name, detail: s.description || s.code, source: s.source });
  }
  for (const k of o.knowledge) {
    const detail = !k.available
      ? '知识服务不可达'
      : k.enabled
        ? `${k.docCount} 文档`
        : `${k.docCount} 文档 · 集合已停用`;
    list.push({ key: `knowledge-${k.collectionId}`, type: 'knowledge', name: k.name, detail, source: 'knowledge-service' });
  }
  return list;
});

const filtered = computed(() =>
  typeFilter.value === 'all' ? rows.value : rows.value.filter((r) => r.type === typeFilter.value),
);

const columns = [
  { title: '类型', dataIndex: 'type', width: 90 },
  { title: '名称', dataIndex: 'name', width: 200 },
  { title: '说明', dataIndex: 'detail', ellipsis: true },
  { title: '来源', dataIndex: 'source', width: 160 },
  { title: '操作', dataIndex: 'action', width: 130 },
];

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    overviews.value = await fetchAgentCapabilities(agentId.value);
    if (!agentId.value && overviews.value.length) {
      agentId.value = overviews.value[0].agentId;
    }
  } catch (e) {
    loadError.value = (e as Error).message || '加载能力资产失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function goMcp(): void {
  router.push('/mcp');
}
function goSkills(): void {
  router.push('/agents/skills');
}
function goKnowledge(): void {
  router.push('/agents/knowledge');
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.cap-page {
  display: flex;
  flex-direction: column;
}
.cap-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 14px;
}
.cap-head h2 {
  font-size: var(--ws-font-size-h3);
  color: var(--ws-text-primary);
  margin: 0;
  font-weight: var(--ws-font-weight-semibold);
}
.cap-sub {
  margin: 4px 0 0;
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
}
.cap-alert {
  margin-bottom: 12px;
}
.cap-stats {
  margin-bottom: 12px;
}
.cap-stat {
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md);
  box-shadow: var(--ws-shadow-card);
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.cap-stat:hover,
.cap-stat.on {
  border-color: var(--ws-brand-500);
}
.cap-stat-label {
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
  font-weight: 500;
}
.cap-stat-value {
  font-size: 26px;
  font-weight: var(--ws-font-weight-semibold);
  color: var(--ws-text-primary);
  font-variant-numeric: tabular-nums;
  margin: 4px 0;
}
.cap-stat-note {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.cap-table-card {
  background: var(--ws-bg-surface);
}
.cap-card-title {
  font-weight: var(--ws-font-weight-semibold);
}
.cap-version {
  margin-left: 8px;
  color: var(--ws-text-tertiary);
}
.cap-type-tag {
  display: inline-block;
  font-size: 12px;
  color: var(--ws-brand-500);
  background: var(--ws-brand-50);
  border-radius: var(--ws-radius-pill);
  padding: 1px 8px;
  font-weight: 500;
}
.cap-detail,
.cap-source,
.cap-muted {
  color: var(--ws-text-secondary);
}
.cap-source {
  font-size: 12px;
}
.cap-empty {
  padding-top: 12px;
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
