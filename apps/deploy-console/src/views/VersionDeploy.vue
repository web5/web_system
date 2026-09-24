<script setup lang="ts">
/**
 * 版本部署（微前端域，路由 /deploys/micro）
 *
 * 2026-09-21：API 网关域的「版本部署」入口与其 backend 分支已下线
 * （后端由发布流水线的 restart / verify action 直接生效），本页只处理前端 / 微前端模块。
 * 表格 = 模块清单 + 最近一次部署摘要（环境维度收进部署抽屉，环境可数十个）。
 * 设计依据：specs/version-deploy/page-spec.md + design.md（已确认原型
 * docs/ui/prototypes/deploy-console-domain.html v4）
 * 数据来源：GET /deploy/modules（type 过滤）、/deploy/module-deployments/:key
 * （取 deployedAt 最新一条作「最近部署」）、/deploy/versions?env=&component=（抽屉）、
 * POST /deploy/modules/:k/envs/:env/deploy（部署动作 = 切换版本指针）。
 */
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { deployApi, environmentApi, type EnvDictRow } from '@/api'
import VersionDeployDrawer, { type DrawerEnv, type DrawerVersion } from '@/components/VersionDeployDrawer.vue'

const route = useRoute()

/** 本页只处理前端 / 微前端模块（后端服务走发布流水线，不在此处部署） */
const isFrontendModule = (t: string) => t === 'micro-frontend' || t === 'frontend'

interface ModuleRow {
  key: string
  name: string
  /** 最近一次部署（各环境 deployedAt 最新一条；null = 从未部署） */
  latest: { envId: string; version: string; time: string; by: string } | null
}

const loading = ref(false)
const modules = ref<ModuleRow[]>([])

const META = {
  sub: '微前端模块 · 选择已有发布版本直接部署（切版本指针），构建与发布走「流水线」',
  note: '表格显示各模块最近一次部署；目标环境在「部署」抽屉内选择（环境可数十个，支持下拉搜索）。前端/微前端部署 = 切换版本指针，刷新页面即生效，不触碰任何进程。',
}

const columns: TableColumnsType = [
  { title: '模块', key: 'module', width: 240 },
  { title: '最近部署版本', key: 'version', width: 220 },
  { title: '环境', key: 'env', width: 110 },
  { title: '发布时间', key: 'time', width: 180 },
  { title: '发布人', key: 'by', width: 110 },
  { title: '操作', key: 'action', width: 100 },
]

function fmtTime(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  modules.value = []
  try {
    const list = (await deployApi.modules()).filter((m) => isFrontendModule(m.type))
    const rows = await Promise.all(
      list.map(async (m) => {
        let latest: ModuleRow['latest'] = null
        try {
          const dep = await deployApi.moduleDeployments(m.key)
          const cand = (dep.environments || [])
            .filter((e) => e.deployedAt)
            .sort((a, b) => +new Date(b.deployedAt!) - +new Date(a.deployedAt!))
          const top = cand[0]
          if (top) {
            latest = {
              envId: top.envId,
              version: top.currentVersion || '',
              time: fmtTime(top.deployedAt),
              by: top.deployedBy || '',
            }
          }
        } catch {
          /* 单模块部署记录缺失不阻塞整表 */
        }
        return { key: m.key, name: m.name, latest }
      }),
    )
    modules.value = rows
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载模块列表失败')
  } finally {
    loading.value = false
  }
}

// ---------- 部署抽屉（部署域数据源） ----------
const drawerOpen = ref(false)
const drawerModule = ref<ModuleRow | null>(null)
const drawerEnv = ref('')
const drawerLoading = ref(false)
const drawerError = ref<string | null>(null)
const drawerVersions = ref<DrawerVersion[]>([])
const drawerCurrent = ref<string | null>(null)
const deploying = ref(false)

const envOptions = ref<DrawerEnv[]>([])

async function loadEnvOptions() {
  if (envOptions.value.length) return
  try {
    const rows = (await environmentApi.list()) as EnvDictRow[]
    envOptions.value = (rows || []).map((e) => ({ id: e.id, name: e.name }))
    if (!envOptions.value.length) {
      message.warning('暂无环境，请先在环境管理创建环境')
    }
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载环境列表失败')
  }
}

