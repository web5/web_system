<script setup lang="ts">
/**
 * 环境管理（微前端域）
 *
 * 环境 = 微前端的加载维度：每个 envId 对应一个产物目录 /static/modules/<appKey>/<envId>/。
 * 设计依据：specs/deploy-console-domain-split/environment-design.md
 * 数据来源：`GET/POST/PUT/DELETE /api/envs`（双域重构 P1 已接通，搜索与分页走服务端）
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { envsApi, type EnvRow, type SiteRow } from '@/api'

const router = useRouter()

const list = ref<EnvRow[]>([])
const sites = ref<SiteRow[]>([])
const total = ref(0)
const loading = ref(false)
const keyword = ref('')
const activeSite = ref<string>('all')
const page = ref(1)
const PAGE_SIZE = 20

/** 站点筛选（含"全部"），选项来自站点接口而非硬编码 */
const siteFilters = computed(() => [
  { value: 'all', label: '全部' },
  ...sites.value.map((s) => ({ value: s.key, label: s.key })),
])

/** 可创建环境的站点（prod 站点唯一，不再允许新建） */
const createSites = computed(() => sites.value.filter((s) => s.key !== 'prod'))

async function load() {
  loading.value = true
  try {
    const res = await envsApi.list({
      siteKey: activeSite.value === 'all' ? undefined : activeSite.value,
      q: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    list.value = res.items
    total.value = res.total
  } catch (e: any) {
    message.error(e?.response?.data?.message || '环境列表加载失败')
  } finally {
    loading.value = false
  }
}

async function loadSites() {
  try {
    sites.value = await envsApi.sites()
  } catch {
    /* 站点拉取失败不阻断环境列表（筛选退化为仅"全部"） */
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

const columns: TableColumnsType = [
  { title: '环境 ID（目录名）', dataIndex: 'envId', key: 'envId', width: 190 },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '站点', dataIndex: 'siteKey', key: 'siteKey', width: 100 },
  { title: '类型', dataIndex: 'isProd', key: 'isProd', width: 100 },
  { title: '排序', dataIndex: 'sort', key: 'sort', width: 80, align: 'right' },
  { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 100 },
]

// ---------- 新建环境（envId 由系统自增） ----------
const formOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', siteKey: 'dev' })

function openCreate() {
  form.name = ''
  form.siteKey = createSites.value[0]?.key || 'dev'
  formOpen.value = true
}

async function submitCreate() {
  if (!form.name.trim()) {
    message.error('请填写环境名称')
    return
  }
  saving.value = true
  try {
    const env = await envsApi.create({ name: form.name.trim(), siteKey: form.siteKey })
    formOpen.value = false
    message.success(`环境已创建，envId = ${env.envId}`)
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

// ---------- 删除（占用由服务端判定并阻断） ----------
function removeEnv(row: EnvRow) {
  if (row.builtin) return
  Modal.confirm({
    title: '删除环境',
    content: `删除后 envId=${row.envId} 的产物目录不再被加载，历史版本记录保留。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await envsApi.remove(row.envId)
        message.success('已删除')
        await load()
      } catch (e: any) {
        // 服务端返回占用者清单（"仍有 N 个应用在该环境有部署记录：admin、portal"）
        Modal.warning({
          title: '无法删除环境',
          content: e?.response?.data?.message || '删除失败',
          okText: '知道了',
        })
      }
    },
  })
}

async function toggleEnabled(row: EnvRow, checked: boolean) {
  try {
    await envsApi.update(row.envId, { enabled: checked })
    row.enabled = checked
    message.success(checked ? '已启用' : '已停用')
  } catch (e: any) {
    row.enabled = !checked
    message.error(e?.response?.data?.message || '更新失败')
  }
}

onMounted(async () => {
  await loadSites()
  await load()
})
</script>

<template>
  <div class="env-page">
    <div class="page-head">
      <div>
        <h1>环境管理</h1>
        <p class="sub">
          微前端加载环境：每个环境对应一个产物目录
          <code>/static/modules/&lt;appKey&gt;/&lt;envId&gt;/</code>，用户在产品页面用切换插件选择。
        </p>
      </div>
      <a-button type="primary" @click="openCreate">新建环境</a-button>
    </div>

    <a-card :bordered="false" class="panel">
      <div class="filters">
        <a-radio-group v-model:value="activeSite" button-style="solid" @change="reloadFromFirstPage">
          <a-radio-button v-for="s in siteFilters" :key="s.value" :value="s.value">{{ s.label }}</a-radio-button>
        </a-radio-group>
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索环境 ID / 名称"
          style="width: 260px"
          allow-clear
          @search="reloadFromFirstPage"
        />
        <span class="count">共 {{ total }} 个环境</span>
      </div>

      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        row-key="envId"
        size="middle"
        :pagination="{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t: number) => `共 ${t} 个环境`,
        }"
        @change="(p: any) => onPageChange(p.current)"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'envId'">
            <a @click="router.push({ name: 'EnvironmentDetail', params: { envId: record.envId } })">
              <span class="ws-mono">{{ record.envId }}</span>
            </a>
            <a-tag v-if="record.builtin" class="tag-builtin">内置</a-tag>
          </template>
          <template v-else-if="column.key === 'siteKey'">
            <a-tag>{{ record.siteKey }}</a-tag>
          </template>
          <template v-else-if="column.key === 'isProd'">
            <a-tag v-if="record.isProd" color="orange">生产</a-tag>
            <span v-else class="muted">{{ record.siteKey === 'local' ? '本地' : '开发' }}</span>
          </template>
          <template v-else-if="column.key === 'sort'">
            <span class="ws-tabular">{{ record.sort }}</span>
          </template>
          <template v-else-if="column.key === 'enabled'">
            <a-switch :checked="record.enabled" size="small" @change="(v: any) => toggleEnabled(record, !!v)" />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-tooltip :title="record.builtin ? '内置环境不可删除' : ''">
              <a type="link" :disabled="record.builtin" @click="removeEnv(record)">删除</a>
            </a-tooltip>
          </template>
        </template>
      </a-table>

      <p class="hint">
        环境 ID 由系统自增（内置 dev / local / prod 为保留字）；prod 唯一，dev / local 可多环境；
        请求的 envId 找不到时回退 <code>dev</code>。
      </p>
    </a-card>

    <a-modal
      :open="formOpen"
      title="新建环境"
      :confirm-loading="saving"
      ok-text="创建"
      cancel-text="取消"
      @ok="submitCreate"
      @cancel="formOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="环境 ID">
          <a-input value="系统自增，创建后分配" disabled />
          <div class="field-hint">作为产物目录名与 URL 段，用户不可填写</div>
        </a-form-item>
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="如 联调环境" :maxlength="32" />
        </a-form-item>
        <a-form-item label="归属站点">
          <a-select v-model:value="form.siteKey">
            <a-select-option v-for="s in createSites" :key="s.key" :value="s.key">
              {{ s.key }}（{{ s.host }}）
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.env-page {
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
  line-height: 1.7;
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
.muted {
  color: var(--ws-text-tertiary);
}
.tag-builtin {
  margin-left: 6px;
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
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--ws-text-secondary);
}
</style>
