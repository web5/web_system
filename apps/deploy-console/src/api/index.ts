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

  // ===== 自助诊断（任务 23） =====
  restart: (env: string, service: string) =>
    http.post('/monitor/pm2/restart', null, {
      params: { env, service },
    }) as Promise<{ service: string; output: string }>,
  restartLocal: (service: string) =>
    http.post('/monitor/local/pm2/restart', null, {
      params: { service },
    }) as Promise<{ service: string; output: string }>,
  port: (env: string, port: number) =>
    http.get('/monitor/port', { params: { env, port } }) as Promise<{
      port: number
      occupied: boolean
      lines: string[]
    }>,
  localPort: (port: number) =>
    http.get('/monitor/local/port', { params: { port } }) as Promise<{
      port: number
      occupied: boolean
      lines: string[]
    }>,
  searchLogs: (env: string, service: string, keyword: string, lines = 300) =>
    http.get('/monitor/logs', {
      params: { env, service, keyword, lines },
    }) as Promise<{ service: string; logs: string[]; matched?: number }>,
  searchLocalLogs: (service: string, keyword: string, lines = 300) =>
    http.get('/monitor/local/logs', {
      params: { service, keyword, lines },
    }) as Promise<{ service: string; logs: string[]; matched?: number }>,
}

/* ========== Canary（灰度规则） ========== */

export interface CanaryRule {
  id: string
  envId: string
  moduleKey: string
  canaryVersion: string
  matchRule: {
    type: 'percent' | 'user-list' | 'header'
    value?: number
    userIds?: string[]
    key?: string
    values?: string[]
  }
  enabled: boolean
  createdAt: string
}

export const canaryApi = {
  list: (envId?: string, moduleKey?: string) =>
    http.get('/canary', {
      params: { ...(envId ? { envId } : {}), ...(moduleKey ? { moduleKey } : {}) },
    }) as Promise<CanaryRule[]>,
  update: (id: string, data: Partial<CanaryRule>) =>
    http.put(`/canary/${id}`, data) as Promise<CanaryRule>,
  remove: (id: string) => http.delete(`/canary/${id}`) as Promise<{ status: string }>,
  preview: (id: string, userId: string) =>
    http.post(`/canary/${id}/preview`, { userId }) as Promise<{ hit: boolean; rule: CanaryRule }>,
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
        /** 字段级前后 diff（配置类写操作；无则为 undefined） */
        changes?: { field: string; before?: unknown; after?: unknown }[]
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

/** 流水线模板（流程定义；模块下可建多条） */
export interface PipelineTemplate {
  id: string
  moduleKey: string
  name: string
  description?: string
  skipVerify: boolean
  approval: 'inherit' | 'always' | 'never'
  defaultTarget: 'auto' | 'local' | 'remote'
  enabled: boolean
  builtin: boolean
  createdAt: string
  updatedAt: string
}

export interface PipelineItem {
  id: string
  env: string
  moduleKey: string
  versionTag?: string
  mode: string
  /** pending-approval=提交被审批门禁阻断，等待审批 */
  status: 'pending' | 'pending-approval' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  templateId?: string
  /** 模板名快照（旧实例为 null → 展示「默认」） */
  templateName?: string
  skipVerify?: boolean
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
    /** 流水线模板 ID（不传 = 模块默认模板） */
    templateId?: string
    confirm?: boolean
  }) => http.post('/pipelines', dto) as Promise<{ jobId: string; status: string }>,

  list: (params?: { env?: string; moduleKey?: string; limit?: number }) =>
    http.get('/pipelines', { params: params ?? {} }) as Promise<PipelineItem[]>,

  get: (id: string) => http.get(`/pipelines/${id}`) as Promise<PipelineItem>,

  cancel: (id: string) => http.post(`/pipelines/${id}/cancel`) as Promise<{ id: string; status: string }>,

  /** 审批通过（待审批流水线；通过后自动执行） */
  approve: (id: string, comment?: string) =>
    http.post(`/pipelines/${id}/approve`, { comment }) as Promise<{ id: string; status: string }>,

  /** 审批拒绝（拒绝必填意见） */
  reject: (id: string, comment: string) =>
    http.post(`/pipelines/${id}/reject`, { comment }) as Promise<{ id: string; status: string }>,

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

