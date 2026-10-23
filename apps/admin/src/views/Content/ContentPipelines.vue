<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import {
  listPipelines,
  deletePipeline,
  updatePipeline,
  type ContentPipeline,
} from '@/api/content';

const router = useRouter();
const userStore = useUserStore();
const canManage = userStore.hasPermission('content:manage');

const pipelines = ref<ContentPipeline[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    pipelines.value = await listPipelines();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

async function onDelete(p: ContentPipeline) {
  try {
    await deletePipeline(p.id);
    message.success('已删除');
    load();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onToggle(p: ContentPipeline, checked: boolean) {
  try {
    await updatePipeline(p.id, { enabled: checked });
    message.success(checked ? '已启用' : '已停用');
    load();
  } catch {
    /* request 拦截器已弹错 */
  }
}

const PUBLISH_TARGET_LABEL: Record<string, string> = {
  tencent_docs: '腾讯文档',
  wechat_mp: '公众号',
};

const PUBLISH_MODE_LABEL: Record<string, string> = {
  publish: '直接发布',
  draft: '只建草稿',
};

const pipelineColumns = [
  { title: '编码', dataIndex: 'code', width: 130 },
  { title: '类型', dataIndex: 'type', width: 90 },
  { title: 'cron', dataIndex: 'cron', width: 120 },
  { title: '标题模板', dataIndex: 'title_template', ellipsis: true },
  { title: '发布目标', key: 'publish_targets', width: 170 },
  { title: '发布模式', key: 'publish_mode', width: 110 },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 140 },
];

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>发布管线</h2>
      <div class="header-actions">
        <a-button v-if="canManage" type="primary" @click="router.push('/content/pipelines/new')">添加管线</a-button>
      </div>
    </div>

    <a-table
      :columns="pipelineColumns"
      :data-source="pipelines"
      :loading="loading"
      row-key="id"
      :pagination="false"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'type'">
          <a-tag :color="record.type === 'paper' ? 'purple' : 'green'">{{ record.type }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'cron'">
          <span class="mono">{{ record.cron }}</span>
        </template>
        <template v-else-if="column.key === 'publish_targets'">
          <a-space :size="4" wrap>
            <a-tag v-for="t in record.publish_targets ?? []" :key="t" color="geekblue">
              {{ PUBLISH_TARGET_LABEL[t] ?? t }}
            </a-tag>
          </a-space>
        </template>
        <template v-else-if="column.key === 'publish_mode'">
          <a-tag :color="record.publish_mode === 'draft' ? 'orange' : 'blue'">
            {{ PUBLISH_MODE_LABEL[record.publish_mode ?? 'publish'] ?? '直接发布' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'enabled'">
          <a-switch :checked="record.enabled" :disabled="!canManage" @change="(checked: boolean) => onToggle(record, checked)" />
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" @click="router.push(`/content/pipelines/${record.id}`)">编辑</a-button>
            <a-popconfirm v-if="canManage" title="确定删除该管线？" @confirm="onDelete(record)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
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
  gap: 12px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
