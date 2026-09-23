<script setup lang="ts">
/**
 * 流水线编排画布（新三层模型：步骤 → 任务 → 动作）。
 *
 * UI 真相源：docs/ui/prototypes/deploy-console-domain-split.html（用户逐轮确认的画布形态）
 * 模型：specs/pipeline-step-task/design.md §6
 *  - 上行步骤标题（互不连线）；下行任务卡（箭头串联，连线中点「＋」= 添加步骤）
 *  - 多任务步骤分叉进入；任务头下紧贴动作块（共享边框组，圆角 2px）
 *  - 动作一律 shell 脚本；写版本记录 = 脚本调平台工具（非内置工具）
 *  - 抽屉两态：任务总览（动作列表+条件/变量 tab）/ 单动作（动作名+脚本）
 *  - 删除走画布 hover ×；保存在页头按钮组（取消/删除/保存），抽屉无保存
 */
import { ref, computed, nextTick, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  orchestrationApi,
  type OrchestrationStep,
  type OrchestrationTask,
  type OrchestrationAction,
} from '@/api'

const props = defineProps<{ pipelineId: string }>()
const emit = defineEmits<{ (e: 'dirty', v: boolean): void }>()

// ── 数据 ──
const loading = ref(true)
const saving = ref(false)
const steps = ref<OrchestrationStep[]>([])
const pristine = ref('')

function snapshot(): string {
  return JSON.stringify(steps.value)
}
const dirty = computed(() => snapshot() !== pristine.value)

function markDirty() {
  emit('dirty', dirty.value)
}

