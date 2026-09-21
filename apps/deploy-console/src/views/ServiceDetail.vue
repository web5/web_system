<script setup lang="ts">
/**
 * 服务详情（API 网关域）
 *
 * Tab：**接口（默认）** / 概览 / 网关路由 / 环境 / 部署
 * - 接口：方法 + 路径级治理元数据（鉴权 / 权限码 / 限流 / 来源），改动**不影响转发行为**
 * - 网关路由：转发规则（前缀 / 剥离 / 重写 / 超时 / 优先级），环境级覆盖 + 前缀包含告警
 * - 环境：各环境运行时与目标主机（**只读**；编辑入口在「环境管理 → 环境详情」）
 * 设计依据：specs/deploy-console-domain-split/page-spec.md §4 / design.md v2 §2.3
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import {
  servicesApi,
  deployApi,
  pipelineRunsApi,
  type ServiceRow,
  type ServiceRouteRow,
  type EndpointRow,
  type ServiceEnvRow,
  type EndpointMethod,
  type EndpointAuthMode,
  type RouteAuthMode,
} from '@/api'

const route = useRoute()
const router = useRouter()
const svcKey = computed(() => String(route.params.key || ''))

const activeTab = ref('endpoints')
const loading = ref(false)
const service = ref<ServiceRow | null>(null)

const METHOD_FILTERS = ['all', 'GET', 'POST', 'PUT', 'DELETE', 'ALL'] as const
const METHOD_OPTIONS: EndpointMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL']
const AUTH_OPTIONS: EndpointAuthMode[] = ['inherit', 'passthrough', 'jwt', 'service_key', 'none']
const ROUTE_AUTH_OPTIONS: RouteAuthMode[] = ['passthrough', 'service_key', 'jwt']

// ---------- 接口 ----------
const endpoints = ref<EndpointRow[]>([])
const epTotal = ref(0)
const epPage = ref(1)
const EP_PAGE_SIZE = 100
const epKeyword = ref('')
const epMethod = ref<string>('all')

const epColumns: TableColumnsType = [
  { title: '方法', key: 'method', width: 90 },
  { title: '路径模式', key: 'pathPattern' },
  { title: '摘要', key: 'summary', width: 170 },
  { title: '鉴权模式', key: 'authMode', width: 110 },
  { title: '权限码', key: 'permissionCode', width: 170 },
  { title: '限流', key: 'rateLimitPerMin', width: 80, align: 'right' },
  { title: '来源', key: 'source', width: 90 },
  { title: '启用', key: 'enabled', width: 70 },
  { title: '操作', key: 'action', width: 100 },
]

async function loadEndpoints() {
  try {
    const res = await servicesApi.endpoints(svcKey.value, {
      method: epMethod.value === 'all' ? undefined : epMethod.value,
      q: epKeyword.value.trim() || undefined,
      page: epPage.value,
      pageSize: EP_PAGE_SIZE,
    })
    endpoints.value = res.items
    epTotal.value = res.total
  } catch (e: any) {
    message.error(e?.response?.data?.message || '接口清单加载失败')
  }
}

function reloadEndpointsFromFirstPage() {
  epPage.value = 1
  loadEndpoints()
}

// 新增 / 编辑接口
const epFormOpen = ref(false)
const epSaving = ref(false)
const epEditingId = ref<string | null>(null)
const epForm = reactive({
  method: 'GET' as EndpointMethod,
  pathPattern: '',
  code: '',
  summary: '',
  authMode: 'inherit' as EndpointAuthMode,
  permissionCode: '',
  rateLimitPerMin: undefined as number | undefined,
  deprecated: false,
  enabled: true,
})

function openCreateEndpoint() {
  epEditingId.value = null
  Object.assign(epForm, {
    method: 'GET',
    pathPattern: '',
    code: '',
    summary: '',
    authMode: 'inherit',
    permissionCode: '',
    rateLimitPerMin: undefined,
    deprecated: false,
    enabled: true,
  })
  epFormOpen.value = true
}

function openEditEndpoint(row: EndpointRow) {
  epEditingId.value = row.id
  Object.assign(epForm, {
    method: row.method,
    pathPattern: row.pathPattern,
    code: row.code || '',
    summary: row.summary || '',
    authMode: row.authMode,
    permissionCode: row.permissionCode || '',
    rateLimitPerMin: row.rateLimitPerMin ?? undefined,
    deprecated: row.deprecated,
    enabled: row.enabled,
  })
  epFormOpen.value = true
}

async function submitEndpoint() {
  if (!epForm.pathPattern.trim().startsWith('/')) {
    message.error('接口路径必须以 / 开头')
    return
  }
  epSaving.value = true
  const payload = {
    method: epForm.method,
    pathPattern: epForm.pathPattern.trim(),
    code: epForm.code.trim() || undefined,
    summary: epForm.summary.trim() || undefined,
    authMode: epForm.authMode,
    permissionCode: epForm.permissionCode.trim() || undefined,
    rateLimitPerMin: epForm.rateLimitPerMin,
    deprecated: epForm.deprecated,
    enabled: epForm.enabled,
  }
  try {
    if (epEditingId.value) {
      await servicesApi.updateEndpoint(svcKey.value, epEditingId.value, payload)
      message.success('接口已更新（source 标记为 manual）')
    } else {
      await servicesApi.createEndpoint(svcKey.value, payload)
      message.success('接口已新增')
    }
    epFormOpen.value = false
    await loadEndpoints()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    epSaving.value = false
  }
}

function removeEndpoint(row: EndpointRow) {
  Modal.confirm({
    title: '删除接口',
    content: `删除后不再登记 ${row.method} ${row.pathPattern}（不影响转发规则）。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await servicesApi.removeEndpoint(svcKey.value, row.id)
        message.success('已删除')
        await loadEndpoints()
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

async function toggleEndpoint(row: EndpointRow, checked: boolean) {
  try {
    await servicesApi.updateEndpoint(svcKey.value, row.id, { method: row.method, pathPattern: row.pathPattern, enabled: checked })
    row.enabled = checked
    message.success(checked ? '已启用' : '已停用')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '更新失败')
  }
}

/** 批量导入：粘贴 JSON 数组（或 OpenAPI 精简项） */
const importOpen = ref(false)
const importSaving = ref(false)
const importText = ref('')
const importSource = ref<'openapi' | 'scan' | 'manual'>('openapi')

