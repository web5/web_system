<script setup lang="ts">
/**
 * 环境详情（微前端域）
 *
 * 环境是"一套完整的运行上下文"：
 *   ① 前端：微前端按 envId 加载产物目录 /static/modules/<appKey>/<envId>/
 *   ② 后端：该环境下 API 网关把请求转发到哪个服务地址（"指向"）
 * 因此详情页承担「改这个环境的后端指向」的职责（服务详情只读）。
 *
 * 设计依据：specs/deploy-console-domain-split/environment-design.md / page-spec.md §5
 * 数据来源：`GET /api/envs/:envId`、`GET|PUT /api/envs/:envId/service-routes`
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { envsApi, type EnvRow, type EnvServiceRouteRow } from '@/api'

const route = useRoute()
const router = useRouter()
const envId = computed(() => String(route.params.envId || ''))

const activeTab = ref('basic')
const loading = ref(false)

/** 环境基本信息 */
const envInfo = ref<EnvRow>({
  envId: '',
  name: '',
  siteKey: '',
  isProd: false,
  builtin: false,
  sort: 0,
  enabled: true,
})

/** 该环境的后端服务指向 */
const serviceRoutes = ref<EnvServiceRouteRow[]>([])

async function load() {
  loading.value = true
  try {
    const [env, routesRes] = await Promise.all([
      envsApi.get(envId.value),
      envsApi.serviceRoutes(envId.value),
    ])
    envInfo.value = env
    serviceRoutes.value = routesRes.items || []
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载环境信息失败')
  } finally {
    loading.value = false
  }
}

const columns: TableColumnsType = [
  { title: '服务', key: 'serviceKey', width: 210 },
  { title: '上游地址（网关指向）', key: 'upstreamUrl' },
  { title: '目标主机', key: 'hostName', width: 150 },
  { title: '端口', key: 'port', width: 90, align: 'right' },
  { title: '启用', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 90 },
]

/** 上游地址展示：显式 upstreamUrl 优先，否则由「主机 + 端口」推导 */
function upstreamOf(row: EnvServiceRouteRow): string {
  if (row.upstreamUrl) return row.upstreamUrl
  if (row.hostName && row.port) return `http://${row.hostName}:${row.port}`
  return '—'
}

// ---------- 环境启用开关 ----------
async function toggleEnvEnabled(checked: boolean) {
  try {
    await envsApi.update(envId.value, { enabled: checked })
    envInfo.value.enabled = checked
    message.success(checked ? '已启用' : '已停用')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '更新失败')
  }
}

// ---------- 服务指向启用开关（未配主机不允许启用）----------
async function toggleServiceEnabled(row: EnvServiceRouteRow, checked: boolean) {
  if (!row.hostName) {
    message.warning('请先配置目标主机（不允许回落到本机）')
    return
  }
  try {
    await envsApi.updateServiceRoute(envId.value, row.serviceKey, {
      hostName: row.hostName,
      enabled: checked,
    })
    row.enabled = checked
    message.success(checked ? '已启用' : '已停用')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '更新失败')
  }
}

// ---------- 编辑某服务的指向 ----------
const editOpen = ref(false)
const saving = ref(false)
const editing = ref<EnvServiceRouteRow | null>(null)
const form = reactive({
  hostName: '',
  port: undefined as number | undefined,
  upstreamUrl: '',
  runtime: undefined as 'pm2' | 'docker' | undefined,
})

function openEdit(row: EnvServiceRouteRow) {
  editing.value = row
  form.hostName = row.hostName || ''
  form.port = row.port ?? undefined
  form.upstreamUrl = row.upstreamUrl || ''
  form.runtime = row.runtime || undefined
  editOpen.value = true
}

/** 由主机 + 端口推导上游地址（用户可再手改） */
function syncUpstream() {
  if (form.hostName && form.port) form.upstreamUrl = `http://${form.hostName}:${form.port}`
}

