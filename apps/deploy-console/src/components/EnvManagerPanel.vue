<script setup lang="ts">
/**
 * 模块环境面板 —— 环境归属模块（1:N）。
 * 一个模块有多个环境，一个环境只属于一个模块；dev/prod 每模块各一份（不可删，地址可改）。
 * 原「全局环境管理页」已并入「模块管理 → 环境管理」。
 */
import { ref, reactive, onMounted, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { environmentApi, type ModuleEnvRow } from '@/api'

const props = defineProps<{ moduleKey: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const envList = ref<ModuleEnvRow[]>([])
const loading = ref(false)

// 当前编辑环境（空 = 新建）
const editingEnvId = ref('')
const formVisible = ref(false)
const saving = ref(false)

const envForm = reactive({
  id: '',
  name: '',
  publicUrl: '',
  address: '',
  serverName: '',
  port: undefined as number | undefined,
  /** 新建时复制本模块已有环境的地址/服务器组作初值 */
  copyFrom: undefined as string | undefined,
})

async function loadEnvironments() {
  if (!props.moduleKey) return
  loading.value = true
  try {
    envList.value = await environmentApi.listByModule(props.moduleKey)
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
    address: '',
    serverName: '',
    port: undefined,
    copyFrom: undefined,
  })
}

function openEdit(e: ModuleEnvRow) {
  editingEnvId.value = e.id
  formVisible.value = true
  Object.assign(envForm, {
    id: e.id,
    name: e.name,
    publicUrl: e.publicUrl || '',
    address: e.address || '',
    serverName: e.serverName || '',
    port: e.port,
    copyFrom: undefined,
  })
}

/** 选择「复制自」→ 把该环境的地址/服务器组/公网地址填进来 */
function onCopyFrom(val: string | undefined) {
  if (!val) return
  const base = envList.value.find((e) => e.id === val)
  if (!base) return
  Object.assign(envForm, {
    address: base.address || envForm.address,
    serverName: base.serverName || envForm.serverName,
    port: base.port ?? envForm.port,
    publicUrl: base.publicUrl || envForm.publicUrl,
  })
}

async function saveEnv() {
  const dto = {
    id: envForm.id.trim(),
    name: envForm.name.trim(),
    publicUrl: envForm.publicUrl.trim() || undefined,
    address: envForm.address.trim() || undefined,
    serverName: envForm.serverName.trim() || undefined,
    port: envForm.port,
    copyFrom: editingEnvId.value ? undefined : envForm.copyFrom,
  }
  if (!dto.id || !dto.name) {
    message.error('环境 ID 和名称必填')
    return
  }
  saving.value = true
  try {
    if (editingEnvId.value) {
      await environmentApi.update(props.moduleKey, editingEnvId.value, dto)
      message.success('环境已更新')
    } else {
      await environmentApi.create(props.moduleKey, dto)
      message.success('环境已创建')
    }
    formVisible.value = false
    emit('changed')
    await loadEnvironments()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function deleteEnv(e: ModuleEnvRow) {
  if (e.builtin) {
    message.warning('内置环境不可删除')
    return
  }
  Modal.confirm({
    title: '确认删除',
    content: `确认删除环境 ${e.name}（${e.id}）吗？删除后该环境在本模块的部署/路由/灰度记录会保留为历史数据。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await environmentApi.remove(props.moduleKey, e.id)
        message.success('已删除')
        formVisible.value = false
        emit('changed')
        await loadEnvironments()
      } catch (err: any) {
        message.error(err?.response?.data?.message || '删除失败')
      }
    },
  })
}

onMounted(loadEnvironments)
watch(() => props.moduleKey, loadEnvironments)
</script>

<template>
  <div>
    <p style="color: var(--ws-text-secondary); margin-bottom: 12px;">
      环境归属模块：<b>{{ moduleKey }}</b> 的环境列表。dev / prod 为本模块内置环境（不可删，地址可改），其余可任意增删。
    </p>

    <a-card style="margin-bottom: 16px;" :bordered="false">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span>环境列表</span>
        <a-button type="primary" @click="openCreate">新建环境</a-button>
      </div>
      <a-table
        :columns="[
          { title: 'ID', dataIndex: 'id', key: 'id', width: 140 },
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '公网地址', dataIndex: 'publicUrl', key: 'publicUrl' },
          { title: '服务地址', dataIndex: 'address', key: 'address' },
          { title: '服务器组', dataIndex: 'serverName', key: 'serverName', width: 160 },
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
          <template v-if="column.key === 'address'">
            <span v-if="record.address" class="ws-mono">{{ record.address }}</span>
            <span v-else style="color: #999;">—</span>
          </template>
          <template v-else-if="column.key === 'serverName'">
            <span v-if="record.serverName" class="ws-mono">{{ record.serverName }}</span>
            <span v-else style="color: #999;">—</span>
          </template>
          <template v-else-if="column.key === 'builtin'">
            <a-tag :color="record.builtin ? 'gold' : 'default'">
              {{ record.builtin ? '内置' : '自定义' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button
              type="link"
              size="small"
              danger
              :disabled="record.builtin"
              @click="deleteEnv(record)"
            >删除</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card v-if="formVisible" :title="editingEnvId ? `编辑环境 ${editingEnvId}` : '新建环境'" :bordered="false">
      <a-form layout="vertical">
        <a-form-item v-if="!editingEnvId" label="复制自（可选：复用本模块已有环境的地址/服务器组）">
          <a-select
            v-model:value="envForm.copyFrom"
            placeholder="不选则空白新建"
            allow-clear
            style="max-width: 360px;"
            @change="onCopyFrom"
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

        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="服务地址（backend 模块；留空 = 不在本环境部署）">
              <a-input v-model:value="envForm.address" placeholder="如 127.0.0.1:6000 或 dev.kedouai.com" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="服务器组">
              <a-input v-model:value="envForm.serverName" placeholder="如 dev-default" />
            </a-form-item>
          </a-col>
        </a-row>

        <div style="margin-top: 8px;">
          <a-button type="primary" :loading="saving" @click="saveEnv">
            {{ editingEnvId ? '保存修改' : '创建环境' }}
          </a-button>
          <a-button style="margin-left: 8px;" @click="formVisible = false">取消</a-button>
        </div>
      </a-form>
    </a-card>
  </div>
</template>
