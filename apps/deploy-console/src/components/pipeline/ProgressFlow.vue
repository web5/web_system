<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PipelineItem, OrchestrationStep, OrchestrationTask, TaskRunStatus } from '@/api'
import {
  stepList,
  stepState,
  stepLabelOf,
  statusColor,
  statusText,
  isLive,
} from './pipeline.stages'
import { drawWires as drawPipelineWires, taskSeqNo } from '@/utils/pipelineWires'

const props = defineProps<{
  instance: PipelineItem
}>()

const emit = defineEmits<{
  (e: 'stageClick', stage: string): void
  (e: 'commandClick', stage: string): void
}>()

/* ========== 编排画布模式（specs/pipeline-task-status/design.md §4） ========== */

/**
 * 新引擎实例（orchestration 快照非空）：渲染与编辑页同构的只读画布，
 * 任务级状态来自后端落库的 taskStates；走过路径绿色高亮。
 */
const orch = computed(() => props.instance.orchestration ?? null)
const hasTaskStates = computed(
  () => !!props.instance.taskStates && Object.keys(props.instance.taskStates).length > 0,
)

type AggState = 'succeeded' | 'failed' | 'running' | 'awaiting' | 'skipped' | 'cancelled' | 'none'

const TASK_STATE_TEXT: Record<string, string> = {
  succeeded: '完成',
  running: '执行中',
  failed: '失败',
  skipped: '跳过',
  awaiting: '待审批',
  cancelled: '已取消',
  '': '未执行',
}

/** 任务状态：有落库直读；无落库的历史实例按整体状态粗粒度兜底 */
function taskStateOf(step: OrchestrationStep, task: OrchestrationTask): TaskRunStatus | '' {
  const raw = props.instance.taskStates?.[`${step.id}/${task.id}`] || ''
  // 终态归一（2026-09-22，规格 §13）：实例整体已 succeeded 时，落库残留的 awaiting/running
  // 是过期中间态（如审批通过后引擎未回写任务状态）—— 整体成功与「审批仍挂起」不可能并存。
  // 按原值展示会让步骤聚合为 awaiting，导致「该变绿的连线」保持灰色。
  if (props.instance.status === 'succeeded' && (raw === 'awaiting' || raw === 'running')) {
    return 'succeeded'
  }
  if (hasTaskStates.value) return raw
  return coarseTaskState(step)
}

/**
 * 粗粒度兜底（taskStates 落库前的历史新引擎实例）：
 * 整体 succeeded → 全绿；awaiting-approval → 挂起步骤前绿、挂起处橙；其余不给状态（灰）。
 */
function coarseTaskState(step: OrchestrationStep): TaskRunStatus | '' {
  const st = props.instance.status
  if (st === 'succeeded') return 'succeeded'
  if (st === 'awaiting-approval') {
    const steps = orch.value ?? []
    const hangIdx = steps.findIndex((s) => s.name === props.instance.stage)
    const myIdx = steps.findIndex((s) => s.id === step.id)
    if (hangIdx < 0 || myIdx < 0) return ''
    return myIdx < hangIdx ? 'succeeded' : myIdx === hangIdx ? 'awaiting' : ''
  }
  return ''
}

/** 步骤聚合状态（单一状态源 = 任务状态；任一失败 → 失败，见 design §4.2） */
function stepAgg(step: OrchestrationStep): AggState {
  const states = (step.tasks ?? [])
    .map((t) => taskStateOf(step, t))
    .filter(Boolean) as TaskRunStatus[]
  if (!states.length) return 'none'
  if (states.includes('failed')) return 'failed'
  if (states.includes('cancelled')) return 'cancelled'
  if (states.includes('running')) return 'running'
  if (states.includes('awaiting')) return 'awaiting'
  if (states.some((s) => s === 'succeeded')) return 'succeeded'
  if (states.every((s) => s === 'skipped')) return 'skipped'
  return 'none'
}

/* ── 连线：几何与落笔走公共 util（utils/pipelineWires.ts，与编辑页共用同一套规则） ──
 * 规则判据源：specs/pipeline-flow-color/design.md §2.5 ——
 *   L1 主线横线 = 目标列步骤**聚合**状态色（有成功分支时成功覆盖）
 *   L2 分叉竖线 = **按转折点分段**，第 k 段归第 k 条分支（不归聚合）
 *   L3 支线横线 + L4 箭头 = 各目标任务自身状态色
 *   落笔：坐标取整 + 圆帽 + 拐点补圆；层序：中性色（灰）先画、彩色（深色）后画
 * 本组件只负责把业务状态翻译成颜色（colorOf），不重复实现几何。 */
