<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { configApi, environmentApi, moduleApi, serverApi } from '@/api'
import { message, Modal } from 'ant-design-vue'

const activeTab = ref('kv')

interface ConfigRow {
  id: string
  scope: string
  envId: string
  moduleKey: string
  key: string
  value: string
  isSecret: boolean
  enabled: boolean
  description?: string
  updatedBy?: string
  updatedAt?: string
}

const SCOPES = [
  { value: 'global', label: '全局默认' },
  { value: 'env', label: '环境级' },
  { value: 'module', label: '模块级' },
]

const loading = ref(false)
const rows = ref<ConfigRow[]>([])
const envs = ref<Array<{ id: string; name: string }>>([])
const modules = ref<Array<{ key: string; name: string }>>([])

const filterScope = ref<string | undefined>(undefined)
const filterEnv = ref<string | undefined>(undefined)
const filterModule = ref<string | undefined>(undefined)

async function load() {
  loading.value = true
  try {
    rows.value = await configApi.list(filterScope.value, filterEnv.value, filterModule.value)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载配置失败')
  } finally {
    loading.value = false
  }
}

// ===== 环境信息视图（环境自身参数 + 服务器组路由） =====
interface EnvInfo {
  id: string
  name: string
  builtin: boolean
  publicUrl?: string
  ports?: Record<string, string>
  /** 该环境下 serviceName -> serverName */
  routeMap: Record<string, string>
}
const envInfos = ref<EnvInfo[]>([])

async function loadEnvInfo() {
  try {
    const [envList, routes] = await Promise.all([
      environmentApi.list() as Promise<EnvInfo[]>,
      serverApi.listRoutes(),
    ])
    const routeMap: Record<string, Record<string, string>> = {}
    for (const r of routes) {
      ;(routeMap[r.envId] = routeMap[r.envId] || {})[r.serviceName] = r.serverName
    }
    envInfos.value = envList.map((e) => ({ ...e, routeMap: routeMap[e.id] || {} }))
  } catch {
    message.error('加载环境信息失败')
  }
}

function openCreateForEnv(envId: string) {
  editing.value = { scope: 'env', envId, key: '', value: '', isSecret: false, moduleKey: '' }
  modalOpen.value = true
}

async function loadOptions() {
  try {
    envs.value = await environmentApi.list()
  } catch {
    /* 非致命：下拉为空不影响列表查看 */
  }
  try {
    const list = await moduleApi.list()
    modules.value = (list ?? []).map((m: any) => ({ key: m.key, name: m.name || m.key }))
  } catch {
    /* 同上 */
  }
}

// ── 新增 / 编辑 ──
const modalOpen = ref(false)
const editing = ref<Partial<ConfigRow>>({})

function openCreate() {
  editing.value = { scope: 'global', key: '', value: '', isSecret: false, envId: '', moduleKey: '' }
  modalOpen.value = true
}

function openEdit(row: ConfigRow) {
  // 密钥不回显：值留空，提示需重新输入
  editing.value = { ...row, value: row.isSecret ? '' : row.value }
  modalOpen.value = true
}

async function save() {
  const e = editing.value
  if (!e.key?.trim()) {
    message.warning('请填写配置键')
    return
  }
  if (e.scope === 'env' && !e.envId) {
    message.warning('环境级配置需选择环境')
    return
  }
  if (e.scope === 'module' && (!e.envId || !e.moduleKey)) {
    message.warning('模块级配置需选择环境与模块')
    return
  }
  if (e.isSecret && !e.value) {
    message.warning('密钥不可读回，请重新输入新的密钥值')
    return
  }
  if (!e.isSecret && !e.value) {
    message.warning('请填写配置值')
    return
  }

  try {
    await configApi.save({
      scope: e.scope!,
      envId: e.scope === 'global' ? undefined : e.envId,
      moduleKey: e.scope === 'module' ? e.moduleKey : undefined,
      // 上方已校验非空（密钥要求重新输入、非密钥要求填写）
      key: e.key!,
      value: e.value!,
      isSecret: e.isSecret,
      description: e.description,
    })
    message.success('已保存')
    modalOpen.value = false
    await load()
  } catch (err: any) {
    message.error(err?.response?.data?.message || '保存失败')
  }
}

