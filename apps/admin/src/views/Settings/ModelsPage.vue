<template>
  <div class="mp-page">
    <div class="page-head">
      <div>
        <h2>模型</h2>
        <p class="page-sub">
          清单与价格维护在「字典管理 · 大模型清单」；本页用于总览与漏配检查（Agent 侧 60s 内生效）
        </p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="load">刷新</a-button>
        <a-button type="primary" @click="goDicts">去字典管理维护</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="page-alert" :message="loadError" />

    <a-alert v-if="missingPriceCount > 0" type="warning" show-icon class="page-alert">
      <template #message>
        有 {{ missingPriceCount }} 个启用中的模型未配置单价，它们的 run 成本将记为 0。
      </template>
      <template #action>
        <a-button
          size="small"
          :type="onlyMissing ? 'default' : 'primary'"
          @click="toggleOnlyMissing"
        >
          {{ onlyMissing ? '查看全部' : '去看这些模型' }}
        </a-button>
      </template>
    </a-alert>

    <a-card :bordered="false" class="table-card">
      <a-table
        :columns="columns"
        :data-source="displayRows"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 'max-content' }"
        size="middle"
        row-key="id"
        :locale="{ emptyText: ' ' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'value'">
            <span class="ws-mono value-cell">{{ record.value }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'label'">
            {{ record.label || '—' }}
          </template>
          <template v-else-if="column.dataIndex === 'provider'">
            {{ attr(record, 'provider') }}
          </template>
          <template v-else-if="column.dataIndex === 'context'">
            {{ fmtContext(attr(record, 'context_window')) }}
          </template>
          <template v-else-if="column.dataIndex === 'inputPrice'">
            <span v-if="hasPrice(record)" class="ws-mono">
              {{ fmtPrice(record, 'input_price_per1k') }}
            </span>
            <a-tag v-else color="warning">未配置</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'outputPrice'">
            <span v-if="hasPrice(record)" class="ws-mono">
              {{ fmtPrice(record, 'output_price_per1k') }}
            </span>
            <a-tag v-else color="warning">未配置</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'currency'">
            <span class="ws-mono">{{ currencyOf(record) }}</span>
          </template>
          <template v-else-if="column.dataIndex === 'status'">
            <a-tag v-if="record.enabled" color="success">启用</a-tag>
            <a-tag v-else>停用</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <a-button type="link" size="small" @click="goDictsWith(record.value)">
              在字典中编辑
            </a-button>
          </template>
        </template>
      </a-table>
      <a-empty v-if="!loading && !displayRows.length" class="page-empty" :description="emptyText" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
/**
 * 模型 · 只读总览。
 *
 * 维护入口**统一在「字典管理」**（字段定义走独立页面、记录走抽屉），本页只做两件事：
 * 1) 一眼看清哪些模型可用、价格多少；2) 把「启用但未配价」的模型挑出来（这些 run 成本记 0）。
 * 数据与维护同源，避免出现"两处都能改"的重复维护（specs/llm-models-unify/design.md §4.6）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchDictItems, type DictItemRow } from '@/api/dict';

/** 模型清单所在字典编码（与 ai-agent 的 MODEL_DICT_CODE 保持一致） */
const DICT_CODE = 'llm_models';
const PRICE_KEYS = ['input_price_per1k', 'output_price_per1k'];

const router = useRouter();
const loading = ref(false);
const loadError = ref('');
const rows = ref<DictItemRow[]>([]);
/** 只显示"启用但未配价"的模型 */
const onlyMissing = ref(false);

const columns = [
  { title: '模型 id', dataIndex: 'value', width: 220 },
  { title: '展示名', dataIndex: 'label', width: 150 },
  { title: '提供方', dataIndex: 'provider', width: 110 },
  { title: '上下文', dataIndex: 'context', width: 100, align: 'right' as const },
  { title: '输入价 / 1K', dataIndex: 'inputPrice', width: 140, align: 'right' as const },
  { title: '输出价 / 1K', dataIndex: 'outputPrice', width: 140, align: 'right' as const },
  { title: '币种', dataIndex: 'currency', width: 80 },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '操作', dataIndex: 'action', width: 120 },
];

function attr(row: DictItemRow, key: string): string {
  const v = row.attrs ? row.attrs[key] : null;
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function currencyOf(row: DictItemRow): string {
  const v = row.attrs ? row.attrs.currency : null;
  return v ? String(v) : 'CNY';
}

/** 是否已配价（0 也是合法价格，只有空值算未配置） */
function hasPrice(row: DictItemRow): boolean {
  const attrs = row.attrs;
  if (!attrs) return false;
  return PRICE_KEYS.some((k) => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '');
}

function isMissingPrice(row: DictItemRow): boolean {
  return row.enabled && !hasPrice(row);
}

const missingPriceCount = computed(() => rows.value.filter(isMissingPrice).length);

const displayRows = computed(() =>
  onlyMissing.value ? rows.value.filter(isMissingPrice) : rows.value,
);

const emptyText = computed(() =>
  onlyMissing.value ? '当前筛选下没有模型' : '还没有可用模型，去「字典管理」添加',
);

/** 128000 → 128k；非法值原样返回 */
function fmtContext(v: string): string {
  if (v === '—') return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function fmtPrice(row: DictItemRow, key: string): string {
  const raw = row.attrs ? row.attrs[key] : null;
  const n = Number(raw ?? 0);
  return `${currencyOf(row) === 'USD' ? '$' : '¥'} ${n.toFixed(6)}`;
}

function toggleOnlyMissing(): void {
  onlyMissing.value = !onlyMissing.value;
}

function goDicts(): void {
  void router.push(`/admin/settings/dicts/${DICT_CODE}`);
}

/** 跳到字典管理并把该模型 id 作为搜索词带入（页面若不支持 keyword，忽略即可） */
function goDictsWith(modelId: string): void {
  void router.push({ path: `/admin/settings/dicts/${DICT_CODE}`, query: { keyword: modelId } });
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await fetchDictItems(DICT_CODE, { pageSize: 200 });
    rows.value = res.items;
  } catch (e) {
    loadError.value = (e as Error).message || '加载模型清单失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
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
.value-cell {
  color: var(--ws-text-primary);
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ws-text-secondary);
}
.page-empty {
  padding-top: 12px;
}
</style>