const canvasBody = ref<HTMLElement | null>(null)
const wires = ref<SVGSVGElement | null>(null)

/** 状态 → 连线颜色 token（边的颜色 = 目标节点状态） */
const WIRE_COLOR: Record<string, string> = {
  succeeded: 'var(--ws-success-500)',
  failed: 'var(--ws-error-500)',
  running: 'var(--ws-brand-500)',
  awaiting: 'var(--ws-warning-500)',
}
function wireColor(state: AggState | TaskRunStatus | ''): string {
  return WIRE_COLOR[state] ?? 'var(--ws-border)'
}

function drawWires() {
  if (!canvasBody.value || !wires.value) return
  drawPipelineWires<OrchestrationTask>({
    wrap: canvasBody.value,
    svg: wires.value,
    colSelector: '.orch-col',
    taskSelector: '.orch-task',
    tasksOf: (toCol) => orch.value?.[toCol]?.tasks ?? [],
    colorOf: ({ kind, toCol, taskIndex, tasks }) => {
      const step = orch.value?.[toCol]
      if (!step) return 'var(--ws-border)'
      if (kind === 'main') return wireColor(stepAgg(step))
      const t = tasks?.[taskIndex]
      return wireColor(t ? taskStateOf(step, t) : '')
    },
  })
}
watch(
  () => props.instance,
  () => nextTick(drawWires),
)
onMounted(() => {
  nextTick(drawWires)
  window.addEventListener('resize', drawWires)
})
onUnmounted(() => window.removeEventListener('resize', drawWires))

/* ========== 时间线模式（legacy / v5 nodes 实例，保持原样） ========== */

/** 流程节点 = 实例活动阶段列表（含快照子集） */
const nodes = computed(() => stepList(props.instance))
const overallStatus = computed(() => props.instance.status)
const currentStage = computed(() => props.instance.stage || '')

function stateOf(s: string) {
  return stepState(props.instance, s)
}

const PROGRESS_TEXT: Record<string, string> = {
  done: '已完成',
  running: '执行中',
  error: '失败',
  pending: '等待',
}

function idxOf(s: string) {
  return nodes.value.indexOf(s) + 1
}

function isError(s: string) {
  return stateOf(s) === 'error'
}
function isRunning(s: string) {
  return stateOf(s) === 'running'
}
function isDone(s: string) {
  return stateOf(s) === 'done'
}

/** 节点展示名（v5 按 nodes label；legacy 按九阶段中文） */
function labelOf(s: string) {
  return stepLabelOf(props.instance, s)
}
/**
 * 该节点是否**审批节点**（基于实例 nodes 快照）。
 *
 * 终态已无 platform 节点（git 是普通 shell 节点、平台能力变成 service action），
 * 这里原来的"平台节点"标记据此改成"审批节点"标记。
 */
function isApproval(s: string) {
  return props.instance.nodes?.find((n) => n.key === s)?.kind === 'approval'
}
function isWatchdog(s: string) {
  return !!props.instance.nodes?.find((n) => n.key === s)?.watchdog
}
</script>

