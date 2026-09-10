<template>
  <div class="mp-page">
    <div class="page-head">
      <div>
        <h2>模型</h2>
        <p class="page-sub">
          可用清单由「字典管理」的 <span class="ws-mono">llm_models</span> 决定；单价用于 run 成本核算，无单价记录的模型成本记 0
        </p>
      </div>
      <a-space>
        <a-button :loading="loading || catalogLoading" @click="refreshAll">刷新</a-button>
        <a-button type="primary" @click="openCreate()">新建单价</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="page-alert" :message="loadError" />

    <a-alert v-if="catalogError" type="warning" show-icon class="page-alert" :message="catalogError" />

    <a-card :bordered="false" class="table-card catalog-card">
      <template #title>
        <span class="catalog-title">可用模型清单</span>
        <span class="catalog-sub">来自字典 <span class="ws-mono">llm_models</span>（在「字典管理」维护，Agent 侧 60s 内生效）</span>
      </template>
      <template #extra>
        <a-button type="link" @click="goDicts">去字典管理</a-button>
      </template>
      <a-table
        :columns="catalogColumns"
        :data-source="dictModels"
        :loading="catalogLoading"
        :pagination="false"
        size="small"
        row-key="id"
        :locale="{ emptyText: ' ' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'model'">
            <span class="ws-mono">{{ record.value }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'provider'">
            {{ (record.attrs && record.attrs.provider) || '—' }}
          </template>
          <template v-else-if="column.dataIndex === 'status'">
            <a-tag v-if="record.enabled" color="success">启用</a-tag>
            <a-tag v-else>停用</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'price'">
            <span v-if="priceOf(record.value)" class="ws-mono">{{ fmtPrice(priceOf(record.value)!.inputPricePer1k) }}</span>
            <a-tag v-else color="warning">未配置单价</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <a-button type="link" size="small" @click="openCreate(record)">
              {{ priceOf(record.value) ? '改单价' : '配置单价' }}
            </a-button>
          </template>
        </template>
      </a-table>
      <a-empty
        v-if="!catalogLoading && !dictModels.length"
        class="page-empty"
        description="字典 llm_models 暂无记录，去「字典管理」添加可用模型"
      />
    </a-card>

    <a-card :bordered="false" class="table-card">
      <template #title><span class="catalog-title">模型单价</span></template>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }"
        size="middle"
        row-key="id"
        :locale="{ emptyText: ' ' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'model'">
            <span class="mp-model">{{ record.provider }} / <span class="ws-mono">{{ record.model }}</span></span>
          </template>
          <template v-else-if="column.dataIndex === 'inputPricePer1k'">
            <span class="ws-mono">{{ fmtPrice(record.inputPricePer1k) }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'outputPricePer1k'">
            <span class="ws-mono">{{ fmtPrice(record.outputPricePer1k) }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'updatedAt'">
            <span class="ws-mono">{{ fmtTime(record.updatedAt) }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
              <a-popconfirm title="确认删除该模型单价？" ok-text="删除" cancel-text="取消" @confirm="doRemove(record)">
                <a-button type="link" size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-empty v-if="!loading && !rows.length && !loadError" class="page-empty" description="暂无模型单价，点「新建单价」开始配置" />
    </a-card>

    <a-modal
      v-model:open="modalOpen"
      :title="editing ? '编辑模型单价' : '新建模型单价'"
      :confirm-loading="saving"
      :mask-closable="false"
      @ok="submit"
      @cancel="closeModal"
    >
      <a-form ref="formRef" :model="form" :rules="rules" :label-col="{ span: 7 }" :wrapper-col="{ span: 16 }">
        <a-form-item label="提供方" name="provider">
          <a-input v-model:value="form.provider" placeholder="如 tokenhub / hy3" />
        </a-form-item>
        <a-form-item label="模型 id" name="model">
          <a-input v-model:value="form.model" placeholder="如 deepseek-v4-flash" :disabled="!!editing" />
        </a-form-item>
        <a-form-item label="输入价" name="inputPricePer1k">
          <a-input-number v-model:value="form.inputPricePer1k" :min="0" :precision="6" style="width: 100%" />
          <div class="form-hint">每 1K input tokens 价格（CNY）</div>
        </a-form-item>
        <a-form-item label="输出价" name="outputPricePer1k">
          <a-input-number v-model:value="form.outputPricePer1k" :min="0" :precision="6" style="width: 100%" />
          <div class="form-hint">每 1K output tokens 价格（CNY）</div>
        </a-form-item>
        <a-form-item label="币种" name="currency">
          <a-select v-model:value="form.currency" :options="['CNY', 'USD'].map((c) => ({ value: c, label: c }))" style="width: 100%" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { FormInstance } from 'ant-design-vue';
import { message } from 'ant-design-vue';
import { fetchPricings, upsertPricing, removePricing, type ModelPricingItem } from '@/api/model-pricing';
import { fetchDictItems, type DictItemRow } from '@/api/dict';

const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const rows = ref<ModelPricingItem[]>([]);

/** 可用模型清单（来自字典 llm_models；单价表只管价格，可用性由字典决定） */
const dictModels = ref<DictItemRow[]>([]);
const catalogLoading = ref(false);
const catalogError = ref('');

const modalOpen = ref(false);
const editing = ref<ModelPricingItem | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<{
  provider: string;
  model: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  currency: string;
}>({ provider: '', model: '', inputPricePer1k: 0, outputPricePer1k: 0, currency: 'CNY' });

const rules = {
  provider: [{ required: true, message: '请填写提供方' }],
  model: [{ required: true, message: '请填写模型 id' }],
  inputPricePer1k: [{ required: true, type: 'number' as const, min: 0, message: '输入价需 ≥ 0' }],
  outputPricePer1k: [{ required: true, type: 'number' as const, min: 0, message: '输出价需 ≥ 0' }],
};

const catalogColumns = [
  { title: '模型 id', dataIndex: 'model' },
  { title: '提供方', dataIndex: 'provider', width: 120 },
  { title: '输入价 / 1K', dataIndex: 'price', width: 140, align: 'right' as const },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '操作', dataIndex: 'action', width: 110 },
];

const columns = [
  { title: '模型', dataIndex: 'model' },
  { title: '输入价 / 1K', dataIndex: 'inputPricePer1k', width: 140, align: 'right' as const },
  { title: '输出价 / 1K', dataIndex: 'outputPricePer1k', width: 140, align: 'right' as const },
  { title: '币种', dataIndex: 'currency', width: 90 },
  { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
  { title: '操作', dataIndex: 'action', width: 150 },
];

function fmtPrice(v: string): string {
  return `¥ ${Number(v).toFixed(6)}`;
}
function fmtTime(v?: string): string {
  return v ? v.replace('T', ' ').slice(0, 19) : '—';
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    rows.value = await fetchPricings();
  } catch (e) {
    loadError.value = (e as Error).message || '加载模型单价失败';
  } finally {
    loading.value = false;
  }
}

function openCreate(item?: DictItemRow): void {
  editing.value = null;
  const attrProvider = item?.attrs ? item.attrs.provider : undefined;
  Object.assign(form, {
    provider: attrProvider ? String(attrProvider) : '',
    model: item?.value ?? '',
    inputPricePer1k: 0,
    outputPricePer1k: 0,
    currency: 'CNY',
  });
  modalOpen.value = true;
}

/** 该模型 id 是否已配置单价 */
function priceOf(model: string): ModelPricingItem | undefined {
  return rows.value.find((p) => p.model === model);
}

function goDicts(): void {
  void router.push('/admin/settings/dicts');
}

function refreshAll(): void {
  void load();
  void loadDictModels();
}

/** 可用模型清单来自字典 llm_models（可用性以字典为准，与单价解耦） */
async function loadDictModels(): Promise<void> {
  catalogLoading.value = true;
  catalogError.value = '';
  try {
    const res = await fetchDictItems('llm_models', { pageSize: 200 });
    dictModels.value = res.items;
  } catch (e) {
    catalogError.value = (e as Error).message || '加载可用模型清单失败';
  } finally {
    catalogLoading.value = false;
  }
}

function openEdit(record: ModelPricingItem): void {
  editing.value = record;
  Object.assign(form, {
    provider: record.provider,
    model: record.model,
    inputPricePer1k: Number(record.inputPricePer1k),
    outputPricePer1k: Number(record.outputPricePer1k),
    currency: record.currency,
  });
  modalOpen.value = true;
}

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  saving.value = true;
  try {
    await upsertPricing({
      provider: form.provider.trim(),
      model: form.model.trim(),
      inputPricePer1k: form.inputPricePer1k,
      outputPricePer1k: form.outputPricePer1k,
      currency: form.currency,
    });
    message.success(editing.value ? '单价已更新' : '单价已创建');
    modalOpen.value = false;
    await load();
  } catch (e) {
    message.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function closeModal(): void {
  if (saving.value) return;
  modalOpen.value = false;
  formRef.value?.clearValidate();
}

async function doRemove(record: ModelPricingItem): Promise<void> {
  try {
    await removePricing(record.id);
    message.success('已删除');
    await load();
  } catch (e) {
    message.error((e as Error).message || '删除失败');
  }
}

onMounted(() => {
  void load();
  void loadDictModels();
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
.catalog-card {
  margin-bottom: 14px;
}
.catalog-title {
  font-size: var(--ws-font-size-body);
  color: var(--ws-text-primary);
  font-weight: var(--ws-font-weight-semibold);
}
.catalog-sub {
  margin-left: 8px;
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
  font-weight: var(--ws-font-weight-normal);
}
.mp-model {
  color: var(--ws-text-primary);
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ws-text-secondary);
}
.form-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.6;
  margin-top: 2px;
}
.page-empty {
  padding-top: 12px;
}
</style>
