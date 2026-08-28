<template>
  <a-page-header
    :title="`Agent Run · ${run?.agentId || '...'}`"
    sub-title="查看完整原始数据：systemPrompt / userInput / 步骤流水 / 最终输出"
    @back="goBack"
  >
    <template #extra>
      <a-tag v-if="run" :color="run.status === 'ok' ? 'green' : 'red'">
        {{ run.status === 'ok' ? '成功' : '失败' }}
      </a-tag>
      <a-tag v-if="run" color="blue">{{ run.source }}</a-tag>
    </template>
  </a-page-header>

  <a-spin :spinning="loading">
    <a-empty v-if="!run && !loading" description="未找到该 run" />

    <template v-if="run">
      <!-- 基础信息 -->
      <a-card title="基础信息" size="small" class="mb">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="Run ID">{{ run.id }}</a-descriptions-item>
          <a-descriptions-item label="Agent">{{ run.agentName || run.agentId }}</a-descriptions-item>
          <a-descriptions-item label="Agent ID">{{ run.agentId }}</a-descriptions-item>
          <a-descriptions-item label="来源服务">{{ run.source }}</a-descriptions-item>
          <a-descriptions-item label="用户 ID">{{ run.userId }}</a-descriptions-item>
          <a-descriptions-item label="会话 ID">{{ run.conversationId || '—' }}</a-descriptions-item>
          <a-descriptions-item label="模型">{{ run.model || '—' }}</a-descriptions-item>
          <a-descriptions-item label="工具">{{ (run.tools || []).join(', ') || '—' }}</a-descriptions-item>
          <a-descriptions-item label="耗时">{{ run.durationMs != null ? `${run.durationMs} ms` : '—' }}</a-descriptions-item>
          <a-descriptions-item label="步骤数">{{ run.steps?.length || 0 }}</a-descriptions-item>
          <a-descriptions-item label="创建时间" :span="2">{{ formatDateTime(run.createdAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="run.error" label="错误" :span="2">
            <span class="error-text">{{ run.error }}</span>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- System Prompt（关键：用于优化 prompt） -->
      <a-card title="System Prompt（原文快照）" size="small" class="mb">
        <pre class="raw-block">{{ run.systemPrompt }}</pre>
      </a-card>

      <!-- User Input -->
      <a-card title="用户输入（userInput）" size="small" class="mb">
        <pre class="raw-block">{{ run.userInput }}</pre>
      </a-card>

      <!-- 步骤流水（用于 debug 工具调用链） -->
      <a-card title="步骤流水（steps）" size="small" class="mb">
        <a-empty v-if="!run.steps?.length" />
        <a-timeline v-else>
          <a-timeline-item
            v-for="(s, idx) in run.steps"
            :key="idx"
            :color="stepColor(s.type)"
          >
            <template #dot>
              <span class="step-type-tag" :class="`type-${s.type}`">{{ s.type }}</span>
            </template>
            <div class="step-head">
              <span class="step-name">{{ s.name || s.type }}</span>
              <span class="step-ts">{{ formatTime(s.ts) }}</span>
            </div>
            <pre v-if="s.content" class="step-content">{{ s.content }}</pre>
            <pre v-if="s.args" class="step-content step-args">{{ formatJson(s.args) }}</pre>
          </a-timeline-item>
        </a-timeline>
      </a-card>

      <!-- 最终输出 -->
      <a-card v-if="run.finalAnswer" title="AI 最终输出" size="small" class="mb">
        <pre class="raw-block">{{ run.finalAnswer }}</pre>
      </a-card>
    </template>
  </a-spin>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import dayjs from 'dayjs';
import { getAgentRun, type AgentRunDetail } from '@/api/agents';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const run = ref<AgentRunDetail | null>(null);

const id = String(route.params.id || '');

function formatDateTime(s: string) {
  return dayjs(s).format('YYYY-MM-DD HH:mm:ss');
}
function formatTime(ts: number) {
  return dayjs(ts).format('HH:mm:ss.SSS');
}
function formatJson(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
function stepColor(type: string) {
  if (type === 'error') return 'red';
  if (type === 'final') return 'green';
  if (type === 'tool_call') return 'blue';
  if (type === 'tool_result') return 'cyan';
  return 'gray';
}
function goBack() {
  const agentId = String(route.params.agentId || '');
  router.push({ name: 'AgentRuns', params: { agentId } });
}

async function load() {
  loading.value = true;
  try {
    const res: any = await getAgentRun(id);
    run.value = (res?.data || res || null) as AgentRunDetail | null;
  } catch {
    run.value = null;
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.id, () => load());
onMounted(load);
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.raw-block {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  padding: 16px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 600px;
  overflow: auto;
  margin: 0;
}
.step-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.step-name {
  font-weight: 600;
  color: #333;
}
.step-ts {
  font-size: 12px;
  color: #999;
}
.step-content {
  background: #fafafa;
  border: 1px solid #eee;
  border-radius: 4px;
  padding: 10px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 6px 0 0 0;
  max-height: 300px;
  overflow: auto;
}
.step-args {
  background: #fffbe6;
  border-color: #ffe58f;
}
.step-type-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: monospace;
  color: #fff;
  background: #999;
  min-width: 40px;
  text-align: center;
}
.type-tool_call { background: #1677ff; }
.type-tool_result { background: #13c2c2; }
.type-final { background: #52c41a; }
.type-error { background: #ff4d4f; }
.type-start { background: #722ed1; }
.error-text {
  color: #ff4d4f;
  font-family: monospace;
}
</style>
