<template>
  <div class="dict-page">
    <div class="page-head">
      <div>
        <h2>字典管理</h2>
        <p class="page-sub">维护系统维表数据；停用比删除安全，已落库的值仍可被解释</p>
      </div>
      <a-space>
        <a-button :loading="loadingTypes" @click="loadTypes">刷新</a-button>
        <a-button type="primary" @click="openEditPage('new')">新建字典</a-button>
      </a-space>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="page-alert" :message="loadError" />

    <div class="dict-cols">
      <!-- 左：字典列表 -->
      <a-card :bordered="false" class="card-left">
        <template #title><span class="card-title">字典（{{ filteredTypes.length }}）</span></template>
        <a-input-search
          v-model:value="typeKeyword"
          placeholder="搜索字典编码 / 名称"
          allow-clear
          class="type-search"
        />
        <div class="type-list">
          <div
            v-for="t in filteredTypes"
            :key="t.code"
            class="dict-item"
            :class="{ active: t.code === curCode }"
            @click="pick(t.code)"
          >
            <div class="item-name">
              <span class="name-text">{{ t.name }}</span>
              <span v-if="t.builtin" class="tag-builtin">内置</span>
              <span v-if="!t.enabled" class="tag-off">停用</span>
              <span class="item-count">{{ t.itemsCount }}</span>
            </div>
            <div class="ws-mono item-code">{{ t.code }}</div>
          </div>
          <a-empty
            v-if="!loadingTypes && !filteredTypes.length"
            class="list-empty"
            :image="null"
            :description="typeKeyword ? `未匹配「${typeKeyword}」，换个关键词或新建` : '暂无字典'"
          />
        </div>
      </a-card>

      <!-- 右：记录明细 -->
      <a-card :bordered="false" class="card-right">
        <template #title>
          <span class="card-title">
            {{ curType?.name || '—' }}
            <span v-if="curType?.builtin" class="tag-builtin">内置</span>
            <span class="ws-mono item-code">{{ curCode }}</span>
          </span>
        </template>
        <template #extra>
          <a-space>
            <a-button type="link" @click="openEditPage(curCode)">编辑字典</a-button>
            <a-button type="primary" :disabled="!curCode" @click="openDrawer()">新增记录</a-button>
          </a-space>
        </template>

        <div class="filter-bar">
          <a-input-search
            v-model:value="itemKeyword"
            placeholder="搜索 Value / 名称"
            allow-clear
            class="filter-search"
            @search="onSearchItems"
          />
          <a-select v-model:value="enabledFilter" class="filter-select" placeholder="全部状态" @change="onSearchItems">
            <a-select-option value="">全部状态</a-select-option>
            <a-select-option value="true">仅启用</a-select-option>
            <a-select-option value="false">仅停用</a-select-option>
          </a-select>
        </div>

        <a-table
          :columns="columns"
          :data-source="rows"
          :loading="loadingItems"
          :pagination="{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t: number) => `共 ${t} 条`,
          }"
          :scroll="{ x: 'max-content' }"
          size="middle"
          row-key="id"
          :locale="{ emptyText: ' ' }"
          @change="onTableChange"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'value'">
              <span class="ws-mono cell-value">{{ record.value }}</span>
            </template>
            <template v-else-if="column.key.startsWith('attr_')">
              <span v-if="record.attrs && record.attrs[column.attrName] !== null && record.attrs[column.attrName] !== undefined && record.attrs[column.attrName] !== ''">
                <span v-if="column.attrType === 'boolean'" class="ws-mono">
                  {{ record.attrs[column.attrName] ? '是' : '否' }}
                </span>
                <span v-else-if="column.attrType === 'number'" class="ws-mono">
                  {{ record.attrs[column.attrName] }}
                </span>
                <span v-else>{{ record.attrs[column.attrName] }}</span>
              </span>
              <span v-else class="cell-empty">—</span>
            </template>
            <template v-else-if="column.dataIndex === 'enabled'">
              <a-switch
                :checked="record.enabled"
                size="small"
                @change="(checked: boolean) => toggleEnabled(record, checked)"
              />
            </template>
            <template v-else-if="column.dataIndex === 'action'">
              <a-space>
                <a-button type="link" size="small" @click="openDrawer(record)">编辑</a-button>
                <a-popconfirm
                  title="删除后使用该值的历史数据将无法在字典中解释，建议改用「停用」。确认删除？"
                  ok-text="删除"
                  cancel-text="取消"
                  @confirm="doRemove(record)"
                >
                  <a-button type="link" size="small" danger>删除</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
        <a-empty
          v-if="!loadingItems && !rows.length"
          class="page-empty"
          :description="emptyText"
        />
        <div v-if="fields.length > 3" class="scroll-hint">列较多，可左右滑动表格查看全部字段</div>
      </a-card>
    </div>

    <!-- 抽屉：记录新增 / 编辑 -->
    <a-drawer
      v-model:open="drawerOpen"
      :title="editing ? `编辑记录 · ${curCode}` : `新增记录 · ${curCode}`"
      placement="right"
      width="460"
      :mask-closable="!saving"
      @close="closeDrawer"
    >
      <a-form :model="form" layout="vertical">
        <a-form-item label="Value（业务侧消费的原值，同字典内唯一）" v-bind="validateInfos.value">
          <a-input v-model:value="form.value" class="ws-mono" :disabled="!!editing" placeholder="hy4-preview" />
        </a-form-item>
        <a-form-item label="名称（列表默认展示）" v-bind="validateInfos.label">
          <a-input v-model:value="form.label" placeholder="Hy4 Preview" />
        </a-form-item>

        <template v-for="f in fields" :key="f.name">
          <a-form-item :label="f.label + (f.required ? '' : '（选填）')">
            <a-switch
              v-if="f.type === 'boolean'"
              :checked="attrValue(f.name) === true"
              @change="(checked: boolean) => setAttr(f.name, checked)"
            />
            <a-select
              v-else-if="f.type === 'enum'"
              :value="(attrValue(f.name) as string) || undefined"
              :options="(f.options || []).map((o) => ({ value: o, label: o }))"
              :placeholder="f.defaultValue || '请选择'"
              @change="(v: string) => setAttr(f.name, v)"
            />
            <a-textarea
              v-else-if="f.type === 'text'"
              :value="(attrValue(f.name) as string) ?? ''"
              :maxlength="f.length || 4096"
              :rows="3"
              @change="(e: Event) => setAttr(f.name, (e.target as HTMLTextAreaElement).value)"
            />
            <a-input-number
              v-else-if="f.type === 'number'"
              :value="(attrValue(f.name) as number) ?? null"
              style="width: 100%"
              @change="(v: number | null) => setAttr(f.name, v)"
            />
            <a-date-picker
              v-else-if="f.type === 'date'"
              :value="attrValue(f.name) ? dayjs(String(attrValue(f.name))) : undefined"
              style="width: 100%"
              @change="(_d: unknown, dateString: string) => setAttr(f.name, dateString)"
            />
            <a-input
              v-else
              :value="(attrValue(f.name) as string) ?? ''"
              :maxlength="f.length || 1024"
              @change="(e: Event) => setAttr(f.name, (e.target as HTMLInputElement).value)"
            />
            <div v-if="f.length" class="form-hint">最多 {{ f.length }} {{ lengthUnit(f.type) }}</div>
          </a-form-item>
        </template>
        <div v-if="!fields.length" class="form-hint">该字典未定义字段，记录只有 Value / 名称。</div>

        <a-form-item label="排序">
          <a-input-number v-model:value="form.sort" :min="0" style="width: 100%" />
        </a-form-item>
        <a-form-item label="启用">
          <a-switch v-model:checked="form.enabled" />
        </a-form-item>
      </a-form>

      <template #footer>
        <div class="drawer-foot">
          <span class="foot-hint">记录改动即时生效</span>
          <a-space>
            <a-button :disabled="saving" @click="closeDrawer">取消</a-button>
            <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
          </a-space>
        </div>
      </template>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Form, message } from 'ant-design-vue';
