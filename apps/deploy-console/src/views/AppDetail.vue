<script setup lang="ts">
/**
 * 应用详情（微前端域）
 *
 * Tab 只保留微前端语义：概览 / 路由（shell 挂载） / 部署（环境 × 版本）。
 * 明确**不含**「服务环境」（属服务域）与「环境」Tab（环境由环境管理统一维护）。
 * 设计依据：specs/deploy-console-domain-split/page-spec.md §2
 * 数据来源：`GET /api/apps/:key`、`/apps/:key/envs`、`/apps/:key/versions`、`switch`、`rollback`
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { appsApi, type AppRow, type AppRouteRow, type AppEnvVersionRow } from '@/api'
import VersionDeployDrawer, { type DrawerVersion } from '@/components/VersionDeployDrawer.vue'

const route = useRoute()
const router = useRouter()
const appKey = computed(() => String(route.params.key || ''))

const app = ref<AppRow | null>(null)
const routes = ref<AppRouteRow[]>([])
const deployRows = ref<AppEnvVersionRow[]>([])
const loading = ref(false)
const activeTab = ref('overview')

const KIND_LABEL: Record<string, string> = {
  shell: '基座',
  'micro-frontend': '微前端',
  spa: '独立应用',
  'mini-app': '小程序',
}
const kindLabel = computed(() => KIND_LABEL[app.value?.kind || ''] || app.value?.kind || '-')

async function load() {
  loading.value = true
  try {
    const [detail, envs] = await Promise.all([appsApi.get(appKey.value), appsApi.envs(appKey.value)])
    app.value = detail
    routes.value = detail.routes || []
    deployRows.value = envs.items || []
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载应用信息失败')
  } finally {
    loading.value = false
  }
}

// ---------- 挂载路由（保存只改配置、不触发发布） ----------
const routeColumns: TableColumnsType = [
  { title: '挂载路径', dataIndex: 'mountPath', key: 'mountPath', width: 180 },
  { title: '激活规则', dataIndex: 'activeRule', key: 'activeRule', width: 180 },
  { title: '需鉴权', dataIndex: 'requireAuth', key: 'requireAuth', width: 100 },
  { title: '排序', dataIndex: 'sort', key: 'sort', width: 80, align: 'right' },
  { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 90 },
]

const routeFormOpen = ref(false)
const routeSaving = ref(false)
const routeForm = reactive({ mountPath: '', requireAuth: true, sort: 0 })

function openAddRoute() {
  routeForm.mountPath = ''
  routeForm.requireAuth = true
  routeForm.sort = (routes.value.at(-1)?.sort ?? 0) + 10
  routeFormOpen.value = true
}

async function submitAddRoute() {
  if (!routeForm.mountPath.trim().startsWith('/')) {
    message.error('挂载路径必须以 / 开头')
    return
  }
  routeSaving.value = true
  try {
    await appsApi.createRoute(appKey.value, {
      mountPath: routeForm.mountPath.trim(),
      requireAuth: routeForm.requireAuth,
      sort: routeForm.sort,
    })
    routeFormOpen.value = false
    message.success('挂载已新增（用户刷新后生效）')
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '新增挂载失败')
  } finally {
    routeSaving.value = false
  }
}

async function toggleRoute(row: AppRouteRow, field: 'requireAuth' | 'enabled', value: boolean) {
  try {
    await appsApi.updateRoute(appKey.value, row.id, { [field]: value })
    ;(row as any)[field] = value
    message.success('已更新')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '更新失败')
    await load()
  }
}

function removeRoute(row: AppRouteRow) {
  Modal.confirm({
    title: '删除挂载',
    content: `删除后 ${row.mountPath} 不再挂载到本应用。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await appsApi.removeRoute(appKey.value, row.id)
        message.success('已删除')
        await load()
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

// ---------- 部署矩阵 ----------
const deployColumns: TableColumnsType = [
  { title: '环境', key: 'envId', width: 190 },
  { title: '当前版本', key: 'currentVersion', width: 140 },
  { title: '上一版本', key: 'previousVersion', width: 120 },
  { title: '发布时间', key: 'deployedAt', width: 170 },
  { title: '发布人', dataIndex: 'deployedBy', key: 'deployedBy', width: 90 },
  { title: '操作', key: 'action', width: 210 },
]

/**
 * 部署：打开选版本部署抽屉（与「版本部署」页同一交互；不跳发布流水线）。
 * 应用域数据源：版本 = 磁盘版本目录（GET /apps/:key/versions），
 * 部署 = POST /apps/:key/switch-version（含产物存在守卫 + 入口指针写入）。
 */
function goDeploy(envId?: string) {
  drawerEnv.value = envId || deployRows.value[0]?.envId || 'dev'
  drawerOpen.value = true
}

