<script setup lang="ts">
/**
 * 应用管理（微前端域）
 *
 * 应用 = 微前端域的可发布构建单元（portal / admin / shell / 小程序 / 后续子模块）。
 * 子模块与顶层应用**同构**，仅用 parentKey 表达归属（列表缩进展示，不做强制层级）。
 * 设计依据：specs/deploy-console-domain-split/design.md §2.2 / page-spec.md §1
 * 数据来源：`GET/POST /api/apps`（双域重构 P1 已接通）
 */
import { ref, computed, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { appsApi, type AppRow, type AppKind, type AppEnvVersionRow } from '@/api'

const router = useRouter()

const KINDS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'shell', label: '基座' },
  { value: 'micro-frontend', label: '微前端' },
  { value: 'spa', label: '独立应用' },
  { value: 'mini-app', label: '小程序' },
]

function kindLabel(kind: string): string {
  return KINDS.find((k) => k.value === kind)?.label || kind
}

const list = ref<AppRow[]>([])
const total = ref(0)
const loading = ref(false)
const keyword = ref('')
const activeKind = ref('all')
const page = ref(1)
const PAGE_SIZE = 20

const columns: TableColumnsType = [
  { title: '应用', key: 'key', width: 240 },
  { title: '类型', key: 'kind', width: 110 },
  { title: '仓库目录', key: 'repoDir' },
  { title: '各环境版本', key: 'envVersions', width: 360 },
  { title: '启用', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 130 },
]

async function load() {
  loading.value = true
  try {
    const res = await appsApi.list({
      kind: activeKind.value === 'all' ? undefined : activeKind.value,
      q: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    list.value = res.items
    total.value = res.total
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载应用列表失败')
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

/** 环境版本徽标：有版本显示版本号，无版本显示占位（只编码"有/无"，不编码类型） */
function envTags(row: AppRow): AppEnvVersionRow[] {
  return row.envVersions || []
}

// ---------- 新建应用（key 创建后不可改） ----------
const formOpen = ref(false)
const saving = ref(false)
const form = reactive({
  key: '',
  name: '',
  kind: 'micro-frontend' as AppKind,
  repoDir: '',
  parentKey: '',
})

const keyValid = computed(() => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(form.key))
const canSubmit = computed(
  () => keyValid.value && !!form.name.trim() && !!form.repoDir.trim() && !saving.value,
)

function openCreate() {
  form.key = ''
  form.name = ''
  form.kind = 'micro-frontend'
  form.repoDir = ''
  form.parentKey = ''
  formOpen.value = true
}

/** 仓库目录默认跟随 key（apps/<dir>），用户可改 */
function onKeyInput() {
  if (!form.repoDir || form.repoDir === form.parentKey) return
  if (/^[a-z0-9_-]*$/.test(form.key)) form.repoDir = form.key
}

async function submitCreate() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    const app = await appsApi.create({
      key: form.key,
      name: form.name.trim(),
      kind: form.kind,
      repoDir: form.repoDir.trim(),
      parentKey: form.parentKey.trim() || undefined,
    })
    formOpen.value = false
    message.success(`应用 ${app.key} 已创建`)
    await load()
  } catch (e: any) {
    // key 冲突（409）与父应用不存在（400）都由服务端给出可读文案
    message.error(e?.response?.data?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <div class="page-head">
      <div>
        <h1>应用管理</h1>
        <p class="sub">
          微前端应用与子模块，按产品特性管理；版本与发布在详情页按环境操作。
        </p>
      </div>
      <a-button type="primary" @click="openCreate">新建应用</a-button>
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
        <span class="count">共 {{ total }} 个应用</span>
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
          showTotal: (t: number) => `共 ${t} 个应用`,
        }"
        @change="(p: any) => onPageChange(p.current)"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'key'">
            <span v-if="record.parentKey" class="tree-mark">└</span>
            <a @click="router.push({ name: 'AppDetail', params: { key: record.key } })">
              <span class="ws-mono">{{ record.key }}</span>
            </a>
            <span class="name">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'kind'">
            <a-tag>{{ kindLabel(record.kind) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'repoDir'">
            <span class="ws-mono">apps/{{ record.repoDir }}</span>
          </template>
          <template v-else-if="column.key === 'envVersions'">
            <span v-if="!envTags(record).length" class="muted">尚未发布</span>
            <a-tag
              v-for="v in envTags(record)"
              :key="v.envId"
              :color="v.currentVersion ? 'blue' : undefined"
              class="env-chip"
            >
              {{ v.envId }}
              <span class="ws-mono">{{ v.currentVersion || '—' }}</span>
            </a-tag>
          </template>
          <template v-else-if="column.key === 'enabled'">
            <a-switch :checked="record.enabled !== false" size="small" disabled />
          </template>
          <template v-else-if="column.key === 'action'">
            <a type="link" @click="router.push({ name: 'AppDetail', params: { key: record.key } })">详情</a>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal
      :open="formOpen"
      title="新建应用"
      :confirm-loading="saving"
      ok-text="创建"
      cancel-text="取消"
      :ok-button-props="{ disabled: !canSubmit }"
      @ok="submitCreate"
      @cancel="formOpen = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="应用 key" required>
          <a-input
            v-model:value="form.key"
            placeholder="如 admin"
            :maxlength="64"
            @input="onKeyInput"
          />
          <div class="field-hint">
            小写字母/数字/下划线/中划线；<strong>创建后不可修改</strong>（gateway manifest 依赖它取版本）
          </div>
          <div v-if="form.key && !keyValid" class="field-error">key 需以字母或数字开头，长度 2–64</div>
        </a-form-item>
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="如 运营后台" :maxlength="32" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="form.kind">
            <a-select-option value="micro-frontend">微前端</a-select-option>
            <a-select-option value="spa">独立应用</a-select-option>
            <a-select-option value="shell">基座</a-select-option>
            <a-select-option value="mini-app">小程序</a-select-option>
          </a-select>
          <div v-if="form.kind === 'shell'" class="field-hint">
            基座固定走「站点 + 版本」，不纳入环境切换
          </div>
        </a-form-item>
        <a-form-item label="仓库目录" required>
          <a-input v-model:value="form.repoDir" placeholder="如 admin" :maxlength="64" />
          <div class="field-hint">对应 apps/&lt;目录&gt;</div>
        </a-form-item>
        <a-form-item label="父应用 key（子模块可选）">
          <a-input v-model:value="form.parentKey" placeholder="留空 = 顶层应用" :maxlength="64" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.app-page {
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
.name {
  margin-left: 8px;
  color: var(--ws-text-tertiary);
  font-size: 12px;
}
.tree-mark {
  color: var(--ws-text-tertiary);
  margin-right: 4px;
}
.env-chip {
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--ws-text-tertiary);
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
