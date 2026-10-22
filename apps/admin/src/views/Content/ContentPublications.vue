<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import {
  listPublications,
  publicationPreview,
  republishPublication,
  type Publication,
  type PublicationPreview,
} from '@/api/content';

const userStore = useUserStore();
const canManage = userStore.hasPermission('content:manage');

const fmtTime = (s?: string | null) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

// ── 列表（服务端筛选 + 分页）──
const filters = reactive({ target: undefined as string | undefined, status: undefined as string | undefined });
const page = reactive({ current: 1, pageSize: 20, total: 0 });
const items = ref<Publication[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await listPublications({
      limit: page.pageSize,
      offset: (page.current - 1) * page.pageSize,
      target: filters.target,
      status: filters.status,
    });
    items.value = res.items;
    page.total = res.total;
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.current = 1;
  load();
}

function onTableChange(pag: { current: number; pageSize: number }) {
  page.current = pag.current;
  page.pageSize = pag.pageSize;
  load();
}

/** 列表标题：条目级发布用关联条目标题；管线级发布（item_id=0）显示管线聚合入口 */
const rowTitle = (p: Publication) =>
  p.item_title ?? (p.pipeline_id ? `管线成文（pipeline #${p.pipeline_id}）` : '（无标题）');

/** 该发布记录是否留存了成文内容（2026-10-22 起发布才留存 payload） */
function hasPayload(p: Publication): boolean {
  const detail = p.detail as { payload?: { title?: string } } | null;
  return !!detail?.payload?.title;
}

// ── 预览抽屉（文章级聚合，Q5）──
const previewVisible = ref(false);
const previewLoading = ref(false);
const preview = ref<PublicationPreview | null>(null);

async function openPreview(p: Publication) {
  previewVisible.value = true;
  previewLoading.value = true;
  preview.value = null;
  try {
    preview.value = await publicationPreview(p.id);
  } catch {
    previewVisible.value = false;
    /* request 拦截器已弹错 */
  } finally {
    previewLoading.value = false;
  }
}

// ── 重新发布（Q3）──
const republishingId = ref<number | null>(null);

async function onRepublish(p: Publication) {
  republishingId.value = p.id;
  try {
    const res = await republishPublication(p.id);
    if (res.ok) {
      message.success(`重发成功（新记录 #${res.publication_id}）`);
    } else {
      message.error(`重发失败：${res.error ?? '未知错误'}`);
    }
    load();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    republishingId.value = null;
  }
}

const TARGET_LABEL: Record<string, string> = {
  wechat_mp: '公众号',
  tencent_docs: '腾讯文档',
};

const pubColumns = [
  { title: 'ID', dataIndex: 'id', width: 70 },
  { title: '标题', key: 'title', ellipsis: true },
  { title: '目标', dataIndex: 'target', width: 100 },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '外部 ID', dataIndex: 'external_id', width: 130, ellipsis: true },
  { title: '发布时间', dataIndex: 'created_at', width: 160 },
  { title: '操作', key: 'action', width: 140 },
];

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>公众号成文</h2>
    </div>

    <div class="filters">
      <a-select
        v-model:value="filters.target"
        placeholder="发布目标"
        allow-clear
        style="width: 140px"
        @change="onFilterChange"
      >
        <a-select-option value="wechat_mp">公众号</a-select-option>
        <a-select-option value="tencent_docs">腾讯文档</a-select-option>
      </a-select>
      <a-select
        v-model:value="filters.status"
        placeholder="状态"
        allow-clear
        style="width: 120px"
        @change="onFilterChange"
      >
        <a-select-option value="success">成功</a-select-option>
        <a-select-option value="failed">失败</a-select-option>
      </a-select>
      <a-button type="primary" @click="onFilterChange">查询</a-button>
    </div>

    <a-table
      :columns="pubColumns"
      :data-source="items"
      :loading="loading"
      row-key="id"
      size="middle"
      :pagination="{
        current: page.current,
        pageSize: page.pageSize,
        total: page.total,
        showSizeChanger: true,
        showTotal: (t: number) => `共 ${t} 条`,
      }"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <a @click="openPreview(record)">{{ rowTitle(record) }}</a>
        </template>
        <template v-else-if="column.dataIndex === 'target'">
          <a-tag color="geekblue">{{ TARGET_LABEL[record.target] ?? record.target }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'status'">
          <a-tag :color="record.status === 'success' ? 'green' : record.status === 'failed' ? 'red' : 'default'">
            {{ record.status === 'success' ? '成功' : record.status === 'failed' ? '失败' : record.status }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'created_at'">
          {{ fmtTime(record.created_at) }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" type="link" @click="openPreview(record)">预览</a-button>
            <a-tooltip
              v-if="canManage && record.status === 'failed'"
              :title="hasPayload(record) ? '按发布时留存的内容重新投递' : '该记录未留存成文内容（2026-10-22 前历史记录），请重跑对应管线'"
            >
              <a-button
                size="small"
                type="link"
                danger
                :loading="republishingId === record.id"
                :disabled="!hasPayload(record)"
                @click="onRepublish(record)"
              >
                重新发布
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 成文预览抽屉（文章级聚合渲染） -->
    <a-drawer
      v-model:open="previewVisible"
      :title="preview?.title ?? '成文预览'"
      width="720"
      :body-style="{ padding: '0' }"
    >
      <a-spin :spinning="previewLoading">
        <div v-if="preview" class="preview-wrap">
          <div class="preview-meta">
            <a-tag color="geekblue">{{ TARGET_LABEL[preview.target] ?? preview.target }}</a-tag>
            <a-tag :color="preview.status === 'success' ? 'green' : 'red'">
              {{ preview.status === 'success' ? '成功' : '失败' }}
            </a-tag>
            <span class="muted">{{ fmtTime(preview.published_at) }}</span>
            <span v-if="preview.source === 'aggregated'" class="muted">
              · 按管线 + 发布日期聚合 {{ preview.item_count }} 条明细重建
            </span>
          </div>
          <!-- 成文 HTML 由自家管线 LLM 生成后留存/重建，非用户输入 -->
          <div class="preview-html" v-html="preview.html" />
        </div>
      </a-spin>
    </a-drawer>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
.preview-wrap {
  padding: 16px 24px;
}
.preview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle);
}
.muted {
  color: var(--text-faint);
  font-size: 12px;
}
.preview-html {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-body);
}
.preview-html :deep(h1),
.preview-html :deep(h2),
.preview-html :deep(h3) {
  color: var(--text-primary);
}
.preview-html :deep(a) {
  color: #ff8c42;
}
.preview-html :deep(img) {
  max-width: 100%;
}
</style>