// ---------- 选版本部署抽屉（应用域数据源） ----------
const drawerOpen = ref(false)
const drawerEnv = ref('')
const drawerLoading = ref(false)
const drawerError = ref<string | null>(null)
const drawerVersions = ref<DrawerVersion[]>([])
const drawerCurrent = ref<string | null>(null)
const deploying = ref(false)

/** 环境选项 = 本应用已配置的环境行（envId × envName） */
const drawerEnvs = computed(() =>
  deployRows.value.map((e) => ({ id: e.envId, name: e.envName || e.envId })),
)

async function loadDrawerVersions() {
  if (!appKey.value || !drawerEnv.value) return
  drawerLoading.value = true
  drawerError.value = null
  drawerVersions.value = []
  try {
    const res = await appsApi.versions(appKey.value, drawerEnv.value)
    drawerCurrent.value = res.currentVersion
    drawerVersions.value = (res.availableVersions || []).map((v) => ({
      tag: v.ref,
      meta: v.isPrevious ? '上一版本 · 磁盘版本目录' : '磁盘版本目录',
      isCurrent: v.isCurrent || v.ref === res.currentVersion,
    }))
  } catch (e: any) {
    drawerError.value = e?.response?.data?.message || '网络或服务异常，请重试'
  } finally {
    drawerLoading.value = false
  }
}

// 抽屉打开或目标环境变化 → 加载该环境可选版本
watch([drawerOpen, drawerEnv], ([open]) => {
  if (open) loadDrawerVersions()
})

async function onDeploy(version: string) {
  deploying.value = true
  try {
    const res = await appsApi.switchVersion(appKey.value, { envId: drawerEnv.value, version })
    message.success(
      res.unchanged
        ? `${res.envId} 已是 ${res.to}，无需切换`
        : `${res.envId} 已从 ${res.from ?? '-'} 切换到 ${res.to}（刷新页面生效）`,
    )
    drawerOpen.value = false
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '部署失败')
  } finally {
    deploying.value = false
  }
}

// ---------- 切换版本（只改指针，不重新构建） ----------
const switchOpen = ref(false)
const switchRow = ref<AppEnvVersionRow | null>(null)
const switchTarget = ref('')
const switchOptions = ref<string[]>([])
const switchLoading = ref(false)

async function openSwitch(row: AppEnvVersionRow) {
  switchRow.value = row
  switchTarget.value = ''
  switchOptions.value = []
  switchOpen.value = true
  switchLoading.value = true
  try {
    const res = await appsApi.versions(appKey.value, row.envId)
    switchOptions.value = res.availableVersions.filter((v) => !v.isCurrent).map((v) => v.ref)
    switchTarget.value = switchOptions.value[0] || ''
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载可选版本失败')
  } finally {
    switchLoading.value = false
  }
}

async function submitSwitch() {
  if (!switchTarget.value || !switchRow.value) {
    message.error('请选择目标版本')
    return
  }
  switchLoading.value = true
  try {
    const res = await appsApi.switchVersion(appKey.value, {
      envId: switchRow.value.envId,
      version: switchTarget.value,
    })
    message.success(
      res.unchanged
        ? `${res.envId} 已是 ${res.to}，无需切换`
        : `${res.envId} 已从 ${res.from ?? '-'} 切换到 ${res.to}（刷新页面生效）`,
    )
    switchOpen.value = false
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '切换失败')
  } finally {
    switchLoading.value = false
  }
}

// ---------- 回滚（默认回到上一版本） ----------
const rollbackOpen = ref(false)
const rollbackRow = ref<AppEnvVersionRow | null>(null)
const rollbackTarget = ref('')
const rollbackOptions = ref<string[]>([])
const rollbackLoading = ref(false)

async function openRollback(row: AppEnvVersionRow) {
  if (!row.previousVersion) {
    Modal.warning({
      title: '无法回滚',
      content: `环境 ${row.envId} 没有可回滚的上一版本。`,
      okText: '知道了',
    })
    return
  }
  rollbackRow.value = row
  rollbackTarget.value = row.previousVersion
  rollbackOptions.value = []
  rollbackOpen.value = true
  try {
    const res = await appsApi.versions(appKey.value, row.envId)
    rollbackOptions.value = res.availableVersions
      .filter((v) => !v.isCurrent)
      .map((v) => v.ref)
  } catch {
    /* 拉取失败时仍可用默认的上一版本 */
  }
}

