<template>
  <a-select
    :value="modelValue"
    show-search
    allow-clear
    :placeholder="placeholder"
    :filter-option="filterOption"
    :loading="loading"
    @update:value="onUpdate"
  >
    <a-select-option v-for="b in branches" :key="b" :value="b">
      {{ b }}{{ b === current ? '（当前）' : '' }}
    </a-select-option>
    <template v-if="!branches.length" #notFoundContent>
      <a-typography-text type="secondary" style="padding: 8px;">
        暂无可用分支，请先 git push
      </a-typography-text>
    </template>
  </a-select>
</template>

<script setup lang="ts">
/**
 * 远程分支下拉（数据来源：GET /api/modules/:key/branches → ReleaseGitService.listRemoteBranches）。
 *
 * 为什么抽成组件：发起发布表单在**三处**出现 —— 发布流水线页（PipelineCenter）、
 * 流水线详情页（PipelineDetail）、共用抽屉（PipelineSubmit）。
 * 后两处此前是 `a-input placeholder="master"`：只能手输、写错分支名要等发布失败才发现，
 * 而平台本来就提供分支列表（页面只读选择，不手输）。统一走本组件后三处行为一致。
 *
 * 行为：
 *  - `origin/*` 分支列表 + 可搜索；当前分支若尚未推送（不在列表里）也会补进来并标「当前」
 *  - `auto-select-current`：用户未主动选择时，默认落到发布目录当前分支（而非写死 master）
 *  - `@loaded`：把 branches/current 抛给调用方（用于展示提示文案或做联动）
 */
import { computed, ref, watch } from 'vue'
import { moduleApi } from '@/api'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    moduleKey?: string
    /** 用户未选择时是否自动落到「当前分支」（默认 false，避免覆盖调用方的显式默认） */
    autoSelectCurrent?: boolean
  }>(),
  { autoSelectCurrent: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | undefined): void
  (e: 'loaded', info: { branches: string[]; current: string | null }): void
}>()

const branches = ref<string[]>([])
const current = ref<string | null>(null)
const loading = ref(false)

const placeholder = computed(() =>
  branches.value.length ? '选择分支（可直接输入）' : loading.value ? '加载分支中…' : 'master',
)

const filterOption = (input: string, opt: any) =>
  (opt?.value || '').toString().toLowerCase().includes(input.toLowerCase())

async function load(key?: string) {
  if (!key) {
    branches.value = []
    current.value = null
    return
  }
  loading.value = true
  try {
    const r = await moduleApi.branches(key)
    const list = r.branches || []
    const cur = (r.current && r.current !== 'HEAD' ? r.current : null) as string | null
    // 当前分支若未推送（不在 origin/* 列表），补进列表以便能选中
    branches.value = cur && !list.includes(cur) ? [cur, ...list] : list
    current.value = cur
    emit('loaded', { branches: branches.value, current: cur })
    if (props.autoSelectCurrent && cur && (!props.modelValue || props.modelValue === 'master')) {
      emit('update:modelValue', cur)
    }
  } catch {
    branches.value = []
    current.value = null
  } finally {
    loading.value = false
  }
}

// 模块变化 → 重新拉分支（immediate：初次挂载即加载）
watch(() => props.moduleKey, (k) => void load(k), { immediate: true })

function onUpdate(v?: string) {
  emit('update:modelValue', v)
}
</script>