function openImport() {
  importText.value = '[\n  { "method": "GET", "pathPattern": "/api/xxx", "summary": "示例" }\n]'
  importOpen.value = true
}

async function submitImport() {
  let items: Record<string, unknown>[]
  try {
    const parsed = JSON.parse(importText.value)
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    message.error('JSON 解析失败，请检查格式')
    return
  }
  if (!items.length) {
    message.warning('没有可导入的条目')
    return
  }
  importSaving.value = true
  try {
    const res = await servicesApi.importEndpoints(svcKey.value, {
      source: importSource.value,
      items,
    })
    importOpen.value = false
    Modal.info({
      title: '导入完成',
      content: `共 ${res.total} 条：新增 ${res.created} / 补空 ${res.filled} / 跳过 ${res.skipped}。已存在的非空字段不会被覆盖。`,
      okText: '知道了',
    })
    await loadEndpoints()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '导入失败')
  } finally {
    importSaving.value = false
  }
}

// ---------- 网关路由 ----------
const routes = ref<ServiceRouteRow[]>([])
const routeColumns: TableColumnsType = [
  { title: '环境', key: 'envId', width: 110 },
  { title: '路径前缀', key: 'pathPrefix', width: 170 },
  { title: '剥离', key: 'stripPrefix', width: 110 },
  { title: '重写到', key: 'rewriteTo', width: 110 },
  { title: '上游覆盖', key: 'upstreamOverride' },
  { title: '超时(ms)', key: 'timeoutMs', width: 100, align: 'right' },
  { title: '鉴权', key: 'authMode', width: 110 },
  { title: '优先级', key: 'priority', width: 90, align: 'right' },
  { title: '启用', key: 'enabled', width: 70 },
  { title: '操作', key: 'action', width: 100 },
]

/** 前缀包含关系（客户端展示告警；服务端在写入时也会返回 warnings） */
const prefixOverlaps = computed(() => {
  const rows = routes.value.filter((r) => r.enabled)
  const pairs: { a: string; b: string; relation: string }[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      if (a.envId !== b.envId) continue
      if (a.pathPrefix.startsWith(b.pathPrefix)) {
        pairs.push({ a: a.pathPrefix, b: b.pathPrefix, relation: `${b.pathPrefix} 更宽` })
      } else if (b.pathPrefix.startsWith(a.pathPrefix)) {
        pairs.push({ a: a.pathPrefix, b: b.pathPrefix, relation: `${a.pathPrefix} 更宽` })
      }
    }
  }
  return pairs
})

async function loadRoutes() {
  try {
    // 默认展示「全环境」规则；环境级规则可切换查看
    routes.value = await servicesApi.routes(svcKey.value, routeEnvFilter.value || undefined)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '转发规则加载失败')
  }
}

const routeEnvFilter = ref<string>('')

