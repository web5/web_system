<template>
  <div class="kb-page">
    <div class="page-head">
      <div>
        <h2>知识集合</h2>
        <p class="page-sub">
          agent 通过 knowledge MCP 工具检索；集合与 agent 的绑定在其定义 capabilities 中以 config.collectionId 声明
        </p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="load">刷新</a-button>
        <a-button type="primary" :disabled="!canManage" @click="openCreate">新建集合</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="page-alert" :message="loadError" />

    <a-card :bordered="false" class="table-card">
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="false"
        size="middle"
        row-key="id"
        :locale="{ emptyText: ' ' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'name'">
            <div class="kb-name">{{ record.name }}</div>
            <div v-if="record.description" class="kb-desc">{{ record.description }}</div>
          </template>
          <template v-else-if="column.dataIndex === 'embedModel'">
            <span class="ws-mono">{{ record.embedModel }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'docCount'">
            <span class="ws-mono">{{ record.docCount }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'enabled'">
            <a-switch
              :checked="record.enabled"
              :disabled="!canManage"
              checked-children="启用"
              un-checked-children="停用"
              @change="(v: boolean) => doToggle(record, v)"
            />
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="openDrawer(record)">管理文档</a-button>
              <a-button type="link" size="small" :disabled="!canManage" @click="openEdit(record)">编辑</a-button>
              <a-popconfirm
                title="删除将级联删除该集合下所有文档与分块，确认？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="doRemoveCollection(record)"
              >
                <a-button type="link" size="small" danger :disabled="!canManage">删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-empty
        v-if="!loading && !rows.length && !loadError"
        class="page-empty"
        description="暂无知识集合，点「新建集合」开始"
      />
    </a-card>

    <!-- 新建/编辑集合 -->
    <a-modal
      v-model:open="modalOpen"
      :title="editing ? '编辑集合' : '新建集合'"
      :confirm-loading="saving"
      :mask-closable="false"
      @ok="submitCollection"
      @cancel="modalOpen = false"
    >
      <a-form ref="formRef" :model="form" :rules="rules" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="名称" name="name">
          <a-input v-model:value="form.name" placeholder="如 合同法规库 / 儿童安全话术" />
        </a-form-item>
        <a-form-item label="描述" name="description">
          <a-textarea v-model:value="form.description" :rows="3" placeholder="集合用途说明（可选）" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 文档管理抽屉 -->
    <a-drawer
      :open="drawerOpen"
      :width="760"
      :title="`集合管理 · ${current?.name || ''}`"
      @close="drawerOpen = false"
    >
      <a-spin :spinning="docsLoading">
        <template v-if="current">
          <a-alert
            class="drawer-alert"
            :type="current.enabled ? 'success' : 'warning'"
            show-icon
            :message="current.enabled ? '集合启用中：绑定该集合的 agent 可检索' : '集合已停用：检索将返回明确错误（R3.4）'"
          />

          <div v-if="canManage" class="upload-box">
            <div class="upload-title">录入文档文本（解析分块 + 向量化）</div>
            <a-form layout="vertical">
              <a-form-item label="标题">
                <a-input v-model:value="uploadForm.title" placeholder="文档标题" />
              </a-form-item>
              <a-form-item label="正文">
                <a-textarea v-model:value="uploadForm.text" :rows="5" placeholder="粘贴文档正文（自动分块并向量化入库）" />
              </a-form-item>
              <a-space>
                <a-button type="primary" :loading="ingesting" :disabled="!uploadForm.title.trim() || !uploadForm.text.trim()" @click="doIngest">
                  入库
                </a-button>
              </a-space>
            </a-form>
          </div>

          <div class="doc-list-title">文档（{{ docs.length }}）</div>
          <a-table
            :columns="docColumns"
            :data-source="docs"
            :loading="docsLoading"
            :pagination="false"
            size="small"
            row-key="id"
            :locale="{ emptyText: ' ' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'status'">
                <a-tooltip v-if="record.status === 'failed' && record.error" :title="record.error">
                  <a-tag color="error">failed</a-tag>
                </a-tooltip>
                <a-tag v-else :color="record.status === 'ready' ? 'success' : 'warning'">{{ record.status }}</a-tag>
              </template>
              <template v-else-if="column.dataIndex === 'chunkCount'">
                <span class="ws-mono">{{ record.chunkCount }}</span>
              </template>
              <template v-else-if="column.dataIndex === 'createdAt'">
                <span class="ws-mono">{{ fmtTime(record.createdAt) }}</span>
              </template>
              <template v-else-if="column.dataIndex === 'action'">
                <a-space>
                  <a-button type="link" size="small" :disabled="record.status !== 'ready'" @click="viewDoc(record)">
                    查看分块
                  </a-button>
                  <a-popconfirm title="删除该文档及其分块？" ok-text="删除" cancel-text="取消" @confirm="doRemoveDoc(record)">
                    <a-button type="link" size="small" danger :disabled="!canManage">删除</a-button>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
          </a-table>
          <a-empty v-if="!docsLoading && !docs.length" class="drawer-empty" description="暂无文档，在上方录入文本" />
        </template>
      </a-spin>
    </a-drawer>

    <!-- 分块详情 -->
    <a-modal v-model:open="chunkOpen" :title="`分块 · ${viewingDoc?.title || ''}`" :footer="null" width="760">
      <a-empty v-if="!viewingChunks.length" description="该文档无分块" />
      <div v-for="(c, i) in viewingChunks" :key="c.id" class="chunk-item">
        <div class="chunk-head">#{{ c.seq }}<span class="ws-mono"> {{ shortId(c.id) }}</span></div>
        <pre class="chunk-content">{{ c.content }}</pre>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import type { FormInstance } from 'ant-design-vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import {
  fetchCollections,
  createCollection,
  updateCollection,
  toggleCollection,
  deleteCollection,
  fetchDocs,
  fetchDocDetail,
  ingestDoc,
  deleteDoc,
  type KnowledgeCollection,
  type KnowledgeDoc,
  type KnowledgeChunk,
} from '@/api/knowledge';

const userStore = useUserStore();
const canManage = computed(() => userStore.hasPermission('knowledge:manage'));

const rows = ref<KnowledgeCollection[]>([]);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const modalOpen = ref(false);
const editing = ref<KnowledgeCollection | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ name: '', description: '' });