async function loadDrawerVersions() {
  const m = drawerModule.value
  if (!m) return
  drawerLoading.value = true
  drawerError.value = null
  drawerVersions.value = []
  try {
    const [vers, dep] = await Promise.all([
      deployApi.versions(drawerEnv.value, m.key),
      deployApi.moduleDeployments(m.key),
    ])
    const cur = (dep.environments || []).find((e) => e.envId === drawerEnv.value)
    drawerCurrent.value = cur?.currentVersion ?? null
    drawerVersions.value = (vers || []).map((v) => ({
      tag: v.versionTag,
      meta: [v.gitBranch, v.gitCommit, fmtTime(v.releasedAt), v.releasedBy].filter(Boolean).join(' · '),
      isCurrent: v.versionTag === drawerCurrent.value,
    }))
  } catch (e: any) {
    drawerError.value = e?.response?.data?.message || '网络或服务异常，请重试'
  } finally {
    drawerLoading.value = false
  }
}

async function openDeploy(row: ModuleRow, presetEnv?: string) {
  drawerModule.value = row
  // 默认环境 = 入口预选环境 > 该模块最近部署的环境 > 环境列表第一个
  drawerEnv.value = presetEnv || row.latest?.envId || envOptions.value[0]?.id || 'dev'
  drawerOpen.value = true
  // 版本列表加载由 watch([drawerOpen, drawerEnv]) 驱动（打开/切环境都触发）
}

async function onDeploy(versionTag: string) {
  const m = drawerModule.value
  if (!m) return
  deploying.value = true
  try {
    await deployApi.deployVersion(m.key, drawerEnv.value, versionTag)
    message.success(`${drawerEnv.value} / ${m.key} 已部署到 ${versionTag}`)
    drawerOpen.value = false
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '部署失败')
  } finally {
    deploying.value = false
  }
}

// 抽屉打开或目标环境变化 → 加载该环境版本记录（含打开同环境的场景）
watch([drawerOpen, drawerEnv], ([open]) => {
  if (open && drawerModule.value) loadDrawerVersions()
})

onMounted(async () => {
  await loadEnvOptions()
  await load()
  // 入口预选（如从服务管理「部署」跳入）：query.module 直接打开选版本抽屉
  const presetModule = String(route.query.module || '')
  const presetEnv = String(route.query.env || '')
  if (presetModule) {
    const row = modules.value.find((m) => m.key === presetModule)
    if (row) {
      openDeploy(row, presetEnv || undefined)
    } else {
      message.warning(`模块 ${presetModule} 不在本域模块清单中`)
    }
  }
})
</script>

<template>
  <div class="vdeploy-page">
    <div class="page-head">
      <div>
        <h1>版本部署</h1>
        <p class="sub">{{ META.sub }}</p>
      </div>
    </div>

    <a-card :bordered="false" class="panel">
      <a-table
        :columns="columns"
        :data-source="modules"
        :loading="loading"
        row-key="key"
        size="middle"
        :pagination="false"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'module'">
            <span class="mod-name">{{ record.name }}</span>
            <span class="ws-mono mod-key">{{ record.key }}</span>
          </template>
          <template v-else-if="column.key === 'version'">
            <span v-if="record.latest" class="ws-mono">{{ record.latest.version || '—' }}</span>
            <span v-else class="muted">—</span>
          </template>
          <template v-else-if="column.key === 'env'">
            <a-tag v-if="record.latest">{{ record.latest.envId }}</a-tag>
            <span v-else class="muted">—</span>
          </template>
          <template v-else-if="column.key === 'time'">
            <span v-if="record.latest" class="ws-tabular">{{ record.latest.time }}</span>
            <span v-else class="muted">—</span>
          </template>
          <template v-else-if="column.key === 'by'">
            <span v-if="record.latest">{{ record.latest.by || '—' }}</span>
            <span v-else class="muted">—</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a type="link" @click="openDeploy(record)">部署</a>
          </template>
        </template>
        <template #emptyText>
          <a-empty description="暂无可部署模块：模块清单来自发布模块注册表，请先在模块注册表登记" />
        </template>
      </a-table>
      <p class="hint">{{ META.note }}</p>
    </a-card>

    <VersionDeployDrawer
      v-model:open="drawerOpen"
      v-model:env="drawerEnv"
      :module-name="drawerModule?.name || ''"
      :module-key="drawerModule?.key || ''"
      :envs="envOptions"
      :loading="drawerLoading"
      :load-error="drawerError"
      :versions="drawerVersions"
      :current-version="drawerCurrent"
      :deploying="deploying"
      @retry="loadDrawerVersions"
      @deploy="onDeploy"
    />
  </div>
</template>

<style scoped>
.vdeploy-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-head h1 {
  font-size: 22px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin: 0;
}
.page-head .sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ws-text-secondary);
}
.panel {
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card, 0 2px 12px rgba(20, 30, 50, 0.06));
}
.mod-name {
  font-weight: 600;
  color: var(--ws-text-primary);
}
.mod-key {
  font-size: 11.5px;
  color: var(--ws-text-tertiary);
  margin-left: 8px;
}
.muted {
  color: var(--ws-text-tertiary);
}
.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
</style>