async function load() {
  loading.value = true
  try {
    const tree = await orchestrationApi.getTree(props.pipelineId)
    steps.value = (tree ?? []).map((s) => ({
      ...s,
      tasks: (s.tasks ?? []).map((t) => ({ ...t, actions: [...(t.actions ?? [])] })),
    }))
    pristine.value = snapshot()
    emit('dirty', false)
    await nextTick()
    drawWires()
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ── 编号：单任务步骤用步骤号；多任务用 步骤号-任务号 ──
function taskSeq(stepIdx: number, taskIdx: number, step: OrchestrationStep): string {
  const n = (step.tasks ?? []).length
  return n > 1 ? `${stepIdx + 1}-${taskIdx + 1}` : String(stepIdx + 1)
}

// ── 画布编辑 ──
function addStep() {
  steps.value.push({ name: `步骤${steps.value.length + 1}`, description: '', tasks: [] })
  markDirty()
}
function removeStep(i: number) {
  steps.value.splice(i, 1)
  markDirty()
  nextTick(drawWires)
}
function addTask(step: OrchestrationStep) {
  ;(step.tasks ??= []).push({ kind: 'script', name: `任务${(step.tasks ?? []).length + 1}`, actions: [] })
  markDirty()
  nextTick(drawWires)
}
function removeTask(step: OrchestrationStep, i: number) {
  step.tasks?.splice(i, 1)
  markDirty()
  nextTick(drawWires)
}
function removeAction(task: OrchestrationTask, i: number) {
  if (task.actions?.[i]?.managed) {
    message.warning('平台托管动作不可删除')
    return
  }
  task.actions?.splice(i, 1)
  markDirty()
}

// ── 抽屉（两态：任务总览 / 单动作） ──
const drawerOpen = ref(false)
const drawerMode = ref<'task' | 'action'>('task')
const curStep = ref<OrchestrationStep | null>(null)
const curTask = ref<OrchestrationTask | null>(null)
const curAction = ref<OrchestrationAction | null>(null)
const drawerTab = ref('task')

function openTask(step: OrchestrationStep, task: OrchestrationTask) {
  curStep.value = step
  curTask.value = task
  curAction.value = null
  drawerMode.value = 'task'
  drawerTab.value = 'task'
  drawerOpen.value = true
  syncEnvDrafts(task)
}

// ── 任务级环境变量（KEY 可改名：以 draft 暂存，blur/回车提交重建对象保证响应性） ──
const envKeyDrafts = ref<Record<string, string>>({})
function syncEnvDrafts(task: OrchestrationTask) {
  envKeyDrafts.value = Object.fromEntries(Object.keys(task.env ?? {}).map((k) => [k, k]))
}
function addEnvKey(task: OrchestrationTask) {
  const next = { ...(task.env ?? {}) }
  let name = `KEY_${Object.keys(next).length + 1}`
  while (name in next) name = `_${name}`
  next[name] = ''
  task.env = next
  envKeyDrafts.value = { ...envKeyDrafts.value, [name]: name }
  markDirty()
}
function removeEnvKey(task: OrchestrationTask, oldKey: string) {
  const next = { ...(task.env ?? {}) }
  delete next[oldKey]
  task.env = next
  delete envKeyDrafts.value[oldKey]
  markDirty()
}
function commitEnvKey(task: OrchestrationTask, oldKey: string) {
  const newKey = (envKeyDrafts.value[oldKey] ?? '').trim()
  if (!newKey || newKey === oldKey) {
    envKeyDrafts.value[oldKey] = oldKey
    return
  }
  if (task.env && newKey in task.env) {
    message.warning(`变量键重复：${newKey}`)
    envKeyDrafts.value[oldKey] = oldKey
    return
  }
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(task.env ?? {})) next[k === oldKey ? newKey : k] = v
  task.env = next
  const drafts = { ...envKeyDrafts.value }
  delete drafts[oldKey]
  drafts[newKey] = newKey
  envKeyDrafts.value = drafts
  markDirty()
}
function openAction(step: OrchestrationStep, task: OrchestrationTask, action: OrchestrationAction) {
  curStep.value = step
  curTask.value = task
  curAction.value = action
  drawerMode.value = 'action'
  drawerOpen.value = true
}
function closeDrawer() {
  drawerOpen.value = false
  markDirty()
}
function addAction(task: OrchestrationTask) {
  ;(task.actions ??= []).push({ name: `动作${(task.actions ?? []).length + 1}`, script: '#!/usr/bin/env bash\nset -euo pipefail\n' })
  drawerOpen.value = false
  markDirty()
  nextTick(drawWires)
}

// ── 保存（页头按钮组）：先 steps（元数据），再逐步骤 tasks ──
async function save() {
  if (!steps.value.length) {
    message.warning('至少保留一个步骤')
    return
  }
  saving.value = true
  try {
    const saved = await orchestrationApi.saveSteps(
      props.pipelineId,
      steps.value.map((s, i) => ({
        // 带 id = 更新（可改名，任务保留）；不带 = 新建
        ...(s.id ? { id: s.id } : {}),
        name: s.name,
        description: s.description ?? null,
        sort: s.sort ?? i,
        enabled: s.enabled ?? true,
      })),
    )
    // 按 id 配对（saved 按 sort 排序，与本地顺序可能不一致；按索引配对会把任务存错步骤）
    for (const local of steps.value) {
      const remote = saved.find((s) => s.id === local.id) ?? saved.find((s) => s.name === local.name)
      if (remote?.id && (local.tasks ?? []).length) {
        await orchestrationApi.saveTasks(props.pipelineId, remote.id, local.tasks ?? [])
      }
    }
    message.success('流水线已保存（步骤 / 任务 / 动作 / 条件 / 变量）')
    await load()
  } catch (e) {
    message.error((e as Error).message?.slice(0, 200) || '保存失败')
  } finally {
    saving.value = false
  }
}
function cancelEdit() {
  steps.value = JSON.parse(pristine.value)
  message.info('已放弃未保存的修改')
  nextTick(drawWires)
}
async function removePipelineStep(step: OrchestrationStep) {
  if (step.id) {
    try {
      await orchestrationApi.deleteStep(props.pipelineId, step.id)
      message.success(`已删除步骤「${step.name}」（级联任务与动作）`)
    } catch (e) {
      message.error((e as Error).message?.slice(0, 160) || '删除失败')
      return
    }
  }
  const i = steps.value.indexOf(step)
  if (i >= 0) steps.value.splice(i, 1)
  markDirty()
  nextTick(drawWires)
}

defineExpose({ save, dirty })

// ── 连线（测量式：JS 量坐标 + SVG 绘制，与布局解耦 —— 原型定稿的关键技术决策） ──
const wires = ref<SVGSVGElement | null>(null)
const canvasBody = ref<HTMLElement | null>(null)
const COLOR = '#F97316' // SVG presentation attribute 不支持 CSS 变量（原型已验证），用主题主橙

function center(el: Element, wrap: Element) {
  const r = el.getBoundingClientRect()
  const w = wrap.getBoundingClientRect()
  return {
    right: r.right - w.left,
    left: r.left - w.left,
    cy: r.top - w.top + r.height / 2,
  }
}
function seg(x1: number, y1: number, x2: number, y2: number) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', `M${x1} ${y1} L${x2} ${y2}`)
  p.setAttribute('stroke', COLOR)
  p.setAttribute('stroke-width', '2.5')
  p.setAttribute('fill', 'none')
  p.setAttribute('opacity', '.9')
  wires.value?.appendChild(p)
}
function chevron(x: number, y: number) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', `M${x - 9} ${y - 8} L${x} ${y} L${x - 9} ${y + 8}`)
  p.setAttribute('stroke', COLOR)
  p.setAttribute('stroke-width', '3')
  p.setAttribute('fill', 'none')
  p.setAttribute('stroke-linecap', 'round')
  p.setAttribute('stroke-linejoin', 'round')
  wires.value?.appendChild(p)
}
function drawWires() {
  const wrap = canvasBody.value
  const svg = wires.value
  if (!wrap || !svg) return
  const cols = [...wrap.querySelectorAll('.step-col')] as HTMLElement[]
  if (!cols.length) return
  svg.setAttribute('width', String(Math.ceil(wrap.scrollWidth) + 40))
  svg.setAttribute('height', String(Math.ceil(wrap.scrollHeight) + 20))
  svg.innerHTML = ''
  // 清掉上一轮的连线中点＋号（否则重绘时残留叠加）
  wrap.querySelectorAll('.wire-plus').forEach((n) => n.remove())
  for (let i = 0; i < cols.length - 1; i++) {
    const from = cols[i].querySelector('.task-node')
    const tos = [...cols[i + 1].querySelectorAll('.task-node')]
    if (!from || !tos.length) continue
    const f = center(from, wrap)
    const t0 = center(tos[0], wrap)
    const midX = (f.right + t0.left) / 2
    seg(f.right, f.cy, midX, f.cy)
    // 中点＋号（添加步骤）
    const btn = document.createElement('button')
    btn.className = 'wire-plus'
    btn.title = '在此插入步骤'
    btn.textContent = '＋'
    btn.style.left = `${midX}px`
    btn.style.top = `${f.cy}px`
    btn.onclick = () => {
      steps.value.splice(i + 1, 0, { name: `步骤${i + 2}`, description: '', tasks: [] })
      markDirty()
      nextTick(drawWires)
    }
    wrap.appendChild(btn)

    const sameLine = tos.length === 1 && Math.abs(center(tos[0], wrap).cy - f.cy) < 1
    if (sameLine) {
      seg(midX, f.cy, t0.left, f.cy)
      chevron(t0.left, f.cy)
    } else {
      const ys = tos.map((t) => center(t, wrap).cy)
      const top = Math.min(f.cy, ...ys)
      const bot = Math.max(f.cy, ...ys)
      seg(midX, top, midX, bot)
      for (const t of tos) {
        const c = center(t, wrap)
        seg(midX, c.cy, c.left, c.cy)
        chevron(c.left, c.cy)
      }
    }
  }
}
</script>

