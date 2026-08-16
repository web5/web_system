<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { moduleApi, serverApi, environmentApi } from '@/api'

// ============ 类型定义 ============
const TYPE_OPTIONS = [
  { value: 'backend', label: '后端服务（pm2 部署）', color: 'blue' },
  { value: 'frontend', label: '前端模块（打包到网关）', color: 'green' },
  { value: 'micro-frontend', label: '微前端模块（shell 加载）', color: 'purple' },
  { value: 'mini-app', label: '小程序', color: 'orange' },
] as const

function typeLabel(type: string): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label || type
}
function typeColor(type: string): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.color || 'default'
}

// ============ 服务列表（Tab 1） ============
const moduleList = ref<any[]>([])
const moduleLoading = ref(false)
const typeFilter = ref<string | undefined>(undefined)

const moduleFormVisible = ref(false)
const moduleSaving = ref(false)
const editingKey = ref('')

const moduleForm = reactive({
  key: '',
  name: '',
  type: 'backend' as 'backend' | 'frontend' | 'micro-frontend' | 'mini-app',
  dir: '',
  pm2: '',
  publicPath: '',
  buildCmd: '',
  enabled: true,
})

async function loadModules() {
  moduleLoading.value = true
  try {
    moduleList.value = await moduleApi.list()
  } catch {
    message.error('加载服务列表失败')
  } finally {
    moduleLoading.value = false
  }
}

function resetModuleForm() {
  Object.assign(moduleForm, {
    key: '',
    name: '',
    type: 'backend' as const,
    dir: '',
    pm2: '',
    publicPath: '',
    buildCmd: '',
    enabled: true,
  })
}

function openModuleCreate() {
  editingKey.value = ''
  resetModuleForm()
  moduleFormVisible.value = true
}

function openModuleEdit(m: any) {
  editingKey.value = m.key
  Object.assign(moduleForm, {
    key: m.key,
    name: m.name || '',
    type: m.type || 'backend',
    dir: m.dir || '',
    pm2: m.pm2 || '',
    publicPath: m.publicPath || '',
    buildCmd: m.buildCmd || '',
    enabled: m.enabled !== false,
  })
  moduleFormVisible.value = true
}

async function submitModuleForm() {
  if (!moduleForm.key || !moduleForm.name) {
    message.error('服务 key 和名称必填')
    return
  }
  moduleSaving.value = true
  try {
    const dto: any = {
      key: moduleForm.key.trim(),
      name: moduleForm.name.trim(),
      type: moduleForm.type,
      dir: moduleForm.dir.trim() || `servers/${moduleForm.key.trim()}`,
      pm2: moduleForm.pm2.trim() || undefined,
      publicPath: moduleForm.publicPath.trim() || undefined,
      buildCmd: moduleForm.buildCmd.trim() || undefined,
      enabled: moduleForm.enabled,
    }
    if (editingKey.value) {
      await moduleApi.update(editingKey.value, dto)
      message.success('服务已更新')
    } else {
      await moduleApi.create(dto)
      message.success('服务已创建')
    }
    moduleFormVisible.value = false
    await loadModules()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    moduleSaving.value = false
  }
}

