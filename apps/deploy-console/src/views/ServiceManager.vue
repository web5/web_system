<script setup lang="ts">
/**
 * 服务管理（API 网关域）
 *
 * 服务 = 网关背后的后端进程/容器。**点服务进入「接口清单」**（详情默认页签）。
 * 设计依据：specs/deploy-console-domain-split/page-spec.md §3 / design.md v2 §2.3
 * 数据来源：`GET/POST /api/services`（双域重构 P2 已接通）
 *
 * 说明：健康状态**不伪造** —— 列表展示"已配置指向的环境"，探活按需手动触发（逐环境）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { servicesApi, type ServiceRow, type ServiceKind } from '@/api'

const router = useRouter()

const KINDS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'nest', label: '业务服务' },
  { value: 'express', label: 'Express' },
  { value: 'mcp', label: 'MCP' },
  { value: 'static', label: '静态' },
]

function kindLabel(kind: string): string {
  return KINDS.find((k) => k.value === kind)?.label || kind
}

const list = ref<ServiceRow[]>([])
const total = ref(0)
const loading = ref(false)
const keyword = ref('')
const activeKind = ref('all')
const page = ref(1)
const PAGE_SIZE = 50
const probing = ref<string | null>(null)

const columns: TableColumnsType = [
  { title: '服务', key: 'key', width: 220 },
  { title: '类型', key: 'kind', width: 100 },
  { title: '仓库目录', key: 'repoDir', width: 170 },
  { title: '端口', key: 'defaultPort', width: 90, align: 'right' },
  { title: '探活路径', key: 'healthPath', width: 110 },
  { title: '已配指向的环境', key: 'envs' },
  { title: '接口数', key: 'endpointCount', width: 90, align: 'right' },
  { title: '网关路由', key: 'routeCount', width: 90, align: 'right' },
  { title: '操作', key: 'action', width: 160 },
]

async function load() {
  loading.value = true
  try {
    const res = await servicesApi.list({
      kind: activeKind.value === 'all' ? undefined : activeKind.value,
      q: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    list.value = res.items
    total.value = res.total
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载服务列表失败')
  } finally {
    loading.value = false
  }
}

function reloadFromFirstPage() {
  page.value = 1
  load()
}

function onPageChange(p: number) {
  page.value = p
  load()
}

function goDetail(key: string) {
  router.push({ name: 'ServiceDetail', params: { key } })
}

/** 逐环境手动探活（未配置主机时后端明确报错，不回落本机） */
async function probe(row: ServiceRow, envId: string) {
  probing.value = `${row.key}@${envId}`
  try {
    const res = await servicesApi.health(row.key, envId)
    if (res.ok) {
      message.success(`${row.key} @ ${envId} 健康（${res.status}，${res.latencyMs}ms）→ ${res.target}`)
    } else {
      message.error(
        `${row.key} @ ${envId} 探活失败：${res.error || `HTTP ${res.status}`}（${res.target}）`,
      )
    }
  } catch (e: any) {
    message.error(e?.response?.data?.message || '探活失败')
  } finally {
    probing.value = null
  }
}

/** 部署：跳「版本部署」（API 网关域）并预选该服务直接打开选版本抽屉；构建新版本走「发布流水线」 */
function deploy(row: ServiceRow) {
  if (row.deployChannel === 'legacy') {
    message.warning('该服务走传统发布通道（legacy），不由流水线托管')
    return
  }
  router.push({
    name: 'VersionDeployBackend',
    query: { module: row.key, env: row.configuredEnvs?.[0] || 'dev' },
  })
}

// ---------- 新建服务（key 创建后不可改） ----------
const formOpen = ref(false)
const saving = ref(false)
const form = reactive({
  key: '',
  name: '',
  kind: 'nest' as ServiceKind,
  repoDir: '',
  pm2Name: '',
  healthPath: '/health',
})

const keyValid = computed(() => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(form.key))
const canSubmit = computed(
  () => keyValid.value && !!form.name.trim() && !!form.repoDir.trim() && !saving.value,
)

function openCreate() {
  form.key = ''
  form.name = ''
  form.kind = 'nest'
  form.repoDir = ''
  form.pm2Name = ''
  form.healthPath = '/health'
  formOpen.value = true
}

function onKeyInput() {
  if (!form.repoDir || /^[a-z0-9_-]*$/.test(form.key)) form.repoDir = form.key
  if (!form.pm2Name || form.pm2Name === `web-`) form.pm2Name = `web-${form.key}`
}

