<script setup lang="ts">
import { computed } from 'vue'
import type { PipelineItem } from '@/api'
import {
  STEP_LABELS,
  stepList,
  stepState,
  statusColor,
  statusText,
  isLive,
} from './pipeline.stages'

const props = defineProps<{
  instance: PipelineItem
}>()

const emit = defineEmits<{
  (e: 'stageClick', stage: string): void
  (e: 'commandClick', stage: string): void
}>()

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
          模板 · {{ instance.templateName }}
        </span>
      </div>
      <span v-if="isLive(instance) && instance.progress?.message" class="flow-message">
        {{ instance.progress.message }}
      </span>
    </div>

    <!-- 步骤连线图 -->
    <div class="flow-track">
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
          <span class="stage-name" :class="{ current: s === currentStage }">{{ STEP_LABELS[s] || s }}</span>
          <span class="cmd-link" title="查看该阶段发布命令" @click.stop="emit('commandClick', s)">命令</span>
        </div>
        <div class="flow-sub">
          <span v-if="isRunning(s)" style="color:#1677ff;">执行中…</span>
          <span v-else style="color:#bbb;">{{ PROGRESS_TEXT[stateOf(s)] }}</span>
        </div>
      </div>
    </div>

    <div class="flow-foot">
      <i class="legend-dot" style="background:#52c41a;" /><span>完成</span>
      <i class="legend-dot" style="background:#1677ff;" /><span>执行中</span>
      <i class="legend-dot" style="background:#ff4d4f;" /><span>失败</span>
      <i class="legend-dot" style="background:#fff; border:1px solid #d9d9d9;" /><span>等待</span>
      <span style="color:#999; margin-left:12px;">点击节点查看阶段说明 · 点「命令」查看该阶段发布命令</span>
    </div>
  </div>
</template>

<style scoped>
.progress-flow {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
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
  border-radius: 4px;
  padding: 2px 8px;
}
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
  padding: 0 2px;
}
/* 横向连线：从本节点圆心向右延伸半个节点宽 */
.flow-item::after {
  content: '';
  position: absolute;
  top: 15px;
  left: 50%;
  width: 50%;
  height: 2px;
  z-index: 0;
  background: #f0f0f0;
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
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
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
</style>
