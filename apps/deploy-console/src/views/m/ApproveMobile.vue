<script setup lang="ts">
/**
 * 企微移动端发布审批 H5（卡② T2-e）。
 *
 * 逐屏对齐已通过原型 `02-交互原型稿-企微移动端审批.html`（Design: pass）：
 *  S1 详情（首屏不滚动看到环境/模块/版本/提交人）、S2 prod 二次确认、
 *  S3 驳回意见必填、S4 结果态（审批结果 ≠ 发布结果）、S5 冷提示。
 *
 * 🔴 刻意做死、不得优化掉的四件事：
 *  1. prod 不允许一键通过（确认层 + 输入「确认」+ 后端 confirm=true）；
 *  2. 驳回空意见禁用提交（后端同样 400，前端不算安全边界）；
 *  3. 结果态区分「审批结果」与「发布结果」；
 *  4. 任何错误态不给「可能已生效」的模糊表述。
 *
 * 短令牌只存 sessionStorage，不落 localStorage；从 URL 读入后立即清理。
 * （唯一写 localStorage 的是「票据换来的平台会话」，键名 `auth`，与 pinia 持久化契约一致。）
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

interface Detail {
  approvalId: string
  status: string
  env: string
  moduleKey: string
  mode: string
  versionTag?: string
  gitBranch?: string
  commitId?: string
  operator: string
  /** 提交人用户名：后端由 operator(id) 反查；查不到时为 undefined，回落显示 operator */
  operatorName?: string
  /** bigint 列 → 序列化成字符串，故两种类型都要容忍 */
  createdAt: number | string
  nodeLabel?: string
  pipelineId: string
  pipelineStatus: string
  /** 所属流水线模板 id —— 控制台详情页要的是模板 id，不是运行实例 id */
  templateId?: string
  reviewer?: string
  reviewedAt?: number | string
  requiresConfirm: boolean
  recentNodes: Array<{ key: string; label: string; result: string }>
}

interface Decision {
  approvalId: string
  status: 'approved' | 'rejected'
  pipelineStatus: string
  message: string
}

const API_BASE = '/console/api/wecom'
const route = useRoute()
const approvalId = computed(() => String(route.params.id || ''))
const ticket = ref('')
const screen = ref<'loading' | 'detail' | 'confirm' | 'reject' | 'result' | 'error'>('loading')
const detail = ref<Detail | null>(null)
const result = ref<Decision | null>(null)
const busy = ref(false)
const errorState = reactive({ title: '无法打开', message: '' })
const confirmText = ref('')
const rejectComment = ref('')
const presetReasons = ['分支不对', '版本不对', '时机不对', '其他']

const isProd = computed(() => detail.value?.env === 'prod')
const versionLine = computed(() => {
  const d = detail.value
  if (!d) return '-'
  return d.versionTag || d.commitId || d.gitBranch || '-'
})
const submittedAt = computed(() => {
  // createdAt 是 bigint（毫秒）列，JSON 序列化后是字符串；
  // 直接 new Date('1793951145341') 在 Chrome 里得 Invalid Date，必须先转数字。
  const raw = detail.value?.createdAt
  const ms = typeof raw === 'string' ? Number(raw) : raw
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '-'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
})
/**
 * 控制台链接拼装规则（踩过的坑，别再改回去）：
 * `/console/pipelines/:id` 的 `:id` 是**流水线模板 id**，而审批单存的是**运行实例 id**（runId）。
 * 直接用 runId 拼 → 模板查不到 → 详情页 `router.replace('/pipelines')`，手机点进去只能看到列表。
 * 正确形态：`/console/pipelines/<templateId>?run=<runId>`，详情页按 `route.query.run` 选中那次运行。
 */
const consoleLink = computed(() => {
  const tplId = detail.value?.templateId
  const runId = detail.value?.pipelineId
  if (!tplId) return '/console/pipelines'
  return `/console/pipelines/${tplId}${runId ? `?run=${encodeURIComponent(runId)}` : ''}`
})

/**
 * S4 主出口：走**移动端**「发布结果」页（S5），**不换会话**。
 *
 * 这是 14 号方案的核心改动：看一眼发布结果不该需要后台权限。
 * 票据直接带过去（sessionStorage 已有），凭据不出审批域。
 *
 * 两个调用点：
 *  - 结果态主按钮「查看发布结果」——审批后确认成没成
 *  - **详情态「查看完整流程」**——审批**前**看后面还有几步，避免盲批
 */
