import axios from 'axios'
import { message } from 'ant-design-vue'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

const http = axios.create({
  baseURL: '/console/api',
  timeout: 30000,
})

// 请求拦截器：添加 Authorization 头
http.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore()
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// 响应拦截器：处理 401
http.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const isLoginRequest = error.config?.url?.endsWith('/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      const authStore = useAuthStore()
      authStore.logout()
      message.error('登录已过期，请重新登录')
      router.push('/login')
    }
    return Promise.reject(error)
  },
)

/* ========== Auth ========== */
export const authApi = {
  login: (username: string, password: string) =>
    http.post('/auth/login', { username, password }) as Promise<{
      token: string
      user: { username: string; role: string }
    }>,
  profile: () =>
    http.get('/auth/profile') as Promise<{
      username: string
      role: string
    }>,
}

/* ========== Deploy ========== */
export const deployApi = {
  build: (component: string) =>
    http.post('/deploy/build', { component }) as Promise<{ taskId: string }>,
  deploy: (env: string, component: string, confirm = false) =>
    http.post('/deploy/deploy', { env, component, confirm }) as Promise<{
      taskId: string
    }>,
  rollback: (env: string, tag: string, confirm = false) =>
    http.post('/deploy/rollback', { env, tag, confirm }) as Promise<{
      taskId: string
    }>,
  publishVersion: (env: string, versionTag: string, confirm = false) =>
    http.post('/deploy/publish-version', { env, versionTag, confirm }) as Promise<{
      status: string
      message: string
      component: string
      versionTag: string
    }>,
  tasks: () =>
    http.get('/deploy/tasks') as Promise<
      {
        id: string
        env: string
        component: string
        status: string
        startedAt: string
        finishedAt: string
        logs: string[]
      }[]
    >,
  task: (id: string) =>
    http.get(`/deploy/task/${id}`) as Promise<{
      id: string
      env: string
      component: string
      status: string
      startedAt: string
      finishedAt: string
      logs: string[]
    }>,
  releases: (env: string) =>
    http.get('/deploy/releases', { params: { env } }) as Promise<
      { tag: string; date: string; size: string }[]
    >,
  modules: () =>
    http.get('/deploy/modules') as Promise<
      {
        key: string
        name: string
        type: 'backend' | 'frontend' | 'micro-frontend' | 'mini-app'
        dir: string
        pm2?: string
        publicPath?: string
        buildCmd?: string
        entry?: string
        description?: string
        builtin?: boolean
        enabled?: boolean
      }[]
    >,
  currentVersions: (env: string) =>
    http.get('/deploy/current-versions', { params: { env } }) as Promise<
      {
        envId: string
        moduleKey: string
        moduleName: string
        currentVersion: string
        status: string
        deployedAt: string
        deployedBy: string
      }[]
    >,
  versions: (env?: string) =>
    http.get('/deploy/versions', { params: env ? { env } : {} }) as Promise<
      {
        id: string
        env: string
        component: string
        versionTag: string
        gitCommit?: string
        gitBranch?: string
        releasedBy?: string
        releasedAt: string
        status: string
      }[]
    >,
}

/* ========== Environments ========== */
export const environmentApi = {
  list: () =>
    http.get('/environments') as Promise<
      {
        id: string
        name: string
        publicUrl?: string
        ports?: Record<string, number>
        builtin: boolean
      }[]
    >,
  get: (id: string) => http.get(`/environments/${id}`) as Promise<any>,
  create: (dto: any) => http.post('/environments', dto) as Promise<any>,
  update: (id: string, dto: any) => http.put(`/environments/${id}`, dto) as Promise<any>,
  remove: (id: string) => http.delete(`/environments/${id}`) as Promise<any>,
}

/* ========== Modules（模块注册表） ========== */
export const moduleApi = {
  list: () => http.get('/modules') as Promise<any[]>,
  get: (key: string) => http.get(`/modules/${key}`) as Promise<any>,
  create: (dto: any) => http.post('/modules', dto) as Promise<any>,
  update: (key: string, dto: any) => http.put(`/modules/${key}`, dto) as Promise<any>,
  remove: (key: string) => http.delete(`/modules/${key}`) as Promise<any>,
}

/* ========== Monitor ========== */
export const monitorApi = {
  health: (env: string) =>
    http.get('/monitor/health', { params: { env } }) as Promise<
      {
        service: string
        port: number
        status: 'up' | 'down'
        responseTime: number
      }[]
    >,
  pm2: (env: string) =>
    http.get('/monitor/pm2', { params: { env } }) as Promise<
      {
        name: string
        status: 'online' | 'stopped' | 'errored'
        cpu: number
        memory: number
        uptime: number
        restarts: number
      }[]
    >,
  logs: (env: string, service: string, lines = 100) =>
    http.get('/monitor/logs', {
      params: { env, service, lines },
    }) as Promise<{ lines: string[] }>,
}

/* ========== Audit ========== */
export const auditApi = {
  list: (page: number, limit: number) =>
    http.get('/audit/list', { params: { page, limit } }) as Promise<{
      total: number
      data: {
        id: number
        timestamp: string
        user: string
        action: string
        env: string
        component: string
        status: string
        detail: string
      }[]
    }>,
}

/* ========== Servers（服务器组 + 环境服务路由） ========== */
export const serverApi = {
  listServers: (serverName?: string) =>
    http.get('/servers', { params: serverName ? { serverName } : {} }) as Promise<
      {
        id: string
        serverName: string
        host: string
        sshUser: string
        sshKeyPath?: string
        remoteDir: string
        createdAt: string
      }[]
    >,
  createServer: (dto: {
    serverName: string
    host: string
    sshUser: string
    sshKeyPath?: string
    remoteDir: string
  }) => http.post('/servers', dto) as Promise<any>,
  removeServer: (id: string) => http.delete(`/servers/${id}`) as Promise<any>,

  listRoutes: (env?: string) =>
    http.get('/env-service-routes', { params: env ? { env } : {} }) as Promise<
      {
        id: string
        envId: string
        serviceName: string
        serverName: string
        port?: number
        createdAt: string
      }[]
    >,
  createRoute: (dto: { envId: string; serviceName: string; serverName: string; port?: number }) =>
    http.post('/env-service-routes', dto) as Promise<any>,
  removeRoute: (id: string) => http.delete(`/env-service-routes/${id}`) as Promise<any>,
}

export default http
