<template>
  <div>
    <a-select
      :value="multiple ? modelValue : modelValue?.[0]"
      :mode="multiple ? 'multiple' : undefined"
      show-search
      allow-clear
      :disabled="disabled"
      :placeholder="placeholder"
      :filter-option="filterOption"
      :loading="loading"
      :max-tag-count="maxTagCount"
      @update:value="onUpdate"
    >
      <a-select-option v-for="u in options" :key="u.username" :value="u.username">
        <span>{{ u.nickname || u.username }}</span>
        <span v-if="u.nickname" class="ws-us-dim">（{{ u.username }}）</span>
        <a-tag v-for="r in u.roles || []" :key="r" color="blue" class="ws-us-role">{{ r }}</a-tag>
      </a-select-option>
      <template v-if="!options.length && !loading" #notFoundContent>
        <span class="ws-us-empty">{{ emptyText }}</span>
      </template>
    </a-select>

    <!-- 权威名单没拿到 → 后端多半不做强校验，必须显式告知 -->
    <div v-if="degraded" class="ws-us-hint">
      <ExclamationCircleOutlined /> {{ degradedText }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 人员选择器（@web-system/ui 公共组件）。
 *
 * 为什么在共享包里：「选一个系统用户」在 admin（运营）与 deploy-console（运维）
 * 都会出现 —— 审批人、负责人、通知接收人等。各自实现就会出现两处漂移：
 * 展示口径不一致、错误提示不一致、以及最容易忽略的「degraded（没拿到权威名单）
 * 时不提示」，让人误以为设了限制其实没有。
 *
 * 数据来源**由调用方注入**（`load` 或 `users`）：本包不依赖任何一端的 API，
 * 因此 admin 可以传用户列表接口、console 可以传「按权限码筛选的审批人」接口。
 *
 * 行为：
 *  - 单选 / 多选（`multiple`）；按用户名 / 昵称 / 角色搜索
 *  - 只可从候选里选，不允许自由输入（自由输入 = 又回到手填用户名、写错才发现）
 *  - `degraded` 时给出显式告警文案
 *  - `users` 优先（受控用法）；未给 `users` 时才调 `load`
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ExclamationCircleOutlined } from '@ant-design/icons-vue'
import type { UserOption, UserSelectLoadResult } from './UserSelect.types'

const props = withDefaults(
  defineProps<{
    modelValue?: string[]
    multiple?: boolean
    disabled?: boolean
    placeholder?: string
    /** 多选时最多展示几个标签，超出折叠 */
    maxTagCount?: number
    /** 受控候选（给了就不再调用 load） */
    users?: UserOption[]
    /** 加载器：注入具体端的数据来源 */
    load?: () => Promise<UserSelectLoadResult>
    /** degraded 时的告警文案前缀 */
    degradedText?: string
  }>(),
  {
    multiple: true,
    maxTagCount: 3,
    placeholder: '选择人员',
    degradedText: '未获取到权威人员名单，本次不会做强校验',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void
  (e: 'loaded', info: UserSelectLoadResult): void
}>()

const fetched = ref<UserOption[]>([])
const degraded = ref(false)
const degradedReason = ref('')
const loading = ref(false)

const options = computed<UserOption[]>(() =>
  props.users && props.users.length ? props.users : fetched.value,
)

const emptyText = computed(() =>
  degraded.value ? '未获取到人员（服务不可用）' : '暂无可选人员',
)
const degradedText = computed(() =>
  [props.degradedText, degradedReason.value].filter(Boolean).join('：'),
)

const filterOption = (input: string, opt: any) => {
  const key = String(opt?.value || '').toLowerCase()
  const u = options.value.find((x) => x.username === key)
  const hay = [u?.username, u?.nickname, ...(u?.roles ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(input.toLowerCase())
}

async function load() {
  if (!props.load) return
  loading.value = true
  try {
    const r = await props.load()
    fetched.value = r.users ?? []
    degraded.value = !!r.degraded
    degradedReason.value = r.degraded ? r.reason || '' : ''
    emit('loaded', r)
  } catch {
    fetched.value = []
    degraded.value = true
    degradedReason.value = '获取人员失败'
  } finally {
    loading.value = false
  }
}

function onUpdate(v?: string | string[]) {
  emit('update:modelValue', Array.isArray(v) ? v : v ? [v] : [])
}

// load 变化（如切换了筛选条件）→ 重新拉取；immediate 使挂载即加载
watch(() => props.load, () => void load(), { immediate: true })
onMounted(() => {
  if (props.load && !fetched.value.length) void load()
})
</script>

<style scoped>
.ws-us-dim {
  color: #8c8c8c;
  margin-left: 4px;
}
.ws-us-role {
  margin-left: 6px;
  transform: scale(0.85);
}
.ws-us-empty {
  display: inline-block;
  padding: 8px;
  color: #8c8c8c;
}
.ws-us-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #d46b08;
}
</style>
