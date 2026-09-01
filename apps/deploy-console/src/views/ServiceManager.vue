<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { moduleApi } from '@/api'

// ============ 类型定义 ============
const TYPE_OPTIONS = [
  { value: 'backend', label: '后端服务（pm2 部署）', color: 'blue' },
  { value: 'frontend', label: '前端模块（打包到网关）', color: 'green' },
  { value: 'micro-frontend', label: '微前端模块（shell 加载）', color: 'purple' },
  { value: 'mini-app', label: '小程序', color: 'orange' },
] as const

function typeLabel(type: string): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label || type
}
function typeColor(type: string): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.color || 'default'
}

// ============ 模块列表 ============
const moduleList = ref<any[]>([])
const moduleLoading = ref(false)
const activeType = ref<string>('all')

const moduleFormVisible = ref(false)
const moduleSaving = ref(false)
const editingKey = ref('')

const moduleForm = reactive({
  key: '',
  name: '',
  type: 'backend' as 'backend' | 'frontend' | 'micro-frontend' | 'mini-app',
  dir: '',
  pm2: '',
  publicPath: '',
  buildCmd: '',
  enabled: true,
})

async function loadModules() {
  moduleLoading.value = true
  try {
    moduleList.value = await moduleApi.list()
  } catch {
    message.error('加载模块列表失败')
  } finally {
    moduleLoading.value = false
  }
}

function resetModuleForm() {
  Object.assign(moduleForm, {
    key: '',
    name: '',
    type: 'backend' as const,
    dir: '',
    pm2: '',
    publicPath: '',
    buildCmd: '',
    enabled: true,
  })
}

function openModuleCreate() {
  editingKey.value = ''
  resetModuleForm()
  moduleFormVisible.value = true
}

function openModuleEdit(m: any) {
  editingKey.value = m.key
  Object.assign(moduleForm, {
    key: m.key,
    name: m.name || '',
    type: m.type || 'backend',
    dir: m.dir || '',
    pm2: m.pm2 || '',
    publicPath: m.publicPath || '',
    buildCmd: m.buildCmd || '',
    enabled: m.enabled !== false,
  })
  moduleFormVisible.value = true
}

async function submitModuleForm() {
  if (!moduleForm.key || !moduleForm.name) {
    message.error('模块 key 和名称必填')
    return
  }
  moduleSaving.value = true
  try {
    const dto: any = {
      key: moduleForm.key.trim(),
      name: moduleForm.name.trim(),
      type: moduleForm.type,
      dir: moduleForm.dir.trim() || `servers/${moduleForm.key.trim()}`,
      pm2: moduleForm.pm2.trim() || undefined,
      publicPath: moduleForm.publicPath.trim() || undefined,
      buildCmd: moduleForm.buildCmd.trim() || undefined,
      enabled: moduleForm.enabled,
    }
    if (editingKey.value) {
      await moduleApi.update(editingKey.value, dto)
      message.success('模块已更新')
    } else {
      await moduleApi.create(dto)
      message.success('模块已创建')
    }
    moduleFormVisible.value = false
    await loadModules()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    moduleSaving.value = false
  }
}

function removeModule(m: any) {
  if (m.builtin) {
    message.warn('内置模块不可删除')
    return
  }
  Modal.confirm({
    title: '确认删除',
    content: `确认删除模块 ${m.name}（${m.key}）吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await moduleApi.remove(m.key)
        message.success('已删除')
        await loadModules()
      } catch (err: any) {
        message.error(err?.response?.data?.message || '删除失败')
      }
    },
  })
}

const filteredModules = computed(() => {
  if (activeType.value === 'all') return moduleList.value
  return moduleList.value.filter((m: any) => m.type === activeType.value)
})

onMounted(loadModules)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>模块管理</h2>
      <p>模块注册表是发布系统的「模块元数据」真相源。后端模块（pm2 部署）、前端模块、微前端模块、小程序均在此登记。点击「详情」查看并管理该模块前端/后台的部署版本与环境。</p>
      <p style="color: #888;">启动时若表为空，会从 <code>scripts/modules.json</code> 种子导入（标记为 builtin）。builtin 不可删除，可改字段。</p>
    </div>

    <a-card>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <a-tabs v-model:activeKey="activeType" size="small">
          <a-tab-pane key="all" :tab="`全部 (${moduleList.length})`" />
          <a-tab-pane
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            :tab="`${typeLabel(t.value)} (${moduleList.filter((m: any) => m.type === t.value).length})`"
          />
        </a-tabs>
        <a-button type="primary" @click="openModuleCreate">新建模块</a-button>
      </div>

      <a-table
        :columns="[
          { title: 'key', dataIndex: 'key', key: 'key', width: 180 },
          { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
          { title: '类型', dataIndex: 'type', key: 'type', width: 200 },
          { title: '目录', dataIndex: 'dir', key: 'dir' },
          { title: 'pm2 / publicPath', key: 'meta', width: 220 },
          { title: '状态', key: 'status', width: 100 },
          { title: '操作', key: 'action', width: 200 },
        ]"
        :data-source="filteredModules"
        :loading="moduleLoading"
        :pagination="false"
        row-key="key"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'type'">
            <a-tag :color="typeColor(record.type)">{{ typeLabel(record.type) }}</a-tag>
            <a-tag v-if="record.builtin" color="gold" style="margin-left: 4px;">内置</a-tag>
          </template>
          <template v-else-if="column.key === 'meta'">
            <span v-if="record.pm2" style="margin-right: 8px;">pm2={{ record.pm2 }}</span>
            <span v-if="record.publicPath">pub={{ record.publicPath }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="record.enabled !== false ? 'green' : 'default'">
              {{ record.enabled !== false ? '启用' : '禁用' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click="$router.push(`/modules/${record.key}`)">详情</a-button>
            <a-button type="link" size="small" @click="openModuleEdit(record)">编辑</a-button>
            <a-button type="link" size="small" danger :disabled="record.builtin" @click="removeModule(record)">删除</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal
      :title="editingKey ? `编辑模块 ${editingKey}` : '新建模块'"
      v-model:open="moduleFormVisible"
      :footer="null"
      :destroy-on-close="true"
      width="640px"
    >
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="模块 key（唯一，不可改）">
              <a-input v-model:value="moduleForm.key" :disabled="!!editingKey" placeholder="如 auth-service" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="名称">
              <a-input v-model:value="moduleForm.name" placeholder="如 认证服务" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="类型">
              <a-select v-model:value="moduleForm.type">
                <a-select-option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">
                  {{ t.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="代码目录（相对仓库根）">
              <a-input v-model:value="moduleForm.dir" placeholder="servers/auth-service" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="pm2 进程名（后端用）">
              <a-input v-model:value="moduleForm.pm2" placeholder="如 auth-service" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="publicPath（前端模块挂载路径）">
              <a-input v-model:value="moduleForm.publicPath" placeholder="如 /auth-service/" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="buildCmd（前端模块构建命令）">
          <a-input v-model:value="moduleForm.buildCmd" placeholder="如 cd apps/auth-service && pnpm build" />
        </a-form-item>
        <a-form-item label="启用">
          <a-switch v-model:checked="moduleForm.enabled" />
        </a-form-item>
        <div style="margin-top: 8px;">
          <a-button type="primary" :loading="moduleSaving" @click="submitModuleForm">{{ editingKey ? '保存' : '创建' }}</a-button>
          <a-button style="margin-left: 8px;" @click="moduleFormVisible = false">取消</a-button>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>