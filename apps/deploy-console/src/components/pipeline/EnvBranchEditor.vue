<script setup lang="ts">
/**
 * 节点「环境分支」编辑器（release 等 shell 节点）。
 *
 * 语义：每个环境一段**自包含**脚本，保存时由后端拼装成单一执行体
 * （写入 command 与 actions[shell].code —— 执行体真相源在后者）。
 * 未配置脚本的环境 → 发布时 fail-fast（不做静默回落）。
 *
 * 设计：specs/pipeline-env-branch/design.md
 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { pipelineStepApi, envsApi } from '@/api'

const props = defineProps<{
  templateId: string
  nodeKey: string
  /** 已保存的环境分支配置（null = 未启用） */
  modelValue: Record<string, string> | null
  /** 平台托管节点（locked）只读 */
  locked?: boolean
}>()
const emit = defineEmits<{ (e: 'saved'): void }>()

interface BranchRow {
  env: string
  script: string
}

const rows = ref<BranchRow[]>([])
const saving = ref(false)
const envs = ref<string[]>([])
const enabled = ref(false)

/** 内置环境兜底（环境服务不可用时也能配） */
const BUILTIN_ENVS = ['local', 'dev', 'staging', 'prod']

async function loadEnvs() {
  try {
    // envsApi.list 返回分页信封（{ items, total, ... }），也可能直接是数组（兼容两种）
    const raw = await envsApi.list()
    const list: unknown[] = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])
    const ids = list
      .map((e) => (e as { id?: string; key?: string })?.id || (e as { id?: string; key?: string })?.key)
      .filter(Boolean) as string[]
    envs.value = Array.from(new Set([...BUILTIN_ENVS, ...ids]))
  } catch {
    envs.value = [...BUILTIN_ENVS]
  }
}

const envOptions = computed(() =>
  envs.value.map((e) => ({ value: e, label: e, disabled: rows.value.some((r) => r.env === e) })),
)

watch(
  () => props.modelValue,
  (v) => {
    const has = !!v && Object.keys(v).length > 0
    enabled.value = has
    rows.value = has ? Object.entries(v!).map(([env, script]) => ({ env, script: String(script ?? '') })) : []
  },
  { immediate: true, deep: true },
)

watch(() => props.nodeKey, () => void loadEnvs(), { immediate: true })

function addBranch() {
  const used = new Set(rows.value.map((r) => r.env))
  const next = envs.value.find((e) => !used.has(e))
  rows.value.push({
    env: next || `env-${rows.value.length + 1}`,
    script: '#!/usr/bin/env bash\nset -euo pipefail\n',
  })
}

function removeBranch(i: number) {
  rows.value.splice(i, 1)
}

async function save() {
  if (!enabled.value) {
    // 关闭环境分支：回到单一脚本形态
    saving.value = true
    try {
      await pipelineStepApi.save(props.templateId, props.nodeKey, { envBranches: null })
      message.success('已关闭环境分支（回到单一脚本）')
      emit('saved')
    } catch (e: unknown) {
      message.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      saving.value = false
    }
    return
  }

  const branches: Record<string, string> = {}
  for (const r of rows.value) {
    if (!r.env?.trim()) {
      message.warning('存在未选择环境的分支')
      return
    }
    if (branches[r.env]) {
      message.warning(`环境 ${r.env} 重复`)
      return
    }
    branches[r.env] = r.script ?? ''
  }
  if (!Object.keys(branches).length) {
    message.warning('至少配置一个环境分支')
    return
  }

  saving.value = true
  try {
    await pipelineStepApi.save(props.templateId, props.nodeKey, { envBranches: branches })
    message.success(`已保存 ${Object.keys(branches).length} 个环境分支：${Object.keys(branches).join('、')}`)
    emit('saved')
  } catch (e: unknown) {
    message.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="env-branch">
    <a-alert type="info" show-icon style="margin-bottom: 12px;">
      <template #message>
        环境分支：每个环境一段脚本，保存后节点执行体由分支配置**生成**（手工改脚本会被覆盖）。
        未配置脚本的环境 → 发布时直接失败。
      </template>
    </a-alert>

    <div class="branch-switch">
      <a-switch v-model:checked="enabled" :disabled="locked" />
      <span class="switch-label">按环境分叉（关闭则为单一脚本）</span>
    </div>

    <template v-if="enabled">
      <div v-for="(b, i) in rows" :key="i" class="branch-row">
        <div class="branch-head">
          <a-select
            v-model:value="b.env"
            :options="envOptions"
            :disabled="locked"
            style="width: 180px;"
          />
          <a-button danger size="small" :disabled="locked" @click="removeBranch(i)">删除</a-button>
        </div>
        <a-textarea
          v-model:value="b.script"
          class="ws-mono branch-code"
          :rows="10"
          :disabled="locked"
          spellcheck="false"
        />
      </div>

      <div class="branch-ops">
        <a-button size="small" :disabled="locked" @click="addBranch">+ 添加环境分支</a-button>
        <a-button type="primary" size="small" :loading="saving" :disabled="locked" @click="save">
          保存环境分支
        </a-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.env-branch {
  margin-top: 12px;
}
.branch-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.switch-label {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.branch-row {
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 10px;
}
.branch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.branch-code {
  font-family: var(--ws-font-mono);
  font-size: 12px;
}
.branch-ops {
  display: flex;
  gap: 8px;
}
</style>
