<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import {
  listSources,
  deleteSource,
  updateSource,
  triggerCollect,
  lastCollect,
  type ContentSource,
  type TriggerResult,
  type LastCollectRow,
} from '@/api/content';

const router = useRouter();
const userStore = useUserStore();
/** 写操作（新建/编辑/删除/触发/试采）收窄到 content:manage；查看只要 content:view */
const canManage = userStore.hasPermission('content:manage');

const fmtTime = (s?: string | null) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

// ── 采集源列表 ──
const sources = ref<ContentSource[]>([]);
const sourceLoading = ref(false);
/** source_code → 最近一次采集（列表页「最近采集」列，G5） */
const lastCollectMap = ref<Record<string, LastCollectRow>>({});

async function loadSources() {
  sourceLoading.value = true;
  try {
    const [list, lastRes] = await Promise.all([listSources(), lastCollect()]);
    sources.value = list;
    lastCollectMap.value = Object.fromEntries(lastRes.items.map((r) => [r.source_code, r]));
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    sourceLoading.value = false;
  }
}

async function onDeleteSource(s: ContentSource) {
  try {
    await deleteSource(s.id);
    message.success('已删除');
    loadSources();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onToggleSource(s: ContentSource, checked: boolean) {
  try {
    await updateSource(s.id, { enabled: checked });
    message.success(checked ? '已启用' : '已停用');
    loadSources();
  } catch {
    /* request 拦截器已弹错 */
  }
}

// ── 手动触发（五态弹窗：运行中/成功/空/失败/拒绝）──
const triggerVisible = ref(false);
const triggerSource = ref<ContentSource | null>(null);
const triggerLimit = ref(20);
const triggerLoading = ref(false);
const triggerResult = ref<TriggerResult | null>(null);

function openTrigger(s: ContentSource) {
  triggerSource.value = s;
  triggerLimit.value = 20;
  triggerResult.value = null;
  triggerVisible.value = true;
}

async function runTrigger() {
  if (!triggerSource.value) return;
  triggerLoading.value = true;
  try {
    triggerResult.value = await triggerCollect(triggerSource.value.code, triggerLimit.value);
    if (triggerResult.value.status === 'ok') {
      message.success('采集完成');
      loadSources();
    } else if (triggerResult.value.status === 'empty') {
      message.warning('采集返回空，详见下方说明');
    }
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    triggerLoading.value = false;
  }
}

/** 触发结果 → 友好状态（技术原文折叠，不直接糊用户脸上） */
const triggerView = ref<{ tone: 'success' | 'warning' | 'error' | 'info'; title: string; desc: string } | null>(null);
watch(triggerResult, (r) => {
  if (!r) {
    triggerView.value = null;
    return;
  }
  if (r.status === 'ok') {
    triggerView.value = {
      tone: 'success',
      title: '采集成功',
      desc: r.items != null ? `本次入库 ${r.items} 条` : '采集结果已写入采集明细',
    };
  } else if (r.status === 'empty') {
    triggerView.value = {
      tone: 'warning',
      title: '采集返回空',
      desc: '上游可能限流、网络不通或筛选条件过严；可稍后重试或到「采集监控」查看管线状态',
    };
  } else if (r.status === 'rejected') {
    triggerView.value = { tone: 'warning', title: '已拒绝', desc: r.reason ?? '该采集源当前不可触发' };
  } else if (r.status === 'unknown') {
    triggerView.value = {
      tone: 'error',
      title: '采集失败',
      desc: r.reason ?? r.error ?? '未登记的采集源或采集器类型',
    };
  } else {
    triggerView.value = { tone: 'error', title: '采集失败', desc: r.error ?? '未知错误，可展开技术详情查看' };
  }
});

const sourceColumns = [
  { title: '编码', dataIndex: 'code', width: 150 },
  { title: '名称', dataIndex: 'name', width: 170 },
  { title: '类型', dataIndex: 'type', width: 150 },
  { title: '领域', dataIndex: 'category', width: 80 },
  { title: '私有配置', dataIndex: 'config', ellipsis: true },
  { title: '最近采集', key: 'last_collect', width: 170 },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 210 },
];

const LAST_STATUS_COLOR: Record<string, string> = {
  ok: 'green',
  empty: 'orange',
  failed: 'red',
};

onMounted(loadSources);
</script>

<template>
  <!-- 不包 a-config-provider，避免覆盖 shell antd 的默认 token（cssinjs 类名 hash 会变） -->
  <div class="page">
    <div class="header">
      <h2>采集源管理</h2>
      <div class="header-actions">
        <a-button v-if="canManage" type="primary" @click="router.push('/content/sources/new')">添加采集源</a-button>
      </div>
    </div>

    <a-table
      :columns="sourceColumns"
      :data-source="sources"
      :loading="sourceLoading"
      row-key="id"
      :pagination="false"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'type'">
          <a-tag color="blue">{{ record.type }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'category'">
          <a-tag :color="record.category === '财经' ? 'orange' : record.category === '论文' ? 'purple' : 'green'">
            {{ record.category ?? '-' }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'config'">
          <span class="mono">{{ record.config ? JSON.stringify(record.config) : '-' }}</span>
        </template>
        <template v-else-if="column.key === 'last_collect'">
          <template v-if="lastCollectMap[record.code]">
            <a-tag :color="LAST_STATUS_COLOR[lastCollectMap[record.code].status] ?? 'default'">
              {{ lastCollectMap[record.code].status }}
            </a-tag>
            <span class="last-meta">
              {{ lastCollectMap[record.code].item_count }} 条 · {{ fmtTime(lastCollectMap[record.code].finished_at) }}
            </span>
          </template>
          <span v-else class="muted">暂无记录</span>
        </template>
        <template v-else-if="column.key === 'enabled'">
          <a-switch :checked="record.enabled" :disabled="!canManage" @change="(checked: boolean) => onToggleSource(record, checked)" />
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button v-if="canManage" size="small" type="primary" ghost :disabled="!record.enabled" @click="openTrigger(record)">触发</a-button>
            <a-button size="small" @click="router.push(`/content/sources/${record.id}`)">编辑</a-button>
            <a-popconfirm v-if="canManage" title="确定删除该采集源？" @confirm="onDeleteSource(record)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 手动触发弹窗（五态） -->
    <a-modal
      v-model:open="triggerVisible"
      :title="`手动触发采集：${triggerSource?.name ?? ''}`"
      width="560px"
      :footer="null"
    >
      <a-form layout="vertical">
        <a-form-item label="采集条数上限">
          <a-input-number v-model:value="triggerLimit" :min="1" :max="100" style="width: 200px" />
        </a-form-item>
        <a-button type="primary" :loading="triggerLoading" @click="runTrigger">开始采集</a-button>
      </a-form>
      <template v-if="triggerView">
        <a-divider>采集结果</a-divider>
        <a-alert :type="triggerView.tone" show-icon>
          <template #message>{{ triggerView.title }}</template>
          <template #description>
            <div>{{ triggerView.desc }}</div>
            <a-collapse v-if="triggerResult" ghost class="tech-detail">
              <a-collapse-panel key="tech" header="技术详情">
                <pre class="result">{{ JSON.stringify(triggerResult, null, 2) }}</pre>
              </a-collapse-panel>
            </a-collapse>
          </template>
        </a-alert>
      </template>
    </a-modal>
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
.last-meta {
  margin-left: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.muted {
  color: var(--text-faint);
  font-size: 12px;
}
.tech-detail {
  margin-top: 4px;
}
.tech-detail :deep(.ant-collapse-header) {
  padding: 4px 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.result {
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  padding: 12px;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-body);
}
</style>
