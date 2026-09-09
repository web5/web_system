<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { PipelineItem } from '@/api'
import PipelineRunLogs from './PipelineRunLogs.vue'
import { stageLogLines, stageHasError, opSegments, type OpSegment } from './pipeline.logs'
import {
  STEP_LABELS,
  stepState,
  statusText,
  formatTime,
  durationMs,
} from './pipeline.stages'

/** 阶段命令抽屉 item（与 stageCommandApi.scriptView 返回项一致） */
/** v4 操作（阶段内 1..N 个执行动作） */
export interface StageActionView {
  id: string
  type: 'shell' | 'service'
  name: string
  code?: string
  tool?: string
  timeoutSec?: number
  cont?: boolean
  enabled?: boolean
  builtin?: boolean
}

export interface StageScriptItem {
  stage: string
  source: 'configured' | 'builtin' | 'required-unset' | 'semantic'
  command: string | null
  /** v4 多操作；单命令形态由后端包装成 1 个操作，前端无需区分 */
  actions: StageActionView[]
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

/** 该阶段的操作序列（后端已保证单命令形态也返回 1 个操作） */
const actions = computed(() => props.item?.actions ?? [])

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

/** 按操作分段的日志（v4 多操作：一个操作一个可折叠块） */
const segments = computed(() => {
  const { prelude, ops } = opSegments(stageLines.value)
  return { prelude, ops }
})
/** 操作块的折叠状态 */
const opCollapsed = ref<Record<string, boolean>>({})
function toggleOp(op: string) {
  opCollapsed.value[op] = !opCollapsed.value[op]
}
/** 操作状态着色：失败红 / 容错继续橙 / 完成绿 / 未知蓝 */
function opState(op: OpSegment): 'ok' | 'fail' | 'cont' | 'run' {
  const txt = [...op.body, op.head].join('\n')
  if (/失败|failed/i.test(txt) && !/continueOnError=是/i.test(txt)) return 'fail'
  if (/continueOnError=是/i.test(txt)) return 'cont'
  if (/完成/i.test(txt)) return 'ok'
  return 'run'
}
const OP_STATE_META: Record<string, { color: string; text: string; bg: string }> = {
  ok: { color: '#52c41a', text: '完成', bg: '#f6ffed' },
  fail: { color: '#ff4d4f', text: '失败', bg: '#fff2f0' },
  cont: { color: '#d48806', text: '失败·容错继续', bg: '#fffbe6' },
  run: { color: '#1677ff', text: '执行中/无结束标记', bg: '#e6f4ff' },
}

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
          <!-- v4 多操作列表 -->
          <template v-if="actions.length">
            <a-divider orientation="left" style="margin: 16px 0 10px;">
              操作列表（{{ actions.length }}）
            </a-divider>
            <a-list size="small" :data-source="actions" bordered>
              <template #renderItem="{ item: act, index }">
                <a-list-item>
                  <a-space size="small" wrap>
                    <span style="font-family: monospace; color: #999;">op{{ index + 1 }}</span>
                    <a-tag :color="act.type === 'service' ? 'purple' : 'blue'">
                      {{ act.type === 'service' ? '工具' : 'shell' }}
                    </a-tag>
                    <span>{{ act.name }}</span>
                    <span v-if="act.type === 'service'" style="color: #999;">{{ act.tool }}</span>
                    <a-tag v-if="act.cont" color="orange">容错</a-tag>
                    <a-tag v-if="act.builtin" color="default">内置</a-tag>
                    <span v-if="act.timeoutSec" style="color: #999;">{{ act.timeoutSec }}s</span>
                  </a-space>
                </a-list-item>
              </template>
            </a-list>
          </template>
          <p style="margin-top: 12px; color: #999; font-size: 12px;">
            说明：此处展示模块当前配置的操作。真实执行内容可在「日志」Tab 通过「[stage/opN] $ ...」行回溯；
            标记「容错」的操作失败不中断阶段，其余操作失败即阶段失败。
          </p>
        </a-tab-pane>

        <!-- Tab ② 执行日志（该阶段段落；有 v4 操作锚则按 op 分段展示） -->
        <a-tab-pane key="logs" tab="执行日志">
          <template v-if="instance">
            <template v-if="segments.ops.length">
              <div class="op-log-panel">
                <!-- 阶段前导说明行 -->
                <template v-if="segments.prelude.length">
                  <div v-for="(l, pi) in segments.prelude" :key="'p' + pi" class="ol-line ol-plain">{{ l }}</div>
                </template>

                <!-- 每个操作一个块 -->
                <div
                  v-for="op in segments.ops"
                  :key="op.op"
                  class="op-block"
                  :class="{ 'op-fail': opState(op) === 'fail' }"
                >
                  <div class="op-head" @click="toggleOp(op.op)">
                    <span class="op-dot" :style="{ background: OP_STATE_META[opState(op)].color }"></span>
                    <span class="op-idx">{{ op.op }}</span>
                    <span class="op-name">{{ op.name }}</span>
                    <a-tag :color="OP_STATE_META[opState(op)].color" style="margin: 0;">
                      {{ OP_STATE_META[opState(op)].text }}
                    </a-tag>
                    <span class="op-code">{{ op.head.replace(/^\[[^\]]*\]\s*/, '') }}</span>
                    <span class="op-caret">{{ opCollapsed[op.op] ? '▸' : '▾' }}</span>
                  </div>
                  <div v-show="!opCollapsed[op.op]" class="op-body">
                    <div
                      v-for="(l, li) in op.body"
                      :key="li"
                      class="ol-line"
                      :class="/error|fail|失败|回滚|警告/i.test(l) ? 'ol-warn' : 'ol-plain'"
                    >{{ l }}</div>
                  </div>
                </div>
              </div>
            </template>
            <PipelineRunLogs
              v-else
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

<style scoped>
/* 操作级日志分段（v4 多操作） */
.op-log-panel {
  background: #1e1e1e;
  border-radius: 6px;
  padding: 8px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.op-block {
  border-top: 1px dashed #333;
}
.op-block:first-of-type {
  border-top: none;
}
.op-block.op-fail {
  background: rgba(255, 77, 79, 0.06);
}
.op-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: #d4d4d4;
  flex-wrap: wrap;
}
.op-head:hover {
  background: rgba(255, 255, 255, 0.04);
}
.op-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.op-idx {
  color: #999;
  font-family: monospace;
}
.op-name {
  font-weight: 600;
  color: #e8e8e8;
}
.op-code {
  color: #91caff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 340px;
  font-family: monospace;
  font-size: 11px;
}
.op-caret {
  margin-left: auto;
  color: #888;
}
.op-body {
  padding: 0 12px 10px 44px;
}
.ol-line {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
}
.ol-warn {
  color: #ff7875;
}
.ol-plain {
  color: #b8b8b8;
}
</style>
