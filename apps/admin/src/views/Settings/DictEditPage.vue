<template>
  <div class="edit-page">
    <a-breadcrumb class="crumb">
      <a-breadcrumb-item><a @click="goBack">字典管理</a></a-breadcrumb-item>
      <a-breadcrumb-item>{{ isNew ? '新建字典' : curName || code }}</a-breadcrumb-item>
    </a-breadcrumb>

    <div class="page-head">
      <div>
        <h2>{{ isNew ? '新建字典' : '编辑字典' }}</h2>
        <p class="page-sub">字典结构（基本信息 + 字段定义）在此页维护；记录数据在列表页用抽屉维护</p>
      </div>
    </div>

    <a-alert v-if="loadError" type="error" show-icon class="page-alert" :message="loadError" />

    <a-card :bordered="false" class="section-card">
      <template #title><span class="card-title">基本信息</span></template>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="字典编码" v-bind="validateInfos.code">
            <a-input v-model:value="form.code" class="ws-mono" :disabled="!isNew" placeholder="llm_models" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="字典名称" v-bind="validateInfos.name">
            <a-input v-model:value="form.name" placeholder="大模型清单" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="描述（选填）">
        <a-input v-model:value="form.description" placeholder="AI Agent 可用模型" />
      </a-form-item>
      <a-form-item label="启用">
        <a-switch v-model:checked="form.enabled" />
        <span class="form-hint">停用后业务侧视为空字典</span>
      </a-form-item>
    </a-card>

    <a-card :bordered="false" class="section-card">
      <template #title>
        <span class="card-title">字段定义</span>
      </template>
      <template #extra>
        <span class="card-extra">决定记录表列与记录表单控件；length 为长度上限（写库强校验 + 输入前置拦截）</span>
      </template>

      <a-table
        :columns="fieldColumns"
        :data-source="draft"
        :pagination="false"
        size="small"
        row-key="idx"
        :locale="{ emptyText: ' ' }"
      >
        <template #bodyCell="{ column, record, index }">
          <template v-if="column.dataIndex === 'name'">
            <a-input v-model:value="record.name" class="ws-mono" placeholder="provider" />
          </template>
          <template v-else-if="column.dataIndex === 'label'">
            <a-input v-model:value="record.label" placeholder="提供方" />
          </template>
          <template v-else-if="column.dataIndex === 'type'">
            <a-select v-model:value="record.type" style="width: 100%">
              <a-select-option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</a-select-option>
            </a-select>
          </template>
          <template v-else-if="column.dataIndex === 'length'">
            <a-input-number
              v-model:value="record.length"
              :min="1"
              :disabled="!needLength(record.type)"
              style="width: 100%"
            />
          </template>
          <template v-else-if="column.dataIndex === 'required'">
            <a-switch v-model:checked="record.required" size="small" />
          </template>
          <template v-else-if="column.dataIndex === 'extra'">
            <a-input
              v-if="record.type === 'enum'"
              v-model:value="record.optionsText"
              placeholder="逗号分隔，如 tokenhub,hy3"
            />
            <a-input v-else v-model:value="record.defaultValue" placeholder="默认值（选填）" />
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <a-space>
              <a-button type="link" size="small" :disabled="index === 0" @click="move(index, -1)">↑</a-button>
              <a-button type="link" size="small" :disabled="index === draft.length - 1" @click="move(index, 1)">↓</a-button>
              <a-button type="link" size="small" danger @click="removeField(index)">删除</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-empty
        v-if="!draft.length"
        class="section-empty"
        :image="null"
        description="暂未定义字段，记录将只含 Value / 名称 两个字段"
      />
      <a-button class="add-btn" @click="addField">+ 添加字段</a-button>
      <div class="form-hint">保存时整体提交字段数组（覆盖式）。删除字段只丢这一列的值，不删数据行。</div>
    </a-card>

    <div v-if="!isNew" class="danger-zone">
      <div>
        <div class="danger-title">删除字典</div>
        <div class="danger-desc">
          连带删除字段定义与全部记录，不可恢复；已引用该字典的服务会回落至环境变量 / 内置默认值。
        </div>
      </div>
      <a-button danger :disabled="isBuiltin" @click="confirmDelete">
        {{ isBuiltin ? '内置字典不可删除' : '删除' }}
      </a-button>
    </div>

    <div class="page-foot">
      <a-space>
        <a-button @click="goBack">取消</a-button>
        <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Form, Modal, message } from 'ant-design-vue';
