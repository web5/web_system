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
import { formatTime, isLive, stepLabelOf, stageKeys, stepState } from '@/components/pipeline/pipeline.stages'
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
const exitOpen = ref(false)
const exiting = ref(false)
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

const versionLine = computed(() => {
  const s = snapshot.value
  if (!s) return '-'
  return s.versionTag || s.gitCommit || s.gitBranch || '-'
})

const triggerLine = computed(() => {
  const s = snapshot.value
  if (!s) return '-'
  const who = s.operatorName || s.operator || '-'
  return s.triggerSource ? `${who} · ${s.triggerSource}` : who
})

/** 桌面出口：模板 id + 运行 id，缺模板 id 就回落列表页（历史运行可能没有） */
const consoleLink = computed(() => {
  const s = snapshot.value
  if (!s?.templateId) return '/console/pipelines'
  return `/console/pipelines/${s.templateId}?run=${encodeURIComponent(s.runId)}`
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
 * 桌面出口：换 30 分钟平台会话后跳 SPA。
 * 🔴 这是**提权**动作，必须先过确认层；换不到就直跳，由控制台自己走登录。
 */
async function openDesktop(): Promise<void> {
  if (exiting.value) return
  exiting.value = true
  try {
    const res = await request<{ token: string; user: { username: string; role: string } }>(
      `/approvals/${encodeURIComponent(approvalId.value)}/session`,
      { method: 'POST' },
    )
    // 与 pinia-plugin-persistedstate 契约一致：key = store id `auth`
    localStorage.setItem('auth', JSON.stringify({ token: res.token, user: res.user }))
  } catch {
    // 静默：换不到交给控制台登录流程
  } finally {
    exiting.value = false
  }
  window.location.href = consoleLink.value
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
    <div class="topbar">企业微信 · 发布结果</div>

    <div v-if="loading" class="center muted">正在读取发布结果…</div>

    <div v-else-if="errorState" class="sheet">
      <div class="cold-icon">!</div>
      <h1>{{ errorState.title }}</h1>
      <p class="cold-text">{{ errorState.message }}</p>
      <p class="cold-tip">审批结果不受影响。发布是否生效请看流水线最终状态，不要以本页空白为准。</p>
      <a class="link" :href="consoleLink">去桌面控制台查看</a>
    </div>

    <template v-else-if="snapshot">
      <div class="body">
        <div class="head" :class="statusTone">
          <div class="mark">{{ statusTone === 'ok' ? '✓' : statusTone === 'bad' ? '×' : '●' }}</div>
          <div>
            <h1>{{ statusText }}</h1>
            <p class="sub">{{ snapshot.moduleKey }} · {{ snapshot.env.toUpperCase() }} · {{ snapshot.mode }}</p>
          </div>
          <span v-if="refreshing" class="refreshing">刷新中</span>
        </div>

        <p v-if="snapshot.live" class="live-tip">
          流水线仍在运行，本页每 5 秒自动刷新。可以直接关掉，稍后再从审批单进来查看。
        </p>

        <div class="card">
          <h4>关键信息</h4>
          <div class="kv"><span class="k">运行</span><span class="v mono">#{{ snapshot.runId }}</span></div>
          <div class="kv"><span class="k">版本</span><span class="v mono">{{ versionLine }}</span></div>
          <div class="kv"><span class="k">分支</span><span class="v mono">{{ snapshot.gitBranch || '-' }}</span></div>
          <div class="kv long"><span class="k">触发</span><span class="v">{{ triggerLine }}</span></div>
          <div class="kv"><span class="k">开始</span><span class="v">{{ formatTime(snapshot.startTime) }}</span></div>
          <div class="kv"><span class="k">结束</span><span class="v">{{ snapshot.endTime ? formatTime(snapshot.endTime) : '进行中' }}</span></div>
          <div class="kv"><span class="k">耗时</span><span class="v">{{ duration }}</span></div>
        </div>

        <div v-if="snapshot.errorBrief" class="card fail">
          <h4>失败原因</h4>
          <p class="err">{{ snapshot.errorBrief }}</p>
          <p class="hint">完整日志请到桌面控制台查看（手机端不展示日志正文）。</p>
        </div>

        <div class="card">
          <h4>节点进度</h4>
          <ul class="steps">
            <li v-for="row in stageRows" :key="row.key">
              <span class="dot" :class="row.state">
                {{ row.state === 'done' ? '✓' : row.state === 'error' ? '×' : row.state === 'running' ? '●' : '○' }}
              </span>
              <span :class="['label', row.state]">{{ row.label }}</span>
              <span class="state-text">{{
                row.state === 'done' ? '已完成' : row.state === 'error' ? '失败' : row.state === 'running' ? '进行中' : '未开始'
              }}</span>
            </li>
          </ul>
          <p v-if="snapshot.nodeLabel" class="hint">本次审批节点：{{ snapshot.nodeLabel }}</p>
        </div>

        <p class="disclaimer">
          审批通过不等于发布成功。本页展示的是流水线的真实执行状态。
        </p>
      </div>

      <div class="footer">
        <button class="btn ghost" @click="backToApproval">返回审批单</button>
        <button class="btn secondary" @click="exitOpen = true">桌面控制台</button>
      </div>

      <!-- 桌面出口确认层：把「授权面扩大」显式化 -->
      <div v-if="exitOpen" class="overlay" @click.self="exitOpen = false">
        <div class="drawer">
          <h2>打开桌面控制台？</h2>
          <p class="hint">
            桌面控制台用于看完整日志、重跑、回滚、改配置。进入需要一次临时授权：
            <b>30 分钟内拥有后台操作权限</b>，到期自动失效。
          </p>
          <p class="hint">只是想确认发布结果的话，本页已经够了，可以不用进。</p>
          <div class="drawer-actions">
            <button class="btn ghost" @click="exitOpen = false">留在本页</button>
            <button class="btn primary" :disabled="exiting" @click="openDesktop">
              {{ exiting ? '正在打开…' : '确认进入' }}
            </button>
          </div>
        </div>
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
.body{flex:1 1 auto;padding:16px 14px 96px;overflow-y:auto}
.center{padding:60px 20px;text-align:center}
.muted{color:#6B7280;font-size:14px}

.head{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.mark{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:23px;font-weight:700;flex:0 0 44px}
.head.ok .mark{background:#F0FDF4;color:#16A34A}
.head.bad .mark{background:#FEF2F2;color:#DC2626}
.head.run .mark{background:#FFF7ED;color:#D97706}
.head.idle .mark{background:#F3F4F6;color:#6B7280}
.head h1{font-size:20px;margin:0 0 4px;letter-spacing:-.01em}
.head .sub{font-size:12.5px;color:#6B7280;margin:0}
.refreshing{font-size:11px;color:#9CA3AF;margin-left:auto}
.live-tip{font-size:12px;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;
  border-radius:8px;padding:9px 10px;line-height:1.6;margin:10px 0 12px}

.card{background:#FFFFFF;border:1px solid rgba(0,0,0,.08);border-radius:12px;
  box-shadow:0 1px 3px rgba(0,0,0,.06);padding:12px 13px;margin-bottom:10px}
.card h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;font-weight:600;margin:0 0 8px}
.kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:6px 0}
.kv+.kv{border-top:1px dashed #F0F0F2}
.kv .k{color:#6B7280;flex:0 0 auto}
.kv .v{text-align:right;font-weight:550;word-break:break-all}
/* 触发来源可能是 `admin · ui|mcp:xxx` 这类长串，右对齐换行会贴到标签上，故单独放开 */
.kv.long .v{text-align:left;font-size:12px;line-height:1.5;overflow-wrap:anywhere;word-break:normal}
.v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}

.card.fail{border-color:#FECACA;background:#FFFBFB}
.card.fail h4{color:#B91C1C}
.card.fail .err{font-size:13px;color:#7F1D1D;line-height:1.65;margin:0 0 8px;word-break:break-word}
.hint{font-size:11.5px;color:#6B7280;line-height:1.6;margin:8px 0 0}

.steps{list-style:none;padding:0;margin:0;font-size:13px}
.steps li{display:flex;gap:8px;align-items:center;padding:6px 0;color:#6B7280}
.steps li+li{border-top:1px dashed #F0F0F2}
.steps .dot{width:16px;flex:0 0 16px;text-align:center;font-weight:700}
.steps .dot.done{color:#16A34A}
.steps .dot.error{color:#DC2626}
.steps .dot.running{color:#D97706}
.steps .dot.pending{color:#D1D5DB}
.steps .label{flex:1;color:#1A1A1F}
.steps .label.pending{color:#9CA3AF}
.state-text{font-size:11.5px;color:#9CA3AF}

.disclaimer{font-size:11.5px;color:#9CA3AF;line-height:1.6;margin:14px 2px 0}

.footer{position:fixed;left:0;right:0;bottom:0;background:#FFFFFF;border-top:1px solid rgba(0,0,0,.08);
  padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;z-index:2}
.btn{flex:1;border-radius:10px;padding:12px;font-size:14px;font-weight:600;border:1px solid transparent;
  cursor:pointer;font-family:inherit}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.ghost{background:#FFFFFF;border-color:rgba(0,0,0,.12);color:#1A1A1F}
.btn.secondary{background:#F0FDFA;border-color:#99F6E4;color:#0F766E}
.btn.primary{background:#F97316;color:#FFFFFF}

.overlay{position:fixed;inset:0;background:rgba(17,17,20,.42);z-index:5;display:flex;align-items:flex-end}
.drawer{background:#FFFFFF;width:100%;border-radius:18px 18px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom))}
.drawer h2{font-size:17px;margin:0 0 8px}
.hint{font-size:12.5px;color:#6B7280;line-height:1.65;margin-bottom:14px}
.drawer-actions{display:flex;gap:10px;margin-top:8px}

.sheet{margin:32px 16px;background:#FFFFFF;border:1px solid rgba(0,0,0,.08);
  box-shadow:0 1px 3px rgba(0,0,0,.06);border-radius:16px;padding:28px 20px}
.sheet h1{font-size:20px;margin:0 0 12px;color:#B91C1C}
.cold-icon{width:38px;height:38px;border-radius:50%;background:#FEF2F2;color:#B91C1C;
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px;margin-bottom:16px}
.cold-text{font-size:14px;line-height:1.7;color:#6B7280;margin-bottom:16px}
.cold-tip{border-top:1px solid rgba(0,0,0,.06);padding-top:14px;font-size:12.5px;line-height:1.7;color:#1A1A1F}
.link{display:inline-block;margin-top:18px;font-size:13px;color:#0F766E;text-decoration:none;font-weight:600}
</style>
