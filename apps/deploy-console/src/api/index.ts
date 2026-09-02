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
  moduleDeployments: (moduleKey: string) =>
    http.get(`/deploy/module-deployments/${moduleKey}`) as Promise<{
      moduleKey: string
      environments: {
        envId: string
        currentVersion: string
        status: string
        deployedAt: string | null
        deployedBy: string | null
      }[]
      versionHistory: {
        id: string
        env: string
        component: string
        versionTag: string
        gitCommit?: string
        gitBranch?: string
        releasedBy?: string
        releasedAt: string
        taskId?: string
        status: string
        note?: string
      }[]
    }>,
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
        /** 服务地址映射：{ moduleKey: 'host:port' 或域名 } */
        addresses?: Record<string, string>
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
        address: string
        status: 'up' | 'down'
        response?: string
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
  localPm2: () =>
    http.get('/monitor/local/pm2') as Promise<
      {
        name: string
        status: 'online' | 'stopped' | 'errored'
        cpu: number
        memory: number
        uptime: number
        restarts: number
      }[]
    >,
  localHealth: () =>
    http.get('/monitor/local/health') as Promise<
      {
        service: string
        address: string
        status: 'up' | 'down'
        response?: string
        responseTime: number
      }[]
    >,
  localLogs: (service: string, lines = 100) =>
    http.get('/monitor/local/logs', {
      params: { service, lines },
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

  serviceOverview: () =>
    http.get('/env-service-routes/overview') as Promise<
      {
        serviceName: string
        serviceType: string
        environments: {
          envId: string
          address: string
          serverName: string
          port?: number
        }[]
      }[]
    >,
}

/* ========== Pipelines（发布流水线） ========== */

export interface PipelineItem {
  id: string
  env: string
  moduleKey: string
  versionTag?: string
  mode: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  stage?: string
  progress?: { current: number; total: number; message?: string }
  logs?: string[]
  error?: string
  operator?: string
  gitBranch?: string
  gitCommit?: string
  grayscaleRule?: Record<string, unknown>
  canaryRuleId?: string
  result?: Record<string, unknown>
  startTime: number
  endTime?: number
  reuseArtifact?: boolean
}

export const pipelineApi = {
  submit: (dto: {
    env: string
    moduleKey: string
    /** 目标分支（默认 master），发布基于远程仓库该分支拉取代码 */
    branch?: string
    /** 目标 commit（git 短哈希，默认分支最新） */
    commitId?: string
    mode?: 'direct' | 'grayscale'
    /** @deprecated 等价 commitId */
    versionTag?: string
    target?: 'local' | 'remote'
    grayscaleRule?: Record<string, unknown>
    confirm?: boolean
  }) => http.post('/pipelines', dto) as Promise<{ jobId: string; status: string }>,

  list: (params?: { env?: string; moduleKey?: string; limit?: number }) =>
    http.get('/pipelines', { params: params ?? {} }) as Promise<PipelineItem[]>,

  get: (id: string) => http.get(`/pipelines/${id}`) as Promise<PipelineItem>,

  cancel: (id: string) => http.post(`/pipelines/${id}/cancel`) as Promise<{ id: string; status: string }>,

  promote: (id: string) =>
    http.post(`/pipelines/${id}/promote`) as Promise<{ id: string; versionTag: string }>,

  /** 可发布版本（含磁盘上未登记版本表的历史产物） */
  releases: (env?: string, component?: string) =>
    http.get('/pipelines/meta/releases', {
      params: { ...(env ? { env } : {}), ...(component ? { component } : {}) },
    }) as Promise<
      {
        versionTag: string
        component?: string
        env?: string
        gitCommit?: string
        gitBranch?: string
        releasedBy?: string
        releasedAt?: string
        status?: string
        note?: string
        /** db=版本表记录；artifact=磁盘产物（未登记版本表） */
        source?: 'db' | 'artifact'
      }[]
    >,
}

/* ========== Hooks（发布脚本，各阶段自定义 shell） ========== */

export const STAGES = [
  'check',
  'pull',
  'build',
  'upload',
  'restart',
  'version',
  'pointer',
  'verify',
  'cleanup',
] as const

export const hookApi = {
  list: (key: string) =>
    http.get(`/modules/${key}/hooks`) as Promise<
      { stage: string; configured: boolean; enabled: boolean; updatedAt?: string; updatedBy?: string }[]
    >,
  get: (key: string, stage: string) =>
    http.get(`/modules/${key}/hooks/${stage}`) as Promise<{
      id?: string
      moduleKey: string
      stage: string
      script: string
      enabled: boolean
      updatedBy?: string
    } | null>,
  save: (key: string, stage: string, script: string) =>
    http.put(`/modules/${key}/hooks/${stage}`, { script }) as Promise<{
      moduleKey: string
      stage: string
      updatedAt: string
    }>,
  remove: (key: string, stage: string) =>
    http.delete(`/modules/${key}/hooks/${stage}`) as Promise<{ ok: boolean }>,
  validate: (key: string, stage: string, script: string) =>
    http.post(`/modules/${key}/hooks/${stage}/validate`, { script }) as Promise<{
      ok: boolean
      message: string
    }>,
  templates: (type: string) =>
    http.get('/modules/hooks/templates', { params: { type } }) as Promise<Record<string, string>>,
}

/**
 * 可配置阶段：version / pointer 是发布语义真相源，固定由流水线执行，不可配置。
 * 其中 **build 必须配置命令**（未配置即 fail-fast），其余阶段未配置则回落到内置逻辑。
 */
export const CONFIGURABLE_STAGES = [
  'check',
  'pull',
  'build',
  'upload',
  'restart',
  'verify',
  'cleanup',
] as const

/** 阶段命令：发布流水线唯一执行真相源（替代已废弃的 hookApi） */
export const stageCommandApi = {
  list: (key: string) =>
    http.get(`/modules/${key}/stage-commands`) as Promise<
      {
        stage: string
        configured: boolean
        command: string | null
        enabled: boolean
        timeoutSec: number | null
        updatedAt?: string
        updatedBy?: string
      }[]
    >,
  get: (key: string, stage: string) =>
    http.get(`/modules/${key}/stage-commands/${stage}`) as Promise<{
      command: string
      timeoutSec?: number
    } | null>,
  save: (key: string, stage: string, command: string, timeoutSec?: number) =>
    http.put(`/modules/${key}/stage-commands/${stage}`, { command, timeoutSec }) as Promise<{
      moduleKey: string
      stage: string
      updatedAt: string
    }>,
  remove: (key: string, stage: string) =>
    http.delete(`/modules/${key}/stage-commands/${stage}`) as Promise<{ ok: boolean }>,
  validate: (key: string, stage: string, command: string) =>
    http.post(`/modules/${key}/stage-commands/${stage}/validate`, { command }) as Promise<{
      ok: boolean
      message: string
    }>,
  template: (type: string) =>
    http.get('/modules/stage-commands/templates', { params: { type } }) as Promise<string | null>,
}

/**
 * 配置中心（仅控制台 JWT 可访问）。
 * 安全边界：密钥在接口层即返回掩码，前端拿不到明文，也就不可能误展示。
 */
export const configApi = {
  list: (scope?: string, envId?: string, moduleKey?: string) =>
    http.get('/config/items', { params: { scope, envId, moduleKey } }) as Promise<
      {
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
      }[]
    >,
  save: (dto: {
    scope: string
    envId?: string
    moduleKey?: string
    key: string
    value: string
    isSecret?: boolean
    description?: string
  }) => http.put('/config/items', dto) as Promise<{ id: string; key: string }>,
  remove: (id: string) => http.delete(`/config/items/${id}`) as Promise<{ ok: boolean }>,
  snapshot: (envId: string, moduleKey: string, versionTag: string) =>
    http.post('/config/snapshots', { envId, moduleKey, versionTag }) as Promise<{ id: string }>,
  restore: (envId: string, moduleKey: string, versionTag: string) =>
    http.post('/config/snapshots/restore', { envId, moduleKey, versionTag }) as Promise<number>,
}

export default http