import dayjs from 'dayjs';
import {
  createDictItem,
  fetchDictFields,
  fetchDictItems,
  fetchDictTypes,
  lengthUnit,
  removeDictItem,
  updateDictItem,
  type DictAttrValue,
  type DictFieldDef,
  type DictItemRow,
  type DictTypeItem,
} from '@/api/dict';

const router = useRouter();

const loadingTypes = ref(false);
const loadingItems = ref(false);
const loadError = ref('');
const types = ref<DictTypeItem[]>([]);
const typeKeyword = ref('');
const curCode = ref('');

const fields = ref<DictFieldDef[]>([]);
const rows = ref<DictItemRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const itemKeyword = ref('');
const enabledFilter = ref<string>('');

const drawerOpen = ref(false);
const saving = ref(false);
const editing = ref<DictItemRow | null>(null);
const form = reactive<{
  value: string;
  label: string;
  sort: number;
  enabled: boolean;
  attrs: Record<string, DictAttrValue>;
}>({ value: '', label: '', sort: 10, enabled: true, attrs: {} });

const useForm = Form.useForm;
const rules = reactive({
  value: [{ required: true, message: '请填写 Value' }],
  label: [{ required: true, message: '请填写名称' }],
});
const { validateInfos, resetFields, validate } = useForm(form, rules);

