<template>
  <a-page-header
    title="Agent 定义管理"
    sub-title="配置化维护 Agent 的 systemPrompt / 模型 / 工具 / 记忆，发布后 30s 内运行时生效"
  >
    <template #extra>
      <a-button type="primary" @click="openCreate">新建 Agent</a-button>
      <a-button :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

  <a-card :bordered="true">
    <a-table
      :columns="columns"
      :data-source="defs"
      :loading="loading"
      row-key="id"
      size="middle"
      :pagination="false"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'id'">
          <b>{{ record.id }}</b>
        </template>
        <template v-else-if="column.dataIndex === 'status'">
          <a-tag v-if="record.status === 'published'" color="green">已发布</a-tag>
          <a-tag v-else color="orange">草稿</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'enabled'">
          <a-switch
            :checked="record.enabled"
            :disabled="!canManage"
            @change="(v: boolean) => toggleEnabled(record, v)"
          />
        </template>
        <template v-else-if="column.dataIndex === 'version'">
          v{{ record.version }}
        </template>
        <template v-else-if="column.dataIndex === 'model'">
          {{ record.model }}
        </template>
        <template v-else-if="column.dataIndex === 'tools'">
          {{ (record.tools || []).join(', ') || '—' }}
        </template>
        <template v-else-if="column.dataIndex === 'updatedAt'">
          {{ fmt(record.updatedAt) }}
        </template>
        <template v-else-if="column.dataIndex === 'actions'">
          <a-space>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button type="link" size="small" @click="openVersions(record)">版本</a-button>
            <a-popconfirm
              v-if="canManage && record.status !== 'published'"
              title="发布后 30s 内生效，确认发布？"
              ok-text="发布"
              cancel-text="取消"
              @confirm="publish(record)"
            >
              <a-button type="link" size="small" style="color: #52c41a">发布</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <!-- 编辑 / 新建 弹窗 -->
  <a-modal
    :open="editOpen"
    :title="editing ? `编辑 Agent · ${editing.id}` : '新建 Agent'"
    :width="880"
    :confirm-loading="saving"
    ok-text="保存"
    cancel-text="取消"
    @ok="save"
    @cancel="closeEdit"
  >
    <a-form layout="vertical" :model="form">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="Agent ID（唯一，小写短横线）">
            <a-input v-model:value="form.id" :disabled="!!editing" placeholder="如 contract-risk" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="名称">
            <a-input v-model:value="form.name" placeholder="如 合同翻译官" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="模型">
            <a-select v-model:value="form.model">
              <a-select-option value="hy3">hy3（混元）</a-select-option>
              <a-select-option value="deepseek">deepseek</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="最大步数">
            <a-input-number v-model:value="form.maxSteps" :min="1" :max="50" style="width: 100%" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="Temperature">
            <a-input-number v-model:value="form.temperature" :min="0" :max="2" :step="0.1" style="width: 100%" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="工具（工具名数组，需已在对应服务注册）">
        <a-select v-model:value="form.tools" mode="tags" placeholder="输入工具名回车添加" />
      </a-form-item>
      <a-form-item label="System Prompt">
        <a-textarea
          v-model:value="form.systemPrompt"
          :rows="14"
          placeholder="Agent 的系统提示词，发布后运行时生效"
        />
      </a-form-item>
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="记忆：压缩阈值">
            <a-input-number v-model:value="form.memory.compactionThreshold" :min="1" style="width: 100%" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="记忆：保留近期条数">
            <a-input-number v-model:value="form.memory.keepRecent" :min="1" style="width: 100%" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="启用记忆">
            <a-switch v-model:checked="form.memory.enabled" />
          </a-form-item>
        </a-col>
      </a-row>
    </a-form>
  </a-modal>

  <!-- 版本弹窗 -->
  <a-modal
    :open="versionsOpen"
    :title="`版本历史 · ${currentDef?.id || ''}`"
    :footer="null"
    :width="720"
    @cancel="versionsOpen = false"
  >
    <a-empty v-if="!versions.length" description="暂无历史版本" />
    <a-table
      v-else
      :columns="versionColumns"
      :data-source="versions"
      row-key="id"
      size="small"
      :pagination="false"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'version'">
          <a-tag :color="record.version === currentDef?.version ? 'green' : 'default'">v{{ record.version }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'createdAt'">
          {{ fmt(record.createdAt) }}
        </template>
        <template v-else-if="column.dataIndex === 'actions'">
          <a-popconfirm
            v-if="canManage && record.version !== currentDef?.version"
            title="回滚会发布为新版本，确认？"
            ok-text="回滚"
            cancel-text="取消"
            @confirm="rollback(record)"
          >
            <a-button type="link" size="small">回滚</a-button>
          </a-popconfirm>
        </template>
      </template>
    </a-table>
  </a-modal>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import {
  listAgentDefs,
  createAgentDef,
  updateAgentDef,
  publishAgentDef,
  setAgentDefEnabled,
  listAgentDefVersions,
  rollbackAgentDef,
  type AgentDef,
  type AgentDefVersion,
  type SaveAgentDefPayload,
} from '@/api/agent-defs';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const canManage = userStore.hasPermission('agents:manage');

const loading = ref(false);
const defs = ref<AgentDef[]>([]);
const editOpen = ref(false);
const editing = ref<AgentDef | null>(null);
const saving = ref(false);
const versionsOpen = ref(false);
const versions = ref<AgentDefVersion[]>([]);
const currentDef = ref<AgentDef | null>(null);

const defaultForm = (): SaveAgentDefPayload => ({
  id: '',
  name: '',
  systemPrompt: '',
  model: 'hy3',
  tools: [],
  maxSteps: 10,
  temperature: 0.7,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
});
const form = reactive<SaveAgentDefPayload>(defaultForm());

const columns = [
  { title: 'ID', dataIndex: 'id' },
  { title: '名称', dataIndex: 'name' },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '版本', dataIndex: 'version', width: 70 },
  { title: '模型', dataIndex: 'model', width: 100 },
  { title: '工具', dataIndex: 'tools' },
  { title: '启用', dataIndex: 'enabled', width: 80 },
  { title: '更新时间', dataIndex: 'updatedAt', width: 150 },
  { title: '操作', dataIndex: 'actions', width: 200, fixed: 'right' as const },
];