const routeFormOpen = ref(false)
const routeSaving = ref(false)
const routeEditingId = ref<string | null>(null)
const routeForm = reactive({
  envId: '' as string,
  pathPrefix: '',
  stripPrefix: '',
  rewriteTo: '',
  upstreamOverride: '',
  timeoutMs: 30000,
  authMode: 'passthrough' as RouteAuthMode,
  priority: 0,
  enabled: true,
})

function openCreateRoute() {
  routeEditingId.value = null
  Object.assign(routeForm, {
    envId: '',
    pathPrefix: '',
    stripPrefix: '',
    rewriteTo: '',
    upstreamOverride: '',
    timeoutMs: 30000,
    authMode: 'passthrough',
    priority: 0,
    enabled: true,
  })
  routeFormOpen.value = true
}

function openEditRoute(row: ServiceRouteRow) {
  routeEditingId.value = row.id
  Object.assign(routeForm, {
    envId: row.envId || '',
    pathPrefix: row.pathPrefix,
    stripPrefix: row.stripPrefix || '',
    rewriteTo: row.rewriteTo || '',
    upstreamOverride: row.upstreamOverride || '',
    timeoutMs: row.timeoutMs,
    authMode: row.authMode,
    priority: row.priority,
    enabled: row.enabled,
  })
  routeFormOpen.value = true
}

async function submitRoute() {
  if (!routeForm.pathPrefix.trim().startsWith('/')) {
    message.error('路径前缀必须以 / 开头')
    return
  }
  routeSaving.value = true
  const payload = {
    envId: routeForm.envId || undefined,
    pathPrefix: routeForm.pathPrefix.trim(),
    stripPrefix: routeForm.stripPrefix.trim() || undefined,
    rewriteTo: routeForm.rewriteTo.trim() || undefined,
    upstreamOverride: routeForm.upstreamOverride.trim() || undefined,
    timeoutMs: routeForm.timeoutMs,
    authMode: routeForm.authMode,
    priority: routeForm.priority,
    enabled: routeForm.enabled,
  }
  try {
    const res = routeEditingId.value
      ? await servicesApi.updateRoute(svcKey.value, routeEditingId.value, payload)
      : await servicesApi.createRoute(svcKey.value, payload)
    routeFormOpen.value = false
    if (res.warnings?.length) {
      Modal.warning({
        title: '已保存，但存在前缀包含关系',
        content: `与 ${res.warnings.map((w) => w.pathPrefix).join('、')} 存在包含关系：按优先级数值小者优先匹配，请确认优先级设置。`,
        okText: '知道了',
      })
    } else {
      message.success('已保存（网关缓存 ≤60s 内生效）')
    }
    await loadRoutes()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    routeSaving.value = false
  }
}