import {
  createDictType,
  fetchDictFields,
  fetchDictTypes,
  removeDictType,
  replaceDictFields,
  updateDictType,
  type DictFieldDef,
  type DictFieldPayload,
  type DictFieldType,
  type DictTypeItem,
} from '@/api/dict';

const FIELD_TYPES: DictFieldType[] = ['string', 'text', 'number', 'boolean', 'enum', 'date'];

const route = useRoute();
const router = useRouter();

const code = computed(() => String(route.params.code || ''));
const isNew = computed(() => code.value === 'new' || !code.value);

const saving = ref(false);
const loadError = ref('');
const curName = ref('');
const isBuiltin = ref(false);
const typeId = ref('');
const draft = ref<Array<DictFieldPayload & { optionsText: string }>>([]);

const form = reactive<{ code: string; name: string; description: string; enabled: boolean }>({
  code: '',
  name: '',
  description: '',
  enabled: true,
});

const rules = computed(() => ({
  code: [
    { required: isNew.value, message: '请填写字典编码' },
    {
      validator: (_r: unknown, v: string) =>
        !v || /^[a-z][a-z0-9_]*$/.test(v)
          ? Promise.resolve()
          : Promise.reject(new Error('只能包含小写字母、数字和下划线，且以字母开头')),
    },
  ],
  name: [{ required: true, message: '请填写字典名称' }],
}));
const { validateInfos, validate } = Form.useForm(form, rules);

const fieldColumns = [
  { title: '字段名', dataIndex: 'name', key: 'name', width: 150 },
  { title: '标签', dataIndex: 'label', key: 'label', width: 140 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 110 },
  { title: '长度', dataIndex: 'length', key: 'length', width: 90 },
  { title: '必填', dataIndex: 'required', key: 'required', width: 70 },
  { title: '枚举项 / 默认值', dataIndex: 'extra', key: 'extra' },
  { title: '操作', dataIndex: 'action', key: 'action', width: 150 },
];

function needLength(type: DictFieldType): boolean {
  return type === 'string' || type === 'text' || type === 'number';
}

function toRow(f: DictFieldDef): DictFieldPayload & { optionsText: string } {
  return {
    name: f.name,
    label: f.label,
    type: f.type,
    length: f.length ?? undefined,
    required: f.required,
    defaultValue: f.defaultValue ?? '',
    options: f.options ?? undefined,
    sort: f.sort,
    optionsText: (f.options || []).join(','),
  };
}

function addField(): void {
  draft.value.push({
    name: '',
    label: '',
    type: 'string',
    length: undefined,
    required: false,
    defaultValue: '',
    optionsText: '',
    sort: (draft.value.length + 1) * 10,
  });
}

function removeField(index: number): void {
  draft.value.splice(index, 1);
}

function move(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= draft.value.length) return;
  const tmp = draft.value[index];
  draft.value[index] = draft.value[target];
  draft.value[target] = tmp;
}

async function load(): Promise<void> {
  if (isNew.value) return;
  loadError.value = '';
  try {
    const types: DictTypeItem[] = await fetchDictTypes();
    const hit = types.find((t) => t.code === code.value);
    if (!hit) {
      loadError.value = `字典不存在: ${code.value}`;
      return;
    }
    typeId.value = hit.id;
    curName.value = hit.name;
    isBuiltin.value = hit.builtin;
    form.code = hit.code;
    form.name = hit.name;
    form.description = hit.description ?? '';
    form.enabled = hit.enabled;
    const fields = await fetchDictFields(code.value);
    draft.value = fields.map(toRow);
  } catch (e) {
    loadError.value = (e as Error).message || '加载字典失败';
  }
}

