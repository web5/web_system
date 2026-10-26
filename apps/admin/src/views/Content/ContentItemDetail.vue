<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getItemDetail, type ContentItemDetail } from '@/api/content';

const route = useRoute();
const router = useRouter();

const detail = ref<ContentItemDetail | null>(null);
const loading = ref(false);

const fmtTime = (s?: string | null) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

/** 质量归因流程条：采集 → 去重 → AI 处理 → 发布，标出当前卡点 */
const STAGES = [
  { key: 'collect', label: '采集' },
  { key: 'dedup', label: '去重' },
  { key: 'ai', label: 'AI 处理' },
  { key: 'publish', label: '发布' },
];

const stageIndex = (stage?: string | null) => STAGES.findIndex((s) => s.key === stage);

/** 该阶段是否已走过（当前阶段本身算「走到这」） */
const stagePassed = (i: number) => {
  const cur = stageIndex(detail.value?.item.quality_stage);
  return cur >= 0 && i <= cur;
};
const stageCurrent = (i: number) => stageIndex(detail.value?.item.quality_stage) === i;

const QUALITY_STATUS_MAP: Record<string, { color: string; label: string }> = {
  ok: { color: 'green', label: '正常' },
  skip: { color: 'orange', label: '去重跳过' },
  fail: { color: 'red', label: '失败' },
  partial: { color: 'gold', label: '部分异常' },
};

const TARGET_LABEL: Record<string, string> = {
  wechat_mp: '公众号',
  tencent_docs: '腾讯文档',
};

const pubColumns = [
  { title: '目标', key: 'target', width: 120 },
  { title: '状态', key: 'status', width: 90 },
  { title: '外部 ID', key: 'external_id', ellipsis: true },
  { title: '时间', key: 'created_at', width: 170 },
];

async function load() {
  loading.value = true;
  try {
    detail.value = await getItemDetail(Number(route.params.id));
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <a-button type="text" class="back-btn" @click="router.push('/content/items')">← 返回采集明细</a-button>
      <h2>{{ detail?.item.title_zh || detail?.item.title || '明细详情' }}</h2>
    </div>

    <template v-if="detail">
      <!-- 质量归因 -->
      <a-card size="small" class="block">
        <div class="quality-head">
          <span class="block-title">质量归因</span>
          <template v-if="detail.item.quality_status">
            <a-tag :color="QUALITY_STATUS_MAP[detail.item.quality_status]?.color ?? 'default'">
              {{ QUALITY_STATUS_MAP[detail.item.quality_status]?.label ?? detail.item.quality_status }}
            </a-tag>
            <span v-if="detail.item.quality_issue" class="issue">{{ detail.item.quality_issue }}</span>
          </template>
          <span v-else class="muted">未打质量标</span>
        </div>
        <a-steps :current="stageIndex(detail.item.quality_stage)" size="small" class="stage-flow">
          <a-step v-for="s in STAGES" :key="s.key" :title="s.label" />
        </a-steps>
        <div class="stage-hint">
          当前阶段：
          <b>{{ STAGES[stageIndex(detail.item.quality_stage)]?.label ?? '未标注' }}</b>
          <template v-if="detail.item.quality_stage === 'dedup' && detail.item.quality_status === 'skip'">
            —— 该条目与已有内容重复（唯一键 / SimHash 命中），已跳过不进入后续流程
          </template>
          <template v-else-if="detail.item.quality_status === 'fail'">
            —— 该阶段处理失败，详见下方技术信息
          </template>
        </div>
      </a-card>

      <!-- 标题本地化：英文源要看得出「翻成了什么」和「原文是什么」 -->
      <a-card v-if="detail.item.title_zh" size="small" class="block">
        <div class="block-title">中文标题</div>
        <div class="localized-title">{{ detail.item.title_zh }}</div>
        <div class="muted origin-line">
          原文（{{ detail.item.source_lang ?? '未知语种' }}）：{{ detail.item.title }}
        </div>
      </a-card>

      <!-- AI 摘要 -->
      <a-card v-if="detail.item.summary" size="small" class="block">
        <div class="block-title">AI 摘要</div>
        <div class="summary-text">{{ detail.item.summary }}</div>
      </a-card>

      <!-- 基础信息 -->
      <a-card size="small" class="block">
        <div class="block-title">基础信息</div>
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="外部 ID">
            <span class="mono">{{ detail.item.external_id }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="来源">{{ detail.item.source_name ?? '-' }}</a-descriptions-item>
          <a-descriptions-item label="归属管线">
            <a-tag v-if="detail.pipeline" color="purple">{{ detail.pipeline.code }}</a-tag>
            <span v-else class="muted">手动触发（无管线）</span>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="detail.item.status === 'failed' ? 'red' : detail.item.status === 'pending' ? 'blue' : 'default'">
              {{ detail.item.status }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="原文发布时间">{{ fmtTime(detail.item.publish_date) }}</a-descriptions-item>
          <a-descriptions-item label="入库时间">{{ fmtTime(detail.item.created_at) }}</a-descriptions-item>
          <a-descriptions-item label="采集耗时">
            {{ detail.item.collect_duration_ms != null ? `${detail.item.collect_duration_ms} ms` : '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="原文链接">
            <a v-if="detail.item.url" :href="detail.item.url" target="_blank" rel="noopener">打开原文</a>
            <span v-else class="muted">-</span>
          </a-descriptions-item>
          <a-descriptions-item label="SimHash">
            <span class="mono">{{ detail.item.simhash ?? '-' }}</span>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- 原文内容 -->
      <a-card v-if="detail.item.content" size="small" class="block">
        <div class="block-title">采集原文</div>
        <pre class="content-pre">{{ detail.item.content }}</pre>
      </a-card>

      <!-- 发布记录 -->
      <a-card size="small" class="block">
        <div class="block-title">发布记录</div>
        <a-empty v-if="!detail.publications.length" description="该条目暂无发布记录" />
        <a-table
          v-else
          :columns="pubColumns"
          :data-source="detail.publications"
          :pagination="false"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'target'">
              <a-tag color="geekblue">{{ TARGET_LABEL[record.target] ?? record.target }}</a-tag>
            </template>
            <template v-else-if="column.key === 'status'">
              <a-tag :color="record.status === 'success' ? 'green' : record.status === 'failed' ? 'red' : 'default'">
                {{ record.status }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'external_id'">
              <span class="mono">{{ record.external_id ?? '-' }}</span>
            </template>
            <template v-else-if="column.key === 'created_at'">
              {{ fmtTime(record.created_at) }}
            </template>
          </template>
        </a-table>
      </a-card>
    </template>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}
.page-head {
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 8px 0 0;
  font-size: 18px;
}
.back-btn {
  padding-left: 0;
  color: var(--text-tertiary);
}
.block {
  margin-bottom: 12px;
}
.block-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.quality-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.quality-head .block-title {
  margin-bottom: 0;
}
.issue {
  font-size: 12px;
  color: var(--text-tertiary);
}
.stage-flow {
  margin-bottom: 8px;
}
.stage-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.summary-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-body);
  white-space: pre-wrap;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.muted {
  color: var(--text-faint);
  font-size: 12px;
}
.localized-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong);
  line-height: 1.5;
}
.origin-line {
  margin-top: 6px;
}
.content-pre {
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  padding: 12px;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-body);
  margin: 0;
}
</style>