async function submitRollback() {
  if (!rollbackTarget.value || !rollbackRow.value) {
    message.error('请选择回滚到的版本')
    return
  }
  rollbackLoading.value = true
  try {
    const res = await appsApi.rollback(appKey.value, {
      envId: rollbackRow.value.envId,
      version: rollbackTarget.value,
    })
    message.success(`${res.envId} 已回滚到 ${res.to}（刷新页面生效）`)
    rollbackOpen.value = false
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '回滚失败')
  } finally {
    rollbackLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="app-detail" :class="{ loading }">
    <div class="crumb">
      <a @click="router.push({ name: 'AppManager' })">应用管理</a>
      <span class="sep">/</span>
      <span class="ws-mono">{{ appKey }}</span>
    </div>

    <div class="page-head">
      <div>
        <h1>
          <span class="ws-mono">{{ appKey }}</span>
          <a-tag class="kind-tag">{{ kindLabel }}</a-tag>
        </h1>
        <p class="sub">{{ app?.name }} · <code>apps/{{ app?.repoDir }}</code></p>
      </div>
      <a-button type="primary" @click="goDeploy()">部署</a-button>
    </div>

    <a-card :bordered="false" class="panel">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 概览 -->
        <a-tab-pane key="overview" tab="概览">
          <a-descriptions :column="3" bordered size="small" class="desc">
            <a-descriptions-item label="key">
              <span class="ws-mono">{{ appKey }}</span>
              <span class="tip">创建后不可修改</span>
            </a-descriptions-item>
            <a-descriptions-item label="名称">{{ app?.name || '-' }}</a-descriptions-item>
            <a-descriptions-item label="类型">{{ kindLabel }}</a-descriptions-item>
            <a-descriptions-item label="父应用">
              <span v-if="app?.parentKey" class="ws-mono">{{ app.parentKey }}</span>
              <span v-else class="muted">无（顶层应用）</span>
            </a-descriptions-item>
            <a-descriptions-item label="仓库目录">
              <span class="ws-mono">apps/{{ app?.repoDir || '-' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="入口">
              <span class="ws-mono">{{ app?.entry || 'index.js' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="部署模式">
              <a-tag v-if="app?.deployMode === 'site-version'">站点 + 版本（不随环境切换）</a-tag>
              <a-tag v-else>按环境目录（envId）</a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="产物路径">
              <span class="ws-mono">
                {{ app?.publicPath || (app?.deployMode === 'site-version' ? `/static/modules/${appKey}/<version>/` : `/static/modules/${appKey}/<envId>/`) }}
              </span>
            </a-descriptions-item>
            <a-descriptions-item label="描述">{{ app?.description || '-' }}</a-descriptions-item>
          </a-descriptions>

          <div class="env-cards">
            <div v-for="e in deployRows" :key="e.envId" class="env-card">
              <div class="ec-head">
                <span class="ws-mono ec-env">{{ e.envId }}</span>
                <span class="ec-name">{{ e.envName }}</span>
                <a-tag v-if="e.isProd" color="orange" class="ec-prod">生产</a-tag>
              </div>
              <div class="ec-ver ws-mono">{{ e.currentVersion || '—' }}</div>
              <div class="ec-meta">
                {{ e.deployedAt ? e.deployedAt : '尚未发布' }}
                <template v-if="e.deployedBy"> · {{ e.deployedBy }}</template>
              </div>
            </div>
          </div>
        </a-tab-pane>

        <!-- 路由 -->
        <a-tab-pane key="routes" tab="路由">
          <a-table :columns="routeColumns" :data-source="routes" row-key="id" size="middle" :pagination="false">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'mountPath'">
                <span class="ws-mono">{{ record.mountPath }}</span>
              </template>
              <template v-else-if="column.key === 'activeRule'">
                <span class="ws-mono">{{ record.activeRule }}</span>
              </template>
              <template v-else-if="column.key === 'requireAuth'">
                <a-switch
                  :checked="record.requireAuth"
                  size="small"
                  @change="(v: any) => toggleRoute(record, 'requireAuth', !!v)"
                />
              </template>
              <template v-else-if="column.key === 'sort'">
                <span class="ws-tabular">{{ record.sort }}</span>
              </template>
              <template v-else-if="column.key === 'enabled'">
                <a-switch
                  :checked="record.enabled"
                  size="small"
                  @change="(v: any) => toggleRoute(record, 'enabled', !!v)"
                />
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="removeRoute(record)">删除</a>
              </template>
            </template>
          </a-table>
          <div class="table-actions">
            <a-button size="small" @click="openAddRoute">新增挂载</a-button>
          </div>
          <p class="hint">
            保存只更新配置、不触发发布；与其它应用已占用的挂载路径冲突时会被拒绝（数据层唯一约束兜底）。
          </p>
        </a-tab-pane>

        <!-- 部署 -->
        <a-tab-pane key="deploy" tab="部署">
          <a-table
            :columns="deployColumns"
            :data-source="deployRows"
            row-key="envId"
            size="middle"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'envId'">
                <span class="ws-mono">{{ record.envId }}</span>
                <span class="ec-name">{{ record.envName }}</span>
                <a-tag v-if="record.isProd" color="orange">生产</a-tag>
              </template>
              <template v-else-if="column.key === 'currentVersion'">
                <span class="ws-mono">{{ record.currentVersion || '—' }}</span>
                <a-tooltip v-if="record.pointerVersion && record.pointerVersion !== record.currentVersion" title="磁盘指针与版本记录不一致，请排查">
                  <a-tag color="red" class="mt-2">指针不一致</a-tag>
                </a-tooltip>
              </template>
              <template v-else-if="column.key === 'previousVersion'">
                <span class="ws-mono muted">{{ record.previousVersion || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'deployedAt'">
                <span class="ws-tabular">{{ record.deployedAt || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'deployedBy'">
                <span>{{ record.deployedBy || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="goDeploy(record.envId)">部署</a>
                <a type="link" @click="openSwitch(record)">切换版本</a>
                <a type="link" @click="openRollback(record)">回滚</a>
              </template>
            </template>
          </a-table>
          <p class="hint">
            应用侧部署只切版本指针、不触碰任何进程；后端服务发布在「服务管理」内。
            切换版本与回滚都只改写 <code>index.js</code> 指针，用户刷新即生效。
          </p>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 新增挂载 -->
    <a-modal
      :open="routeFormOpen"
      title="新增挂载"
      :confirm-loading="routeSaving"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitAddRoute"
      @cancel="routeFormOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="挂载路径" required>
          <a-input v-model:value="routeForm.mountPath" placeholder="如 /admin" />
        </a-form-item>
        <a-form-item label="需鉴权">
          <a-switch v-model:checked="routeForm.requireAuth" size="small" />
        </a-form-item>
        <a-form-item label="排序">
          <a-input-number v-model:value="routeForm.sort" :min="0" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 切换版本 -->
    <a-modal
      :open="switchOpen"
      title="切换版本"
      :confirm-loading="switchLoading"
      ok-text="确认切换"
      cancel-text="取消"
      @ok="submitSwitch"
      @cancel="switchOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="环境">
          <a-input :value="switchRow?.envId" disabled />
        </a-form-item>
        <a-form-item label="当前版本">
          <a-input :value="switchRow?.currentVersion || '—'" disabled />
        </a-form-item>
        <a-form-item label="目标版本" required>
          <a-select v-model:value="switchTarget" placeholder="请选择要切换到的版本" :loading="switchLoading">
            <a-select-option v-for="v in switchOptions" :key="v" :value="v">{{ v }}</a-select-option>
          </a-select>
          <div v-if="!switchLoading && !switchOptions.length" class="field-hint">
            该环境暂无可切换的历史版本（产物目录内仅有当前版本）
          </div>
        </a-form-item>
      </a-form>
      <p class="modal-hint">切换后用户刷新页面立即加载新版本（index.js 为 no-cache）。</p>
    </a-modal>

    <!-- 回滚 -->
    <a-modal
      :open="rollbackOpen"
      title="回滚"
      :confirm-loading="rollbackLoading"
      ok-text="确认回滚"
      ok-type="danger"
      cancel-text="取消"
      @ok="submitRollback"
      @cancel="rollbackOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="环境">
          <a-input :value="rollbackRow?.envId" disabled />
        </a-form-item>
        <a-form-item label="当前版本">
          <a-input :value="rollbackRow?.currentVersion || '—'" disabled />
        </a-form-item>
        <a-form-item label="回滚到" required>
          <a-select v-model:value="rollbackTarget" placeholder="请选择要回滚到的版本">
            <a-select-option v-for="v in rollbackOptions.length ? rollbackOptions : [rollbackTarget]" :key="v" :value="v">
              {{ v }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
      <p class="modal-hint">回滚只改写入口指针指向该版本（版本目录保留，无需重新构建）。</p>
    </a-modal>

    <!-- 选版本部署抽屉（应用域数据源：磁盘版本目录 + switch-version） -->
    <VersionDeployDrawer
      v-model:open="drawerOpen"
      v-model:env="drawerEnv"
      :module-name="app?.name || appKey"
      :module-key="appKey"
      :envs="drawerEnvs"
      :loading="drawerLoading"
      :load-error="drawerError"
      :versions="drawerVersions"
      :current-version="drawerCurrent"
      :deploying="deploying"
      :backend="false"
      @retry="loadDrawerVersions"
      @deploy="onDeploy"
    />
  </div>
</template>

<style scoped>
.app-detail {
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
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
.ec-name {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.ec-prod {
  margin-left: 4px;
}
.ec-ver {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
}
.ec-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.table-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
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
.field-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
}
.muted {
  color: var(--ws-text-tertiary);
}
.mt-2 {
  margin-left: 6px;
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