function goRun(): void {
  window.location.href = `/console/m/approve/${encodeURIComponent(approvalId.value)}/run`
}

/**
 * 桌面出口：换 30 分钟平台会话后跳 SPA。
 *
 * 🔴 这是**提权**动作（授权面从「这一单」扩到「全站」），故必须先过确认层。
 * 换不到（票据过期 / 本单 3 次已用尽 / 通道关闭）就直跳 —— 落登录页，但不是死链。
 * 次数上限是「每单 3 次」（后端 `wecom_session_count < 3`），前端不做预算，失败静默降级。
 */
const desktopOpen = ref(false)
const consoleBusy = ref(false)
async function openDesktop(): Promise<void> {
  if (consoleBusy.value) return
  consoleBusy.value = true
  try {
    const res = await request<{ token: string; user: { username: string; role: string } }>(
      `/approvals/${encodeURIComponent(approvalId.value)}/session`,
      { method: 'POST' },
    )
    // 与 pinia-plugin-persistedstate 契约一致：key = store id `auth`，值 = JSON.stringify(state)
    localStorage.setItem('auth', JSON.stringify({ token: res.token, user: res.user }))
  } catch {
    // 静默：换不到就交给控制台自己的登录流程，不在这里弹错
  } finally {
    consoleBusy.value = false
  }
  window.location.href = consoleLink.value
}

function fail(title: string, message: string): void {
  errorState.title = title
  errorState.message = message
  screen.value = 'error'
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
    const msg = body?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body.data
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
    // 票据不留在地址栏（避免 referrer / 截图泄漏）
    window.history.replaceState({}, '', window.location.pathname)
  }
  try {
    detail.value = await request<Detail>(`/approvals/${encodeURIComponent(approvalId.value)}`)
    if (detail.value.status !== 'pending') {
      result.value = {
        approvalId: detail.value.approvalId,
        status: detail.value.status === 'approved' ? 'approved' : 'rejected',
        pipelineStatus: detail.value.pipelineStatus,
        message: `已由 ${detail.value.reviewer || '他人'} 处理，本次未做任何变更`,
      }
      screen.value = 'result'
      return
    }
    screen.value = 'detail'
  } catch (e) {
    const msg = (e as Error).message || ''
    if (/过期|票据|401/.test(msg)) fail('链接已过期', '请从企业微信重新进入，或到发布控制台处理。')
    else fail('无访问权限', `${msg}。本次操作未生效，审批单仍为待处理。`)
  }
})

function openApprove(): void {
  if (!detail.value) return
  if (isProd.value) {
    confirmText.value = ''
    screen.value = 'confirm'
  } else {
    void submit('approve', { confirm: true })
  }
}

async function submit(action: 'approve' | 'reject', body: Record<string, unknown>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    result.value = await request<Decision>(
      `/approvals/${encodeURIComponent(approvalId.value)}/${action}`,
      { method: 'POST', body: JSON.stringify(body) },
    )
    screen.value = 'result'
  } catch (e) {
    const msg = (e as Error).message || ''
    if (/已处理|409|冲突/.test(msg)) {
      fail('审批单已处理', `${msg}。本次操作未生效，请刷新或到控制台查看结果。`)
    } else {
      fail('提交失败', `${msg}。审批结果未确认，请到发布控制台核对后再操作。`)
    }
  } finally {
    busy.value = false
  }
}

function confirmProd(): void {
  if (confirmText.value.trim() !== '确认') return
  void submit('approve', { confirm: true })
}

function submitReject(): void {
  const comment = rejectComment.value.trim()
  if (!comment) return
  void submit('reject', { comment })
}

function useReason(reason: string): void {
  rejectComment.value = reason === '其他' ? '' : reason
}

function backToDetail(): void {
  screen.value = 'detail'
  confirmText.value = ''
  rejectComment.value = ''
}
</script>