const filteredTypes = computed(() => {
  const kw = typeKeyword.value.trim().toLowerCase();
  if (!kw) return types.value;
  return types.value.filter((t) => t.code.includes(kw) || t.name.toLowerCase().includes(kw));
});
const curType = computed(() => types.value.find((t) => t.code === curCode.value) || null);

const columns = computed(() => {
  const base = [
    { title: 'Value', dataIndex: 'value', key: 'value', width: 180 },
    { title: '名称', dataIndex: 'label', key: 'label', width: 160 },
  ];
  const dyn = fields.value.map((f) => ({
    title: f.label,
    key: `attr_${f.name}`,
    dataIndex: `attrs.${f.name}`,
    attrName: f.name,
    attrType: f.type,
    width: 150,
  }));
  return [
    ...base,
    ...dyn,
    { title: '排序', dataIndex: 'sort', key: 'sort', width: 80 },
    { title: '状态', dataIndex: 'enabled', key: 'enabled', width: 90 },
    { title: '操作', dataIndex: 'action', key: 'action', width: 130 },
  ];
});

const emptyText = computed(() => {
  if (itemKeyword.value || enabledFilter.value) return '没有符合条件的记录，换个关键词或清除筛选';
  return '该字典暂无记录，点右上「新增记录」添加第一条';
});

function attrValue(name: string): DictAttrValue {
  const v = form.attrs[name];
  return v === undefined ? null : v;
}
function setAttr(name: string, v: DictAttrValue): void {
  form.attrs[name] = v;
}

async function loadTypes(): Promise<void> {
  loadingTypes.value = true;
  loadError.value = '';
  try {
    types.value = await fetchDictTypes();
    if (!curCode.value && types.value.length) {
      curCode.value = types.value[0].code;
      await Promise.all([loadFields(), loadItems()]);
    }
  } catch (e) {
    loadError.value = (e as Error).message || '加载字典失败';
  } finally {
    loadingTypes.value = false;
  }
}

async function loadFields(): Promise<void> {
  if (!curCode.value) return;
  try {
    fields.value = await fetchDictFields(curCode.value);
  } catch {
    fields.value = [];
  }
}