function buildFields(): DictFieldPayload[] {
  return draft.value.map((f, i) => ({
    name: f.name.trim(),
    label: f.label.trim(),
    type: f.type,
    ...(needLength(f.type) && f.length ? { length: f.length } : {}),
    required: !!f.required,
    defaultValue: f.type === 'enum' ? '' : (f.defaultValue ?? ''),
    ...(f.type === 'enum'
      ? { options: f.optionsText.split(',').map((s) => s.trim()).filter(Boolean) }
      : {}),
    sort: (i + 1) * 10,
  }));
}

function validateFields(): boolean {
  const names = draft.value.map((f) => f.name.trim());
  if (names.some((n) => !/^[a-z][a-z0-9_]*$/.test(n))) {
    message.error('字段名只能包含小写字母、数字和下划线，且以字母开头');
    return false;
  }
  if (new Set(names).size !== names.length) {
    message.error('字段名不可重复');
    return false;
  }
  if (draft.value.some((f) => !f.label.trim())) {
    message.error('字段标签必填');
    return false;
  }
  if (draft.value.some((f) => f.type === 'enum' && !f.optionsText.trim())) {
    message.error('enum 字段必须填写枚举项');
    return false;
  }
  return true;
}

async function submit(): Promise<void> {
  try {
    await validate();
  } catch {
    return;
  }
  if (!validateFields()) return;
  saving.value = true;
  try {
    const targetCode = form.code.trim();
    if (isNew.value) {
      await createDictType({
        code: targetCode,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        enabled: form.enabled,
      });
    } else if (typeId.value) {
      await updateDictType(typeId.value, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        enabled: form.enabled,
      });
    }
    await replaceDictFields(targetCode, buildFields());
    message.success(`字典已保存（字段 ${draft.value.length} 个）`);
    void router.push('/admin/settings/dicts');
  } catch (e) {
    message.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function confirmDelete(): void {
  if (isBuiltin.value) return;
  Modal.confirm({
    title: `删除「${curName.value}」？`,
    content: '将同时删除其字段定义与全部记录，不可恢复。已引用该字典的服务会回落至环境变量 / 内置默认值（Agent 仍可用，但界面不可再维护）。若只是暂时不用，建议改为停用。',
    okText: '确认删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await removeDictType(typeId.value);
        message.success('已删除');
        void router.push('/admin/settings/dicts');
      } catch (e) {
        message.error((e as Error).message || '删除失败');
      }
    },
  });
}

function goBack(): void {
  void router.push('/admin/settings/dicts');
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.crumb {
  margin-bottom: 8px;
}
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
.section-card {
  margin-bottom: 14px;
}
.card-title {
  font-size: var(--ws-font-size-body);
  font-weight: var(--ws-font-weight-semibold);
  color: var(--ws-text-primary);
}
.card-extra {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.section-empty {
  padding: 12px 0;
}
.add-btn {
  margin-top: 10px;
}
.form-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.6;
}
.danger-zone {
  border: 1px solid var(--ws-status-error, #e5484d);
  border-radius: var(--ws-radius-md, 8px);
  padding: 13px;
  background: var(--ws-status-error-soft, #fdebec);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.danger-title {
  font-size: var(--ws-font-size-body);
  font-weight: var(--ws-font-weight-semibold);
  color: var(--ws-status-error, #e5484d);
}
.danger-desc {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ws-text-secondary);
  line-height: 1.5;
}
.page-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--ws-border-base);
}
.ws-mono {
  font-family: var(--ws-font-mono);
}
</style>
