<template>
  <div class="mp-page">
    <div class="page-head">
      <div>
        <h2>模型单价</h2>
        <p class="page-sub">run 成本按 usage × 单价核算；无单价记录的模型成本记 0，请及时补配</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="load">刷新</a-button>
        <a-button type="primary" @click="openCreate">新建单价</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="page-alert" :message="loadError" />

    <a-card :bordered="false" class="table-card">
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
import type { FormInstance } from 'ant-design-vue';
import { message } from 'ant-design-vue';
import { fetchPricings, upsertPricing, removePricing, type ModelPricingItem } from '@/api/model-pricing';

const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const rows = ref<ModelPricingItem[]>([]);

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

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { provider: '', model: '', inputPricePer1k: 0, outputPricePer1k: 0, currency: 'CNY' });
  modalOpen.value = true;
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