<template>
  <div class="orch-editor">
    <!-- 保存/取消统一在页面页头（与基本信息共用一组按钮），画布内不再重复 -->
    <div class="orch-head">
      <span class="hint">步骤（名称+介绍，不连线）→ 任务（箭头串联、多任务分叉）→ 动作（脚本，紧贴任务头）。修改后点页面右上「保存」。</span>
    </div>

    <a-spin :spinning="loading">
      <div class="orch-canvas">
        <div class="canvas-body" ref="canvasBody">
          <svg class="wires" ref="wires"></svg>
          <div class="pipeline">
            <div v-for="(step, si) in steps" :key="si" class="step-col">
              <div class="step-title" @click="openTask(step, (step.tasks ?? [])[0] ?? ({ kind: 'script', name: '', actions: [] } as OrchestrationTask))">
                <span class="nm">{{ step.name }}</span>
                <span class="desc">{{ step.description || '点击编辑介绍' }}</span>
              </div>
              <div class="tasks">
                <div v-for="(task, ti) in step.tasks ?? []" :key="ti" class="task">
                  <div class="task-node" :class="{ approval: task.kind === 'approval' }" @click="openTask(step, task)">
                    <span class="seq">{{ taskSeq(si, ti, step) }}</span>
                    <span class="tag">任务</span>
                    <span v-if="task.condition" class="ifb" :title="`执行条件：${task.condition}`">if</span>
                    <span class="tname">{{ task.name }}</span>
                    <button class="del" title="删除任务" @click.stop="removeTask(step, ti)">×</button>
                  </div>
                  <div v-if="task.kind === 'script'" class="task-acts">
                    <div
                      v-for="(action, ai) in task.actions ?? []"
                      :key="ai"
                      class="act-node"
                      :title="action.managed ? '平台托管动作（不可删除）' : '脚本：点击编辑该动作'"
                      @click.stop="openAction(step, task, action)"
                    >
                      <span class="atag">脚本</span>
                      <span class="aname">{{ action.name }}</span>
                      <button class="del" :disabled="action.managed" :title="action.managed ? '平台托管动作不可删除' : '删除动作'" @click.stop="removeAction(task, ai)">×</button>
                    </div>
                  </div>
                </div>
                <button class="add-task" @click="addTask(step)">＋ 任务</button>
              </div>
            </div>
            <button class="add-step" @click="addStep">＋ 步骤</button>
          </div>
        </div>
        <div v-if="!loading && !steps.length" class="empty">暂无步骤——点击「＋ 步骤」开始编排</div>
      </div>
    </a-spin>

    <!-- 抽屉：两态（任务总览 / 单动作） -->
    <a-drawer :open="drawerOpen" :width="520" @close="closeDrawer" :title="drawerMode === 'action' ? `${curTask?.name ?? ''} · ${curAction?.name ?? ''}` : `任务 · ${curTask?.name ?? ''}`">
      <!-- 单动作态：只展示当前动作（删除在画布，切换靠重新点画布） -->
      <template v-if="drawerMode === 'action' && curAction">
        <div class="field-note">
          任务 {{ curTask?.name }} 的单个动作 —— 动作一律 shell 脚本；删除动作在画布动作卡上操作。
        </div>
        <div class="field"><label>动作名</label><a-input v-model:value="curAction.name" /></div>
        <div class="field">
          <label>脚本</label>
          <a-textarea v-model:value="curAction.script" :rows="12" spellcheck="false" class="mono" />
        </div>
      </template>
      <!-- 任务总览态 -->
      <template v-else-if="curTask">
        <a-tabs v-model:activeKey="drawerTab">
          <a-tab-pane key="task" tab="任务">
            <div class="field"><label>任务名</label><a-input v-model:value="curTask.name" /></div>
            <template v-if="curTask.kind === 'script'">
              <div class="field">
                <label>动作（按顺序执行，点击进入单个动作）</label>
                <div v-for="(a, ai) in curTask.actions ?? []" :key="ai" class="act-row" @click="curAction = a; drawerMode = 'action'">
                  <span class="atag">脚本</span>
                  <span class="aname">{{ a.name }}</span>
                  <span class="go">编辑</span>
                </div>
                <a-button size="small" @click="addAction(curTask)">＋ 添加动作</a-button>
              </div>
            </template>
            <template v-else>
              <div class="field"><label>审批人</label><a-select mode="tags" v-model:value="(curTask.approval ??= { approvers: [] }).approvers" placeholder="输入审批人（回车确认）" /></div>
              <div class="field"><label>拒绝时</label><a-radio-group v-model:value="(curTask.approval ??= { approvers: [] }).onReject" :defaultValue="'fail'"><a-radio value="fail">失败</a-radio><a-radio value="skip">跳过</a-radio></a-radio-group></div>
            </template>
          </a-tab-pane>
          <a-tab-pane v-if="curTask.kind === 'script'" key="adv" tab="高级">
            <div class="field-note">条件满足 → 执行该任务；不满足 → 跳过（日志留痕）。多选一（如发布：本机/远程）用互斥条件，不提供默认兜底——全不命中该步骤失败。</div>
            <div class="field"><label>执行条件</label><a-input v-model:value="curTask.condition" placeholder="如 DEPLOY_ENV == local（空 = 恒执行）" class="mono" /></div>
            <div class="field-note small">语法：KEY == 值 / KEY != 值，多条件 &amp;&amp;；变量：DEPLOY_ENV / MODULE_KEY / MODULE_TYPE / BRANCH / COMMIT_ID 及流水线变量。</div>
          </a-tab-pane>
          <a-tab-pane v-if="curTask.kind === 'script'" key="env" tab="环境变量">
            <div class="field-note">
              <b>任务级环境变量</b>：只在执行<b>该任务的动作</b>时注入，<b>优先级最高</b>——
              可覆盖配置中心 / 流水线变量 / 内置同名键。脚本里 <code>${'{KEY}'}</code> 引用。
            </div>
            <div v-for="(v, k) in curTask.env ?? {}" :key="k" class="env-row">
              <a-input
                :value="envKeyDrafts[k] ?? k"
                class="mono"
                size="small"
                placeholder="KEY"
                style="width: 38%;"
                @change="(e: any) => (envKeyDrafts[k] = e.target.value)"
                @blur="commitEnvKey(curTask, k)"
                @press-enter="commitEnvKey(curTask, k)"
              />
              <a-input v-model:value="curTask.env![k]" class="mono" size="small" placeholder="值" style="flex: 1;" />
              <a style="color: var(--ws-error-500); font-size: 12px;" @click="removeEnvKey(curTask, k)">删除</a>
            </div>
            <a-button size="small" @click="addEnvKey(curTask)">＋ 添加变量</a-button>
          </a-tab-pane>
        </a-tabs>
      </template>
    </a-drawer>
  </div>