function remove(row: ConfigRow) {
  Modal.confirm({
    title: `删除配置 ${row.key}？`,
    content: '删除后该配置不再注入进程',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await configApi.remove(row.id)
        message.success('已删除')
        await load()
      } catch {
        message.error('删除失败')
      }
    },
  })
}

onMounted(async () => {
  await Promise.all([loadOptions(), load(), loadEnvInfo()])
})
</script>

<template>
  <div>
    <a-tabs v-model:activeKey="activeTab">
      <a-tab-pane key="kv" tab="键值配置">
        <a-card title="键值配置（作用域覆盖注入）">
      <template #extra>
        <a-space wrap>
          <a-select
            v-model:value="filterScope"
            placeholder="作用域"
            allow-clear
            style="width: 130px;"
            @change="load"
          >
            <a-select-option v-for="s in SCOPES" :key="s.value" :value="s.value">
              {{ s.label }}
            </a-select-option>
          </a-select>
          <a-select
            v-model:value="filterEnv"
            placeholder="环境"
            allow-clear
            style="width: 140px;"
            @change="load"
          >
            <a-select-option v-for="e in envs" :key="e.id" :value="e.id">
              {{ e.name }}
            </a-select-option>
          </a-select>
          <a-select
            v-model:value="filterModule"
            placeholder="模块"
            allow-clear
            style="width: 160px;"
            @change="load"
          >
            <a-select-option v-for="m in modules" :key="m.key" :value="m.key">
              {{ m.name }}
            </a-select-option>
          </a-select>
          <a-button @click="load">刷新</a-button>
          <a-button type="primary" @click="openCreate">新增配置</a-button>
        </a-space>
      </template>

      <a-table
        :data-source="rows"
        :loading="loading"
        row-key="id"
        :pagination="{ pageSize: 20 }"
        :locale="{ emptyText: '暂无键值配置。可将环境级参数（如 PUBLIC_URL / DB_HOST）以「环境级」新增；各环境自身信息见「环境信息」' }"
      >
        <a-table-column title="配置键" data-index="key" />
        <a-table-column title="值">
          <template #default="{ record }">
            <span v-if="record.isSecret" style="color: #999;">
              {{ record.value }}
              <a-tag color="orange" style="margin-left: 4px;">密钥·不可读</a-tag>
            </span>
            <span v-else>{{ record.value }}</span>
          </template>
        </a-table-column>
        <a-table-column title="作用域" data-index="scope" />
        <a-table-column title="环境" data-index="envId" />
        <a-table-column title="模块" data-index="moduleKey" />
        <a-table-column title="最后编辑人" data-index="updatedBy" />
        <a-table-column title="操作">
          <template #default="{ record }">
            <a-space>
              <a-button size="small" @click="openEdit(record)">编辑</a-button>
              <a-button size="small" danger @click="remove(record)">删除</a-button>
            </a-space>
          </template>
        </a-table-column>
      </a-table>

      <div style="margin-top: 12px; color: #888; font-size: 12px; line-height: 1.9;">
        生效优先级：<code>模块级 &gt; 环境级 &gt; 全局默认</code>，后者覆盖前者。<br />
        发布/重启时按此合并后<b>强制覆盖</b>注入进程环境——这正是历史
        <code>PORT=6200</code> 污染的对策，<b>请勿在 shell 全局预设里写死 PORT 等变量</b>。<br />
        密钥以 AES-256-GCM 加密存储，页面只显示掩码、不支持读取明文；修改密钥需重新输入真实值。
      </div>
        </a-card>
      </a-tab-pane>

      <!-- 环境信息视图 -->
      <a-tab-pane key="env" tab="环境信息">
        <a-card title="环境参数">
          <p style="color: #666; margin-bottom: 12px;">
            每个部署环境的自身信息（公网地址、后端服务地址映射、服务器组路由）在「环境管理」中维护，此处只读汇总；环境的运行参数/变量请作为<b>环境级配置</b>新增。
          </p>
          <a-table
            :data-source="envInfos"
            :pagination="false"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无环境' }"
          >
            <a-table-column title="环境" data-index="id">
              <template #default="{ record }">
                <b>{{ record.name }}</b>（{{ record.id }}）
                <a-tag v-if="record.builtin" color="blue" style="margin-left: 4px;">内置</a-tag>
              </template>
            </a-table-column>
            <a-table-column title="公网地址" key="url">
              <template #default="{ record }">{{ record.publicUrl || '—' }}</template>
            </a-table-column>
            <a-table-column title="服务地址（后端模块）" key="ports">
              <template #default="{ record }">
                <template v-if="record.ports && Object.keys(record.ports).length">
                  <a-tag v-for="(addr, mod) in record.ports" :key="mod" style="margin-bottom: 2px;">
                    {{ mod }} → {{ addr }}
                  </a-tag>
                </template>
                <span v-else style="color: #bbb;">—</span>
              </template>
            </a-table-column>
            <a-table-column title="服务器组（服务 → 组）" key="routes">
              <template #default="{ record }">
                <template v-if="Object.keys(record.routeMap).length">
                  <a-tag
                    v-for="(srv, svc) in record.routeMap"
                    :key="svc"
                    color="geekblue"
                    style="margin-bottom: 2px;"
                  >
                    {{ svc }} → {{ srv }}
                  </a-tag>
                </template>
                <span v-else style="color: #bbb;">—</span>
              </template>
            </a-table-column>
            <a-table-column title="操作" key="action" width="240">
              <template #default="{ record }">
                <a-space>
                  <a-button size="small" @click="openCreateForEnv(record.id)">为该环境新增配置</a-button>
                  <a-button size="small" type="link" @click="$router.push('/environments')">环境管理</a-button>
                </a-space>
              </template>
            </a-table-column>
          </a-table>
          <div style="margin-top: 12px; color: #888; font-size: 12px;">
            提示：环境相关的运行参数/变量请在此新增为<b>环境级配置</b>（如 <code>PUBLIC_URL</code>、<code>DB_HOST</code>），
            发布/重启时按 global → env → module 优先级合并注入对应进程。
          </div>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <a-modal
      v-model:open="modalOpen"
      :title="editing.id ? '编辑配置' : '新增配置'"
      ok-text="保存"
      cancel-text="取消"
      @ok="save"
    >
      <a-form layout="vertical">
        <a-form-item label="作用域">
          <a-select v-model:value="editing.scope">
            <a-select-option v-for="s in SCOPES" :key="s.value" :value="s.value">
              {{ s.label }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item v-if="editing.scope !== 'global'" label="环境">
          <a-select v-model:value="editing.envId" placeholder="选择环境">
            <a-select-option v-for="e in envs" :key="e.id" :value="e.id">
              {{ e.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item v-if="editing.scope === 'module'" label="模块">
          <a-select v-model:value="editing.moduleKey" placeholder="选择模块">
            <a-select-option v-for="m in modules" :key="m.key" :value="m.key">
              {{ m.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="配置键">
          <a-input v-model:value="editing.key" placeholder="如 PORT / DB_PASSWORD" />
        </a-form-item>

        <a-form-item label="配置值">
          <a-input
            v-model:value="editing.value"
            :placeholder="editing.isSecret ? '输入新的密钥值（原值不可读回）' : '配置值'"
          />
        </a-form-item>

        <a-form-item>
          <a-checkbox v-model:checked="editing.isSecret">
            密钥（加密存储、页面掩码、不可读明文）
          </a-checkbox>
        </a-form-item>

        <a-form-item label="说明">
          <a-input v-model:value="editing.description" placeholder="可选" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>