const versionColumns = [
  { title: '版本', dataIndex: 'version', width: 80 },
  { title: '说明', dataIndex: 'changeNote' },
  { title: '发布人', dataIndex: 'createdBy', width: 100 },
  { title: '时间', dataIndex: 'createdAt', width: 160 },
  { title: '操作', dataIndex: 'actions', width: 90 },
];

function fmt(s: string) {
  return s ? dayjs(s).format('YYYY-MM-DD HH:mm') : '—';
}

function unwrap(res: any): any {
  // request 拦截器已 unwrap {code,data,message}；这里再兼容 res?.data
  return res?.data ?? res;
}

async function reload() {
  loading.value = true;
  try {
    const res: any = await listAgentDefs();
    defs.value = (unwrap(res) || []) as AgentDef[];
  } catch {
    defs.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, defaultForm());
  editOpen.value = true;
}

function openEdit(def: AgentDef) {
  editing.value = def;
  Object.assign(form, {
    id: def.id,
    name: def.name,
    systemPrompt: def.systemPrompt,
    model: def.model,
    tools: [...(def.tools || [])],
    maxSteps: def.maxSteps,
    temperature: def.temperature ?? 0.7,
    memory: { ...def.memory },
  });
  editOpen.value = true;
}

function closeEdit() {
  editOpen.value = false;
  editing.value = null;
}

async function save() {
  if (!form.id.trim() || !form.name.trim()) {
    message.warning('Agent ID 和名称必填');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      const res: any = await updateAgentDef(editing.value.id, form);
      message.success('已保存（如修改了 prompt，需点"发布"才生效）');
    } else {
      const res: any = await createAgentDef(form);
      message.success('已创建草稿，点击"发布"生效');
    }
    closeEdit();
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(def: AgentDef, enabled: boolean) {
  try {
    const res: any = await setAgentDefEnabled(def.id, enabled);
    message.success(enabled ? '已启用' : '已停用');
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '操作失败');
    await reload();
  }
}

async function publish(def: AgentDef) {
  try {
    const res: any = await publishAgentDef(def.id);
    message.success(`已发布 v${(unwrap(res) as AgentDef).version}，约 30s 内生效`);
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '发布失败');
  }
}

async function openVersions(def: AgentDef) {
  currentDef.value = def;
  versionsOpen.value = true;
  try {
    const res: any = await listAgentDefVersions(def.id);
    versions.value = (unwrap(res) || []) as AgentDefVersion[];
  } catch {
    versions.value = [];
  }
}

async function rollback(ver: AgentDefVersion) {
  try {
    const res: any = await rollbackAgentDef(currentDef.value!.id, ver.id);
    message.success(`已回滚并发布 v${(unwrap(res) as AgentDef).version}`);
    versionsOpen.value = false;
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '回滚失败');
  }
}

onMounted(reload);
</script>
