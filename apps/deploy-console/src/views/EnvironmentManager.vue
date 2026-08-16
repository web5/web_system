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
  ports: {} as Record<string, number>, // { moduleKey: port }
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

// ============ 表单行为 ============
function buildPortsFromEnv(env: any): Record<string, number> {
  // 优先用环境自己的 ports，否则按模块默认端口 0
  const ports: Record<string, number> = {}
  for (const m of backendModules.value) {
    ports[m.key] = env?.ports?.[m.key] ?? 0
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
}

// base 环境变化 → 把它的端口填到表单（仅新建且用户没编辑过 ports 时）
function onBaseEnvChange(val: string | undefined) {
  if (editingEnvId.value) return // 编辑模式不响应
  if (!val) return
  const base = envList.value.find((e) => e.id === val)
  if (!base) return
  Object.assign(envForm, {
    ports: buildPortsFromEnv(base),
    name: base.name ? `${base.name}（副本）` : envForm.name,
  })
}

function updatePort(key: string, val: number) {
  envForm.ports[key] = val
}

function clearServicePort(key: string) {
  delete envForm.ports[key]
}

async function saveEnv() {
  // 校验
  const ports: Record<string, number> = {}
  for (const [k, v] of Object.entries(envForm.ports)) {
    if (v > 0) ports[k] = v
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
    port: envForm.ports[m.key] ?? 0,
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
      <p>环境为一等公民：每个环境独立配置公网地址和后端服务端口。服务器连接信息在「服务器管理」中配置（serverName 服务器组）。dev / prod 为内置环境（不可删，端口可改），其余可任意增删。</p>
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
          { title: '已配置服务端口', dataIndex: 'ports', key: 'ports' },
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
              <a-tag v-for="(port, k) in record.ports" :key="k" style="margin-bottom: 2px;">{{ k }}={{ port }}</a-tag>
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
        <a-form-item v-if="!editingEnvId" label="基础环境（可选：把已有环境的端口填进来作模板）">
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

        <!-- 服务端口列表（从模块注册表自动加载） -->
        <a-divider>服务端口</a-divider>
        <p style="color: #666; margin-bottom: 8px;">
          服务清单来自「服务管理」注册的 backend 模块。端口 = 0 表示该服务不在本环境部署，保存时会被忽略。
        </p>
        <a-table
          :columns="[
            { title: '服务 key', dataIndex: 'key', key: 'key', width: 200 },
            { title: '名称', dataIndex: 'name', key: 'name' },
            { title: '目录', dataIndex: 'dir', key: 'dir' },
            { title: '内置', dataIndex: 'builtin', key: 'builtin', width: 90 },
            { title: '端口', key: 'port', width: 240 },
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
            <template v-else-if="column.key === 'port'">
              <a-input-number
                :value="record.port"
                :min="0"
                :max="65535"
                :step="100"
                placeholder="0 表示未部署"
                style="width: 160px;"
                @change="(v: any) => updatePort(record.key, Number(v) || 0)"
              />
              <a-button
                v-if="record.port > 0"
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