<template>
  <div class="progress-flow">
    <!-- 进度摘要 -->
    <div class="flow-head">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <a-tag :color="statusColor(overallStatus)" style="margin-right: 0;">
          {{ statusText(overallStatus) }}
        </a-tag>
        <a-tag v-if="instance.mode === 'grayscale'" color="orange" style="margin-right: 0;">灰度</a-tag>
        <a-tag v-if="instance.reuseArtifact" color="cyan" style="margin-right: 0;">复用产物</a-tag>
        <span v-if="instance.templateName" style="color: #888; font-size: 12px;">
          流水线 · {{ instance.templateName }}
        </span>
        <span
          v-if="orch && !hasTaskStates"
          class="coarse-hint"
          title="该实例早于任务级状态落库上线，只能按整体结果粗略着色"
        >无任务级执行记录，按整体结果着色</span>
      </div>
      <span v-if="isLive(instance) && instance.progress?.message" class="flow-message">
        {{ instance.progress.message }}
      </span>
    </div>

    <!-- 编排画布（新引擎实例，与编辑页同构 · 原型 baa40e5）：单 grid 一列 = 步骤卡 + 该列
         任务卡（同列同宽）；步骤标题卡中性（无序号，编辑页 step-title 即如此）；序号在
         任务卡左侧竖条（编辑页 task-node .seq 同款，状态色填充顶到卡边）；连线 = SVG 测量
         （任务卡中线），主线/竖线按进入侧步骤聚合状态、支线按目标任务自身状态
         （仅 succeeded 绿，未执行/待审批/跳过一律灰） -->
    <div v-if="orch?.length" class="orch-canvas">
      <div class="canvas-body" ref="canvasBody">
        <svg class="wires" ref="wires"></svg>
        <div class="orch-grid">
          <div v-for="(s, i) in orch" :key="s.id" class="orch-col">
            <div class="orch-step" @click="emit('stageClick', s.name)">
              <span class="name">{{ s.name }}</span>
              <span class="cmd-link" title="查看该步骤发布命令" @click.stop="emit('commandClick', s.name)">命令</span>
            </div>
            <div
              v-for="(t, ti) in s.tasks ?? []"
              :key="t.id"
              class="orch-task"
              :class="`st-${taskStateOf(s, t)}`"
              @click="emit('stageClick', s.name)"
            >
              <span class="rseq">{{ taskSeqNo(i, ti, (s.tasks ?? []).length) }}</span>
              <span class="tname">{{ t.name }}</span>
              <span v-if="t.kind === 'approval'" class="tag t-approval">审批</span>
              <span v-if="t.condition" class="tag t-cond" :title="`条件：${t.condition}`">条件</span>
              <span class="tstate">{{ TASK_STATE_TEXT[taskStateOf(s, t)] }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 时间线（legacy / v5 nodes 实例，保持原有展示） -->
    <div v-else class="flow-track">
      <div
        v-for="(s, i) in nodes"
        :key="s"
        class="flow-item"
        :class="{ 'rail-done': i > 0 && isDone(nodes[i - 1]), 'rail-active': i > 0 && isRunning(nodes[i - 1]) }"
        @click="emit('stageClick', s)"
      >
        <div class="flow-dot" :class="{ 'dot-error': isError(s), 'dot-running': isRunning(s), 'dot-done': isDone(s) }">
          <!-- 失败：红色叉 -->
          <svg v-if="isError(s)" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" stroke-width="3.4">
            <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
          </svg>
          <!-- 进行中：白色呼吸圈 -->
          <span v-else-if="isRunning(s)" class="pulse-ring" />
          <!-- 完成：对勾 -->
          <svg v-else-if="isDone(s)" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#52c41a" stroke-width="3.4">
            <path d="M4.5 12.5l5 5 10-11" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <!-- 等待：序号 -->
          <span v-else class="dot-idx">{{ idxOf(s) }}</span>
        </div>

        <div class="flow-label">
          <span class="stage-name" :class="{ current: s === currentStage }">{{ labelOf(s) }}</span>
          <template v-if="isApproval(s) || isWatchdog(s)">
            <span class="mini-tag" :class="isApproval(s) ? 't-plat' : 't-watch'">
              {{ isApproval(s) ? '审批' : '⚠ watchdog' }}
            </span>
          </template>
          <span class="cmd-link" title="查看该阶段发布命令" @click.stop="emit('commandClick', s)">命令</span>
        </div>
        <div class="flow-sub">
          <span v-if="isRunning(s)" style="color:#1677ff;">执行中…</span>
          <span v-else style="color:#bbb;">{{ PROGRESS_TEXT[stateOf(s)] }}</span>
        </div>
      </div>
    </div>

    <div class="flow-foot">
      <template v-if="orch?.length">
        <i class="legend-dot" style="background: var(--ws-success-500);" /><span>完成</span>
        <i class="legend-dot" style="background: var(--ws-brand-500);" /><span>执行中</span>
        <i class="legend-dot" style="background: var(--ws-error-500);" /><span>失败</span>
        <i class="legend-dot" style="background: var(--ws-warning-500);" /><span>待审批</span>
        <i class="legend-dot legend-skip" /><span>跳过</span>
        <i class="legend-dot" style="background: var(--ws-border); border: 1px solid var(--ws-border);" /><span>未执行</span>
      </template>
      <template v-else>
        <i class="legend-dot" style="background:#52c41a;" /><span>完成</span>
        <i class="legend-dot" style="background:#1677ff;" /><span>执行中</span>
        <i class="legend-dot" style="background:#ff4d4f;" /><span>失败</span>
        <i class="legend-dot" style="background:#fff; border:1px solid #d9d9d9;" /><span>等待</span>
      </template>
      <span style="color:#999; margin-left:12px;">点击节点/任务查看阶段说明 · 点「命令」查看该步骤发布命令</span>
    </div>
  </div>
</template>

<style scoped>
.progress-flow {
  border: 1px solid #f0f0f0;
  border-radius: var(--r-card);
  padding: 16px 16px 10px;
  background: #fff;
}
.flow-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}
.flow-message {
  color: #1677ff;
  font-size: 12px;
  background: #e6f4ff;
  border-radius: var(--r-chip);
  padding: 2px 8px;
}
.coarse-hint {
  font-size: 11px;
  color: var(--ws-text-tertiary);
  border: 1px dashed var(--ws-border);
  border-radius: var(--r-chip);
  padding: 0 6px;
  line-height: 18px;
}

