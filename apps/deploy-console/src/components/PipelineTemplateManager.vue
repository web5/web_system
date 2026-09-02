<script setup lang="ts">
import { ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { pipelineTemplateApi, type PipelineTemplate } from '@/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>()

// 内置九阶段（core=安全/发布语义基线，不可裁剪）
const TPL_STAGES = [
  { key: 'check', label: '校验（安全基线）', core: true },
  { key: 'pull', label: '拉取代码' },
  { key: 'build', label: '构建' },
  { key: 'upload', label: '投递' },
  { key: 'restart', label: '重启' },
  { key: 'version', label: '写版本（发布语义）', core: true },
  { key: 'pointer', label: '切指针（发布语义）', core: true },
  { key: 'verify', label: '探活验证' },
  { key: 'cleanup', label: '清理旧版本' },
]
const TPL_ALL_KEYS = TPL_STAGES.map((s) => s.key)

const templates = ref<PipelineTemplate[]>([])
const loading = ref(false)
const modal = ref({
  open: false,
  editing: null as PipelineTemplate | null,
  name: '',
  description: '',
  steps: TPL_ALL_KEYS as string[],
  rollbackOnFailure: 'previous' as string,
  approval: 'inherit' as string,
  defaultTarget: 'auto' as string,
})

function approvalText(a: string) {
  const map: Record<string, string> = { inherit: '沿用环境规则', always: '始终审批', never: '免除审批' }
  return map[a] || a
}
function targetText(t: string) {
  const map: Record<string, string> = { auto: '自动', local: '本机', remote: '远程' }
  return map[t] || t
}
function stepSummary(t: PipelineTemplate) {
  const total = TPL_STAGES.length
  const active = t.steps && t.steps.length ? t.steps.length : total
  return `${active}/${total} 步${t.skipVerify ? ' · 跳过探活' : ''}${
    t.rollbackOnFailure === 'none' ? ' · 失败不回滚' : ''
  }`
}

async function load() {
  loading.value = true
  try {
    templates.value = await pipelineTemplateApi.list()
  } catch {
    message.error('加载流水线模板失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) load()
  },
  { immediate: true },
)

function openCreate() {
  modal.value = {
    open: true,
    editing: null,
    name: '',
    description: '',
    steps: [...TPL_ALL_KEYS],
    rollbackOnFailure: 'previous',
    approval: 'inherit',
    defaultTarget: 'auto',
  }
}
function openEdit(t: PipelineTemplate) {
  modal.value = {
    open: true,
    editing: t,
    name: t.name,
    description: t.description || '',
    steps: t.steps && t.steps.length ? [...t.steps] : [...TPL_ALL_KEYS],
    rollbackOnFailure: t.rollbackOnFailure ?? 'previous',
    approval: t.approval,
    defaultTarget: t.defaultTarget,
  }
}
function closeModal() {
  modal.value.open = false
}

async function save() {
  const m = modal.value
  if (!m.name.trim()) {
    message.warning('模板名必填')
    return
  }
  try {
    // 步骤按内置顺序提交（core 由 UI 锁定保留）；skipVerify 由服务端从 steps 派生
    const orderedSteps = TPL_STAGES.filter((s) => m.steps.includes(s.key)).map((s) => s.key)
    const dto = {
      name: m.name.trim(),
      description: m.description.trim() || undefined,
      steps: orderedSteps,
      rollbackOnFailure: m.rollbackOnFailure as PipelineTemplate['rollbackOnFailure'],
      approval: m.approval as PipelineTemplate['approval'],
      defaultTarget: m.defaultTarget as PipelineTemplate['defaultTarget'],
    }
    if (m.editing) {
      await pipelineTemplateApi.update(m.editing.id, dto)
      message.success('模板已更新')
    } else {
      await pipelineTemplateApi.create(dto)
      message.success('流水线已创建')
    }
    closeModal()
    await load()
    emit('changed')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  }
}

async function duplicate(t: PipelineTemplate) {
  try {
    await pipelineTemplateApi.duplicate(t.id)
    message.success('已复制为「' + t.name + ' 副本」')
    await load()
    emit('changed')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '复制失败')
  }
}
async function toggle(t: PipelineTemplate) {
  try {
    await pipelineTemplateApi.update(t.id, { enabled: !t.enabled })
    await load()
    emit('changed')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '操作失败')
  }
}
function remove(t: PipelineTemplate) {
  Modal.confirm({
    title: '删除流水线模板',
    content: `删除「${t.name}」？已提交的实例不受影响。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await pipelineTemplateApi.remove(t.id)
        message.success('已删除')
        await load()
        emit('changed')
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}
</script>

<template>
  <a-drawer
    :open="props.open"
    title="流水线模板（全局定义，不绑定模块）"
    placement="right"
    :width="820"
    @close="emit('close')"
  >
    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;">
      <span style="color: #888; font-size: 13px;">
        流水线独立于模块：执行时在发布页选「模块 + 流水线」。默认 = 全流程 + 环境规则审批。
      </span>
      <a-button type="primary" @click="openCreate">新建流水线</a-button>
    </div>

    <a-table :data-source="templates" :loading="loading" row-key="id" size="small" :pagination="{ pageSize: 8 }">
      <a-table-column title="流水线" data-index="name">
        <template #default="{ record }">
          {{ record.name }}
          <a-tag v-if="record.builtin" color="blue" style="margin-left: 4px;">默认</a-tag>
          <a-tag v-if="!record.enabled" color="default" style="margin-left: 4px;">已停用</a-tag>
        </template>
      </a-table-column>
      <a-table-column title="步骤" key="steps">
        <template #default="{ record }">{{ stepSummary(record) }}</template>
      </a-table-column>
      <a-table-column title="审批" key="approval" width="120">
        <template #default="{ record }">{{ approvalText(record.approval) }}</template>
      </a-table-column>
      <a-table-column title="默认投递" key="target" width="90">
        <template #default="{ record }">{{ targetText(record.defaultTarget) }}</template>
      </a-table-column>
      <a-table-column title="说明" data-index="description" ellipsis />
      <a-table-column title="操作" key="action" width="230">
        <template #default="{ record }">
          <a-space>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button type="link" size="small" @click="duplicate(record)">复制</a-button>
            <a-button type="link" size="small" @click="toggle(record)">
              {{ record.enabled ? '停用' : '启用' }}
            </a-button>
            <a-button
              v-if="!record.builtin"
              type="link"
              size="small"
              danger
              @click="remove(record)"
            >
              删除
            </a-button>
          </a-space>
        </template>
      </a-table-column>
    </a-table>
  </a-drawer>

  <!-- 编辑/新建弹窗 -->
  <a-modal
    :open="modal.open"
    :title="modal.editing ? '编辑流水线' : '新建流水线'"
    :width="640"
    @ok="save"
    @cancel="closeModal"
  >
    <a-form layout="vertical">
      <a-form-item label="名称（全局唯一）" required>
        <a-input
          v-model:value="modal.name"
          :disabled="!!modal.editing?.builtin"
          placeholder="如：正式线（强制审批）/ 快速验证线"
        />
      </a-form-item>
      <a-form-item label="说明">
        <a-input v-model:value="modal.description" />
      </a-form-item>
      <a-form-item label="活动步骤（check / version / pointer 为安全与发布语义基线，不可裁剪）">
        <a-checkbox-group
          v-model:value="modal.steps"
          style="display: flex; flex-wrap: wrap; gap: 4px 16px;"
        >
          <a-checkbox v-for="s in TPL_STAGES" :key="s.key" :value="s.key" :disabled="s.core">
            {{ s.label }}
          </a-checkbox>
        </a-checkbox-group>
      </a-form-item>
      <a-form-item label="探活失败自动回滚">
        <a-radio-group v-model:value="modal.rollbackOnFailure">
          <a-radio value="previous">自动回滚到上一版本</a-radio>
          <a-radio value="none">不回滚（保留现场排查）</a-radio>
        </a-radio-group>
      </a-form-item>
      <a-form-item label="审批策略">
        <a-radio-group v-model:value="modal.approval">
          <a-radio value="inherit">沿用环境规则（prod 需审批）</a-radio>
          <a-radio value="always">始终需要审批</a-radio>
          <a-radio value="never">免除审批（高风险）</a-radio>
        </a-radio-group>
      </a-form-item>
      <a-form-item label="默认投递（提交未指定时）">
        <a-radio-group v-model:value="modal.defaultTarget">
          <a-radio value="auto">自动</a-radio>
          <a-radio value="local">本机</a-radio>
          <a-radio value="remote">远程服务器</a-radio>
        </a-radio-group>
      </a-form-item>
    </a-form>
  </a-modal>
</template>