const drawerOpen = ref(false);
const current = ref<KnowledgeCollection | null>(null);
const docs = ref<KnowledgeDoc[]>([]);
const docsLoading = ref(false);
const uploadForm = reactive({ title: '', text: '' });
const ingesting = ref(false);

const chunkOpen = ref(false);
const viewingDoc = ref<KnowledgeDoc | null>(null);
const viewingChunks = ref<KnowledgeChunk[]>([]);

const columns = [
  { title: '集合', dataIndex: 'name' },
  { title: 'embed 模型', dataIndex: 'embedModel', width: 130 },
  { title: '文档数', dataIndex: 'docCount', width: 90, align: 'right' as const },
  { title: '状态', dataIndex: 'enabled', width: 90 },
  { title: '操作', dataIndex: 'action', width: 240 },
];
const docColumns = [
  { title: '标题', dataIndex: 'title' },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '分块', dataIndex: 'chunkCount', width: 80, align: 'right' as const },
  { title: '创建时间', dataIndex: 'createdAt', width: 160 },
  { title: '操作', dataIndex: 'action', width: 150 },
];
const rules = { name: [{ required: true, message: '请填写集合名称' }] };

function fmtTime(s?: string): string {
  return s ? s.replace('T', ' ').slice(0, 19) : '—';
}
function shortId(id: string): string {
  return id.slice(0, 8);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    rows.value = await fetchCollections();
  } catch (e) {
    loadError.value = (e as Error).message || '加载知识集合失败';
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { name: '', description: '' });
  modalOpen.value = true;
}
function openEdit(record: KnowledgeCollection): void {
  editing.value = record;
  Object.assign(form, { name: record.name, description: record.description || '' });
  modalOpen.value = true;
}
async function submitCollection(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await updateCollection(editing.value.id, { name: form.name.trim(), description: form.description });
      message.success('集合已更新');
    } else {
      await createCollection({ name: form.name.trim(), description: form.description });
      message.success('集合已创建');
    }
    modalOpen.value = false;
    await load();
  } catch (e) {
    message.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function doToggle(record: KnowledgeCollection, v: boolean): Promise<void> {
  try {
    await toggleCollection(record.id, v);
    record.enabled = v;
    message.success(v ? '集合已启用' : '集合已停用');
  } catch (e) {
    message.error((e as Error).message || '操作失败');
    void load();
  }
}

async function doRemoveCollection(record: KnowledgeCollection): Promise<void> {
  try {
    await deleteCollection(record.id);
    message.success('集合已删除');
    if (current.value?.id === record.id) {
      drawerOpen.value = false;
      current.value = null;
    }
    await load();
  } catch (e) {
    message.error((e as Error).message || '删除失败');
  }
}

async function openDrawer(record: KnowledgeCollection): Promise<void> {
  current.value = record;
  drawerOpen.value = true;
  uploadForm.title = '';
  uploadForm.text = '';
  docs.value = [];
  await loadDocs();
}
async function loadDocs(): Promise<void> {
  if (!current.value) return;
  docsLoading.value = true;
  try {
    docs.value = await fetchDocs(current.value.id);
  } catch (e) {
    message.error((e as Error).message || '加载文档失败');
  } finally {
    docsLoading.value = false;
  }
}

async function doIngest(): Promise<void> {
  if (!current.value) return;
  ingesting.value = true;
  try {
    const r = await ingestDoc({
      collectionId: current.value.id,
      title: uploadForm.title.trim(),
      text: uploadForm.text,
      source: 'admin',
    });
    message.success(
      r.duplicate
        ? '内容重复，已跳过（幂等）'
        : r.status === 'ready'
          ? `入库完成：${r.chunkCount} 个分块已向量化`
          : '入库中...',
    );
    uploadForm.title = '';
    uploadForm.text = '';
    await loadDocs();
    await load();
  } catch (e) {
    message.error((e as Error).message || '入库失败');
  } finally {
    ingesting.value = false;
  }
}

async function doRemoveDoc(record: KnowledgeDoc): Promise<void> {
  try {
    await deleteDoc(record.id);
    message.success('文档已删除');
    await loadDocs();
    await load();
  } catch (e) {
    message.error((e as Error).message || '删除失败');
  }
}

async function viewDoc(record: KnowledgeDoc): Promise<void> {
  try {
    const { chunks } = await fetchDocDetail(record.id);
    viewingDoc.value = record;
    viewingChunks.value = chunks;
    chunkOpen.value = true;
  } catch (e) {
    message.error((e as Error).message || '加载分块失败');
  }
}

onMounted(() => {
  void load();
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
.page-alert {
  margin-bottom: 12px;
}
.table-card {
  background: var(--ws-bg-surface);
}
.kb-name {
  color: var(--ws-text-primary);
  font-weight: 500;
}
.kb-desc {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.page-empty {
  padding-top: 12px;
}
.drawer-alert {
  margin-bottom: 12px;
}
.upload-box {
  background: var(--ws-bg-subtle);
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md);
  padding: 12px 14px;
  margin-bottom: 14px;
}
.upload-title {
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}
.doc-list-title {
  font-weight: 600;
  color: var(--ws-text-primary);
  margin: 8px 0;
}
.drawer-empty {
  padding-top: 12px;
}
.chunk-item {
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md);
  padding: 8px 12px;
  margin-bottom: 8px;
}
.chunk-head {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-bottom: 4px;
}
.chunk-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  color: var(--ws-text-primary);
  font-family: var(--ws-font-mono);
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
