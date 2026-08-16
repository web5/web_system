<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { environmentApi, moduleApi } from '@/api'

// ============ 状态 ============
// 环境列表
const envList = ref<any[]>([])
const loading = ref(false)

// 后端服务模块（注册表）
const backendModules = ref<any[]>([])
const allModules = ref<any[]>([])
const modulesLoading = ref(false)

// 当前编辑环境
const editingEnvId = ref('')
const formVisible = ref(false)
const saving = ref(false)

// base 环境选择（新建模式用）：下拉选已有环境把它的端口映射填进来作模板
const baseEnvId = ref<string | undefined>(undefined)

const envForm = reactive({
  id: '',
  name: '',
  publicUrl: '',
  // { moduleKey: 服务地址（'host:port' 或域名，留空 = 不部署） }
  ports: {} as Record<string, string>,
})

// ============ 数据加载 ============
async function loadEnvironments() {
  loading.value = true
  try {
    envList.value = await environmentApi.list()
  } catch {
    message.error('加载环境列表失败')
  } finally {
    loading.value = false
  }
}

async function loadModules() {
  modulesLoading.value = true
  try {
    const list = await moduleApi.list()
    allModules.value = list
    backendModules.value = list.filter((m: any) => m.type === 'backend')
    if (backendModules.value.length === 0) {
      message.warn('注册表中尚无 backend 模块，请先在「服务管理」中创建')
    }
  } catch {
    message.error('加载服务注册表失败')
  } finally {
    modulesLoading.value = false
  }
}

// ============ 后端模块默认端口（按环境） ============
const BACKEND_DEFAULT_PORTS: Record<string, number> = {
  gateway: 6000,
  'auth-service': 6001,
  'user-service': 6002,
  'ai-service': 6003,
  'system-service': 6004,
  'todo-service': 6005,
  'mcp-gateway': 6006,
  finnews: 6007,
  'upload-service': 6008,
  'deploy-console': 6200,
}
const PROD_DEFAULT_PORTS: Record<string, number> = {
  gateway: 3000,
  'auth-service': 3001,
  'user-service': 3002,
  'ai-service': 3003,
  'system-service': 3004,
  'mcp-gateway': 6006,
}
const ENV_DEFAULT_HOST: Record<string, string> = {
  dev: '127.0.0.1',
  prod: 'portal.kedouai.com',
  staging: 'stage.kedouai.com',
}

function hostForEnv(env: any): string {
  if (env?.publicUrl) {
    try {
      return new URL(env.publicUrl).hostname
    } catch {
      /* fallthrough */
    }
  }
  return ENV_DEFAULT_HOST[env?.id || ''] || '127.0.0.1'
}

function portForKey(envId: string, moduleKey: string): number | undefined {
  if (envId === 'prod') return PROD_DEFAULT_PORTS[moduleKey]
  return BACKEND_DEFAULT_PORTS[moduleKey]
}

// ============ 表单行为 ============
// 从 env 构造各 backend 模块的服务地址：
// 1) 已配值优先；2) 未配的 backend 模块按环境 ID + 默认端口表预填；
// 3) frontend / micro-frontend / mini-app 类模块不预填（保留空）。
function buildPortsFromEnv(env: any): Record<string, string> {
  const ports: Record<string, string> = {}
  const envId = env?.id || ''
  const host = hostForEnv(env)
  for (const m of backendModules.value) {
    const existing = env?.ports?.[m.key]
    if (existing) {
      ports[m.key] = existing
      continue
    }
    if (m.type === 'backend') {
      const port = portForKey(envId, m.key)
      ports[m.key] = port ? `${host}:${port}` : ''
    } else {
      ports[m.key] = ''
    }
  }
  return ports
}

function openCreate() {
  editingEnvId.value = ''
  formVisible.value = true
  baseEnvId.value = undefined
  Object.assign(envForm, {
    id: '',
    name: '',
    publicUrl: '',
    ports: buildPortsFromEnv(null),
  })
  rebuildServiceRows()
}

function openEdit(e: any) {
  editingEnvId.value = e.id
  formVisible.value = true
  baseEnvId.value = undefined
  Object.assign(envForm, {
    id: e.id,
    name: e.name,
    publicUrl: e.publicUrl || '',
    ports: buildPortsFromEnv(e),
  })
  rebuildServiceRows()
}

// base 环境变化 → 把它的地址填到表单（仅新建模式）
function onBaseEnvChange(val: string | undefined) {
  if (editingEnvId.value) return // 编辑模式不响应
  if (!val) return
  const base = envList.value.find((e) => e.id === val)
  if (!base) return
  Object.assign(envForm, {
    ports: buildPortsFromEnv(base),
    name: base.name ? `${base.name}（副本）` : envForm.name,
  })
  rebuildServiceRows()
}

function updatePort(key: string, val: string) {
  envForm.ports[key] = val
}

function clearServicePort(key: string) {
  delete envForm.ports[key]
}

