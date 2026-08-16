<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { serverApi, environmentApi } from '@/api'

// ============ 服务器组 ============
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

// 按 serverName 分组展示
const serverGroups = computed(() => {
  const map = new Map<string, any[]>()
  for (const s of serverList.value) {
    if (!map.has(s.serverName)) map.set(s.serverName, [])
    map.get(s.serverName)!.push(s)
  }
  return Array.from(map.entries()).map(([name, servers]) => ({ name, servers }))
})

// ============ 环境服务路由 ============
const routeList = ref<any[]>([])
const routeLoading = ref(false)
const envList = ref<any[]>([])
const routeEnvFilter = ref<string>('')

const routeFormVisible = ref(false)
const routeSaving = ref(false)
const routeForm = reactive({
  envId: '',
  serviceName: '',
  serverName: '',
  port: undefined as number | undefined,
})

const serverNameOptions = computed(() =>
  Array.from(new Set(serverList.value.map((s) => s.serverName))),
)

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

function onRouteEnvChange() {
  loadRoutes()
}

function openRouteCreate() {
  Object.assign(routeForm, {
    envId: routeEnvFilter.value || '',
    serviceName: '',
    serverName: serverNameOptions.value[0] || '',
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

onMounted(async () => {
  await loadServers()
  await loadRoutes()
  try {
    envList.value = await environmentApi.list()
  } catch {
    /* 环境列表加载失败不阻塞 */
  }
})
</script>

<template>
  <div class="server-manager">
    <a-tabs default-active-key="servers">
      <!-- 服务器组 -->
      <a-tab-pane key="servers" tab="服务器组">
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between;">
          <span style="color: #888; font-size: 13px;">
            一个 serverName 可指向多台服务器（多副本/负载均衡）
          </span>
          <a-button type="primary" @click="openServerCreate">新增服务器</a-button>
        </div>
        <a-table
          :data-source="serverGroups"
          :loading="serverLoading"
          :pagination="false"
          row-key="name"
          size="middle"
        >
          <a-table-column title="服务器组 (serverName)" data-index="name" />
          <a-table-column title="主机列表" key="hosts">
            <template #default="{ record }">
              <a-tag v-for="s in record.servers" :key="s.id" color="blue">
                {{ s.host }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="SSH 用户" key="sshUser">
            <template #default="{ record }">{{ record.servers[0]?.sshUser }}</template>
          </a-table-column>
          <a-table-column title="部署目录" key="remoteDir">
            <template #default="{ record }">{{ record.servers[0]?.remoteDir }}</template>
          </a-table-column>
          <a-table-column title="操作" key="action" width="200">
            <template #default="{ record }">
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
          </a-table-column>
        </a-table>
      </a-tab-pane>

      <!-- 环境服务路由 -->
      <a-tab-pane key="routes" tab="环境服务路由">
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between;">
          <a-space>
            <span style="color: #888; font-size: 13px;">环境：</span>
            <a-select
              v-model:value="routeEnvFilter"
              style="width: 160px;"
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
          :data-source="routeList"
          :loading="routeLoading"
          :pagination="false"
          row-key="id"
          size="middle"
        >
          <a-table-column title="环境" data-index="envId" width="100" />
          <a-table-column title="服务名" data-index="serviceName" />
          <a-table-column title="服务器组" data-index="serverName" />
          <a-table-column title="端口" data-index="port" width="90">
            <template #default="{ text }">{{ text || '—' }}</template>
          </a-table-column>
          <a-table-column title="操作" key="action" width="100">
            <template #default="{ record }">
              <a-button type="link" danger size="small" @click="removeRoute(record)">
                删除
              </a-button>
            </template>
          </a-table-column>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- 服务器表单 -->
    <a-modal
      v-model:open="serverFormVisible"
      title="新增服务器"
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

    <!-- 路由表单 -->
    <a-modal
      v-model:open="routeFormVisible"
      title="新增环境服务路由"
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
        <a-form-item label="端口（可选）">
          <a-input-number v-model:value="routeForm.port" style="width: 100%;" placeholder="覆盖环境默认端口" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.server-manager {
  padding: 16px;
}
</style>