</template>

<style scoped>
.orch-editor { display: flex; flex-direction: column; gap: 10px; }
.orch-head { display: flex; align-items: center; gap: 8px; }
.orch-head .hint { font-size: 12px; color: var(--ws-text-secondary); }
.spacer { flex: 1; }

.orch-canvas { border: 1px solid var(--ws-border); border-radius: var(--r-card); padding: 8px 16px 16px; background: var(--ws-bg-surface); overflow-x: auto; }
.canvas-body { position: relative; width: max-content; min-width: 100%; }
.wires { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; }
.pipeline { display: flex; align-items: flex-start; gap: 72px; padding: 14px 20px; }
.step-col { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }

/* 步骤标题（上行，互不连线） */
.step-title { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 14px; min-width: 130px;
  background: var(--ws-bg-surface); border: 1px solid var(--ws-border); border-radius: var(--r-card); cursor: pointer; }
.step-title:hover { border-color: var(--ws-brand-500); }
.step-title .nm { font-size: 13px; font-weight: 600; color: var(--ws-text-primary); }
.step-title .desc { font-size: 11px; color: var(--ws-text-tertiary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 任务与动作 */
.tasks { display: flex; flex-direction: column; width: 100%; gap: 6px; }
.task { display: flex; flex-direction: column; width: 100%; }
.task-node { position: relative; display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 12px;
  background: var(--ws-bg-surface); border: 1px solid var(--ws-border); border-radius: var(--r-card); cursor: pointer; white-space: nowrap; }
.task-node:hover { border-color: var(--ws-brand-500); }
.task-node .seq { align-self: stretch; display: flex; align-items: center; padding: 0 8px; margin: -6px 2px -6px -12px;
  font-family: var(--ws-font-mono, monospace); font-size: 13px; font-weight: 700; color: var(--ws-text-secondary);
  background: var(--ws-bg-surface); border-right: 1px solid var(--ws-border); border-radius: var(--r-chip) 0 0 var(--r-chip); }
.task-node .tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: var(--r-chip); border: 1px solid var(--ws-border);
  color: var(--ws-text-secondary); background: var(--ws-bg-surface); }
.task-node.approval .tag { color: var(--ws-success-500); border-color: var(--ws-success-500); }
.task-node .ifb { font-size: 9px; font-weight: 700; color: #fff; background: var(--ws-brand-500); padding: 1px 5px; border-radius: var(--r-chip); font-family: var(--ws-font-mono, monospace); }
.task-node .tname { font-size: 13px; font-weight: 600; color: var(--ws-text-primary); }
.task-node .del, .act-node .del { position: absolute; width: 18px; height: 18px; border-radius: 50%;
  background: var(--ws-bg-surface); border: 1px solid var(--ws-border); color: var(--ws-text-tertiary); cursor: pointer;
  display: none; align-items: center; justify-content: center; font-size: 11px; line-height: 1; padding: 0; z-index: 2; }
/* 任务卡删除：右上角**外侧**（.task-node 无 overflow 裁剪，外凸点击区更好按） */
.task-node .del { top: -8px; right: -8px; }
/* 动作行删除：**行内**右侧垂直居中。
   ⚠️ 2026-09-21 用户反馈「action 这里的删除 icon 被遮挡了」：动作行容器 .task-acts 为共享
   边框组设了 overflow:hidden，沿用外侧写法（top:-8px;right:-8px）越界 8px 会被直接裁掉。
   改行内定位后不再越界；行内已用 padding-right 预留按钮位（见 .act-node）。 */
.act-node .del { top: 50%; right: 4px; transform: translateY(-50%); }
.task-node:hover .del, .act-node:hover .del { display: flex; }
.task-node .del:hover, .act-node .del:hover { background: var(--ws-error-500); border-color: var(--ws-error-500); color: #fff; }
.act-node .del:disabled { cursor: not-allowed; opacity: .4; }

/* 动作块：紧贴任务头（共享边框组，圆角 2px） */
.task-acts { border: 1px solid var(--ws-border); border-radius: var(--r-card); overflow: hidden; margin-top: -1px; background: var(--ws-bg-surface); }
.act-node { position: relative; display: flex; align-items: center; gap: 6px; padding: 4px 26px 4px 9px; cursor: pointer; white-space: nowrap; width: 100%;
  border-bottom: 1px solid var(--ws-border); }
.act-node:last-child { border-bottom: none; }
.act-node:hover { background: var(--ws-bg-surface); }
.act-node .atag { font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: var(--r-chip); color: var(--ws-brand-500);
  background: var(--ws-bg-surface); border: 1px solid var(--ws-border); flex-shrink: 0; }
/* flex:1 + min-width:0：超长动作名在预留的按钮位前正确省略（否则会顶到删除按钮下面） */
.act-node .aname { flex: 1; min-width: 0; font-size: 11px; color: var(--ws-text-secondary); font-family: var(--ws-font-mono, monospace); overflow: hidden; text-overflow: ellipsis; }

.add-task { align-self: flex-start; font-size: 12px; color: var(--ws-text-tertiary); background: none; border: 1px dashed var(--ws-border);
  border-radius: var(--r-control); padding: 3px 10px; cursor: pointer; }
.add-task:hover { color: var(--ws-brand-500); border-color: var(--ws-brand-500); }
/* 与第一个任务同行：顶部对齐 + 下移到任务行中线（步骤标题高 ~42px + 间距） */
.add-step { flex-shrink: 0; align-self: flex-start; margin-top: 50px; font-size: 13px; font-weight: 600;
  color: var(--ws-text-tertiary); background: var(--ws-bg-surface); border: 1.5px dashed var(--ws-border);
  border-radius: var(--r-control); padding: 10px 18px; cursor: pointer; transition: color .15s, border-color .15s; }
.add-step:hover { color: var(--ws-brand-500); border-color: var(--ws-brand-500); }

.empty { padding: 40px; text-align: center; color: var(--ws-text-tertiary); font-size: 13px; }

/* 抽屉字段 */
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 13px; color: var(--ws-text-secondary); margin-bottom: 6px; font-weight: 600; }
.field-note { font-size: 12px; color: var(--ws-text-secondary); background: var(--ws-bg-surface); border-radius: var(--r-card); padding: 10px 12px; line-height: 1.8; margin-bottom: 12px; }
.field-note.small { background: none; padding: 0 0 6px; }
.mono { font-family: var(--ws-font-mono, monospace); }
.act-row { display: flex; align-items: center; gap: 8px; border: 1px solid var(--ws-border); border-radius: var(--r-card); padding: 7px 10px; margin-bottom: 8px; cursor: pointer; }
.act-row:hover { border-color: var(--ws-brand-500); }
.act-row .go { margin-left: auto; font-size: 12px; color: var(--ws-brand-500); }
.env-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.env-row .k { font-size: 12px; color: var(--ws-text-primary); }
.env-row a { font-size: 12px; color: var(--ws-error-500); }
</style>

<!-- 非 scoped：连线中点＋号是命令式创建的元素，吃不到 scoped data-v 属性 -->
<style>
.orch-canvas .wire-plus { position: absolute; width: 20px; height: 20px; border-radius: 50%;
  border: 1.5px dashed var(--ws-brand-500); color: var(--ws-brand-500); background: var(--ws-bg-surface);
  display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
  transform: translate(-50%, -50%); z-index: 3; font-size: 12px; }
.orch-canvas .wire-plus:hover { border-style: solid; background: var(--ws-brand-500); color: #fff; }
</style>