async function submitEdit() {
  if (!editing.value) return
  if (!form.hostName.trim()) {
    message.error('目标主机必填（不允许静默回落到本机）')
    return
  }
  saving.value = true
  try {
    await envsApi.updateServiceRoute(envId.value, editing.value.serviceKey, {
      hostName: form.hostName.trim(),
      port: form.port,
      upstreamUrl: form.upstreamUrl.trim() || undefined,
      runtime: form.runtime,
    })
    editOpen.value = false
    message.success(`已更新 ${editing.value.serviceKey} 在 ${envId.value} 的指向`)
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="env-detail">
    <div class="crumb">
      <a @click="router.push({ name: 'EnvironmentManager' })">环境管理</a>
      <span class="sep">/</span>
      <span class="ws-mono">{{ envId }}</span>
    </div>

    <div class="page-head">
      <div>
        <h1>
          <span class="ws-mono">{{ envId }}</span>
          <a-tag v-if="envInfo.builtin" class="kind-tag">内置</a-tag>
          <a-tag v-if="envInfo.isProd" color="orange" class="kind-tag">生产</a-tag>
        </h1>
        <p class="sub">
          {{ envInfo.name }} · 站点 <code>{{ envInfo.siteKey }}</code> · 产物目录
          <code>/static/modules/&lt;appKey&gt;/{{ envId }}/</code>
        </p>
      </div>
      <a-switch
        :checked="envInfo.enabled"
        checked-children="启用"
        un-checked-children="停用"
        @change="(v: any) => toggleEnvEnabled(!!v)"
      />
    </div>

    <a-card :bordered="false" class="panel">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 基本信息 -->
        <a-tab-pane key="basic" tab="基本信息">
          <a-descriptions :column="3" bordered size="small">
            <a-descriptions-item label="环境 ID">
              <span class="ws-mono">{{ envId }}</span>
              <span class="tip">系统自增，创建后不可改</span>
            </a-descriptions-item>
            <a-descriptions-item label="名称">{{ envInfo.name }}</a-descriptions-item>
            <a-descriptions-item label="归属站点">
              <a-tag>{{ envInfo.siteKey }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="排序">
              <span class="ws-tabular">{{ envInfo.sort }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="前端产物目录" :span="2">
              <span class="ws-mono">/static/modules/&lt;appKey&gt;/{{ envId }}/</span>
            </a-descriptions-item>
          </a-descriptions>
        </a-tab-pane>

        <!-- 后端服务指向 -->
        <a-tab-pane key="backend" tab="后端服务指向">
          <p class="hint hint-top">
            该环境下 API 网关把请求转发到哪个服务地址。修改后该环境的前端请求立即指向新地址（网关缓存 ≤60s 生效）。
          </p>
          <a-table
            :columns="columns"
            :data-source="serviceRoutes"
            row-key="serviceKey"
            size="middle"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'serviceKey'">
                <span class="ws-mono">{{ record.serviceKey }}</span>
                <span class="svc-name">{{ record.serviceName }}</span>
                <a-tag v-if="!record.configured" class="tag-warn">未配置</a-tag>
              </template>
              <template v-else-if="column.key === 'upstreamUrl'">
                <span class="ws-mono" :class="{ muted: !record.configured }">{{ upstreamOf(record) }}</span>
              </template>
              <template v-else-if="column.key === 'hostName'">
                <span v-if="record.hostName" class="ws-mono">{{ record.hostName }}</span>
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'port'">
                <span class="ws-mono ws-tabular">{{ record.port ?? '—' }}</span>
              </template>
              <template v-else-if="column.key === 'enabled'">
                <a-switch
                  :checked="record.enabled"
                  size="small"
                  @change="(v: any) => toggleServiceEnabled(record, !!v)"
                />
              </template>
              <template v-else-if="column.key === 'action'">
                <a type="link" @click="openEdit(record)">修改</a>
              </template>
            </template>
          </a-table>
          <p class="hint">
            服务本身的注册（仓库目录 / 探活路径 / 接口清单）在「服务管理」内维护；此处只配该环境的"指向"。
          </p>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 修改指向 -->
    <a-modal
      :open="editOpen"
      :title="`修改指向 · ${editing?.serviceKey || ''}`"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitEdit"
      @cancel="editOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="目标主机" required>
          <a-input v-model:value="form.hostName" placeholder="如 server-dev / 175.27.189.123" @blur="syncUpstream" />
          <div class="field-hint">必填：未配置主机时部署会 fail-fast，不允许静默回落到本机</div>
        </a-form-item>
        <a-form-item label="端口">
          <a-input-number v-model:value="form.port" :min="1" :max="65535" style="width: 100%" @blur="syncUpstream" />
        </a-form-item>
        <a-form-item label="上游地址">
          <a-input v-model:value="form.upstreamUrl" placeholder="http://server-dev:6101" />
          <div class="field-hint">留空则用「主机 + 端口」自动拼装</div>
        </a-form-item>
        <a-form-item label="运行时">
          <a-select v-model:value="form.runtime" allow-clear placeholder="继承主机/环境默认">
            <a-select-option value="pm2">pm2</a-select-option>
            <a-select-option value="docker">docker</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.env-detail {
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
  line-height: 1.7;
}
.panel {
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card, 0 2px 12px rgba(20, 30, 50, 0.06));
}
.tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.svc-name {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.tag-warn {
  margin-left: 6px;
  color: var(--ws-color-warning, #d46b08);
  border-color: var(--ws-color-warning, #d46b08);
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
.hint-top {
  margin: 0 0 12px;
}
.field-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
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