<template>
  <div class="page">
    <div class="topbar">企业微信 · 发布审批</div>

    <!-- 加载 -->
    <div v-if="screen === 'loading'" class="center muted">正在验证身份…</div>

    <!-- S5 冷提示 -->
    <div v-else-if="screen === 'error'" class="sheet">
      <div class="cold-icon">!</div>
      <h1>{{ errorState.title }}</h1>
      <p class="cold-text">{{ errorState.message }}</p>
      <p class="cold-tip">本次操作未生效，审批单仍为待处理。请从企业微信重新进入，或到发布控制台处理。</p>
      <a class="link" :href="consoleLink">去发布控制台处理</a>
    </div>

    <!-- S4 结果态 -->
    <div v-else-if="screen === 'result' && result" class="sheet">
      <div class="result-mark" :class="result.status">{{ result.status === 'approved' ? '✓' : '×' }}</div>
      <h1>{{ result.status === 'approved' ? '已通过，发布继续' : '已驳回' }}</h1>
      <p class="cold-text">{{ result.message }}</p>
      <div class="card">
        <div class="kv"><span class="k">审批单</span><span class="v mono">{{ result.approvalId }}</span></div>
        <div class="kv"><span class="k">流水线状态</span><span class="v">{{ result.pipelineStatus }}</span></div>
      </div>
      <p class="cold-tip">审批通过不等于发布成功。发布结果请看流水线的真实执行状态，不要以本页绿灯为准。</p>
      <div class="result-actions">
        <button class="btn primary" @click="goRun">查看发布结果</button>
        <button class="btn ghost" @click="desktopOpen = true">桌面控制台</button>
      </div>
      <p class="tiny-tip">「桌面控制台」用于看完整日志、重跑、回滚，进入需一次 30 分钟临时授权。</p>

      <!-- 桌面出口确认层：把「授权面扩大」显式化，不让它藏在一次点击里 -->
      <div v-if="desktopOpen" class="overlay" @click.self="desktopOpen = false">
        <div class="drawer">
          <h2>打开桌面控制台？</h2>
          <p class="hint">
            进入后可看完整日志、执行重跑 / 回滚 / 改配置。为此会给你的账号
            <b>30 分钟后台操作权限</b>，到期自动失效。
          </p>
          <p class="hint">如果只是想确认这次发布成没成，用「查看发布结果」就够了。</p>
          <div class="drawer-actions">
            <button class="btn ghost" @click="desktopOpen = false">留在本页</button>
            <button class="btn primary" :disabled="consoleBusy" @click="openDesktop">
              {{ consoleBusy ? '正在打开…' : '确认进入' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- S1 详情 + S2 确认层 + S3 驳回抽屉 -->
    <template v-else-if="detail">
      <div class="body">
        <span class="pill">● 等待你确认 · 流水线已挂起</span>
        <h1 class="hero">{{ detail.moduleKey }} 发布到 {{ detail.env }}</h1>
        <p class="hero-sub">
          流水线在「{{ detail.nodeLabel || '发布确认' }}」节点暂停，通过后从该节点之后继续，已完成节点不重跑。
        </p>

        <div class="envrow">
          <span class="tag" :class="isProd ? 'prod' : 'dev'">{{ isProd ? 'PROD 生产' : detail.env.toUpperCase() }}</span>
          <span class="tag mode">{{ detail.mode }}</span>
        </div>

        <!-- 首屏四项判断依据，不滚动即可看全 -->
        <div class="card">
          <h4>判断依据</h4>
          <div class="kv"><span class="k">环境</span><span class="v">{{ detail.env }}</span></div>
          <div class="kv"><span class="k">模块</span><span class="v">{{ detail.moduleKey }}</span></div>
          <div class="kv"><span class="k">版本</span><span class="v mono">{{ versionLine }}</span></div>
          <div class="kv"><span class="k">提交人</span><span class="v">{{ detail.operatorName || detail.operator }}</span></div>
          <div class="kv"><span class="k">提交时间</span><span class="v">{{ submittedAt }}</span></div>
          <div class="kv"><span class="k">分支</span><span class="v mono">{{ detail.gitBranch || '-' }}</span></div>
        </div>

        <div class="card">
          <h4>最近节点</h4>
          <ul class="steps">
            <li v-for="n in detail.recentNodes" :key="n.key">
              <span class="dot ok">✓</span><span>{{ n.label }} · {{ n.result }}</span>
            </li>
            <li><span class="dot now">●</span><span class="now">{{ detail.nodeLabel || '发布确认' }} · 等待你确认 ← 当前</span></li>
          </ul>
          <!-- 🔴 审批前也要能看流程全景：「最近节点」只给了前半段，批准后还有几步不知道 ——
               没有这个入口，审批人只能盲批（11-06 真机三单里两次直接驳回就是这么来的）。
               跳 S5 复用同一张票据（sessionStorage 已有），不扩权、不另签。 -->
          <button class="more" @click="goRun">查看完整流程 →</button>
        </div>
      </div>

      <div class="footer">
        <button class="btn ghost" :disabled="busy" @click="screen = 'reject'">驳回</button>
        <button class="btn primary" :disabled="busy" @click="openApprove">通过</button>
      </div>

      <!-- S2 prod 二次确认 -->
      <div v-if="screen === 'confirm'" class="overlay" @click.self="backToDetail">
        <div class="drawer">
          <h2>确认放行到生产环境？</h2>
          <p class="hint">这是对 <b>PROD</b> 的放行操作。通过后流水线立即从审批节点之后继续，不会再次询问。</p>
          <p class="hint">
            本次将把 <b>{{ detail?.moduleKey }}</b> 切到 <b>{{ versionLine }}</b>，影响<b>全部线上用户</b>。
            网关版本缓存约 10s 生效，回滚需再发一次。
          </p>
          <div class="risk">一键通过生产是设计缺陷：请输入「确认」以继续，后端同时要求 confirm=true。</div>
          <input v-model="confirmText" class="input" placeholder="输入「确认」" autocomplete="off" />
          <div class="drawer-actions">
            <button class="btn ghost" @click="backToDetail">取消</button>
            <button class="btn primary" :disabled="confirmText.trim() !== '确认' || busy" @click="confirmProd">确认通过</button>
          </div>
        </div>
      </div>

      <!-- S3 驳回（意见必填） -->
      <div v-if="screen === 'reject'" class="overlay" @click.self="backToDetail">
        <div class="drawer">
          <h2>驳回这次发布</h2>
          <p class="hint">意见会推给提交人并写进审计日志。驳回后流水线终止，后续节点不执行。</p>
          <div class="presets">
            <button v-for="r in presetReasons" :key="r" class="chip" @click="useReason(r)">{{ r }}</button>
          </div>
          <textarea v-model="rejectComment" class="input area" placeholder="请填写驳回意见（必填）"></textarea>
          <div class="risk">驳回后不会自动回滚。若线上指针已被改动，需要另行发起回滚。</div>
          <div class="drawer-actions">
            <button class="btn ghost" @click="backToDetail">取消</button>
            <button class="btn danger" :disabled="!rejectComment.trim() || busy" @click="submitReject">确认驳回</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
:root { --bg:#FFFFFF; --card:#FFFFFF; --line:rgba(0,0,0,.08); --text:#1A1A1F;
  --text-2:#6B7280; --text-3:#9CA3AF; --brand:#F97316; --accent:#0EA5A4;
  --danger:#DC2626; --warn:#D97706; --ok:#16A34A; --shadow:0 1px 3px rgba(0,0,0,.06); }
*{box-sizing:border-box}
.page{min-height:100vh;background:#F7F7F9;color:#1A1A1F;display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif}
.topbar{background:#FFFFFF;border-bottom:1px solid rgba(0,0,0,.08);padding:11px 16px;
  font-size:13px;font-weight:600;text-align:center;flex:0 0 auto}
.body{flex:1 1 auto;padding:16px 14px 96px;overflow-y:auto}
.center{padding:60px 20px;text-align:center}
.muted{color:#6B7280;font-size:14px}
.pill{display:inline-flex;align-items:center;gap:6px;background:#FFF7ED;color:#B45309;
  border:1px solid #FED7AA;border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:600}
.hero{font-size:20px;font-weight:650;margin:12px 0 6px;letter-spacing:-.01em}
.hero-sub{font-size:12.5px;color:#6B7280;line-height:1.65}
.envrow{display:flex;gap:8px;margin:14px 0 12px}
.tag{font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;border:1px solid transparent}
.tag.prod{background:#FEF2F2;color:#B91C1C;border-color:#FECACA}
.tag.dev{background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE}
.tag.mode{background:#F0FDFA;color:#0F766E;border-color:#99F6E4}
.card{background:#FFFFFF;border:1px solid rgba(0,0,0,.08);border-radius:12px;
  box-shadow:0 1px 3px rgba(0,0,0,.06);padding:12px 13px;margin-bottom:10px}
.card h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;font-weight:600;margin-bottom:8px}
.kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:6px 0}
.kv+.kv{border-top:1px dashed #F0F0F2}
.kv .k{color:#6B7280;flex:0 0 auto}
.kv .v{text-align:right;font-weight:550;word-break:break-all}
.v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.steps{list-style:none;font-size:12.5px}
.steps li{display:flex;gap:8px;align-items:flex-start;padding:4px 0;color:#6B7280}
.steps .dot{width:14px;flex:0 0 14px;text-align:center;font-weight:700}
.steps .dot.ok{color:#16A34A}
.steps .dot.now,.steps .now{color:#D97706}
/* 详情态的流程全景入口：整行可点，用分隔线与节点列表区分，不与「驳回/通过」争视觉权重 */
.more{display:flex;align-items:center;width:100%;min-height:44px;margin:8px 0 -6px;padding:0;
  border:none;border-top:1px solid rgba(0,0,0,.06);background:none;text-align:left;
  font-family:inherit;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer}
.more:active{color:#0B5C55}
.footer{position:fixed;left:0;right:0;bottom:0;background:#FFFFFF;border-top:1px solid rgba(0,0,0,.08);
  padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;z-index:2}
.btn{flex:1;border-radius:10px;padding:12px;font-size:14px;font-weight:600;border:1px solid transparent;
  cursor:pointer;font-family:inherit}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.ghost{background:#FFFFFF;border-color:rgba(0,0,0,.12);color:#1A1A1F}
.btn.primary{background:#F97316;color:#FFFFFF}
.btn.danger{background:#DC2626;color:#FFFFFF}
.overlay{position:fixed;inset:0;background:rgba(17,17,20,.42);z-index:5;display:flex;align-items:flex-end}
.drawer{background:#FFFFFF;width:100%;border-radius:18px 18px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom))}
.drawer h2{font-size:17px;margin:0 0 8px}
.hint{font-size:12.5px;color:#6B7280;line-height:1.65;margin-bottom:14px}
.risk{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;border-radius:8px;
  padding:9px 10px;font-size:12px;line-height:1.6;margin:12px 0}
.input{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:11px 12px;
  font-size:14px;font-family:inherit;color:#1A1A1F;background:#FFFFFF}
.input.area{min-height:84px;resize:vertical}
.presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.chip{background:#F3F4F6;border:1px solid rgba(0,0,0,.06);border-radius:999px;
  padding:6px 12px;font-size:12px;color:#374151;cursor:pointer;font-family:inherit}
.drawer-actions{display:flex;gap:10px;margin-top:16px}
.sheet{margin:32px 16px;background:#FFFFFF;border:1px solid rgba(0,0,0,.08);
  box-shadow:0 1px 3px rgba(0,0,0,.06);border-radius:16px;padding:28px 20px}
.sheet h1{font-size:20px;margin:0 0 12px;color:#B91C1C}
.cold-icon{width:38px;height:38px;border-radius:50%;background:#FEF2F2;color:#B91C1C;
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px;margin-bottom:16px}
.result-mark{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:23px;font-weight:700;margin-bottom:16px}
.result-mark.approved{background:#F0FDF4;color:#16A34A}
.result-mark.rejected{background:#FEF2F2;color:#DC2626}
.cold-text{font-size:14px;line-height:1.7;color:#6B7280;margin-bottom:16px}
.cold-tip{border-top:1px solid rgba(0,0,0,.06);padding-top:14px;font-size:12.5px;line-height:1.7;color:#1A1A1F}
.link{display:inline-block;margin-top:18px;font-size:13px;color:#0F766E;text-decoration:none;font-weight:600}
.result-actions{display:flex;gap:10px;margin-top:18px}
.result-actions .btn{flex:1}
.tiny-tip{font-size:11.5px;color:#9CA3AF;line-height:1.6;margin:10px 0 0}
</style>
