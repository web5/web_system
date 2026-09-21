<script setup lang="ts">
/**
 * 步骤任务（分支）编辑器 —— 「步骤 1:N 任务」实体关系的编辑入口。
 *
 * 每个任务 = 名称 + 匹配条件（空=默认任务）+ 自包含脚本；运行时按 sort 命中第一个为真的任务，
 * 全不命中用默认任务，无默认任务则步骤失败。
 *
 * 设计：specs/pipeline-step-branch/design.md
 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { stepBranchApi } from '@/api'

export interface BranchRow {
  name: string
  label: string
  condition: string
  script: string
  sort: number
}

const props = defineProps<{
  templateId: string
  nodeKey: string
  /** 已保存的任务列表 */
  branches: { name: string; label?: string | null; condition?: string | null; script: string; sort?: number }[]
  locked?: boolean
}>()
const emit = defineEmits<{ (e: 'saved'): void }>()

const rows = ref<BranchRow[]>([])
const saving = ref(false)

watch(
  () => props.branches,
  (v) => {
    rows.value = (v ?? []).map((b, i) => ({
      name: b.name,
      label: b.label ?? '',
      condition: b.condition ?? '',
      script: b.script ?? '',
      sort: b.sort ?? i,
    }))
  },
  { immediate: true, deep: true },
)

const hasDefault = computed(() => rows.value.some((r) => !String(r.condition ?? '').trim()))

function addRow() {
  rows.value.push({
    name: `env-${rows.value.length + 1}`,
    label: '',
    condition: 'DEPLOY_ENV == ',
    script: '#!/usr/bin/env bash\nset -euo pipefail\n',
    sort: rows.value.length,
  })
}
function removeRow(i: number) {
  rows.value.splice(i, 1)
}
function move(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= rows.value.length) return
  const t = rows.value[i]
  rows.value[i] = rows.value[j]
  rows.value[j] = t
  rows.value.forEach((r, k) => (r.sort = k))
}

async function save() {
  const list = rows.value.map((r, i) => ({
    name: r.name?.trim() ?? '',
    label: r.label?.trim() || null,
    condition: String(r.condition ?? '').trim() || null,
    script: r.script ?? '',
    sort: i,
  }))
  if (list.some((r) => !r.name)) {
    message.warning('存在未命名的任务')
    return
  }
  const names = new Set<string>()
  for (const r of list) {
    if (names.has(r.name)) {
      message.warning(`任务名重复: ${r.name}`)
      return
    }
    names.add(r.name)
  }
  if (list.filter((r) => !r.condition).length > 1) {
    message.warning('默认任务（不配条件）最多一个')
    return
  }
  saving.value = true
  try {
    await stepBranchApi.save(props.templateId, props.nodeKey, list)
    message.success(`已保存 ${list.length} 个步骤任务`)
    emit('saved')
  } catch (e: unknown) {
    message.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function clearAll() {
  saving.value = true
  try {
    await stepBranchApi.clear(props.templateId, props.nodeKey)
    message.success('已清空任务（回落到单一脚本）')
    emit('saved')
  } catch (e: unknown) {
    message.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '清空失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="step-branch">
    <a-alert type="info" show-icon style="margin-bottom: 12px;">
      <template #message>
        步骤任务：同一件事的不同做法（如发布=本机 cp / 远程 scp）。运行时按条件<b>命中第一个为真的任务</b>；
        全不命中用<b>默认任务</b>（不配条件）；无默认任务 → 步骤失败。
      </template>
    </a-alert>

    <div v-for="(r, i) in rows" :key="i" class="branch-row">
      <div class="branch-head">
        <a-input v-model:value="r.name" :disabled="locked" placeholder="任务名（如 local）" style="width: 130px;" />
        <a-input v-model:value="r.label" :disabled="locked" placeholder="展示名（如 本机投递）" style="width: 150px;" />
        <a-input
          v-model:value="r.condition"
          :disabled="locked"
          placeholder="匹配条件；留空=默认任务"
          style="flex: 1; min-width: 180px;"
        />
        <span v-if="!String(r.condition ?? '').trim()" class="tag-default">默认</span>
        <a-space size="4">
          <a-button size="small" :disabled="locked || i === 0" @click="move(i, -1)">↑</a-button>
          <a-button size="small" :disabled="locked || i === rows.length - 1" @click="move(i, 1)">↓</a-button>
          <a-button size="small" danger :disabled="locked" @click="removeRow(i)">删除</a-button>
        </a-space>
      </div>
      <a-textarea
        v-model:value="r.script"
        class="branch-code"
        :rows="9"
        :disabled="locked"
        spellcheck="false"
      />
    </div>

    <div class="branch-doc">
      <b>条件语法</b>：<code>KEY == 值</code> / <code>KEY != 值</code>，多条件用 <code>&amp;&amp;</code>；<b>变量</b>：<code>DEPLOY_ENV</code>
      <code>MODULE_KEY</code> <code>MODULE_TYPE</code> <code>BRANCH</code> 等（见「高级」Tab 说明）。示例：<code>DEPLOY_ENV == local</code>
    </div>
    <div class="branch-ops">
      <a-button size="small" :disabled="locked" @click="addRow">+ 添加任务</a-button>
      <a-button type="primary" size="small" :loading="saving" :disabled="locked" @click="save">
        保存任务
      </a-button>
      <a-button size="small" danger :disabled="locked || !rows.length" @click="clearAll">清空</a-button>
      <span v-if="!hasDefault && rows.length" class="hint-warn">未设默认任务：条件都不匹配时步骤会失败</span>
    </div>
  </div>
</template>

<style scoped>
.step-branch { margin-top: 12px; }
.branch-row { border: 1px solid var(--ws-border); border-radius: 6px; padding: 10px; margin-bottom: 10px; }
.branch-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.tag-default { font-size: 11px; color: var(--ws-text-tertiary); border: 1px solid var(--ws-border); border-radius: 20px; padding: 1px 8px; }
.branch-code { font-family: var(--ws-font-mono); font-size: 12px; }
.branch-doc { font-size: 12px; color: var(--ws-text-secondary); line-height: 2;
  border: 1px solid var(--ws-border); border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
.branch-doc b { color: var(--ws-text-primary); }
.branch-doc code { font-family: var(--ws-font-mono); background: var(--ws-bg-hover);
  border: 1px solid var(--ws-border); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
.branch-ops { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.hint-warn { font-size: 12px; color: var(--ws-warning-600, var(--ws-text-tertiary)); }
</style>
