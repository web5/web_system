<!--
  Agent 定义管理列表。编辑/新建走详情页路由（page-spec v2：独立详情页，v1 弹窗版已废弃，无双入口）。
-->
<template>
  <a-page-header
    title="Agent 定义管理"
    sub-title="配置化维护 Agent 的 systemPrompt / 模型 / 工具 / 记忆，发布后 30s 内运行时生效"
  >
    <template #extra>
      <a-button type="primary" @click="goCreate">新建 Agent</a-button>
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
        <template v-else-if="column.dataIndex === 'keywords'">
          <template v-if="(record.keywords || []).length">
            <a-tag v-for="k in (record.keywords || []).slice(0, 3)" :key="k" color="orange">{{ k }}</a-tag>
            <a-typography-text v-if="(record.keywords || []).length > 3" type="secondary">
              +{{ (record.keywords || []).length - 3 }}
            </a-typography-text>
          </template>
          <a-typography-text v-else type="secondary">未配置（只能靠 LLM 判断）</a-typography-text>
        </template>
        <template v-else-if="column.dataIndex === 'updatedAt'">
          {{ fmt(record.updatedAt) }}
        </template>
        <template v-else-if="column.dataIndex === 'actions'">
          <a-space>
            <a-button type="link" size="small" @click="goEdit(record)">编辑</a-button>
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

  <!-- 版本弹窗（历史/回滚，非编辑表单） -->
  <a-modal
    :open="versionsOpen"
    :title="`版本历史 · ${currentDef?.id || ''}`"
    :footer="null"
    :width="720"
    :get-container="moduleOverlayContainer"
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
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { moduleOverlayContainer } from '@/utils/mount';
import dayjs from 'dayjs';
import {
  listAgentDefs,
  publishAgentDef,
  setAgentDefEnabled,
  listAgentDefVersions,
  rollbackAgentDef,
  type AgentDef,
  type AgentDefVersion,
} from '@/api/agent-defs';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();
const canManage = userStore.hasPermission('agents:manage');

const loading = ref(false);
const defs = ref<AgentDef[]>([]);
const versionsOpen = ref(false);
const versions = ref<AgentDefVersion[]>([]);
const currentDef = ref<AgentDef | null>(null);

const columns = [
  { title: 'ID', dataIndex: 'id' },
  { title: '名称', dataIndex: 'name' },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '版本', dataIndex: 'version', width: 70 },
  { title: '模型', dataIndex: 'model', width: 100 },
  { title: '工具', dataIndex: 'tools' },
  { title: '路由关键词', dataIndex: 'keywords', width: 220 },
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

function unwrap(res: unknown): unknown {
  // request 拦截器已 unwrap {code,data,message}；这里再兼容 res?.data
  const r = res as { data?: unknown } | null | undefined;
  return r?.data ?? r;
}

async function reload() {
  loading.value = true;
  try {
    const res = await listAgentDefs();
    defs.value = (unwrap(res) || []) as AgentDef[];
  } catch {
    defs.value = [];
  } finally {
    loading.value = false;
  }
}

/** 编辑/新建一律走详情页路由（page-spec v2，弹窗路径已移除，不留双入口） */
function goEdit(def: AgentDef) {
  void router.push(`/agents/definitions/${def.id}`);
}

function goCreate() {
  void router.push('/agents/definitions/new');
}

async function toggleEnabled(def: AgentDef, enabled: boolean) {
  try {
    await setAgentDefEnabled(def.id, enabled);
    message.success(enabled ? '已启用' : '已停用');
    await reload();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } };
    message.error(err?.response?.data?.message || '操作失败');
    await reload();
  }
}

async function publish(def: AgentDef) {
  try {
    const res = await publishAgentDef(def.id);
    message.success(`已发布 v${(unwrap(res) as AgentDef).version}，约 30s 内生效`);
    await reload();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } };
    message.error(err?.response?.data?.message || '发布失败');
  }
}

async function openVersions(def: AgentDef) {
  currentDef.value = def;
  versionsOpen.value = true;
  try {
    const res = await listAgentDefVersions(def.id);
    versions.value = (unwrap(res) || []) as AgentDefVersion[];
  } catch {
    versions.value = [];
  }
}

async function rollback(ver: AgentDefVersion) {
  try {
    const res = await rollbackAgentDef(currentDef.value!.id, ver.id);
    message.success(`已回滚并发布 v${(unwrap(res) as AgentDef).version}`);
    versionsOpen.value = false;
    await reload();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } };
    message.error(err?.response?.data?.message || '回滚失败');
  }
}

onMounted(() => {
  void reload();
});
</script>