async function saveEnv() {
  // 校验：过滤空地址（留空 = 不部署）
  const ports: Record<string, string> = {}
  for (const [k, v] of Object.entries(envForm.ports)) {
    const trimmed = (v ?? '').trim()
    if (trimmed) ports[k] = trimmed
  }
  const dto = {
    id: envForm.id.trim(),
    name: envForm.name.trim(),
    publicUrl: envForm.publicUrl.trim() || undefined,
    ports,
  }
  if (!dto.id || !dto.name) {
    message.error('环境 ID 和名称必填')
    return
  }
  saving.value = true
  try {
    if (editingEnvId.value) {
      await environmentApi.update(editingEnvId.value, dto)
      message.success('环境已更新')
    } else {
      await environmentApi.create(dto)
      message.success('环境已创建')
    }
    formVisible.value = false
    await loadEnvironments()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function deleteEnv(e: any) {
  if (e.builtin) {
    message.warn('内置环境不可删除')
    return
  }
  Modal.confirm({
    title: '确认删除',
    content: `确认删除环境 ${e.name}（${e.id}）吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await environmentApi.remove(e.id)
        message.success('已删除')
        await loadEnvironments()
      } catch (err: any) {
        message.error(err?.response?.data?.message || '删除失败')
      }
    },
  })
}

// ============ 视图 ============
// 当前表单涉及的服务行（用于 a-table 数据源）
const serviceRows = ref<any[]>([])
function rebuildServiceRows() {
  serviceRows.value = backendModules.value.map((m) => ({
    key: m.key,
    name: m.name,
    dir: m.dir,
    builtin: m.builtin,
    address: envForm.ports[m.key] ?? '',
  }))
}

onMounted(async () => {
  await loadModules()
  await loadEnvironments()
  rebuildServiceRows()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>环境管理</h2>
      <p>环境为一等公民：每个环境独立配置公网地址和后端服务地址（host:port 或域名）。服务器连接信息在「服务器管理」中配置（serverName 服务器组）。dev / prod 为内置环境（不可删，地址可改），其余可任意增删。</p>
    </div>

    <a-card style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span>环境列表</span>
        <a-button type="primary" @click="openCreate">新建环境</a-button>
      </div>
      <a-table
        :columns="[
          { title: 'ID', dataIndex: 'id', key: 'id', width: 160 },
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '公网地址', dataIndex: 'publicUrl', key: 'publicUrl' },
          { title: '已配置服务地址', dataIndex: 'ports', key: 'ports' },
          { title: '内置', dataIndex: 'builtin', key: 'builtin', width: 90 },
          { title: '操作', key: 'action', width: 160 },
        ]"
        :data-source="envList"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'builtin'">
            <a-tag :color="record.builtin ? 'gold' : 'default'">{{ record.builtin ? '内置' : '自定义' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'ports'">
            <span v-if="record.ports && Object.keys(record.ports).length">
              <a-tag v-for="(addr, k) in record.ports" :key="k" style="margin-bottom: 2px;">{{ k }}={{ addr }}</a-tag>
            </span>
            <span v-else style="color: #999;">—</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button type="link" size="small" danger :disabled="record.builtin" @click="deleteEnv(record)">删除</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card title="环境配置" v-if="formVisible">
      <a-form layout="vertical">
        <!-- 基础环境（仅新建模式） -->
        <a-form-item v-if="!editingEnvId" label="基础环境（可选：把已有环境的地址填进来作模板）">
          <a-select
            v-model:value="baseEnvId"
            placeholder="不选则空白新建"
            allow-clear
            style="max-width: 360px;"
            @change="onBaseEnvChange"
          >
            <a-select-option v-for="e in envList" :key="e.id" :value="e.id">
              {{ e.id }} — {{ e.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item :label="editingEnvId ? '环境 ID（不可改）' : '环境 ID'">
              <a-input v-model:value="envForm.id" :disabled="!!editingEnvId" placeholder="如 staging" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="名称">
              <a-input v-model:value="envForm.name" placeholder="如 预发环境" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="公网地址">
          <a-input v-model:value="envForm.publicUrl" placeholder="https://..." style="max-width: 480px;" />
        </a-form-item>

        <!-- 服务地址列表（从模块注册表自动加载） -->
        <a-divider>服务地址</a-divider>
        <p style="color: #666; margin-bottom: 8px;">
          服务清单来自「服务管理」注册的 backend 模块。填入完整的服务地址，如 <code>127.0.0.1:6000</code> / <code>dev.kedouai.com</code>。留空表示该服务不在本环境部署。
        </p>
        <a-table
          :columns="[
            { title: '服务 key', dataIndex: 'key', key: 'key', width: 200 },
            { title: '名称', dataIndex: 'name', key: 'name' },
            { title: '目录', dataIndex: 'dir', key: 'dir' },
            { title: '内置', dataIndex: 'builtin', key: 'builtin', width: 90 },
            { title: '服务地址', key: 'address', width: 360 },
          ]"
          :data-source="serviceRows"
          :loading="modulesLoading"
          :pagination="false"
          row-key="key"
          size="small"
          :locale="{ emptyText: '尚无 backend 模块，请先在「服务管理」中创建' }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'builtin'">
              <a-tag :color="record.builtin ? 'gold' : 'default'">{{ record.builtin ? '内置' : '自定义' }}</a-tag>
            </template>
            <template v-else-if="column.key === 'address'">
              <a-input
                :value="record.address"
                placeholder="如 127.0.0.1:6000 或 dev.kedouai.com"
                style="width: 280px;"
                @change="(e: any) => updatePort(record.key, e.target.value)"
              />
              <a-button
                v-if="record.address"
                type="link"
                size="small"
                style="margin-left: 8px;"
                @click="clearServicePort(record.key)"
              >清除</a-button>
            </template>
          </template>
        </a-table>

        <div style="margin-top: 16px;">
          <a-button type="primary" :loading="saving" @click="saveEnv">{{ editingEnvId ? '保存修改' : '创建环境' }}</a-button>
          <a-button style="margin-left: 8px;" @click="formVisible = false">取消</a-button>
        </div>
      </a-form>
    </a-card>
  </div>
</template>