/* ===== 编排画布（与编辑页同构的两行结构：上排步骤卡 / 下排任务卡，SVG 测量连线） ===== */
.orch-canvas {
  overflow-x: auto;
  padding: 8px 4px 4px;
}
.canvas-body {
  position: relative;
  width: max-content;
  min-width: 100%;
}
.wires {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
/* 单 grid：一列 = 步骤卡 + 该列任务卡，列宽取 max(两者) → 同列同宽（原型 baa40e5） */
.orch-grid {
  display: inline-grid;
  grid-auto-flow: column;
  gap: 6px 44px;
  padding: 4px 10px;
}
.orch-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  min-width: 104px;
  align-items: stretch;
}
/* 步骤标题卡：**中性**（白底灰边深字、名称 13px —— 编辑页 step-title 即如此，无序号；
   执行状态由任务卡与连线表达，不整卡染色） */
.orch-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 14px;
  width: 100%;
  border: 1px solid var(--ws-border);
  border-radius: var(--r-card);
  background: var(--ws-bg-surface);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s, background 0.15s;
}
.orch-step:hover {
  border-color: var(--ws-brand-400);
}
.orch-step .name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-text-primary);
}
.orch-step .cmd-link {
  font-size: 11px;
  line-height: 16px;
}
/* 任务卡：序号在左侧竖条（编辑页 task-node .seq 同款；负 margin 抵消卡 padding，
   状态色填充顶到卡边） */
.orch-task {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 10px;
  border: 1px solid var(--ws-border);
  border-radius: var(--r-card);
  background: var(--ws-bg-surface);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.orch-task .rseq {
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 8px;
  margin: -3px 6px -3px -10px;
  font-family: var(--ws-font-mono, monospace);
  font-size: 13px;
  font-weight: 700;
  color: var(--ws-text-secondary);
  background: var(--ws-bg-subtle);
  border-right: 1px solid var(--ws-border);
  border-radius: var(--r-chip) 0 0 var(--r-chip);
}
.orch-task .tname {
  color: var(--ws-text-secondary);
}
.orch-task .tstate {
  color: var(--ws-text-tertiary);
  margin-left: auto;
}
.orch-task .tag {
  font-size: 10px;
  line-height: 15px;
  border-radius: var(--r-chip);
  padding: 0 4px;
}
.tag.t-approval {
  color: #722ed1;
  background: #f9f0ff;
}
.tag.t-cond {
  color: var(--ws-brand-600);
  background: var(--ws-brand-100);
}

/* 状态着色（原型 baa40e5）：**状态色只填充序号竖条背景**（数字反白）+ 边框，
   任务卡其他区域不改背景色；skipped = 灰（含序号条）；token 单源，dark 自适配 */
.orch-task.st-succeeded {
  border-color: var(--ws-success-500);
}
.orch-task.st-succeeded .rseq {
  background: var(--ws-success-500);
  color: #fff;
  border-right-color: var(--ws-success-500);
}
.orch-task.st-running {
  border-color: var(--ws-brand-500);
}
.orch-task.st-running .rseq {
  background: var(--ws-brand-500);
  color: #fff;
  border-right-color: var(--ws-brand-500);
}
.orch-task.st-running .tstate {
  color: var(--ws-brand-500);
}
@keyframes orch-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.25); }
  50% { box-shadow: 0 0 0 5px rgba(249, 115, 22, 0); }
}
.orch-task.st-running {
  animation: orch-breathe 1.6s ease-in-out infinite;
}
.orch-task.st-failed {
  border-color: var(--ws-error-500);
}
.orch-task.st-failed .rseq {
  background: var(--ws-error-500);
  color: #fff;
  border-right-color: var(--ws-error-500);
}
.orch-task.st-failed .tname,
.orch-task.st-failed .tstate {
  color: var(--ws-error-500);
}
.orch-task.st-awaiting {
  border-color: var(--ws-warning-500);
}
.orch-task.st-awaiting .rseq {
  background: var(--ws-warning-500);
  color: #fff;
  border-right-color: var(--ws-warning-500);
}
.orch-task.st-awaiting .tstate {
  color: var(--ws-warning-500);
}
/* 跳过/取消：整卡弱灰（含序号条），不复用成功色 */
.orch-task.st-skipped,
.orch-task.st-cancelled {
  border-color: var(--ws-border);
  background: var(--ws-bg-subtle);
  opacity: 0.85;
}
.orch-task.st-skipped .tname,
.orch-task.st-skipped .tstate,
.orch-task.st-cancelled .tname,
.orch-task.st-cancelled .tstate {
  color: var(--ws-text-tertiary);
}
.orch-task.st-none,
.orch-task.st- {
  /* 无状态（未到/未记录）：弱化 */
  opacity: 0.85;
}

