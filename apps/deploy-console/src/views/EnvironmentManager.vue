<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { environmentApi } from '@/api'

// 环境列表
const envList = ref<any[]>([])
const loading = ref(false)

// 编辑表单
const editingEnvId = ref('')
const formVisible = ref(false)
const saving = ref(false)
const envForm = reactive({
  id: '',
  name: '',
  publicUrl: '',
  portsText: '{}',
})

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

function openCreate() {
  editingEnvId.value = ''
  formVisible.value = true
  Object.assign(envForm, {
    id: '',
    name: '',
    publicUrl: '',
    portsText: '{}',
  })
}
function openEdit(e: any) {
  editingEnvId.value = e.id
  formVisible.value = true
  Object.assign(envForm, {
    id: e.id,
    name: e.name,
    publicUrl: e.publicUrl || '',
    portsText: JSON.stringify(e.ports || {}, null, 2),
  })
}
async function saveEnv() {
  let ports: Record<string, number> = {}
  try {
    ports = JSON.parse(envForm.portsText || '{}')
  } catch {
    message.error('端口映射 JSON 格式错误')
    return
  }
  const dto = {
    id: envForm.id,
    name: envForm.name,
    publicUrl: envForm.publicUrl,
    ports,
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

onMounted(loadEnvironments)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>环境管理</h2>
      <p>环境为一等公民：后端模块端口随环境配置，不同环境指向不同服务进程端口。服务器连接信息在「服务器管理」中配置（serverName 服务器组）。dev / prod 为内置环境（不可删，端口可改），其余可任意增删。</p>
    </div>

    <a-card style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span>环境列表</span>
        <a-button type="primary" @click="openCreate">新建环境</a-button>
      </div>
      <a-table
        :columns="[
          { title: 'ID', dataIndex: 'id', key: 'id', width: 120 },
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '公网地址', dataIndex: 'publicUrl', key: 'publicUrl' },
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
          <template v-if="column.key === 'action'">
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button type="link" size="small" danger :disabled="record.builtin" @click="deleteEnv(record)">删除</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card title="环境配置" v-if="formVisible">
      <a-form layout="vertical">
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
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="公网地址">
              <a-input v-model:value="envForm.publicUrl" placeholder="https://..." />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="后端模块端口映射（JSON: {模块key: 端口}）">
          <a-textarea v-model:value="envForm.portsText" :rows="5" placeholder='{"gateway":3000,"auth-service":3001}' />
        </a-form-item>
        <a-button type="primary" :loading="saving" @click="saveEnv">{{ editingEnvId ? '保存修改' : '创建环境' }}</a-button>
        <a-button style="margin-left: 8px;" @click="formVisible = false">取消</a-button>
      </a-form>
    </a-card>
  </div>
</template>
