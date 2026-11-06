<script setup lang="ts">
/**
 * 企微移动端「发布结果」只读页（S5，14 号方案 L1 闭环）。
 *
 * 🔴 **为什么这页存在**：
 * S4 结果态之后，审批人真正要判断的是「这次发布到底成没成」。
 * 让一个**只读**动作去换 30 分钟后台会话（旧方案 C）等于为看一眼结果交一次权限。
 * 这页用**同一张审批票据**回答同一个问题 —— 凭据不出审批域。
 *
 * 🔴 **刻意不做的事**：
 *  - 不给日志正文（含内部路径与环境变量，卡② 脱敏边界）
 *  - 不做重跑 / 回滚 / 改配置（高风险操作要在宽屏完整上下文里做）
 *  这些留在「在桌面控制台打开」这条显式出口后面。
 *
 * 🔴 **状态推导复用 `pipeline.stages.ts`**：节点状态由 `stepState` 算，后端只给原始
 * status/stage/nodes。后端不复制一份展示状态机，否则桌面和手机两套判定必然漂移。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { isLive, stepLabelOf, stageKeys, stepState } from '@/components/pipeline/pipeline.stages'
import type { PipelineItem, TemplateNode } from '@/api'

interface StageDto {
  key: string
  label?: string
  kind?: string
}

interface Snapshot {
  runId: string
  approvalId: string
  templateId?: string
  templateName?: string
  env: string
  moduleKey: string
  mode: string
  status: string
  stage?: string
  stages: StageDto[]
  progress?: { current: number; total: number; message?: string }
  versionTag?: string
  gitBranch?: string
  gitCommit?: string
  triggerSource?: string
  operator: string
  operatorName?: string
  /** bigint 列 → 可能是字符串 */
  startTime: number | string
  endTime?: number | string
  errorBrief?: string
  nodeLabel?: string
  live: boolean
}

const API_BASE = '/console/api/wecom'
const POLL_MS = 5000
/** 手机端不做无限轮询：最多 60 次（5 分钟），超时提示手动刷新 */
const MAX_POLLS = 60

const route = useRoute()
const approvalId = computed(() => String(route.params.id || ''))
const ticket = ref('')
const snapshot = ref<Snapshot | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const errorState = ref<{ title: string; message: string } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
let polls = 0

/**
 * 把快照包成 `PipelineItem` 形状，纯粹为了复用 `stepState` / `stepLabelOf`。
 * 这里不伪造业务字段：nodes 只承载 key/label/kind，status/stage 全部来自后端真实值。
 */
const shaped = computed<PipelineItem | null>(() => {
  const s = snapshot.value
  if (!s) return null
  const nodes = s.stages.map(
    (x) => ({ kind: x.kind === 'approval' ? 'approval' : 'script', key: x.key, label: x.label || x.key }) as TemplateNode,
  )
  return {
    id: s.runId,
    env: s.env,
    moduleKey: s.moduleKey,
    mode: s.mode,
    status: s.status as PipelineItem['status'],
    stage: s.stage,
    nodes: nodes.length ? nodes : null,
    steps: null,
    startTime: Number(s.startTime) || 0,
    endTime: s.endTime === undefined ? undefined : Number(s.endTime),
  } as PipelineItem
})

const stageRows = computed(() => {
  const p = shaped.value
  const s = snapshot.value
  if (!p || !s) return []
  return stageKeys(p).map((key) => ({
    key,
    label: stepLabelOf(p, key),
    state: stepState(p, key),
  }))
})

const statusText = computed(() => {
  const map: Record<string, string> = {
    pending: '排队中',
    'pending-approval': '待审批',
    'awaiting-approval': '等待审批',
    running: '发布中',
    succeeded: '发布成功',
    failed: '发布失败',
    cancelled: '已取消',
  }
  const s = snapshot.value?.status || ''
  return map[s] || s || '-'
})

const statusTone = computed<'ok' | 'bad' | 'run' | 'idle'>(() => {
  const s = snapshot.value?.status
  if (s === 'succeeded') return 'ok'
  if (s === 'failed' || s === 'cancelled') return 'bad'
  if (s === 'running' || s === 'pending') return 'run'
  return 'idle'
})

function stateText(state: string): string {
  const map: Record<string, string> = {
    done: '已完成',
    error: '失败',
    running: '进行中',
    pending: '未开始',
  }
  return map[state] || state
}

const duration = computed(() => {
  const s = snapshot.value
  if (!s) return '-'
  const start = Number(s.startTime) || 0
  if (!start) return '-'
  const end = s.endTime === undefined ? Date.now() : Number(s.endTime) || Date.now()
  const ms = Math.max(0, end - start)
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  if (min < 60) return `${min} 分 ${rest} 秒`
  return `${Math.floor(min / 60)} 时 ${min % 60} 分`
})