function removeModule(m: any) {
  if (m.builtin) {
    message.warn('内置服务不可删除')
    return
  }
  Modal.confirm({
    title: '确认删除',
    content: `确认删除服务 ${m.name}（${m.key}）吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await moduleApi.remove(m.key)
        message.success('已删除')
        await loadModules()
      } catch (err: any) {
        message.error(err?.response?.data?.message || '删除失败')
      }
    },
  })
}

const filteredModules = computed(() => {
  if (!typeFilter.value) return moduleList.value
  return moduleList.value.filter((m: any) => m.type === typeFilter.value)
})

// ============ 环境服务路由（Tab 2） ============
const routeList = ref<any[]>([])
const routeLoading = ref(false)
const envList = ref<any[]>([])
const routeEnvFilter = ref<string | undefined>(undefined)

const routeFormVisible = ref(false)
const routeSaving = ref(false)
const routeForm = reactive({
  envId: '',
  serviceName: '',
  serverName: '',
  port: undefined as number | undefined,
})

async function loadRoutes() {
  routeLoading.value = true
  try {
    routeList.value = await serverApi.listRoutes(routeEnvFilter.value || undefined)
  } catch {
    message.error('加载路由列表失败')
  } finally {
    routeLoading.value = false
  }
}

async function loadEnvList() {
  try {
    envList.value = await environmentApi.list()
  } catch {
    /* 路由 tab 不阻塞 */
  }
}

function onRouteEnvChange() {
  loadRoutes()
}

function openRouteCreate() {
  Object.assign(routeForm, {
    envId: routeEnvFilter.value || '',
    serviceName: '',
    serverName: '',
    port: undefined,
  })
  routeFormVisible.value = true
}

async function submitRoute() {
  if (!routeForm.envId || !routeForm.serviceName || !routeForm.serverName) {
    message.warning('请填写环境、服务名和服务器组')
    return
  }
  routeSaving.value = true
  try {
    await serverApi.createRoute({ ...routeForm })
    message.success('路由已保存')
    routeFormVisible.value = false
    await loadRoutes()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存路由失败')
  } finally {
    routeSaving.value = false
  }
}

function removeRoute(row: any) {
  Modal.confirm({
    title: '删除路由',
    content: `确定删除 ${row.envId} / ${row.serviceName} → ${row.serverName}？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await serverApi.removeRoute(row.id)
        message.success('已删除')
        await loadRoutes()
      } catch {
        message.error('删除失败')
      }
    },
  })
}

// ============ 服务器组（Tab 3） ============
const serverList = ref<any[]>([])
const serverLoading = ref(false)
const serverFormVisible = ref(false)
const serverSaving = ref(false)
const serverForm = reactive({
  serverName: '',
  host: '',
  sshUser: 'root',
  sshKeyPath: '~/.ssh/id_ed25519_servers',
  remoteDir: '/data/web_system',
})

async function loadServers() {
  serverLoading.value = true
  try {
    serverList.value = await serverApi.listServers()
  } catch {
    message.error('加载服务器列表失败')
  } finally {
    serverLoading.value = false
  }
}

const serverNameOptions = computed(() =>
  Array.from(new Set(serverList.value.map((s: any) => s.serverName))),
)

function openServerCreate() {
  Object.assign(serverForm, {
    serverName: '',
    host: '',
    sshUser: 'root',
    sshKeyPath: '~/.ssh/id_ed25519_servers',
    remoteDir: '/data/web_system',
  })
  serverFormVisible.value = true
}

async function submitServer() {
  if (!serverForm.serverName || !serverForm.host) {
    message.warning('请填写服务器组名和主机')
    return
  }
  serverSaving.value = true
  try {
    await serverApi.createServer({ ...serverForm })
    message.success('服务器已添加')
    serverFormVisible.value = false
    await loadServers()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '添加服务器失败')
  } finally {
    serverSaving.value = false
  }
}

