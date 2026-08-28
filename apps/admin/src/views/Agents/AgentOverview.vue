<template>
  <a-page-header
    title="Agents"
    sub-title="Agent 对话记录 · 统一 debug 与提示词优化。点击某个 Agent 查看其全部对话记录"
  >
    <template #extra>
      <a-button type="primary" :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

  <a-card :bordered="true">
    <a-empty v-if="!agents.length && !loading" description="暂无 Agent 运行记录" />

    <!-- 按业务场景分组 -->
    <template v-else>
      <div v-for="scene in sceneOptions" :key="scene" class="scene-group">
        <div class="scene-title">
          {{ scene }}
          <span class="scene-count">{{ sceneAgents(scene).length }} 个</span>
        </div>

        <a-row :gutter="16" class="agent-grid">
          <a-col v-for="agent in sceneAgents(scene)" :key="agent.agentId" :xs="24" :sm="12" :md="8" :lg="6">
            <a-card
              hoverable
              size="small"
              class="agent-card"
              @click="goRuns(agent.agentId)"
            >
              <div class="agent-head">
                <span class="agent-cn">{{ agent.agentName || agent.agentId }}</span>
                <a-tag
                  v-if="agent.errorCount > 0"
                  color="red"
                >{{ agent.errorCount }} 次失败</a-tag>
              </div>
              <div class="agent-id">{{ agent.agentId }}</div>
              <div class="agent-stats">
                <span class="stat-item">
                  <b>{{ agent.total }}</b>
                  <span class="stat-label">总对话</span>
                </span>
                <span class="stat-item">
                  <b :class="{ 'stat-err': agent.errorCount > 0 }">{{ agent.errorCount }}</b>
                  <span class="stat-label">失败</span>
                </span>
                <span class="stat-item">
                  <b>{{ okCount(agent) }}</b>
                  <span class="stat-label">成功</span>
                </span>
              </div>
              <div class="agent-last">
                最近 {{ formatRelative(agent.lastRunAt) }}
              </div>
              <div class="agent-action">查看对话记录 →</div>
            </a-card>
          </a-col>
        </a-row>
      </div>
    </template>
  </a-card>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { listAgents, type AgentSummary } from '@/api/agents';

/**
 * Agent 业务场景映射（admin 展示层维护）。
 * 新增 agent 时在此登记，便于概览页按场景分组。
 */
const AGENT_SCENE_MAP: Record<string, string> = {
  'contract-risk': '合同风险',
  'study-assistant': '学习助手',
  bianbian: 'AI 创作',
};
const UNKNOWN_SCENE = '其他';

const router = useRouter();
const loading = ref(false);
const agents = ref<AgentSummary[]>([]);

const sceneOptions = computed(() => {
  const set = new Set<string>();
  agents.value.forEach((a) => set.add(sceneOf(a.agentId)));
  return Array.from(set).sort();
});

function sceneOf(agentId: string): string {
  return AGENT_SCENE_MAP[agentId] || UNKNOWN_SCENE;
}
function sceneAgents(scene: string) {
  return agents.value.filter((a) => sceneOf(a.agentId) === scene);
}
function okCount(a: AgentSummary): number {
  return Math.max(0, a.total - a.errorCount);
}
function formatRelative(s: string) {
  if (!s) return '—';
  const diff = Date.now() - new Date(s).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
function goRuns(agentId: string) {
  router.push({ name: 'AgentRuns', params: { agentId } });
}
async function reload() {
  loading.value = true;
  try {
    const res: any = await listAgents();
    agents.value = (res?.data || res || []) as AgentSummary[];
  } catch {
    agents.value = [];
  } finally {
    loading.value = false;
  }
}
onMounted(reload);
</script>

<style scoped>
.scene-group {
  margin-bottom: 24px;
}
.scene-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  padding: 8px 4px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.scene-count {
  background: #f0f0f0;
  color: #999;
  border-radius: 10px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 400;
}
.agent-card {
  margin-bottom: 16px;
  cursor: pointer;
  border-top: 3px solid #1677ff;
}
.agent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.agent-cn {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-id {
  font-size: 12px;
  color: #999;
  font-family: 'SFMono-Regular', Consolas, monospace;
  margin-top: 4px;
}
.agent-stats {
  display: flex;
  gap: 24px;
  margin-top: 14px;
}
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-item b {
  font-size: 20px;
  color: #333;
}
.stat-label {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}
.stat-err {
  color: #ff4d4f !important;
}
.agent-last {
  font-size: 12px;
  color: #999;
  margin-top: 12px;
}
.agent-action {
  font-size: 13px;
  color: #1677ff;
  margin-top: 8px;
}
</style>