function fail(title: string, message: string): void {
  errorState.value = { title, message }
  loading.value = false
  stopPolling()
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ticket.value}`,
      ...(init.headers || {}),
    },
  })
  const body = (await res.json().catch(() => null)) as
    | { code: number; data?: T; message?: string }
    | null
  if (!res.ok || !body || body.code !== 0 || !body.data) {
    throw new Error(body?.message || `HTTP ${res.status}`)
  }
  return body.data
}

async function load(silent = false): Promise<void> {
  if (silent) refreshing.value = true
  try {
    snapshot.value = await request<Snapshot>(`/approvals/${encodeURIComponent(approvalId.value)}/run`)
    errorState.value = null
    // 终态就停轮询，别让手机白耗电
    if (!snapshot.value.live) stopPolling()
  } catch (e) {
    const msg = (e as Error).message || ''
    if (silent) return // 轮询失败不打断当前画面，下一轮再试
    if (/过期|票据|401/.test(msg)) {
      fail('链接已过期', '请从企业微信重新进入审批单，再点「查看发布结果」。')
    } else {
      fail('无法读取发布结果', `${msg}。可以到桌面控制台查看完整流水线。`)
    }
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function startPolling(): void {
  stopPolling()
  timer = setInterval(() => {
    polls += 1
    if (polls > MAX_POLLS) {
      stopPolling()
      return
    }
    void load(true)
  }, POLL_MS)
}

/**
 * 手动刷新：终态后轮询已停，用户想再看一眼时用；也让「自动刷新」失灵时有个兜底。
 */
async function manualRefresh(): Promise<void> {
  if (refreshing.value) return
  await load(true)
  // 上一轮已停（终态或超限），手动刷新相当于重新开始观察
  if (!snapshot.value || snapshot.value.live) startPolling()
}

function backToApproval(): void {
  window.location.href = `/console/m/approve/${encodeURIComponent(approvalId.value)}`
}

onMounted(async () => {
  const fromQuery = typeof route.query.ticket === 'string' ? route.query.ticket : ''
  const stored = sessionStorage.getItem(`wecom-approve-ticket:${approvalId.value}`) || ''
  ticket.value = fromQuery || stored
  if (!ticket.value) {
    fail('链接已失效', '缺少审批票据，请从企业微信重新进入。')
    return
  }
  sessionStorage.setItem(`wecom-approve-ticket:${approvalId.value}`, ticket.value)
  if (fromQuery) {
    // 票据不留在地址栏
    window.history.replaceState({}, '', window.location.pathname)
  }
  await load()
  if (snapshot.value?.live || isLive(shaped.value)) startPolling()
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="page">
    <!-- 顶栏用中性说法「发布流程」：本页有两个入口 —— 审批前看全景、审批后看结果 -->
    <div class="topbar">企业微信 · 发布流程</div>

    <div v-if="loading" class="center muted">正在读取发布结果…</div>

    <div v-else-if="errorState" class="sheet">
      <div class="cold-icon">!</div>
      <h1>{{ errorState.title }}</h1>
      <p class="cold-text">{{ errorState.message }}</p>
      <p class="cold-tip">审批结果不受影响。发布是否生效以流水线最终状态为准。</p>
      <button class="btn ghost wide" @click="backToApproval">返回审批单</button>
    </div>

    <template v-else-if="snapshot">
      <!-- 操作区在顶部：流程往下读，读到底不用再回头找按钮 -->
      <div class="actions">
        <button class="act" @click="backToApproval">← 返回审批单</button>
        <button class="act" :disabled="refreshing" @click="manualRefresh">
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
      </div>

      <div class="body">
        <div class="head" :class="statusTone">
          <div class="mark">{{ statusTone === 'ok' ? '✓' : statusTone === 'bad' ? '×' : '●' }}</div>
          <div class="head-text">
            <h1>{{ statusText }}</h1>
            <p class="sub">
              {{ snapshot.moduleKey }} · {{ snapshot.env.toUpperCase() }} · 用时 {{ duration }}
            </p>
          </div>
        </div>

        <p v-if="snapshot.live" class="live-tip">
          流水线仍在运行，本页每 5 秒自动刷新。可以直接关掉，稍后再从审批单进来查看。
        </p>

        <div v-if="snapshot.errorBrief" class="card fail">
          <h4>失败原因</h4>
          <p class="err">{{ snapshot.errorBrief }}</p>
        </div>

        <div class="card flow">
          <h4>流程</h4>
          <!-- 竖向时间轴：节点多、名字长都只是往下延伸，不会横向挤压 -->
          <ol class="timeline">
            <li v-for="row in stageRows" :key="row.key" :class="row.state">
              <span class="node">{{
                row.state === 'done' ? '✓' : row.state === 'error' ? '×' : row.state === 'running' ? '●' : ''
              }}</span>
              <div class="node-text">
                <div class="name">{{ row.label }}</div>
                <div class="state">{{ stateText(row.state) }}</div>
              </div>
            </li>
          </ol>
          <p v-if="snapshot.nodeLabel" class="hint">本次审批节点：{{ snapshot.nodeLabel }}</p>
        </div>

        <p class="disclaimer">审批通过不等于发布成功。本页展示的是流水线的真实执行状态。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
*{box-sizing:border-box}
.page{min-height:100vh;background:#F7F7F9;color:#1A1A1F;display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif}
.topbar{background:#FFFFFF;border-bottom:1px solid rgba(0,0,0,.08);padding:11px 16px;
  font-size:13px;font-weight:600;text-align:center;flex:0 0 auto}
.body{flex:1 1 auto;padding:14px 14px 28px;overflow-y:auto}
.center{padding:60px 20px;text-align:center}
.muted{color:#6B7280;font-size:14px}

/* 操作区在顶部：与流程分离，流程再长也不用滚到底找按钮 */
.actions{display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:8px 12px;background:#FFFFFF;border-bottom:1px solid rgba(0,0,0,.08);flex:0 0 auto}
.act{background:none;border:none;padding:7px 4px;font-size:13px;font-weight:600;color:#0F766E;
  font-family:inherit;cursor:pointer}
.act:disabled{color:#9CA3AF;cursor:default}

.head{display:flex;align-items:center;gap:12px;margin:4px 2px 10px}
.mark{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:22px;font-weight:700;flex:0 0 42px}
.head.ok .mark{background:#F0FDF4;color:#16A34A}
.head.bad .mark{background:#FEF2F2;color:#DC2626}
.head.run .mark{background:#FFF7ED;color:#D97706}
.head.idle .mark{background:#F3F4F6;color:#6B7280}
.head-text{min-width:0}
.head h1{font-size:20px;margin:0 0 3px;letter-spacing:-.01em}
.head .sub{font-size:12.5px;color:#6B7280;margin:0;line-height:1.5;word-break:break-word}
.live-tip{font-size:12px;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;
  border-radius:8px;padding:9px 10px;line-height:1.6;margin:0 0 10px}

.card{background:#FFFFFF;border:1px solid rgba(0,0,0,.08);border-radius:12px;
  box-shadow:0 1px 3px rgba(0,0,0,.06);padding:12px 13px;margin-bottom:10px}
.card h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;font-weight:600;margin:0 0 10px}
/* 流程卡整体居中：标题、时间轴、审批节点提示同一基准，避免三种对齐混排 */
.card.flow h4,.card.flow .hint{text-align:center}

.card.fail{border-color:#FECACA;background:#FFFBFB}
.card.fail h4{color:#B91C1C}
.card.fail .err{font-size:13px;color:#7F1D1D;line-height:1.65;margin:0;word-break:break-word}
.hint{font-size:11.5px;color:#6B7280;line-height:1.6;margin:10px 0 0}

/* 竖向时间轴：一行一个节点，节点名与状态分两行，流程再长也只往下延伸。
   🔴 整块贴合内容宽度后水平居中：节点名普遍偏短，满宽会把右侧空出一大片，
   看起来像"贴在左边"；宽度取 max-content + max-width:100% 兜底，长名换行时自然回落满宽。 */
.timeline{list-style:none;margin:0 auto;padding:0;width:max-content;max-width:100%}
.timeline li{position:relative;padding:0 0 20px 32px}
.timeline li:last-child{padding-bottom:0}
.timeline li::before{content:'';position:absolute;left:9px;top:22px;bottom:0;width:2px;background:#E8E8EC}
.timeline li:last-child::before{content:none}
.node{position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
  border:2px solid #D1D5DB;background:#FFFFFF;color:#9CA3AF}
.timeline li.done .node{border-color:#16A34A;background:#16A34A;color:#FFFFFF}
.timeline li.error .node{border-color:#DC2626;background:#DC2626;color:#FFFFFF}
.timeline li.running .node{border-color:#D97706;background:#FFF7ED;color:#D97706;
  animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.node-text{min-width:0}
.name{font-size:14px;font-weight:600;color:#1A1A1F;line-height:1.45;word-break:break-word}
.state{font-size:11.5px;color:#6B7280;margin-top:2px;line-height:1.4}
.timeline li.running .state{color:#B45309;font-weight:600}
.timeline li.error .state{color:#DC2626;font-weight:600}
.timeline li.pending .name{color:#6B7280;font-weight:500}

.disclaimer{font-size:11.5px;color:#6B7280;line-height:1.6;margin:12px 2px 0}

.btn{border-radius:10px;padding:12px 16px;font-size:14px;font-weight:600;border:1px solid transparent;
  cursor:pointer;font-family:inherit}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.ghost{background:#FFFFFF;border-color:rgba(0,0,0,.12);color:#1A1A1F}
.btn.wide{display:block;width:100%;margin-top:18px}

.sheet{margin:32px 16px;background:#FFFFFF;border:1px solid rgba(0,0,0,.08);
  box-shadow:0 1px 3px rgba(0,0,0,.06);border-radius:16px;padding:28px 20px}
.sheet h1{font-size:20px;margin:0 0 12px;color:#B91C1C}
.cold-icon{width:38px;height:38px;border-radius:50%;background:#FEF2F2;color:#B91C1C;
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px;margin-bottom:16px}
.cold-text{font-size:14px;line-height:1.7;color:#6B7280;margin-bottom:16px}
.cold-tip{border-top:1px solid rgba(0,0,0,.06);padding-top:14px;font-size:12.5px;line-height:1.7;color:#1A1A1F}
</style>
