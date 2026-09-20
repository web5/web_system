<script setup lang="ts">
/**
 * 主机管理（基础设施）
 *
 * 主机组 = 服务环境指向的**地址来源**：`deploy_service_envs.host_name` 引用 `name`，
 * 转发/SSH 发布都取 `host`。IP 只在此一处维护，换机器只改这里（Q17 方案 D）。
 * 设计依据：specs/deploy-console-domain-split/page-spec.md §6 / §9.3
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import { hostsApi, type HostRow, type HostRuntime } from '@/api'

const loading = ref(false)
const saving = ref(false)
const rows = ref<HostRow[]>([])
const keyword = ref('')

const columns: TableColumnsType = [
  { title: '主机组名', key: 'name', width: 180 },
  { title: '地址（IP/域名）', key: 'host', width: 190 },
  { title: 'SSH 用户', key: 'sshUser', width: 120 },
  { title: '部署根目录', key: 'remoteDir' },
  { title: '运行时', key: 'runtime', width: 100 },
  { title: '启用', key: 'enabled', width: 90 },
  { title: '操作', key: 'action', width: 120 },
]

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((r) =>
    [r.name, r.host, r.sshUser, r.remoteDir].some((v) => String(v).toLowerCase().includes(kw)),
  )
})

async function load() {
  loading.value = true
  try {
    rows.value = await hostsApi.list()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '主机列表加载失败')
  } finally {
    loading.value = false
  }
}

// ---------- 新增 / 编辑 ----------
const open = ref(false)
const editingName = ref<string | null>(null)
const form = reactive({
  name: '',
  host: '',
  sshUser: '',
  sshKeyPath: '',
  remoteDir: '',
  runtime: 'pm2' as HostRuntime,
  enabled: true,
})

function openCreate() {
  editingName.value = null
  Object.assign(form, {
    name: '',
    host: '',
    sshUser: '',
    sshKeyPath: '',
    remoteDir: '',
    runtime: 'pm2' as HostRuntime,
    enabled: true,
  })
  open.value = true
}

function openEdit(row: HostRow) {
  editingName.value = row.name
  Object.assign(form, {
    name: row.name,
    host: row.host,
    sshUser: row.sshUser,
    sshKeyPath: row.sshKeyPath || '',
    remoteDir: row.remoteDir,
    runtime: row.runtime,
    enabled: row.enabled,
  })
  open.value = true
}

async function submit() {
  if (!form.name.trim() || !form.host.trim()) {
    message.error('主机组名与地址必填')
    return
  }
  if (!form.sshUser.trim() || !form.remoteDir.trim()) {
    message.error('SSH 用户与部署根目录必填')
    return
  }
  saving.value = true
  try {
    if (editingName.value) {
      await hostsApi.update(editingName.value, {
        host: form.host.trim(),
        sshUser: form.sshUser.trim(),
        sshKeyPath: form.sshKeyPath.trim() || null,
        remoteDir: form.remoteDir.trim(),
        runtime: form.runtime,
        enabled: form.enabled,
      })
      message.success('主机组已更新')
    } else {
      await hostsApi.create({
        name: form.name.trim(),
        host: form.host.trim(),
        sshUser: form.sshUser.trim(),
        sshKeyPath: form.sshKeyPath.trim() || undefined,
        remoteDir: form.remoteDir.trim(),
        runtime: form.runtime,
        enabled: form.enabled,
      })
      message.success('主机组已创建')
    }
    open.value = false
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row: HostRow, checked: boolean) {
  try {
    await hostsApi.update(row.name, { enabled: checked })
    row.enabled = checked
    message.success(checked ? '已启用' : '已停用')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '更新失败')
  }
}

function remove(row: HostRow) {
  Modal.confirm({
    title: '删除主机组',
    content: `删除后「${row.name}」不再可被服务指向引用（仍被引用的会先阻断并列出引用方）。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        const res = await hostsApi.remove(row.name)
        if (!res.removed && res.occupants?.length) {
          message.error(`仍被引用：${res.occupants.join('、')}`)
          return
        }
        message.success('已删除')
        await load()
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

onMounted(load)
</script>

<template>
  <div class="host-manager">
    <div class="page-head">
      <div>
        <h1>主机管理</h1>
        <p class="sub">
          部署目标主机（组）与地址。服务在各环境的「指向」引用这里的<b>主机组名</b>，
          转发与 SSH 发布取<b>地址</b> —— IP 只在此一处维护。
        </p>
      </div>
      <a-button type="primary" @click="openCreate">新增主机</a-button>
    </div>

    <a-card :bordered="false" class="panel">
      <div class="bar">
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索组名 / 地址 / SSH 用户 / 目录"
          style="width: 280px"
          allow-clear
        />
      </div>

      <a-table
        :columns="columns"
        :data-source="filtered"
        row-key="name"
        size="middle"
        :loading="loading"
        :pagination="false"
      >
        <template #emptyText>
          <span class="muted">尚未登记主机，服务各环境将无法配置目标主机（探活与部署会 fail-fast）</span>
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span class="ws-mono">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'host'">
            <span class="ws-mono">{{ record.host }}</span>
          </template>
          <template v-else-if="column.key === 'sshUser'">
            <span class="ws-mono">{{ record.sshUser }}</span>
          </template>
          <template v-else-if="column.key === 'remoteDir'">
            <span class="ws-mono">{{ record.remoteDir }}</span>
          </template>
          <template v-else-if="column.key === 'runtime'">
            <a-tag>{{ record.runtime }}</a-tag>
          </template>
          <template v-else-if="column.key === 'enabled'">
            <a-switch
              :checked="record.enabled"
              size="small"
              @change="(v: any) => toggleEnabled(record, !!v)"
            />
          </template>
          <template v-else-if="column.key === 'action'">
            <a type="link" @click="openEdit(record)">编辑</a>
            <a-divider type="vertical" />
            <a type="link" @click="remove(record)">删除</a>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal
      :open="open"
      :title="editingName ? `编辑主机组 · ${editingName}` : '新增主机组'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="submit"
      @cancel="open = false"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="主机组名" required>
          <a-input
            v-model:value="form.name"
            :disabled="!!editingName"
            placeholder="如 dev-default"
            class="ws-mono"
          />
          <div class="field-hint">
            小写字母/数字/短横线；是服务指向的<b>引用键</b>，创建后不可改
          </div>
        </a-form-item>
        <a-form-item label="地址（IP 或域名）" required>
          <a-input v-model:value="form.host" placeholder="如 175.27.189.123" class="ws-mono" />
          <div class="field-hint">转发与 SSH 发布都取它</div>
        </a-form-item>
        <a-form-item label="SSH 用户" required>
          <a-input v-model:value="form.sshUser" placeholder="如 ubuntu" class="ws-mono" />
        </a-form-item>
        <a-form-item label="部署根目录" required>
          <a-input v-model:value="form.remoteDir" placeholder="如 /data/web_system" class="ws-mono" />
        </a-form-item>
        <a-form-item label="SSH 私钥路径">
          <a-input v-model:value="form.sshKeyPath" placeholder="留空用默认部署密钥" class="ws-mono" />
        </a-form-item>
        <a-form-item label="运行时">
          <a-select v-model:value="form.runtime">
            <a-select-option value="pm2">pm2</a-select-option>
            <a-select-option value="docker">docker</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="状态">
          <a-checkbox v-model:checked="form.enabled">启用</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.host-manager {
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
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.muted {
  color: var(--ws-text-tertiary);
}
.field-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.ws-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
