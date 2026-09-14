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
      <a-select-option v-for="u in users" :key="u.username" :value="u.username">
        <span>{{ u.nickname || u.username }}</span>
        <span v-if="u.nickname" class="ws-dim">（{{ u.username }}）</span>
        <a-tag v-for="r in u.roles" :key="r" color="blue" class="ws-role-tag">{{ r }}</a-tag>
      </a-select-option>
      <template v-if="!users.length && !loading" #notFoundContent>
        <a-typography-text type="secondary" style="padding: 8px;">
          {{ emptyText }}
        </a-typography-text>
      </template>
    </a-select>

    <!-- 降级提示：权限服务不可用 / 清单为空时，审批不会做强校验，必须让用户知道 -->
    <a-typography-text v-if="degraded" type="warning" class="ws-hint">
      <ExclamationCircleOutlined /> {{ degradedReason }}
    </a-typography-text>
  </div>
</template>

<script setup lang="ts">
/**
 * 人员选择器（数据来源：GET /api/pipelines/meta/approvers）。
 *
 * 为什么抽成组件：「选人」会在多处出现 —— 流水线的审批人配置、后续节点级审批人、
 * 通知接收人等。此前这些位置都是手填用户名（写错要等运行时才暴露），
 * 统一走本组件后才能保证「选出来的都是真实存在的系统用户」。
 *
 * 数据来源说明：候选人是 **admin 系统中持有指定权限码的用户**
 * （默认 `deploy:pipeline:approve`），不是本控制台的账号 ——
 * 控制台本身没有用户表（登录是单一管理员）。
 *
 * 行为：
 *  - 单选 / 多选（`multiple`）；可搜索（按用户名/昵称/角色）
 *  - `degraded=true`（权限服务不可用或清单为空）时给出显式告警：
 *    此时后端**不做强校验**，必须让用户知情，避免"以为设了审批人其实没设"
 *  - 只允许从候选列表选，不允许自由输入（自由输入 = 又回到手填的老问题）
 */
import { computed, onMounted, ref } from 'vue'
import { TypographyText as ATypographyText } from 'ant-design-vue'
import { ExclamationCircleOutlined } from '@ant-design/icons-vue'
import { pipelineApi, type ApproverUser } from '@/api'

const props = withDefaults(
  defineProps<{
    /** 多选为完整数组；单选时只用第 0 项 */
    modelValue?: string[]
    multiple?: boolean
    disabled?: boolean
    placeholder?: string
    /** 最多展示多少个标签，超出折叠（多选） */
    maxTagCount?: number
  }>(),
  { multiple: true, maxTagCount: 3, placeholder: '选择人员' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void
  (e: 'loaded', info: { users: ApproverUser[]; degraded: boolean }): void
}>()

const users = ref<ApproverUser[]>([])
const degraded = ref(false)
const degradedReason = ref('')
const loading = ref(false)

const emptyText = computed(() =>
  degraded.value ? '未获取到人员（权限服务不可用）' : '暂无可选人员（请先授予对应权限）',
)

const filterOption = (input: string, opt: any) => {
  const key = String(opt?.value || '').toLowerCase()
  const u = users.value.find((x) => x.username === key)
  const hay = [u?.username, u?.nickname, ...(u?.roles ?? [])].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(input.toLowerCase())
}

async function load() {
  loading.value = true
  try {
    const r = await pipelineApi.approvers()
    users.value = r.users ?? []
    degraded.value = !!r.degraded
    degradedReason.value = r.degraded
      ? `未校验审批权限（${r.reason || '权限服务不可用'}）：当前任何可登录控制台的人都能审批`
      : ''
    emit('loaded', { users: users.value, degraded: degraded.value })
  } catch {
    users.value = []
    degraded.value = true
    degradedReason.value = '获取可审批人失败：当前不做审批权限校验'
  } finally {
    loading.value = false
  }
}

function onUpdate(v?: string | string[]) {
  const next = Array.isArray(v) ? v : v ? [v] : []
  emit('update:modelValue', next)
}

onMounted(load)
</script>

<style scoped>
.ws-dim {
  color: var(--ws-text-secondary, #8c8c8c);
  margin-left: 4px;
}
.ws-role-tag {
  margin-left: 6px;
  transform: scale(0.85);
}
.ws-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
</style>
