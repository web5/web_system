<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';
// 品牌主题（原 @web-system/ui 的 antdTheme，整合后内联避免额外依赖）
const antdTheme: ThemeConfig = {
  token: { colorPrimary: '#F97316', colorInfo: '#F97316', colorLink: '#F97316', borderRadius: 4 },
};
import {
  listModules,
  createModule,
  updateModule,
  deleteModule,
  toggleModule,
  debugCall,
  listKeys,
  revokeKey,
  type McpModule,
  type McpTool,
} from '@/api/mcp';

const activeTab = ref<'modules' | 'keys'>('modules');

// ── 模块管理 ──
const modules = ref<McpModule[]>([]);
const loading = ref(false);

const editVisible = ref(false);
const editingId = ref<number | null>(null);
const editForm = reactive({
  name: '',
  description: '',
  base_url: '',
  timeout: 30,
  auth_type: '',
  tools: [] as McpTool[],
});

const debugVisible = ref(false);
const debugModule = ref<McpModule | null>(null);
const debugTool = ref<string>('');
const debugArgs = reactive<Record<string, unknown>>({});
const debugResult = ref('');
const debugLoading = ref(false);

async function load() {
  loading.value = true;
  try {
    modules.value = await listModules();
  } catch (e: any) {
    message.error(e?.response?.data?.error || e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openCreate() {
  editingId.value = null;
  Object.assign(editForm, {
    name: '',
    description: '',
    base_url: '',
    timeout: 30,
    auth_type: '',
    tools: [],
  });
  editVisible.value = true;
}

function openEdit(m: McpModule) {
  editingId.value = m.id;
  Object.assign(editForm, {
    name: m.name,
    description: m.description,
    base_url: m.base_url,
    timeout: m.timeout,
    auth_type: m.auth_type,
    tools: JSON.parse(JSON.stringify(m.tools ?? [])),
  });
  editVisible.value = true;
}

function addTool() {
  editForm.tools.push({ name: '', description: '', method: 'GET', path: '/', params: [] });
}
function removeTool(i: number) {
  editForm.tools.splice(i, 1);
}
function addParam(tool: McpTool) {
  if (!tool.params) tool.params = [];
  tool.params.push({ name: '', type: 'string', required: false, description: '' });
}
function removeParam(tool: McpTool, i: number) {
  tool.params!.splice(i, 1);
}

async function submitEdit() {
  if (!editForm.name || !editForm.base_url) {
    message.warning('请填写模块名和 base_url');
    return;
  }
  for (const t of editForm.tools) {
    if (!t.name || !t.path) {
      message.warning('工具的 name 和 path 必填');
      return;
    }
  }
  try {
    const dto = {
      name: editForm.name,
      description: editForm.description,
      base_url: editForm.base_url,
      timeout: editForm.timeout,
      auth_type: editForm.auth_type,
      tools: editForm.tools,
    };
    if (editingId.value) {
      await updateModule(editingId.value, dto);
      message.success('模块已更新');
    } else {
      await createModule(dto);
      message.success('模块已创建');
    }
    editVisible.value = false;
    load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || e.message || '保存失败');
  }
}

async function onDelete(m: McpModule) {
  await deleteModule(m.id);
  message.success('已删除');
  load();
}

async function onToggle(m: McpModule, checked: boolean) {
  try {
    await toggleModule(m.id, checked);
    message.success(checked ? '已启用' : '已停用');
    load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || e.message || '操作失败');
  }
}

function openDebug(m: McpModule) {
  debugModule.value = m;
  debugTool.value = m.tools?.[0]?.name ?? '';
  Object.keys(debugArgs).forEach((k) => delete debugArgs[k]);
  debugResult.value = '';
  debugVisible.value = true;
}
const currentTool = () => debugModule.value?.tools?.find((t) => t.name === debugTool.value);

async function runDebug() {
  const tool = currentTool();
  if (!tool || !debugModule.value) return;
  const args: Record<string, unknown> = {};
  for (const p of tool.params ?? []) {
    const v = debugArgs[p.name];
    if (p.required && (v === undefined || v === '' || v === null)) {
      message.warning(`参数 ${p.name} 必填`);
      return;
    }
    if (v !== undefined && v !== '' && v !== null) {
      args[p.name] = p.type === 'integer' || p.type === 'number' ? Number(v) : v;
    }
  }
  debugLoading.value = true;
  try {
    const result = await debugCall({
      base_url: debugModule.value.base_url,
      method: tool.method,
      path: tool.path,
      params: args,
    });
    debugResult.value = JSON.stringify(result, null, 2);
  } catch (e: any) {
    debugResult.value = JSON.stringify(
      { error: e?.response?.data?.error || e?.response?.data?.message || e.message || '调用失败' },
      null,
      2,
    );
  } finally {
    debugLoading.value = false;
  }
}

const columns = [
  { title: 'ID', dataIndex: 'id', width: 60 },
  { title: '模块名', dataIndex: 'name', width: 160 },
  { title: '描述', dataIndex: 'description', ellipsis: true },
  { title: '服务地址', dataIndex: 'base_url', ellipsis: true },
  { title: '工具数', key: 'toolCount', width: 80 },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 220 },
];

