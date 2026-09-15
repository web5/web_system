<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { pipelineVarApi, type PipelineVar } from '@/api'

/**
 * 流水线变量面板（可增删改）。
 *
 * 用户 2026-09-15 原型定稿：抽屉「变量」Tab 与编辑页「变量」Tab 共用同一块：
 *  - 顶部：检索框 + 「+ 新增变量」按钮（点开才出现表单，不再常驻挤一行）；
 *  - 新增表单：独立小面板（键 / 值 / 说明 / 密钥 两列 + 取消 / 添加）；
 *  - 表格定宽 + 溢出省略（抽屉只有 640px，宽列会把「键」挤出屏幕）。
 */
const props = defineProps<{ templateId: string; vars: PipelineVar[] }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const q = ref('')
const adding = ref(false)
const saving = ref(false)
const form = ref({ id: '', key: '', value: '', isSecret: false, description: '' })
const editing = computed(() => !!form.value.id)

watch(
  () => props.templateId,
  () => {
    q.value = ''
    adding.value = false
    resetForm()
  },
)

const rows = computed(() => {
  const k = q.value.trim().toLowerCase()
  if (!k) return props.vars
  return props.vars.filter((v) => `${v.key} ${v.description || ''}`.toLowerCase().includes(k))
})

function resetForm() {
  form.value = { id: '', key: '', value: '', isSecret: false, description: '' }
}

function editVar(v: PipelineVar) {
  form.value = { id: v.id, key: v.key, value: '', isSecret: !!v.isSecret, description: v.description || '' }
  adding.value = true
}

async function submit() {
  const f = form.value
  if (!f.key.trim()) {
    message.warning('变量键必填')
    return
  }
  saving.value = true
  try {
    if (f.id) {
      await pipelineVarApi.update(f.id, {
        key: f.key.trim(),
        // 密钥留空 = 不更新（后端语义）
        ...(f.value ? { value: f.value } : {}),
        isSecret: f.isSecret,
        description: f.description,
      })
    } else {
      await pipelineVarApi.create(props.templateId, {
        key: f.key.trim(),
        value: f.value,
        isSecret: f.isSecret,
        description: f.description,
      })
    }
    resetForm()
    adding.value = false
    emit('changed')
    message.success('变量已保存')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存变量失败')
  } finally {
    saving.value = false
  }
}

function removeVar(v: PipelineVar) {
  Modal.confirm({
    title: `删除变量「${v.key}」`,
    content: `删除后节点脚本里的 \${${v.key}} 会取不到值。确认删除？`,
    okText: '确认删除',
    okType: 'danger',
    onOk: async () => {
      try {
        await pipelineVarApi.remove(v.id)
        emit('changed')
        message.success('变量已删除')
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}
</script>

<template>
  <div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <a-input v-model:value="q" placeholder="检索变量（键 / 说明）" size="small" style="flex: 1;" allow-clear />
      <a-button size="small" type="primary" @click="adding = !adding">
        {{ adding ? '收起' : '+ 新增变量' }}
      </a-button>
    </div>

    <a-card v-if="adding" size="small" style="margin-top: 10px;">
      <div style="font-weight: 600; margin-bottom: 8px;">新增变量</div>
      <div class="var-grid">
        <div class="var-field">
          <label>键 *</label>
          <a-input v-model:value="form.key" size="small" placeholder="如 PUBLISH_PATH" class="mono-input" />
        </div>
        <div class="var-field">
          <label>值</label>
          <a-input
            v-model:value="form.value"
            size="small"
            :placeholder="editing ? '值（留空 = 不更新，密钥不回显）' : '值'"
            class="mono-input"
          />
        </div>
        <div class="var-field">
          <label>说明</label>
          <a-input v-model:value="form.description" size="small" placeholder="用途说明" />
        </div>
        <div class="var-field">
          <label>密钥</label>
          <a-checkbox v-model:checked="form.isSecret">值不回显</a-checkbox>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
        <a-button size="small" @click="adding = false; resetForm()">取消</a-button>
        <a-button size="small" type="primary" :loading="saving" @click="submit">
          {{ editing ? '保存' : '添加' }}
        </a-button>
      </div>
    </a-card>

    <a-table
      :data-source="rows"
      :pagination="false"
      size="small"
      row-key="id"
      style="margin-top: 10px;"
    >
      <a-table-column title="键" data-index="key" :width="140" ellipsis>
        <template #default="{ record }"><span class="mono-text">{{ record.key }}</span></template>
      </a-table-column>
      <a-table-column title="值" :width="150" ellipsis>
        <template #default="{ record }">
          <span class="mono-text">{{ record.isSecret ? '********' : record.value }}</span>
        </template>
      </a-table-column>
      <a-table-column title="说明" data-index="description" ellipsis />
      <a-table-column title="密钥" :width="70">
        <template #default="{ record }">
          <a-tag :color="record.isSecret ? 'orange' : 'default'">{{ record.isSecret ? '是' : '否' }}</a-tag>
        </template>
      </a-table-column>
      <a-table-column title="操作" :width="110">
        <template #default="{ record }">
          <a @click="editVar(record)">编辑</a>
          <a-divider type="vertical" />
          <a style="color: var(--ws-error-500);" @click="removeVar(record)">删除</a>
        </template>
      </a-table-column>
      <template #emptyText>
        <div class="empty-hint">
          {{ q ? '没有匹配的变量' : '未定义变量 · 节点脚本里的 ${KEY} 会取不到值' }}
        </div>
      </template>
    </a-table>

    <div class="muted-text" style="margin-top: 10px;">
      变量属于本条流水线（不单独成页）；密钥只写入不回显，留空保存 = 不更新。
    </div>
  </div>
</template>

<style scoped>
.var-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.var-field { display: flex; flex-direction: column; gap: 4px; }
.var-field label { font-size: 12px; color: var(--ws-text-tertiary); }
.mono-input :deep(input) { font-family: var(--ws-font-mono); }
.mono-text { font-family: var(--ws-font-mono); }
.muted-text { font-size: 12px; color: var(--ws-text-tertiary); }
.empty-hint { font-size: 12px; color: var(--ws-text-tertiary); padding: 12px 0; text-align: center; }
</style>