async function submitCreate() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    const svc = await servicesApi.create({
      key: form.key,
      name: form.name.trim(),
      kind: form.kind,
      repoDir: form.repoDir.trim(),
      pm2Name: form.pm2Name.trim() || undefined,
      healthPath: form.healthPath.trim() || undefined,
    })
    formOpen.value = false
    message.success(`服务 ${svc.key} 已创建`)
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="svc-page">
    <div class="page-head">
      <div>
        <h1>服务管理</h1>
        <p class="sub">
          API 网关背后的后端服务；点击服务进入接口清单，网关路由与环境指向在各页签内管理。
        </p>
      </div>
      <a-button type="primary" @click="openCreate">新建服务</a-button>
    </div>

    <a-card :bordered="false" class="panel">
      <div class="filters">
        <a-radio-group v-model:value="activeKind" button-style="solid" @change="reloadFromFirstPage">
          <a-radio-button v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</a-radio-button>
        </a-radio-group>
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索 key / 名称"
          style="width: 240px"
          allow-clear
          @search="reloadFromFirstPage"
        />
        <span class="count">共 {{ total }} 个服务</span>
      </div>

      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        row-key="key"
        size="middle"
        :pagination="{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t: number) => `共 ${t} 个服务`,
        }"
        @change="(p: any) => onPageChange(p.current)"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'key'">
            <a @click="goDetail(record.key)">
              <span class="ws-mono">{{ record.key }}</span>
            </a>
            <span class="name">{{ record.name }}</span>
            <a-tag v-if="record.deployChannel === 'legacy'" class="tag-legacy">传统通道</a-tag>
          </template>
          <template v-else-if="column.key === 'kind'">
            <a-tag>{{ kindLabel(record.kind) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'repoDir'">
            <span class="ws-mono">servers/{{ record.repoDir }}</span>
          </template>
          <template v-else-if="column.key === 'defaultPort'">
            <span class="ws-mono ws-tabular">{{ record.defaultPort ?? '—' }}</span>
          </template>
          <template v-else-if="column.key === 'healthPath'">
            <span class="ws-mono">{{ record.healthPath }}</span>
          </template>
          <template v-else-if="column.key === 'envs'">
            <span v-if="!record.configuredEnvs?.length" class="muted">未配置指向</span>
            <template v-else>
              <a
                v-for="e in record.configuredEnvs"
                :key="e"
                class="env-chip"
                @click="probe(record, e)"
              >
                <a-tag :color="probing === `${record.key}@${e}` ? 'processing' : undefined">{{ e }}</a-tag>
              </a>
            </template>
          </template>
          <template v-else-if="column.key === 'endpointCount'">
            <a @click="goDetail(record.key)">
              <span class="ws-tabular">{{ record.endpointCount ?? 0 }}</span>
            </a>
          </template>
          <template v-else-if="column.key === 'routeCount'">
            <span class="ws-tabular">{{ record.routeCount ?? 0 }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a type="link" @click="goDetail(record.key)">详情</a>
            <a type="link" @click="probe(record, 'dev')">探活</a>
            <a type="link" :disabled="record.deployChannel === 'legacy'" @click="deploy(record)">部署</a>
          </template>
        </template>
      </a-table>

      <p class="hint">
        健康状态不伪造：列表显示「已配指向的环境」，点环境徽标即对该环境探活（未配置主机时明确报错，不回落本机）。
      </p>
    </a-card>

    <a-modal
      :open="formOpen"
      title="新建服务"
      :confirm-loading="saving"
      ok-text="创建"
      cancel-text="取消"
      :ok-button-props="{ disabled: !canSubmit }"
      @ok="submitCreate"
      @cancel="formOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="服务 key" required>
          <a-input v-model:value="form.key" placeholder="如 todo-service" :maxlength="64" @input="onKeyInput" />
          <div class="field-hint">
            小写字母/数字/下划线/中划线；<strong>创建后不可修改</strong>（网关路由与流水线历史都按 key 关联）
          </div>
          <div v-if="form.key && !keyValid" class="field-error">key 需以字母或数字开头，长度 2–64</div>
        </a-form-item>
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="如 待办服务" :maxlength="32" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="form.kind">
            <a-select-option value="nest">NestJS 业务服务</a-select-option>
            <a-select-option value="express">Express</a-select-option>
            <a-select-option value="mcp">MCP 网关</a-select-option>
            <a-select-option value="static">静态服务</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="仓库目录" required>
          <a-input v-model:value="form.repoDir" placeholder="如 todo-service" :maxlength="64" />
          <div class="field-hint">对应 servers/&lt;目录&gt;</div>
        </a-form-item>
        <a-form-item label="pm2 进程名">
          <a-input v-model:value="form.pm2Name" placeholder="如 web-todo" :maxlength="64" />
        </a-form-item>
        <a-form-item label="探活路径">
          <a-input v-model:value="form.healthPath" placeholder="/health" :maxlength="128" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.svc-page {
  padding: 4px 4px 24px;
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
.page-head .sub {
  margin: 0;
  font-size: 12px;
  color: var(--ws-text-secondary);
}
.panel {
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card, 0 2px 12px rgba(20, 30, 50, 0.06));
}
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.filters .count {
  margin-left: auto;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.ws-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.ws-tabular {
  font-variant-numeric: tabular-nums;
}
.name {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.tag-legacy {
  margin-left: 6px;
}
.env-chip {
  cursor: pointer;
}
.muted {
  color: var(--ws-text-tertiary);
}
.hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.8;
}
.field-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
  line-height: 1.7;
}
.field-error {
  font-size: 12px;
  color: var(--ws-color-error, #d4380d);
  margin-top: 4px;
}
</style>
