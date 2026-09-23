<script setup lang="ts">
/**
 * 步骤执行条件（gate）编辑器 —— 抽屉「高级」Tab。
 *
 * 与步骤任务的匹配条件共用同一套表达式引擎（specs/pipeline-step-branch/design.md §2）：
 * 条件满足 → 正常执行；不满足 → 跳过整个步骤（流程继续）；表达式非法 → 步骤失败。
 */
import { ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { pipelineStepApi } from '@/api'

const props = defineProps<{
  templateId: string
  nodeKey: string
  /** 已保存的条件（空 = 恒执行） */
  condition: string | null
  locked?: boolean
}>()
const emit = defineEmits<{ (e: 'saved'): void }>()

const on = ref(false)
const expr = ref('')
const saving = ref(false)

watch(
  () => props.condition,
  (v) => {
    const s = String(v ?? '').trim()
    on.value = !!s
    expr.value = s
  },
  { immediate: true },
)

async function save() {
  const next = on.value ? expr.value.trim() : null
  if (on.value && !next) {
    message.warning('已启用执行条件，表达式不能为空')
    return
  }
  saving.value = true
  try {
    await pipelineStepApi.save(props.templateId, props.nodeKey, { condition: next })
    message.success(next ? `已保存执行条件：${next}` : '已关闭执行条件（恒执行）')
    emit('saved')
  } catch (e: unknown) {
    message.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="cond-editor">
    <div class="cond-row">
      <a-switch v-model:checked="on" :disabled="locked" />
      <span class="lbl">启用执行条件</span>
    </div>
    <div v-if="on" class="cond-row">
      <span class="lbl">表达式</span>
      <a-input
        v-model:value="expr"
        class="mono"
        style="flex: 1;"
        :disabled="locked"
        placeholder="如 DEPLOY_ENV == prod"
        spellcheck="false"
      />
    </div>
    <div class="cond-doc">
      <div><b>语法</b>：<code>KEY == 值</code> / <code>KEY != 值</code>，多条件用 <code>&amp;&amp;</code> 连接；含空格的值用引号包裹。</div>
      <div>
        <b>变量</b>：<code>DEPLOY_ENV</code> <code>MODULE_KEY</code> <code>MODULE_TYPE</code>
        <code>BRANCH</code> <code>COMMIT_ID</code>、本流水线变量与配置中心值（见「变量」Tab）。
      </div>
      <div><b>示例</b>：<code>DEPLOY_ENV == prod</code>　<code>DEPLOY_ENV != local &amp;&amp; MODULE_TYPE == backend</code></div>
    </div>
    <div class="cond-note">
      条件满足 → 正常执行；不满足 → <b>跳过整个步骤</b>（日志记「执行条件不满足，已跳过」，流程继续）；
      表达式非法 → 步骤失败。
    </div>
    <div class="cond-ops">
      <a-button type="primary" size="small" :loading="saving" :disabled="locked" @click="save">
        保存执行条件
      </a-button>
    </div>
  </div>
</template>

<style scoped>
.cond-editor { margin-top: 12px; }
.cond-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.cond-row .lbl { font-size: 12px; color: var(--ws-text-secondary); width: 56px; flex-shrink: 0; }
.mono { font-family: var(--ws-font-mono); font-size: 12px; }
.cond-doc { font-size: 12px; color: var(--ws-text-secondary); line-height: 2;
  border: 1px solid var(--ws-border); border-radius: var(--r-card); padding: 10px 12px; margin-bottom: 10px; }
.cond-doc b { color: var(--ws-text-primary); }
.cond-doc code { font-family: var(--ws-font-mono); background: var(--ws-bg-hover);
  border: 1px solid var(--ws-border); border-radius: var(--r-chip); padding: 1px 5px; font-size: 11px; }
.cond-note { font-size: 12px; color: var(--ws-text-secondary); background: var(--ws-bg-hover);
  border-radius: var(--r-card); padding: 10px 12px; line-height: 1.8; }
.cond-note b { color: var(--ws-text-primary); }
.cond-ops { margin-top: 12px; }
</style>
