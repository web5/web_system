<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { PipelineItem } from '@/api'
import PipelineRunLogs from './PipelineRunLogs.vue'
import { stageLogLines, stageHasError } from './pipeline.logs'
import {
  STEP_LABELS,
  stepState,
  statusText,
  formatTime,
  durationMs,
} from './pipeline.stages'

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
  /** 选中实例：提供时「日志/结果」Tab 才可用 */
  instance?: PipelineItem | null
  /** 打开时默认激活的 Tab（节点点击=logs、命令入口=command） */
  initialTab?: 'command' | 'logs' | 'result'
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const tab = ref<'command' | 'logs' | 'result'>('command')
// 每次切换阶段/打开时重置到 initialTab（默认命令）
watch(
  () => [props.open, props.item?.stage] as const,
  ([open]) => {
    if (open) tab.value = props.initialTab || 'command'
  },
  { immediate: true },
)

const SOURCE_TAG = computed(() => {
  const s = props.item?.source
  if (s === 'configured') return { text: '模块脚本', color: 'blue' }
  if (s === 'required-unset') return { text: '必填·未配置', color: 'red' }
  if (s === 'semantic') return { text: '语义真相源', color: 'purple' }
  return { text: '流程内置', color: 'default' }
})

/** 实例上该阶段的活动状态 */
const stageStateText = computed(() => {
  const st = props.instance ? stepState(props.instance, props.item?.stage ?? '') : 'pending'
  const map: Record<string, string> = {
    done: '已完成',
    running: '执行中',
    error: '失败',
    pending: '未执行/等待',
  }
  return map[st] || st
})
const isError = computed(() => props.instance && stageStateText.value === '失败')

/** 该阶段日志段落（切分自实例全量日志） */
const stageLines = computed(() =>
  props.instance && props.item ? stageLogLines(props.instance, props.item.stage) : [],
)
const stageErr = computed(() => stageHasError(stageLines.value))

/** 涉及产物/版本指针的阶段，结果 Tab 展示关联信息 */
const versionHint = computed(() => {
  if (!props.instance || !props.item) return null
  const s = props.item.stage
  if (['upload', 'version', 'pointer'].includes(s)) {
    return `版本 ${props.instance.versionTag || '—'} @ commit ${props.instance.gitCommit || '—'}`
  }
  return null
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
    :title="`阶段详情：${item?.title || item?.stage || ''}`"
    placement="right"
    :width="680"
    @close="emit('update:open', false)"
  >
    <template v-if="item">
      <!-- 头部：阶段元信息 -->
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <span style="color: #999; font-family: monospace;">{{ item.stage }}</span>
        <a-tag :color="SOURCE_TAG.color">{{ SOURCE_TAG.text }}</a-tag>
        <a-tag v-if="item.timeoutSec" color="cyan">超时 {{ item.timeoutSec }}s</a-tag>
        <a-tag v-if="item.updatedBy" color="default">编辑：{{ item.updatedBy }}</a-tag>
        <a-tag
          v-if="instance"
          :color="isError ? 'error' : 'default'"
          style="margin-right: 0;"
        >{{ STEP_LABELS[item.stage] || item.stage }} · {{ stageStateText }}</a-tag>
      </div>

      <!-- 三合一 Tab -->
      <a-tabs v-model:activeKey="tab" size="small">
        <!-- Tab ① 命令 -->
        <a-tab-pane key="command" tab="命令">
          <template v-if="item.source === 'configured' && item.command">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 12px; color: #999;">shell 命令（DB 真相源）</span>
              <a-button size="small" type="link" @click="copyCmd(item.command!)">复制</a-button>
            </div>
            <pre
              style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px;
                     font-family: monospace; font-size: 12px; white-space: pre-wrap;
                     max-height: 50vh; overflow: auto; margin: 0;"
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
            说明：此处展示模块当前配置的命令。真实执行命令可在「日志」Tab 通过「[stage] $ ...」行回溯。
          </p>
        </a-tab-pane>

        <!-- Tab ② 执行日志（该阶段段落） -->
        <a-tab-pane key="logs" tab="执行日志">
          <template v-if="instance">
            <PipelineRunLogs
              :lines="stageLines"
              :keyword="item.stage"
              empty-text="该阶段暂无输出（可能尚未执行或已跳过）"
              :max-height="420"
            />
          </template>
          <a-empty v-else description="未选择执行实例，无法查看该阶段日志" />
        </a-tab-pane>

        <!-- Tab ③ 结果 -->
        <a-tab-pane key="result" tab="结果">
          <template v-if="instance">
            <a-alert
              v-if="stageErr"
              type="error"
              show-icon
              message="该阶段日志含失败/回滚特征，请前往「执行日志」Tab 查看详情"
              style="margin-bottom: 12px;"
            />
            <a-descriptions :column="2" size="small" bordered>
              <a-descriptions-item label="阶段状态">{{ stageStateText }}</a-descriptions-item>
              <a-descriptions-item label="实例状态">
                <a-tag :color="instance.status === 'succeeded' ? 'success' : instance.status === 'failed' ? 'error' : 'default'">
                  {{ statusText(instance.status) }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="版本 / commit">{{ versionHint || '—' }}</a-descriptions-item>
              <a-descriptions-item label="实例耗时">
                {{ instance.endTime || instance.status === 'succeeded' || instance.status === 'failed' || instance.status === 'cancelled' ? ((durationMs(instance) / 1000).toFixed(1) + 's') : '进行中…' }}
              </a-descriptions-item>
              <a-descriptions-item label="开始时间" :span="2">{{ formatTime(instance.startTime) }}</a-descriptions-item>
            </a-descriptions>
            <a-alert
              v-if="instance.error"
              type="error"
              show-icon
              :message="instance.error"
              style="margin-top: 12px;"
            />
          </template>
          <a-empty v-else description="未选择执行实例，无法查看该阶段结果" />
        </a-tab-pane>
      </a-tabs>
    </template>
    <a-empty v-else description="暂无可展示的阶段信息" />
  </a-drawer>
</template>
