<script setup lang="ts">
import { computed } from 'vue'
import { message } from 'ant-design-vue'

/** 阶段命令抽屉 item（与 stageCommandApi.scriptView 返回项一致） */
export interface StageScriptItem {
  stage: string
  source: 'configured' | 'builtin' | 'required-unset' | 'semantic'
  command: string | null
  enabled: boolean
  timeoutSec: number | null
  updatedAt: string | null
  updatedBy: string | null
  title: string
  builtin: string
  commandMode: 'base' | 'required' | 'override' | 'none'
}

const props = defineProps<{
  open: boolean
  /** 阶段脚本项（由父组件从 scriptView 缓存中取，本组件不重复拉取） */
  item: StageScriptItem | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const SOURCE_TAG = computed(() => {
  const s = props.item?.source
  if (s === 'configured') return { text: '模块脚本', color: 'blue' }
  if (s === 'required-unset') return { text: '必填·未配置', color: 'red' }
  if (s === 'semantic') return { text: '语义真相源', color: 'purple' }
  return { text: '流程内置', color: 'default' }
})

function copyCmd(cmd: string) {
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(cmd)
      .then(() => message.success('已复制'))
      .catch(() => message.warning('复制失败，请手动选择'))
  } else {
    message.warning('当前环境不支持剪贴板，请手动选择')
  }
}
</script>

<template>
  <a-drawer
    :open="open"
    :title="`阶段命令：${item?.title || item?.stage || ''}`"
    placement="right"
    :width="640"
    @close="emit('update:open', false)"
  >
    <template v-if="item">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <span style="color: #999; font-family: monospace;">{{ item.stage }}</span>
        <a-tag :color="SOURCE_TAG.color">{{ SOURCE_TAG.text }}</a-tag>
        <a-tag v-if="item.timeoutSec" color="cyan">超时 {{ item.timeoutSec }}s</a-tag>
        <a-tag v-if="item.updatedBy" color="default">编辑：{{ item.updatedBy }}</a-tag>
      </div>

      <template v-if="item.source === 'configured' && item.command">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 12px; color: #999;">shell 命令（DB 真相源）</span>
          <a-button size="small" type="link" @click="copyCmd(item.command!)">复制</a-button>
        </div>
        <pre
          style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                 font-family: monospace; font-size: 12px; white-space: pre-wrap;
                 max-height: 60vh; overflow: auto; margin: 0;"
        >{{ item.command }}</pre>
        <div v-if="item.builtin" style="margin-top: 8px; color: #666; font-size: 12px;">
          <span style="color: #999;">叠加流程内置：</span>{{ item.builtin }}
        </div>
      </template>

      <a-alert
        v-else-if="item.source === 'required-unset'"
        type="error"
        show-icon
        :message="item.builtin"
      />
      <a-alert
        v-else
        :type="item.source === 'semantic' ? 'warning' : 'info'"
        show-icon
        :message="item.builtin"
      />
      <p style="margin-top: 12px; color: #999; font-size: 12px;">
        说明：此处展示模块当前配置的命令。真实执行命令可在流水线日志中通过「[stage] $ ...」行回溯。
      </p>
    </template>
    <a-empty v-else description="暂无可展示的阶段命令" />
  </a-drawer>
</template>