/* ===== 时间线（原样式保持） ===== */
.flow-track {
  display: flex;
  align-items: flex-start;
}
.flow-item {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* padding 已去除：原本 0 2px 让相邻节点间出现 4px 间隙，导致相邻
     节点连接线之间出现留白「断开」。现在 ::after width:100%
     从本节点中点跨到下一节点中点，连成完整线。 */
  padding: 0;
}
/* 横向连线：从本节点圆心向右延伸到下一节点圆心（width: 100% 跨越本 item 全宽 +
   下一 item 的左半，恰好对接下一节点的中点）。默认色加深 #d9d9d9 让「待执行」段也可见。 */
.flow-item::after {
  content: '';
  position: absolute;
  top: 15px;
  left: 50%;
  width: 100%;
  height: 2px;
  z-index: 0;
  background: #d9d9d9;
}
.flow-item.clickable { cursor: pointer; }
.flow-item.rail-done::after { background: #52c41a; }
.flow-item.rail-active::after { background: #91caff; }
.flow-item:last-child::after { display: none; }

.flow-dot {
  position: relative;
  z-index: 1;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid #d9d9d9;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.flow-dot.dot-done {
  border-color: #52c41a;
  background: #f6ffed;
}
.flow-dot.dot-running {
  border-color: #1677ff;
  background: #1677ff;
}
.flow-dot.dot-error {
  border-color: #ff4d4f;
  background: #ff4d4f;
}
.pulse-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: pf-pulse 1.2s ease-in-out infinite;
}
@keyframes pf-pulse {
  0%, 100% { transform: scale(0.8); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.7; }
}
.dot-idx {
  font-size: 12px;
  color: #999;
  font-family: monospace;
}
.flow-label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  max-width: 100%;
  flex-wrap: wrap;
  justify-content: center;
}
.stage-name {
  font-size: 12px;
  color: #555;
  white-space: nowrap;
}
.stage-name.current {
  color: #1677ff;
  font-weight: 600;
}
.cmd-link {
  font-size: 11px;
  color: #1677ff;
  background: #e6f4ff;
  border-radius: var(--r-chip);
  padding: 0 4px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
}
.mini-tag {
  font-size: 10px;
  line-height: 16px;
  border-radius: var(--r-chip);
  padding: 0 4px;
  white-space: nowrap;
}
.mini-tag.t-plat {
  color: #722ed1;
  background: #f9f0ff;
}
.mini-tag.t-watch {
  color: #e8833a;
  background: #fff3e6;
}
.flow-sub {
  margin-top: 4px;
  font-size: 11px;
  text-align: center;
}
.flow-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 18px;
  padding-top: 10px;
  border-top: 1px dashed #f0f0f0;
  font-size: 11px;
  color: #888;
}
.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 8px;
}
.legend-skip {
  background: var(--ws-bg-surface);
  border: 1px dashed var(--ws-border);
}
</style>