function removeRoute(row: ServiceRouteRow) {
  Modal.confirm({
    title: '删除转发规则',
    content: `删除后 ${row.pathPrefix} 不再由本服务转发（网关缓存 ≤60s 内生效）。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await servicesApi.removeRoute(svcKey.value, row.id)
        message.success('已删除')
        await loadRoutes()
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

async function toggleRoute(row: ServiceRouteRow, checked: boolean) {
  try {
    await servicesApi.updateRoute(svcKey.value, row.id, { pathPrefix: row.pathPrefix, enabled: checked })
    row.enabled = checked
    message.success(checked ? '已启用' : '已停用')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '更新失败')
  }
}

// ---------- 环境（只读） ----------
const svcEnvs = ref<ServiceEnvRow[]>([])
const envColumns: TableColumnsType = [
  { title: '环境', key: 'envId', width: 150 },
  { title: '运行时', key: 'runtime', width: 100 },
  { title: '目标主机', key: 'hostName', width: 160 },
  { title: '端口', key: 'port', width: 90, align: 'right' },
  { title: '副本', key: 'replicas', width: 70, align: 'right' },
  { title: '上游覆盖', key: 'upstreamUrl' },
  { title: '状态', key: 'status', width: 110 },
  { title: '操作', key: 'action', width: 100 },
]

async function loadEnvs() {
  try {
    const res = await servicesApi.envs(svcKey.value)
    svcEnvs.value = res.items
  } catch (e: any) {
    message.error(e?.response?.data?.message || '环境信息加载失败')
  }
}

/** 跳到「环境详情 → 后端服务指向」并高亮本服务（编辑入口唯一，本页只读） */
function gotoEnvConfig(envId: string) {
  router.push({
    name: 'EnvironmentDetail',
    params: { envId },
    query: { tab: 'backend', service: svcKey.value },
  })
}

const probing = ref<string | null>(null)
/** 正在部署的环境（同一时间只允许一个部署在跑） */
const deploying = ref<string | null>(null)
async function probe(envId: string) {
  probing.value = envId
  try {
    const res = await servicesApi.health(svcKey.value, envId)
    if (res.ok) {
      message.success(`${envId} 健康（${res.status}，${res.latencyMs}ms）→ ${res.target}`)
    } else {
      message.error(`${envId} 探活失败：${res.error || `HTTP ${res.status}`}（${res.target}）`)
    }
  } catch (e: any) {
    message.error(e?.response?.data?.message || '探活失败')
  } finally {
    probing.value = null
  }
}

// ---------- 构建发布（流水线）vs 部署（重启 + 探活）----------

/**
 * **构建发布 = 走流水线**：拉码 → 构建 → 上传产物（**不动进程**）。
 * 产物上传后仍需在本页执行「部署」，新代码才会生效。
 */
function publish(envId?: string) {
  if (service.value?.deployChannel === 'legacy') {
    message.warning('该服务走传统发布通道（legacy），不由流水线托管')
    return
  }
  router.push({ name: 'PipelineCenter', query: { module: svcKey.value, env: envId || 'dev' } })
}

/**
 * **部署 = 重启 + 探活**（不重新构建）：
 * 让该环境已上传的产物真正生效。探活失败即判失败；远程主机若不在本机 pm2 纳管，
 * 服务端会返回明确原因（不会「点了没反应」）。
 */
/**
 * 部署 = 选版本 → 改指向（deployVersion：落 dist + 重启 + 写指针）→ 探活。
 * 版本列表 = 该模块在该环境的磁盘产物（流水线「构建发布」上传的），默认选中最新。
 * 用户 2026-09-21：部署时才修改指向，且部署时选择版本。
 */
const deployModal = ref(false)
const deployEnvId = ref('')
const deployVersionSel = ref<string | undefined>(undefined)
const deployVersions = ref<{ versionTag: string; commit?: string; note?: string }[]>([])

async function deploy(envId: string) {
  deployEnvId.value = envId
  deployVersions.value = []
  deployVersionSel.value = undefined
  deployModal.value = true
  try {
    deployVersions.value = await pipelineRunsApi.releases(envId, svcKey.value)
    deployVersionSel.value = deployVersions.value[0]?.versionTag
  } catch {
    deployVersions.value = []
  }
}

async function confirmDeploy() {
  if (!deployVersionSel.value) {
    message.warning('请选择要部署的版本')
    return
  }
  deploying.value = deployEnvId.value
  try {
    await deployApi.deployVersion(svcKey.value, deployEnvId.value, deployVersionSel.value)
    let health = '探活未执行'
    try {
      const res = await servicesApi.health(svcKey.value, deployEnvId.value)
      health = res.ok ? `探活通过（${res.latencyMs}ms）` : `探活失败：${res.error || res.status}`
    } catch {
      health = '探活请求失败'
    }
    message.success(`已部署并指向 ${deployVersionSel.value} → ${health}`)
    deployModal.value = false
    await loadEnvs()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '部署失败')
  } finally {
    deploying.value = null
  }
}

async function load() {
  loading.value = true
  try {
    service.value = await servicesApi.get(svcKey.value)
    await Promise.all([loadEndpoints(), loadRoutes(), loadEnvs()])
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载服务信息失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="svc-detail">
    <div class="crumb">
      <a @click="router.push({ name: 'ServiceManager' })">服务管理</a>
      <span class="sep">/</span>
      <span class="ws-mono">{{ svcKey }}</span>
    </div>

    <div class="page-head">
      <div>
        <h1>
          <span class="ws-mono">{{ svcKey }}</span>
          <a-tag class="kind-tag">{{ service?.kind || '—' }}</a-tag>
          <a-tag v-if="service?.deployChannel === 'legacy'" class="kind-tag">传统通道</a-tag>
        </h1>
        <p class="sub">
          {{ service?.name }} · <code>servers/{{ service?.repoDir }}</code> ·
          <code>{{ service?.healthPath }}</code>
        </p>
      </div>
      <a-button
        type="primary"
        :disabled="service?.deployChannel === 'legacy'"
        @click="publish()"
      >构建发布</a-button>
    </div>

    <a-card :bordered="false" class="panel">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 接口（默认） -->
        <a-tab-pane key="endpoints" tab="接口">
          <div class="bar">
            <a-radio-group
              v-model:value="epMethod"
              button-style="solid"
              size="small"
              @change="reloadEndpointsFromFirstPage"
            >
              <a-radio-button v-for="m in METHOD_FILTERS" :key="m" :value="m">
                {{ m === 'all' ? '全部' : m }}
              </a-radio-button>
            </a-radio-group>
            <a-input-search
              v-model:value="epKeyword"
              placeholder="搜索路径 / 摘要 / 业务码"
              style="width: 260px"
              allow-clear
              @search="reloadEndpointsFromFirstPage"
            />
            <span class="spacer" />
            <a-button size="small" @click="openImport">批量导入</a-button>
            <a-button size="small" type="primary" @click="openCreateEndpoint">新增接口</a-button>
          </div>

          <a-table
            :columns="epColumns"
            :data-source="endpoints"
            row-key="id"
            size="middle"
            :pagination="{ pageSize: EP_PAGE_SIZE, total: epTotal, showSizeChanger: false }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'method'">
                <a-tag>{{ record.method }}</a-tag>
              </template>
              <template v-else-if="column.key === 'pathPattern'">
                <span class="ws-mono">{{ record.pathPattern }}</span>
                <a-tag v-if="record.deprecated" class="tag-dep">已废弃</a-tag>
              </template>
              <template v-else-if="column.key === 'summary'">
                <span v-if="record.summary">{{ record.summary }}</span>
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'authMode'">
                <span class="muted">{{ record.authMode === 'inherit' ? '继承服务' : record.authMode }}</span>
              </template>
              <template v-else-if="column.key === 'permissionCode'">
                <span v-if="record.permissionCode" class="ws-mono">{{ record.permissionCode }}</span>
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'rateLimitPerMin'">
                <span v-if="record.rateLimitPerMin" class="ws-tabular">{{ record.rateLimitPerMin }}</span>
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'source'">
                <span class="muted">{{ record.source }}</span>
              </template>
              <template v-else-if="column.key === 'enabled'">
                <a-switch
                  :checked="record.enabled"
                  size="small"
                  @change="(v: any) => toggleEndpoint(record, !!v)"
                />
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="openEditEndpoint(record)">编辑</a>
                <a type="link" @click="removeEndpoint(record)">删除</a>
              </template>
            </template>
          </a-table>

          <p class="hint">
            此页只登记治理元数据（鉴权 / 权限码 / 限流 / 摘要），修改<b>不会</b>改变转发行为；
            导入按 <code>serviceKey + method + pathPattern</code> 幂等，<b>只补空字段、不覆盖人工配置</b>。
          </p>
        </a-tab-pane>

        <!-- 概览 -->
        <a-tab-pane key="overview" tab="概览">
          <a-descriptions :column="3" bordered size="small" class="desc">
            <a-descriptions-item label="key">
              <span class="ws-mono">{{ svcKey }}</span>
              <span class="tip">创建后不可修改</span>
            </a-descriptions-item>
            <a-descriptions-item label="名称">{{ service?.name || '—' }}</a-descriptions-item>
            <a-descriptions-item label="类型">{{ service?.kind || '—' }}</a-descriptions-item>
            <a-descriptions-item label="仓库目录">
              <span class="ws-mono">servers/{{ service?.repoDir || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="pm2 进程名">
              <span class="ws-mono">{{ service?.pm2Name || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="默认端口">
              <span class="ws-mono ws-tabular">{{ service?.defaultPort ?? '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="探活路径">
              <span class="ws-mono">{{ service?.healthPath }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="未登记接口">
              <a-tag :color="service?.unknownPolicy === 'deny' ? 'red' : undefined">
                {{ service?.unknownPolicy === 'deny' ? '拒绝' : '放行' }}
              </a-tag>
              <span class="tip">unknownPolicy = {{ service?.unknownPolicy }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="发布通道">
              {{ service?.deployChannel === 'legacy' ? '传统通道（legacy）' : '流水线托管（managed）' }}
            </a-descriptions-item>
          </a-descriptions>

          <div class="env-cards">
            <div v-for="e in svcEnvs" :key="e.envId" class="env-card">
              <div class="ec-head">
                <span class="ws-mono ec-env">{{ e.envId }}</span>
                <a-tag v-if="e.isProd" color="orange">生产</a-tag>
                <a-badge
                  v-if="e.configured"
                  status="processing"
                  text="已指向"
                />
                <a-badge v-else status="warning" text="未配置" />
              </div>
              <div class="ec-ver ws-mono">
                {{ e.upstreamUrl || (e.hostAddress ? `${e.hostAddress}:${e.port ?? '—'}` : '—') }}
              </div>
              <div class="ec-meta">{{ e.envName }} · {{ e.runtime || '继承运行时' }}</div>
              <a-button
                size="small"
                style="margin-top: 8px"
                :loading="probing === e.envId"
                @click="probe(e.envId)"
              >探活</a-button>
            </div>
          </div>
        </a-tab-pane>

        <!-- 网关路由 -->
        <a-tab-pane key="routes" tab="网关路由">
          <div class="bar">
            <span class="lbl">环境</span>
            <a-select v-model:value="routeEnvFilter" style="width: 180px" size="small" @change="loadRoutes">
              <a-select-option value="">全环境默认</a-select-option>
              <a-select-option v-for="e in svcEnvs" :key="e.envId" :value="e.envId">{{ e.envId }}</a-select-option>
            </a-select>
            <span class="spacer" />
            <a-button size="small" type="primary" @click="openCreateRoute">新增规则</a-button>
          </div>

          <a-alert
            v-if="prefixOverlaps.length"
            type="warning"
            show-icon
            style="margin-bottom: 12px"
          >
            <template #message>存在包含关系的前缀</template>
            <template #description>
              <span v-for="(p, i) in prefixOverlaps" :key="i" class="ws-mono">
                {{ p.a }} / {{ p.b }}（{{ p.relation }}）{{ i < prefixOverlaps.length - 1 ? '；' : '' }}
              </span>
              —— 按优先级数值小者优先匹配，请确认优先级设置。
            </template>
          </a-alert>

          <a-table
            :columns="routeColumns"
            :data-source="routes"
            row-key="id"
            size="middle"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'envId'">
                <a-tag v-if="record.envId">{{ record.envId }}</a-tag>
                <a-tag v-else>全环境</a-tag>
              </template>
              <template v-else-if="column.key === 'pathPrefix'">
                <span class="ws-mono">{{ record.pathPrefix }}</span>
              </template>
              <template v-else-if="column.key === 'stripPrefix'">
                <span class="ws-mono">{{ record.stripPrefix || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'rewriteTo'">
                <span class="ws-mono">{{ record.rewriteTo || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'upstreamOverride'">
                <span v-if="record.upstreamOverride" class="ws-mono">{{ record.upstreamOverride }}</span>
                <span v-else class="muted">按环境指向解析</span>
              </template>
              <template v-else-if="column.key === 'timeoutMs' || column.key === 'priority'">
                <span class="ws-tabular">{{ record[column.key as 'priority'] }}</span>
              </template>
              <template v-else-if="column.key === 'authMode'">
                <span class="muted">{{ record.authMode }}</span>
              </template>
              <template v-else-if="column.key === 'enabled'">
                <a-switch
                  :checked="record.enabled"
                  size="small"
                  @change="(v: any) => toggleRoute(record, !!v)"
                />
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="openEditRoute(record)">编辑</a>
                <a type="link" @click="removeRoute(record)">删除</a>
              </template>
            </template>
          </a-table>
          <p class="hint">禁用/修改后网关缓存（≤60s）内生效；未配置 <code>upstreamOverride</code> 时按该环境的指向解析上游。</p>
        </a-tab-pane>

        <!-- 环境 -->
        <a-tab-pane key="envs" tab="环境">
          <a-table
            :columns="envColumns"
            :data-source="svcEnvs"
            row-key="envId"
            size="middle"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'envId'">
                <span class="ws-mono">{{ record.envId }}</span>
                <span class="svc-name">{{ record.envName }}</span>
                <a-tag v-if="record.isProd" color="orange">生产</a-tag>
              </template>
              <template v-else-if="column.key === 'runtime'">
                <span class="muted">{{ record.runtime || '继承' }}</span>
              </template>
              <template v-else-if="column.key === 'hostName'">
                <div v-if="record.hostName">
                  <span class="ws-mono">{{ record.hostName }}</span>
                  <div class="sub-addr ws-mono">
                    {{ record.hostAddress || '未登记主机' }}:{{ record.port ?? '—' }}
                  </div>
                </div>
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'port'">
                <span v-if="record.port" class="ws-mono ws-tabular">{{ record.port }}</span>
                <span v-else class="muted">必填</span>
              </template>
              <template v-else-if="column.key === 'replicas'">
                <span class="ws-tabular">{{ record.replicas }}</span>
              </template>
              <template v-else-if="column.key === 'upstreamUrl'">
                <span v-if="record.upstreamUrl" class="ws-mono">{{ record.upstreamUrl }}</span>
                <span v-else class="muted">按主机+端口拼装</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <a-badge v-if="!record.configured" status="warning" text="未配置" />
                <a-badge v-else-if="record.status === 'active'" status="success" text="启用" />
                <a-badge v-else status="default" :text="record.status" />
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="gotoEnvConfig(record.envId)">配置指向</a>
                <a-divider type="vertical" />
                <a-tooltip
                  v-if="!record.configured"
                  title="未配置主机组或端口，探活与部署会 fail-fast（不回落本机）"
                >
                  <a type="link" class="link-disabled">探活</a>
                </a-tooltip>
                <a v-else type="link" @click="probe(record.envId)">探活</a>
              </template>
            </template>
          </a-table>
          <p class="hint">
            本页<b>只读</b>：各环境「指向」（主机组 / 端口 / 上游 / 运行时）统一在
            <a @click="router.push({ name: 'EnvironmentManager' })">环境管理 → 环境详情 → 后端服务指向</a>
            内维护（点行内「配置指向」直达该环境）；主机组名与地址在「基础设施 → 主机管理」登记。
          </p>
        </a-tab-pane>

        <!-- 部署 -->
        <a-tab-pane key="deploy" tab="部署">
          <a-table
            :columns="[
              { title: '环境', key: 'envId', width: 150 },
              { title: '目标', key: 'target' },
              { title: '运行时', key: 'runtime', width: 120 },
              { title: '状态', key: 'status', width: 130 },
              { title: '操作', key: 'action', width: 140 },
            ]"
            :data-source="svcEnvs"
            row-key="envId"
            size="middle"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'envId'">
                <span class="ws-mono">{{ record.envId }}</span>
              </template>
              <template v-else-if="column.key === 'target'">
                <span v-if="record.configured" class="ws-mono">
                  {{ record.upstreamUrl || `${record.hostAddress}:${record.port ?? '—'}` }}
                </span>
                <span v-else class="muted">未配置指向（部署会 fail-fast）</span>
              </template>
              <template v-else-if="column.key === 'runtime'">
                <span class="muted">{{ record.runtime || '继承' }}</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <a-badge v-if="!record.configured" status="warning" text="未配置" />
                <a-badge v-else status="default" text="待部署" />
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="publish(record.envId)">构建发布</a>
                <a-divider type="vertical" />
                <a
                  type="link"
                  :disabled="!record.configured || deploying !== null"
                  @click="deploy(record.envId)"
                >
                  {{ deploying === record.envId ? '部署中…' : '部署' }}
                </a>
                <!-- 部署 = 选版本 → 改指向（落 dist + 重启 + 写指针）→ 探活 -->
                <a-modal
                  v-model:open="deployModal"
                  :title="`部署 · ${deployEnvId}（选择版本并修改指向）`"
                  :confirm-loading="deploying !== null"
                  ok-text="部署（修改指向）"
                  @ok="confirmDeploy"
                >
                  <div v-if="!deployVersions.length" class="muted" style="padding: 8px 0;">
                    未取到该环境已上传的版本——先执行「构建发布」上传产物，再回来部署。
                  </div>
                  <template v-else>
                    <div style="margin-bottom: 8px;">
                      选择要部署的版本（默认最新上传）：
                    </div>
                    <a-radio-group v-model:value="deployVersionSel" style="display: block;">
                      <a-radio
                        v-for="v in deployVersions"
                        :key="v.versionTag"
                        :value="v.versionTag"
                        style="display: block; padding: 6px 0;"
                      >
                        <span class="ws-mono">{{ v.versionTag }}</span>
                        <span v-if="v.note" class="muted"> · {{ v.note }}</span>
                      </a-radio>
                    </a-radio-group>
                    <div class="muted" style="font-size: 12px;">
                      部署 = 把所选版本落地为当前运行版本（改指向）并重启进程，随后自动探活确认。
                    </div>
                  </template>
                </a-modal>
                <a-divider type="vertical" />
                <a type="link" @click="probe(record.envId)">探活</a>
              </template>
            </template>
          </a-table>
          <p class="hint">
            <b>构建发布走流水线</b>（拉码 → 构建 → 上传产物，<b>不动进程</b>），产物上传后<b>不会自动生效</b>；
            <b>部署是独立动作</b>（重启进程 + 探活），探活失败即判失败。<br />
            两者分离，是为了让「已上传但未重启」成为<b>可见的中间态</b>，而不是"以为发了其实还在跑旧代码"。
            服务侧<b>永不写应用侧版本指针</b>（那是微前端域的事）。
          </p>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 新增 / 编辑接口 -->
    <a-modal
      :open="epFormOpen"
      :title="epEditingId ? '编辑接口' : '新增接口'"
      :confirm-loading="epSaving"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitEndpoint"
      @cancel="epFormOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="方法" required>
          <a-select v-model:value="epForm.method">
            <a-select-option v-for="m in METHOD_OPTIONS" :key="m" :value="m">{{ m }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="路径模式" required>
          <a-input v-model:value="epForm.pathPattern" placeholder="如 /api/todo/:id" />
        </a-form-item>
        <a-form-item label="摘要">
          <a-input v-model:value="epForm.summary" placeholder="如 待办详情" />
        </a-form-item>
        <a-form-item label="鉴权模式">
          <a-select v-model:value="epForm.authMode">
            <a-select-option v-for="a in AUTH_OPTIONS" :key="a" :value="a">
              {{ a === 'inherit' ? 'inherit（继承服务默认）' : a }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="权限码">
          <a-input v-model:value="epForm.permissionCode" placeholder="如 todo:read" />
        </a-form-item>
        <a-form-item label="限流（次/分）">
          <a-input-number v-model:value="epForm.rateLimitPerMin" :min="0" style="width: 100%" />
        </a-form-item>
        <a-form-item label="状态">
          <a-checkbox v-model:checked="epForm.enabled">启用</a-checkbox>
          <a-checkbox v-model:checked="epForm.deprecated" style="margin-left: 16px">已废弃</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 批量导入 -->
    <a-modal
      :open="importOpen"
      title="批量导入接口"
      :confirm-loading="importSaving"
      ok-text="导入"
      cancel-text="取消"
      width="640px"
      @ok="submitImport"
      @cancel="importOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="来源">
          <a-select v-model:value="importSource">
            <a-select-option value="openapi">openapi</a-select-option>
            <a-select-option value="scan">scan</a-select-option>
            <a-select-option value="manual">manual</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="条目（JSON 数组）">
          <a-textarea v-model:value="importText" :rows="10" class="ws-mono" />
        </a-form-item>
      </a-form>
      <p class="modal-hint">
        幂等语义：按 <code>method + pathPattern</code> 匹配 —— 已存在时**只补空字段**，不覆盖非空的人工配置，不改启用/废弃状态。
      </p>
    </a-modal>

    <!-- 新增 / 编辑转发规则 -->
    <a-modal
      :open="routeFormOpen"
      :title="routeEditingId ? '编辑转发规则' : '新增转发规则'"
      :confirm-loading="routeSaving"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitRoute"
      @cancel="routeFormOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="环境">
          <a-select v-model:value="routeForm.envId">
            <a-select-option value="">全环境默认</a-select-option>
            <a-select-option v-for="e in svcEnvs" :key="e.envId" :value="e.envId">{{ e.envId }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="路径前缀" required>
          <a-input v-model:value="routeForm.pathPrefix" placeholder="如 /api/todo" />
        </a-form-item>
        <a-form-item label="剥离前缀">
          <a-input v-model:value="routeForm.stripPrefix" placeholder="如 ^/api" />
        </a-form-item>
        <a-form-item label="重写到">
          <a-input v-model:value="routeForm.rewriteTo" placeholder="如 /api" />
        </a-form-item>
        <a-form-item label="上游覆盖">
          <a-input v-model:value="routeForm.upstreamOverride" placeholder="留空 = 按环境指向解析" />
        </a-form-item>
        <a-form-item label="超时（毫秒）">
          <a-input-number v-model:value="routeForm.timeoutMs" :min="100" style="width: 100%" />
        </a-form-item>
        <a-form-item label="鉴权模式">
          <a-select v-model:value="routeForm.authMode">
            <a-select-option v-for="a in ROUTE_AUTH_OPTIONS" :key="a" :value="a">{{ a }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="优先级（数值小者优先）">
          <a-input-number v-model:value="routeForm.priority" style="width: 100%" />
        </a-form-item>
        <a-form-item label="状态">
          <a-checkbox v-model:checked="routeForm.enabled">启用</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.svc-detail {
  padding: 4px 4px 24px;
}
.crumb {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-bottom: 8px;
}
.crumb a {
  color: var(--ws-text-secondary);
}
.crumb .sep {
  margin: 0 6px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.page-head h1 {
  font-size: 20px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin: 0 0 4px;
}
.kind-tag {
  margin-left: 8px;
  font-weight: 400;
}
.page-head .sub {
  margin: 0;
  font-size: 12px;
  color: var(--ws-text-secondary);
}
.panel {
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card, 0 2px 12px rgba(20, 30, 50, 0.06));
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.bar .lbl {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.spacer {
  flex: 1;
}
.desc {
  margin-bottom: 18px;
}
.tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.env-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.env-card {
  border: 1px solid var(--ws-border, #e8ebf0);
  border-radius: var(--ws-radius-md, 10px);
  padding: 12px 14px;
}
.ec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ec-env {
  font-weight: 600;
}
.ec-ver {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}
.ec-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.tag-dep {
  margin-left: 6px;
}
.svc-name {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.sub-addr {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.link-disabled {
  color: var(--ws-text-tertiary);
  cursor: not-allowed;
  opacity: 0.65;
}
.muted {
  color: var(--ws-text-tertiary);
}
.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.8;
}
.modal-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.8;
}
.ws-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.ws-tabular {
  font-variant-numeric: tabular-nums;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--ws-text-secondary);
}
</style>
