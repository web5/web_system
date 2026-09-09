<template>
  <div class="rd-page">
    <div class="page-head">
      <div>
        <h2>检索调试器</h2>
        <p class="page-sub">试跑语义检索：确认 embedding 参数、topK 与召回质量（命中按余弦相似度排序）</p>
      </div>
    </div>

    <a-card :bordered="false" class="query-card">
      <div class="query-row">
        <a-select
          v-model:value="collectionId"
          class="q-select"
          placeholder="选择知识集合"
          :loading="loadingCols"
          @change="runSearch"
        >
          <a-select-option v-for="c in collections" :key="c.id" :value="c.id">
            {{ c.name }}（{{ c.docCount }} 文档{{ c.enabled ? '' : ' · 已停用' }}）
          </a-select-option>
        </a-select>
        <a-input
          v-model:value="query"
          class="q-input"
          placeholder="输入问题或关键词，回车检索…"
          :disabled="!collectionId"
          @press-enter="runSearch"
        />
        <a-input-number v-model:value="topK" :min="1" :max="50" class="q-topk" :disabled="!collectionId" @change="runSearch" />
        <a-button type="primary" :loading="searching" :disabled="!collectionId || !query.trim()" @click="runSearch">
          检索
        </a-button>
      </div>
      <div class="query-hint">topK：返回条数（默认 5）。命中携带 score 与来源引用（R3.1）。</div>
    </a-card>

    <a-alert v-if="error" type="error" show-icon class="rd-alert" :message="error" />

    <a-card :bordered="false" class="result-card">
      <template #title>
        命中（{{ hits.length }}）
        <span v-if="lastQuery" class="result-sub">query: {{ lastQuery }}</span>
      </template>
      <a-spin :spinning="searching">
        <template v-if="hits.length">
          <div v-for="h in hits" :key="h.chunkId" class="hit">
            <div class="hit-head">
              <a-tag :color="scoreColor(h.score)">{{ (h.score * 100).toFixed(1) }}%</a-tag>
              <span class="hit-doc">{{ h.docTitle }}</span>
              <span class="hit-meta ws-mono">#{{ h.seq }} · {{ shortId(h.docId) }} · chunk {{ shortId(h.chunkId) }}</span>
            </div>
            <pre class="hit-content">{{ h.content }}</pre>
          </div>
        </template>
        <a-empty v-else-if="!searching && searched" description="无命中：尝试换个问法，或确认该集合已入库文档（集合停用会返回错误而非空结果）" />
        <a-empty v-else-if="!searching && !searched" class="rd-idle" description="选择集合并输入 query 开始试跑" />
      </a-spin>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { fetchCollections, searchKnowledge, type KnowledgeCollection } from '@/api/knowledge';

const collections = ref<KnowledgeCollection[]>([]);
const loadingCols = ref(false);
const collectionId = ref<string | undefined>(undefined);
const query = ref('');
const topK = ref<number>(5);
const searching = ref(false);
const searched = ref(false);
const lastQuery = ref('');
const hits = ref<Array<{ chunkId: string; content: string; docId: string; docTitle: string; seq: number; score: number }>>([]);
const error = ref('');

function shortId(id: string): string {
  return id.slice(0, 8);
}
function scoreColor(score: number): string {
  if (score >= 0.6) return 'green';
  if (score >= 0.4) return 'orange';
  return 'red';
}

async function loadCollections(): Promise<void> {
  loadingCols.value = true;
  try {
    collections.value = await fetchCollections();
  } catch (e) {
    message.error((e as Error).message || '加载集合失败');
  } finally {
    loadingCols.value = false;
  }
}

async function runSearch(): Promise<void> {
  if (!collectionId.value || !query.value.trim()) return;
  searching.value = true;
  error.value = '';
  try {
    hits.value = await searchKnowledge({
      collectionId: collectionId.value,
      query: query.value.trim(),
      topK: topK.value || 5,
    });
    searched.value = true;
    lastQuery.value = query.value.trim();
  } catch (e) {
    error.value = (e as Error).message || '检索失败';
    hits.value = [];
    searched.value = true;
  } finally {
    searching.value = false;
  }
}

onMounted(() => {
  void loadCollections();
});
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 14px;
}
.page-head h2 {
  font-size: var(--ws-font-size-h3);
  color: var(--ws-text-primary);
  margin: 0;
  font-weight: var(--ws-font-weight-semibold);
}
.page-sub {
  margin: 4px 0 0;
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
}
.query-card {
  background: var(--ws-bg-surface);
  margin-bottom: 12px;
}
.query-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.q-select {
  width: 260px;
}
.q-input {
  flex: 1;
  min-width: 260px;
}
.q-topk {
  width: 110px;
}
.query-hint {
  margin-top: 8px;
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
}
.rd-alert {
  margin-bottom: 12px;
}
.result-card {
  background: var(--ws-bg-surface);
}
.result-sub {
  margin-left: 10px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  font-weight: 400;
}
.rd-idle {
  padding-top: 8px;
}
.hit {
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md);
  padding: 10px 12px;
  margin-bottom: 10px;
}
.hit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.hit-doc {
  font-weight: 600;
  color: var(--ws-text-primary);
}
.hit-meta {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-left: auto;
}
.hit-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  color: var(--ws-text-primary);
  line-height: 1.6;
  background: var(--ws-bg-subtle);
  border-radius: var(--ws-radius-sm);
  padding: 8px 10px;
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