function removeServer(row: any) {
  Modal.confirm({
    title: '删除服务器',
    content: `确定删除 ${row.serverName}@${row.host}？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await serverApi.removeServer(row.id)
        message.success('已删除')
        await loadServers()
      } catch {
        message.error('删除失败')
      }
    },
  })
}

// 按 serverName 分组
const serverGroups = computed(() => {
  const map = new Map<string, any[]>()
  for (const s of serverList.value) {
    if (!map.has(s.serverName)) map.set(s.serverName, [])
    map.get(s.serverName)!.push(s)
  }
  return Array.from(map.entries()).map(([name, servers]) => ({ name, servers }))
})

// ============ 初始化 ============
onMounted(async () => {
  await Promise.all([loadModules(), loadRoutes(), loadEnvList(), loadServers()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>服务管理</h2>
      <p>服务注册表 + 环境路由 + 服务器组，统一管理服务在多环境的部署关系。一个 serverName 可指向多台服务器（多副本 / 负载均衡），每个环境独立配置「服务名 → serverName」路由。</p>
    </div>

    <a-tabs default-active-key="modules">
      <!-- ========== Tab 1: 服务列表 ========== -->
      <a-tab-pane key="modules" tab="服务列表">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <a-space>
            <span>共 {{ moduleList.length }} 个服务</span>
            <a-select
              v-model:value="typeFilter"
              placeholder="按类型筛选"
              allow-clear
              style="width: 200px;"
            >
              <a-select-option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">
                {{ t.label }}
              </a-select-option>
            </a-select>
          </a-space>
          <a-button type="primary" @click="openModuleCreate">新建服务</a-button>
        </div>

        <a-table
          :columns="[
            { title: 'key', dataIndex: 'key', key: 'key', width: 180 },
            { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
            { title: '类型', dataIndex: 'type', key: 'type', width: 200 },
            { title: '目录', dataIndex: 'dir', key: 'dir' },
            { title: 'pm2 / publicPath', key: 'meta', width: 220 },
            { title: '状态', key: 'status', width: 100 },
            { title: '操作', key: 'action', width: 160 },
          ]"
          :data-source="filteredModules"
          :loading="moduleLoading"
          :pagination="false"
          row-key="key"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <a-tag :color="typeColor(record.type)">{{ typeLabel(record.type) }}</a-tag>
              <a-tag v-if="record.builtin" color="gold" style="margin-left: 4px;">内置</a-tag>
            </template>
            <template v-else-if="column.key === 'meta'">
              <span v-if="record.pm2" style="margin-right: 8px;">pm2={{ record.pm2 }}</span>
              <span v-if="record.publicPath">pub={{ record.publicPath }}</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <a-tag :color="record.enabled !== false ? 'green' : 'default'">
                {{ record.enabled !== false ? '启用' : '禁用' }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button type="link" size="small" @click="openModuleEdit(record)">编辑</a-button>
              <a-button type="link" size="small" danger :disabled="record.builtin" @click="removeModule(record)">删除</a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ========== Tab 2: 环境服务路由 ========== -->
      <a-tab-pane key="routes" tab="环境服务路由">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <a-space>
            <span style="color: #888; font-size: 13px;">环境：</span>
            <a-select
              v-model:value="routeEnvFilter"
              style="width: 200px;"
              placeholder="全部环境"
              allow-clear
              @change="onRouteEnvChange"
            >
              <a-select-option v-for="e in envList" :key="e.id" :value="e.id">
                {{ e.name }}（{{ e.id }}）
              </a-select-option>
            </a-select>
          </a-space>
          <a-button type="primary" @click="openRouteCreate">新增路由</a-button>
        </div>
        <a-table
          :columns="[
            { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
            { title: '服务名', dataIndex: 'serviceName', key: 'serviceName', width: 180 },
            { title: '服务器组', dataIndex: 'serverName', key: 'serverName', width: 200 },
            { title: '端口', dataIndex: 'port', key: 'port', width: 100 },
            { title: '操作', key: 'action', width: 100 },
          ]"
          :data-source="routeList"
          :loading="routeLoading"
          :pagination="false"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'port'">
              {{ record.port || '—' }}
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button type="link" danger size="small" @click="removeRoute(record)">删除</a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ========== Tab 3: 服务器组 ========== -->
      <a-tab-pane key="servers" tab="服务器组">
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between;">
          <span style="color: #888; font-size: 13px;">一个 serverName 可指向多台服务器（多副本/负载均衡）</span>
          <a-button type="primary" @click="openServerCreate">新增服务器</a-button>
        </div>
        <a-table
          :columns="[
            { title: '服务器组 (serverName)', dataIndex: 'name', key: 'name', width: 220 },
            { title: '主机列表', key: 'hosts' },
            { title: 'SSH 用户', key: 'sshUser', width: 120 },
            { title: '部署目录', key: 'remoteDir', width: 220 },
            { title: '操作', key: 'action', width: 240 },
          ]"
          :data-source="serverGroups"
          :loading="serverLoading"
          :pagination="false"
          row-key="name"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'hosts'">
              <a-tag v-for="s in record.servers" :key="s.id" color="blue" style="margin-bottom: 2px;">
                {{ s.host }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'sshUser'">
              {{ record.servers[0]?.sshUser }}
            </template>
            <template v-else-if="column.key === 'remoteDir'">
              {{ record.servers[0]?.remoteDir }}
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button
                v-for="s in record.servers"
                :key="s.id"
                type="link"
                danger
                size="small"
                style="margin-right: 8px;"
                @click="removeServer(s)"
              >
                删除 {{ s.host }}
              </a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- 服务编辑弹窗 -->
    <a-modal
      :title="editingKey ? `编辑服务 ${editingKey}` : '新建服务'"
      v-model:open="moduleFormVisible"
      :footer="null"
      :destroy-on-close="true"
      width="640px"
    >
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="服务 key（唯一，不可改）">
              <a-input v-model:value="moduleForm.key" :disabled="!!editingKey" placeholder="如 auth-service" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="名称">
              <a-input v-model:value="moduleForm.name" placeholder="如 认证服务" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="类型">
              <a-select v-model:value="moduleForm.type">
                <a-select-option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">
                  {{ t.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="代码目录（相对仓库根）">
              <a-input v-model:value="moduleForm.dir" placeholder="servers/auth-service" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="pm2 进程名（后端用）">
              <a-input v-model:value="moduleForm.pm2" placeholder="如 auth-service" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="publicPath（前端模块挂载路径）">
              <a-input v-model:value="moduleForm.publicPath" placeholder="如 /auth-service/" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="buildCmd（前端模块构建命令）">
          <a-input v-model:value="moduleForm.buildCmd" placeholder="如 cd apps/auth-service && pnpm build" />
        </a-form-item>
        <a-form-item label="启用">
          <a-switch v-model:checked="moduleForm.enabled" />
        </a-form-item>
        <div style="margin-top: 8px;">
          <a-button type="primary" :loading="moduleSaving" @click="submitModuleForm">{{ editingKey ? '保存' : '创建' }}</a-button>
          <a-button style="margin-left: 8px;" @click="moduleFormVisible = false">取消</a-button>
        </div>
      </a-form>
    </a-modal>

    <!-- 路由编辑弹窗 -->
    <a-modal
      title="新增环境服务路由"
      v-model:open="routeFormVisible"
      :confirm-loading="routeSaving"
      @ok="submitRoute"
    >
      <a-form layout="vertical">
        <a-form-item label="环境" required>
          <a-select v-model:value="routeForm.envId" placeholder="选择环境">
            <a-select-option v-for="e in envList" :key="e.id" :value="e.id">
              {{ e.name }}（{{ e.id }}）
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="服务名" required>
          <a-input v-model:value="routeForm.serviceName" placeholder="如 gateway / ai-service" />
        </a-form-item>
        <a-form-item label="服务器组 (serverName)" required>
          <a-select v-model:value="routeForm.serverName" placeholder="选择服务器组">
            <a-select-option v-for="n in serverNameOptions" :key="n" :value="n">
              {{ n }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="端口（可选，覆盖环境默认）">
          <a-input-number v-model:value="routeForm.port" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 服务器编辑弹窗 -->
    <a-modal
      title="新增服务器"
      v-model:open="serverFormVisible"
      :confirm-loading="serverSaving"
      @ok="submitServer"
    >
      <a-form layout="vertical">
        <a-form-item label="服务器组名 (serverName)" required>
          <a-input v-model:value="serverForm.serverName" placeholder="如 dev-web / prod-gpu" />
        </a-form-item>
        <a-form-item label="SSH 主机" required>
          <a-input v-model:value="serverForm.host" placeholder="IP 或域名" />
        </a-form-item>
        <a-form-item label="SSH 用户">
          <a-input v-model:value="serverForm.sshUser" />
        </a-form-item>
        <a-form-item label="SSH 私钥路径">
          <a-input v-model:value="serverForm.sshKeyPath" />
        </a-form-item>
        <a-form-item label="部署根目录">
          <a-input v-model:value="serverForm.remoteDir" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>