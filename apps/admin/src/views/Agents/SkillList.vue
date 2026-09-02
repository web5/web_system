<template>
  <a-page-header
    title="技能库"
    sub-title="沉淀可复用的行为守则（SKILL.md）。Agent 按需挂载技能，模型需要时通过 load_skill 加载完整规范"
  >
    <template #extra>
      <a-upload
        :show-upload-list="false"
        :before-upload="handleImportFile"
        accept=".zip"
      >
        <a-button>导入 zip 技能包</a-button>
      </a-upload>
      <a-button type="primary" @click="openCreate">新建技能</a-button>
      <a-button :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

  <a-card :bordered="true">
    <a-table
      :columns="columns"
      :data-source="skills"
      :loading="loading"
      row-key="code"
      size="middle"
      :pagination="false"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'name'">
          <b>{{ record.name }}</b>
        </template>
        <template v-else-if="column.dataIndex === 'requiredTools'">
          <template v-if="record.requiredTools?.length">
            <a-tag v-for="t in record.requiredTools" :key="t" size="small">{{ t }}</a-tag>
          </template>
          <span v-else>—</span>
        </template>
        <template v-else-if="column.dataIndex === 'enabled'">
          <a-switch
            :checked="record.enabled"
            :disabled="!canManage"
            @change="(v: boolean) => toggleEnabled(record, v)"
          />
        </template>
        <template v-else-if="column.dataIndex === 'updatedAt'">
          {{ fmt(record.updatedAt) }}
        </template>
        <template v-else-if="column.dataIndex === 'actions'">
          <a-space>
            <a-button type="link" size="small" @click="openView(record)">查看正文</a-button>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm
              title="删除后引用该技能的 Agent 将无法加载，确认删除？"
              ok-text="删除"
              cancel-text="取消"
              @confirm="remove(record)"
            >
              <a-button type="link" size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <!-- 新建 / 编辑弹窗 -->
  <a-modal
    :open="editOpen"
    :title="editing ? `编辑技能 · ${editing.code}` : '新建技能'"
    :width="820"
    :confirm-loading="saving"
    ok-text="保存"
    cancel-text="取消"
    @ok="save"
    @cancel="closeEdit"
  >
    <a-form layout="vertical">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="技能 Code（唯一，对应 SKILL.md name）">
            <a-input v-model:value="form.code" :disabled="!!editing" placeholder="如 web-system-finnews" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="名称">
            <a-input v-model:value="form.name" placeholder="如 财经资讯" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="描述（on-demand 时注入 system 的摘要，50~100 字）">
        <a-textarea v-model:value="form.description" :rows="2" placeholder="模型据此判断是否需要加载该技能" />
      </a-form-item>
      <a-form-item label="依赖工具（本地工具名 或 mcp:module/tool，Agent 勾选本技能时自动带入）">
        <a-select v-model:value="form.requiredTools" mode="tags" placeholder="回车添加" />
      </a-form-item>
      <a-form-item label="SKILL.md 正文（Markdown 行为守则：工作流 / 门禁 / 工具用法 / 错误处理）">
        <a-textarea v-model:value="form.content" :rows="16" placeholder="粘贴 SKILL.md 正文" />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 查看正文弹窗 -->
  <a-modal
    :open="viewOpen"
    :title="`SKILL.md · ${viewing?.name || ''}`"
    :footer="null"
    :width="760"
    @cancel="viewOpen = false"
  >
    <pre class="raw-block">{{ viewing?.content }}</pre>
  </a-modal>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  removeSkill,
  importSkillZip,
  type SkillItem,
  type SkillDetail,
  type SaveSkillPayload,
} from '@/api/skills';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const canManage = userStore.hasPermission('skills:manage');

const loading = ref(false);
const saving = ref(false);
const skills = ref<SkillItem[]>([]);
const editOpen = ref(false);
const viewOpen = ref(false);
const editing = ref<SkillItem | null>(null);
const viewing = ref<SkillDetail | null>(null);

const defaultForm = (): SaveSkillPayload => ({
  code: '',
  name: '',
  description: '',
  content: '',
  requiredTools: [],
  enabled: true,
});
const form = reactive<SaveSkillPayload>(defaultForm());

const columns = [
  { title: 'Code', dataIndex: 'code', width: 180 },
  { title: '名称', dataIndex: 'name', width: 160 },
  { title: '描述', dataIndex: 'description', ellipsis: true },
  { title: '依赖工具', dataIndex: 'requiredTools', width: 200 },
  { title: '版本', dataIndex: 'version', width: 80 },
  { title: '启用', dataIndex: 'enabled', width: 70 },
  { title: '更新时间', dataIndex: 'updatedAt', width: 140 },
  { title: '操作', dataIndex: 'actions', width: 190, fixed: 'right' as const },
];

function fmt(s: string) {
  return s ? dayjs(s).format('YYYY-MM-DD HH:mm') : '—';
}
function unwrap(res: any): any {
  return res?.data ?? res;
}

async function reload() {
  loading.value = true;
  try {
    const res: any = await listSkills();
    skills.value = (unwrap(res) || []) as SkillItem[];
  } catch {
    skills.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, defaultForm());
  editOpen.value = true;
}

async function openEdit(item: SkillItem) {
  editing.value = item;
  try {
    const res: any = await getSkill(item.code);
    const detail = (unwrap(res) || item) as SkillDetail;
    Object.assign(form, {
      code: detail.code,
      name: detail.name,
      description: detail.description,
      content: detail.content,
      requiredTools: [...(detail.requiredTools || [])],
      enabled: detail.enabled,
    });
    editOpen.value = true;
  } catch {
    message.error('加载技能详情失败');
  }
}

async function openView(item: SkillItem) {
  try {
    const res: any = await getSkill(item.code);
    viewing.value = (unwrap(res) || item) as SkillDetail;
    viewOpen.value = true;
  } catch {
    message.error('加载失败');
  }
}

function closeEdit() {
  editOpen.value = false;
  editing.value = null;
}

async function save() {
  if (!form.code.trim() || !form.name.trim()) {
    message.warning('技能 Code 和名称必填');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await updateSkill(editing.value.code, form);
      message.success('已保存');
    } else {
      await createSkill(form);
      message.success('已创建');
    }
    closeEdit();
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(item: SkillItem) {
  try {
    await removeSkill(item.code);
    message.success('已删除');
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '删除失败');
  }
}

async function toggleEnabled(item: SkillItem, enabled: boolean) {
  try {
    const res: any = await getSkill(item.code);
    const detail = (unwrap(res) || item) as SkillDetail;
    await updateSkill(item.code, {
      code: detail.code,
      name: detail.name,
      description: detail.description,
      content: detail.content,
      requiredTools: detail.requiredTools || [],
      enabled,
    });
    message.success(enabled ? '已启用' : '已停用');
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '操作失败');
  }
}

/** zip 技能包导入（before-upload 拦截，返回 false 阻止默认上传） */
async function handleImportFile(file: File): Promise<boolean> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    message.warning('请上传 zip 格式的技能包');
    return false;
  }
  try {
    const res: any = await importSkillZip(file);
    const detail = (unwrap(res) || {}) as SkillDetail;
    message.success(`导入成功：${detail.name || detail.code || '技能'}`);
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '导入失败');
  }
  return false;
}

onMounted(reload);
</script>

<style scoped>
.raw-block {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  padding: 16px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 560px;
  overflow: auto;
  margin: 0;
}
</style>