/* ========== Pipeline Templates（流水线模板：流程定义） ========== */

export const pipelineTemplateApi = {
  list: (moduleKey: string) =>
    http.get(`/modules/${moduleKey}/pipeline-templates`) as Promise<PipelineTemplate[]>,
  create: (moduleKey: string, dto: Partial<PipelineTemplate>) =>
    http.post(`/modules/${moduleKey}/pipeline-templates`, dto) as Promise<PipelineTemplate>,
  duplicate: (moduleKey: string, id: string) =>
    http.post(`/modules/${moduleKey}/pipeline-templates/${id}/duplicate`) as Promise<PipelineTemplate>,
  update: (moduleKey: string, id: string, dto: Partial<PipelineTemplate>) =>
    http.put(`/modules/${moduleKey}/pipeline-templates/${id}`, dto) as Promise<PipelineTemplate>,
  remove: (moduleKey: string, id: string) =>
    http.delete(`/modules/${moduleKey}/pipeline-templates/${id}`) as Promise<{ ok: boolean }>,
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

/**
 * 发布度量。
 * 数据来自 deploy_pipelines 的聚合（流水线本身已记录 status/stage/起止时间），无额外埋点。
 */
export const metricsApi = {
  overview: (params?: { env?: string; moduleKey?: string; from?: number; to?: number }) =>
    http.get('/metrics/releases/overview', { params }) as Promise<{
      total: number
      succeeded: number
      failed: number
      running: number
      cancelled: number
      successRate: number | null
      avgDurationSec: number | null
      p95DurationSec: number | null
    }>,
  trend: (params?: { env?: string; moduleKey?: string; from?: number; to?: number }) =>
    http.get('/metrics/releases/trend', { params }) as Promise<
      { date: string; succeeded: number; failed: number }[]
    >,
  stageFailures: (params?: { env?: string; moduleKey?: string; from?: number; to?: number }) =>
    http.get('/metrics/releases/stage-failures', { params }) as Promise<
      { stage: string; count: number }[]
    >,
  topModules: (params?: { env?: string; from?: number; to?: number; limit?: number }) =>
    http.get('/metrics/releases/top-modules', { params }) as Promise<
      { moduleKey: string; count: number }[]
    >,
  failures: (params?: {
    env?: string
    moduleKey?: string
    stage?: string
    from?: number
    to?: number
    limit?: number
  }) =>
    http.get('/metrics/releases/failures', { params }) as Promise<
      {
        id: string
        moduleKey: string
        env: string
        versionTag: string | null
        stage: string | null
        error: string | null
        startTime: number
        endTime: number | null
        operator: string | null
      }[]
    >,
}

/** 通知中心：站内历史 */
export const notificationApi = {
  list: (limit?: number) =>
    http.get('/notifications', { params: { limit } }) as Promise<
      {
        id: string
        event: string
        env: string
        moduleKey: string
        versionTag: string | null
        status: string
        detail: string
        operator: string | null
        delivery: Record<string, string> | null
        createdAt: string
      }[]
    >,
}

/** 系统设置：通知渠道配置（DB 可配，env 兜底） */
export const systemSettingsApi = {
  getNotifyChannels: () =>
    http.get('/system-settings/notify-channels') as Promise<{
      webhookUrl: string | null
      wecomUrl: string | null
    }>,
  updateNotifyChannels: (dto: { webhookUrl?: string | null; wecomUrl?: string | null }) =>
    http.put('/system-settings/notify-channels', dto) as Promise<{ ok: boolean }>,

  /** 审批门禁：需要审批的环境（逗号分隔，默认 prod） */
  getApprovalEnvs: () =>
    http.get('/system-settings/approval-envs') as Promise<{ envs: string }>,
  updateApprovalEnvs: (envs: string) =>
    http.put('/system-settings/approval-envs', { envs }) as Promise<{ ok: boolean }>,
}

export default http