async function loadItems(): Promise<void> {
  if (!curCode.value) return;
  loadingItems.value = true;
  loadError.value = '';
  try {
    const res = await fetchDictItems(curCode.value, {
      keyword: itemKeyword.value.trim() || undefined,
      enabled: enabledFilter.value === '' ? undefined : enabledFilter.value === 'true',
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = res.items;
    total.value = res.total;
    page.value = res.page;
    pageSize.value = res.pageSize;
  } catch (e) {
    loadError.value = (e as Error).message || '加载记录失败';
  } finally {
    loadingItems.value = false;
  }
}

function pick(code: string): void {
  if (code === curCode.value) return;
  curCode.value = code;
  page.value = 1;
  itemKeyword.value = '';
  enabledFilter.value = '';
  void loadFields();
  void loadItems();
}

function onSearchItems(): void {
  page.value = 1;
  void loadItems();
}

function onTableChange(pag: { current?: number; pageSize?: number }): void {
  page.value = pag.current ?? 1;
  pageSize.value = pag.pageSize ?? 20;
  void loadItems();
}

async function toggleEnabled(record: DictItemRow, checked: boolean): Promise<void> {
  try {
    await updateDictItem(record.id, { enabled: checked });
    record.enabled = checked;
    message.success(checked ? '已启用' : '已停用');
  } catch (e) {
    message.error((e as Error).message || '操作失败');
  }
}

async function doRemove(record: DictItemRow): Promise<void> {
  try {
    await removeDictItem(record.id);
    message.success('已删除');
    await loadItems();
    await loadTypes();
  } catch (e) {
    message.error((e as Error).message || '删除失败');
  }
}

function openEditPage(code: string): void {
  // 注意：admin 的 router base 是 '/admin/'，这里**不能**再写 /admin 前缀，
  // 否则 vue-router 会再拼一次 base（/admin/admin/...）→ 404
  void router.push(`/settings/dicts/${code}`);
}

function openDrawer(record?: DictItemRow): void {
  editing.value = record ?? null;
  resetFields();
  Object.assign(form, {
    value: record?.value ?? '',
    label: record?.label ?? '',
    sort: record?.sort ?? 10,
    enabled: record?.enabled ?? true,
    attrs: { ...(record?.attrs ?? {}) },
  });
  drawerOpen.value = true;
}

function closeDrawer(): void {
  if (saving.value) return;
  drawerOpen.value = false;
}

async function submit(): Promise<void> {
  try {
    await validate();
  } catch {
    return;
  }
  if (!curCode.value) return;
  saving.value = true;
  try {
    const payload = {
      value: form.value.trim(),
      label: form.label.trim(),
      sort: form.sort,
      enabled: form.enabled,
      attrs: { ...form.attrs },
    };
    if (editing.value) {
      await updateDictItem(editing.value.id, payload);
      message.success('记录已更新');
    } else {
      await createDictItem({ typeCode: curCode.value, ...payload });
      message.success('记录已创建');
    }
    drawerOpen.value = false;
    await loadItems();
    await loadTypes();
  } catch (e) {
    message.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadTypes();
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
.dict-cols {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.card-left {
  width: 300px;
  flex-shrink: 0;
}
.card-right {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: var(--ws-font-size-body);
  font-weight: var(--ws-font-weight-semibold);
  color: var(--ws-text-primary);
}
.type-search {
  margin-bottom: 8px;
}
.type-list {
  max-height: 420px;
  overflow: auto;
}
.dict-item {
  padding: 8px 10px;
  border-radius: var(--ws-radius-md, 8px);
  cursor: pointer;
  margin-bottom: 3px;
  border: 1px solid transparent;
}
.dict-item:hover {
  background: var(--ws-bg-hover);
}
.dict-item.active {
  background: var(--ws-brand-soft);
  border-color: var(--ws-brand-500);
}
.item-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name-text {
  color: var(--ws-text-primary);
  font-weight: var(--ws-font-weight-medium);
}
.dict-item.active .name-text {
  color: var(--ws-brand-500);
}
.item-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.item-code {
  font-size: 11px;
  color: var(--ws-text-tertiary);
}
.tag-builtin,
.tag-off {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}
.tag-builtin {
  color: var(--ws-brand-500);
  background: var(--ws-brand-soft);
}
.tag-off {
  color: var(--ws-text-tertiary);
  background: var(--ws-bg-hover);
}
.filter-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.filter-search {
  flex: 1;
}
.filter-select {
  width: 140px;
}
.cell-value {
  color: var(--ws-text-primary);
}
.cell-empty {
  color: var(--ws-text-tertiary);
}
.scroll-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.page-empty {
  padding-top: 12px;
}
.list-empty {
  padding-top: 16px;
}
.form-hint {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.6;
}
.drawer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.foot-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.ws-mono {
  font-family: var(--ws-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