// ── API Key 管理（登录态 + admin 角色鉴权，无需手输密钥）──
const keys = ref<any[]>([]);
const adminLoading = ref(false);

async function loadKeys() {
  adminLoading.value = true;
  try {
    keys.value = await listKeys();
  } catch (e: any) {
    message.error(e?.response?.data?.error || e.message || '加载失败');
  } finally {
    adminLoading.value = false;
  }
}

async function onRevoke(id: number) {
  try {
    await revokeKey(id);
    message.success('已吊销');
    loadKeys();
  } catch (e: any) {
    message.error(e?.response?.data?.error || e.message || '吊销失败');
  }
}

const keyColumns = [
  { title: '前缀', dataIndex: 'keyPrefix', width: 120 },
  { title: '邮箱', dataIndex: 'email', ellipsis: true },
  { title: '名称', dataIndex: 'name', width: 120 },
  { title: '状态', dataIndex: 'status', width: 80 },
  { title: '来源', dataIndex: 'ownerType', width: 80 },
  { title: '最近使用', dataIndex: 'lastUsedAt', width: 160 },
  { title: '创建时间', dataIndex: 'createdAt', width: 160 },
  { title: '操作', key: 'action', width: 80 },
];
</script>

<template>
  <!-- 不包 a-config-provider，避免覆盖 shell antd 的默认 token（cssinjs 类名 hash 会变） -->
  <div class="page">
    <div class="header">
      <h2>MCP 网关管理后台</h2>
      <a-radio-group v-model:value="activeTab">
        <a-radio-button value="modules">模块管理</a-radio-button>
        <a-radio-button value="keys">API Key</a-radio-button>
      </a-radio-group>
      <a-button v-if="activeTab === 'modules'" type="primary" @click="openCreate">添加模块</a-button>
      </div>

      <template v-if="activeTab === 'modules'">
        <a-table
          :columns="columns"
          :data-source="modules"
          :loading="loading"
          row-key="id"
          :pagination="false"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'toolCount'">
              <a-tag color="blue">{{ record.tools?.length ?? 0 }}</a-tag>
            </template>
            <template v-else-if="column.key === 'enabled'">
              <a-switch
                :checked="record.enabled === 1"
                @change="(checked: boolean) => onToggle(record, checked)"
              />
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space>
                <a-button size="small" @click="openDebug(record)">调试</a-button>
                <a-button size="small" @click="openEdit(record)">编辑</a-button>
                <a-popconfirm title="确定删除该模块？" @confirm="onDelete(record)">
                  <a-button size="small" danger>删除</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>

        <a-modal
          v-model:open="editVisible"
          :title="editingId ? '编辑模块' : '添加模块'"
          width="760px"
          @ok="submitEdit"
        >
          <a-form layout="vertical">
            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="模块名" required>
                  <a-input v-model:value="editForm.name" placeholder="如：用户服务" />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="描述">
                  <a-input v-model:value="editForm.description" />
                </a-form-item>
              </a-col>
            </a-row>
            <a-form-item label="服务地址 base_url" required>
              <a-input v-model:value="editForm.base_url" placeholder="http://172.16.16.10:8080" />
            </a-form-item>
            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="超时（秒）">
                  <a-input-number v-model:value="editForm.timeout" :min="1" style="width: 100%" />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="鉴权类型">
                  <a-select v-model:value="editForm.auth_type" placeholder="无鉴权">
                    <a-select-option value="">无鉴权</a-select-option>
                    <a-select-option value="bearer">Bearer Token</a-select-option>
                    <a-select-option value="basic">Basic Auth</a-select-option>
                    <a-select-option value="header">自定义 Header</a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
            </a-row>

            <a-divider>工具列表</a-divider>
            <div v-for="(tool, ti) in editForm.tools" :key="ti" class="tool-card">
              <a-row :gutter="8">
                <a-col :span="6">
                  <a-input v-model:value="tool.name" placeholder="工具名" />
                </a-col>
                <a-col :span="5">
                  <a-input v-model:value="tool.description" placeholder="描述" />
                </a-col>
                <a-col :span="4">
                  <a-select v-model:value="tool.method">
                    <a-select-option value="GET">GET</a-select-option>
                    <a-select-option value="POST">POST</a-select-option>
                    <a-select-option value="PUT">PUT</a-select-option>
                    <a-select-option value="PATCH">PATCH</a-select-option>
                    <a-select-option value="DELETE">DELETE</a-select-option>
                  </a-select>
                </a-col>
                <a-col :span="6">
                  <a-input v-model:value="tool.path" placeholder="/api/xxx/{id}" />
                </a-col>
                <a-col :span="3">
                  <a-button size="small" danger @click="removeTool(ti)">删</a-button>
                </a-col>
              </a-row>
              <div class="param-list">
                <div v-for="(p, pi) in tool.params" :key="pi" class="param-row">
                  <a-input v-model:value="p.name" placeholder="参数名" size="small" style="width: 120px" />
                  <a-select v-model:value="p.type" size="small" style="width: 100px">
                    <a-select-option value="string">string</a-select-option>
                    <a-select-option value="integer">integer</a-select-option>
                    <a-select-option value="number">number</a-select-option>
                    <a-select-option value="boolean">boolean</a-select-option>
                  </a-select>
                  <a-checkbox v-model:checked="p.required">必填</a-checkbox>
                  <a-input v-model:value="p.description" placeholder="参数描述" size="small" style="flex: 1" />
                  <a-button size="small" type="link" danger @click="removeParam(tool, pi)">删</a-button>
                </div>
                <a-button size="small" type="dashed" block @click="addParam(tool)">+ 添加参数</a-button>
              </div>
            </div>
            <a-button type="dashed" block @click="addTool">+ 添加工具</a-button>
          </a-form>
        </a-modal>

        <a-modal
          v-model:open="debugVisible"
          :title="`调试 ${debugModule?.name ?? ''}`"
          width="640px"
          :footer="null"
        >
          <a-form layout="vertical">
            <a-form-item label="选择工具">
              <a-select v-model:value="debugTool">
                <a-select-option v-for="t in debugModule?.tools ?? []" :key="t.name" :value="t.name">
                  {{ t.name }}（{{ t.method }} {{ t.path }}）
                </a-select-option>
              </a-select>
            </a-form-item>
            <template v-for="p in currentTool()?.params ?? []" :key="p.name">
              <a-form-item :label="`${p.name}${p.required ? ' *' : ''}`">
                <a-input-number
                  v-if="p.type === 'integer' || p.type === 'number'"
                  v-model:value="(debugArgs as any)[p.name]"
                  style="width: 100%"
                />
                <a-switch v-else-if="p.type === 'boolean'" v-model:checked="(debugArgs as any)[p.name]" />
                <a-input v-else v-model:value="(debugArgs as any)[p.name]" :placeholder="p.description" />
              </a-form-item>
            </template>
            <a-button type="primary" :loading="debugLoading" @click="runDebug">发起调用</a-button>
          </a-form>
          <a-divider>返回结果</a-divider>
          <pre class="result">{{ debugResult || '（暂无结果）' }}</pre>
        </a-modal>
      </template>

      <template v-else-if="activeTab === 'keys'">
        <a-card title="Key 管理（运营）" size="small">
          <a-space style="margin-bottom: 12px">
            <a-button type="primary" @click="loadKeys" :loading="adminLoading">刷新列表</a-button>
          </a-space>
          <a-table
            :columns="keyColumns"
            :data-source="keys"
            :loading="adminLoading"
            row-key="id"
            size="small"
            style="margin-top: 12px"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'action'">
                <a-popconfirm title="确定吊销该 Key？" @confirm="onRevoke(record.id)">
                  <a-button size="small" danger :disabled="record.status === 'revoked'">吊销</a-button>
                </a-popconfirm>
              </template>
              <template v-else-if="column.dataIndex === 'status'">
                <a-tag :color="record.status === 'active' ? 'green' : 'default'">
                  {{ record.status === 'active' ? '有效' : '已吊销' }}
                </a-tag>
              </template>
            </template>
          </a-table>
        </a-card>
      </template>
    </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
}
.tool-card {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--surface-2);
}
.param-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.param-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.result {
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 12px;
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-body);
}
</style>
