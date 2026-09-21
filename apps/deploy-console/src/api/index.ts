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
  /**
   * 部署某版本到某环境 = **改指针**（把环境当前版本指向该版本目录）。
   * 不做探活验证（改指针基本不会失败），验证由人工确认、后续接 AI 验证 agent。
   */
  deployVersion: (moduleKey: string, env: string, versionTag: string) =>
    http.post(`/deploy/modules/${moduleKey}/envs/${env}/deploy`, { versionTag }) as Promise<{
      env: string
      moduleKey: string
      versionTag: string
    }>,
  /**
   * 回滚到某版本（秒级，不重新构建）。
   * 后台模块：把该版本目录落地到 dist 并重启 pm2；前台模块：只改指针。
   * 不传 `to` = 回滚到上一个版本。
   */
  rollbackVersion: (body: { env: string; moduleKey: string; to?: string; confirm?: boolean }) =>
    http.post('/deploy/rollback-version', body) as Promise<{
      moduleKey: string
      env: string
      from: string
      to: string
      status: string
    }>,
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
}

/* ========== Environments（1:N：环境归属模块） ========== */

/** 模块的环境行（子资源 /modules/:key/environments） */
export interface ModuleEnvRow {
  moduleKey: string
  id: string
  name: string
  publicUrl?: string
  address?: string
  serverName?: string
  port?: number
  builtin: boolean
}

/** 环境字典行（跨模块去重，/environments?moduleKey=） */
export interface EnvDictRow {
  id: string
  name: string
  publicUrl?: string
  builtin: boolean
  moduleCount: number
}

export const environmentApi = {
  /** 环境字典（跨模块聚合，供筛选下拉）；传 moduleKey 则返回该模块的环境行 */
  list: (moduleKey?: string) =>
    http.get('/environments', { params: { moduleKey } }) as Promise<EnvDictRow[] | ModuleEnvRow[]>,
  /** 某模块的环境列表（主入口） */
  listByModule: (moduleKey: string) =>
    http.get(`/modules/${moduleKey}/environments`) as Promise<ModuleEnvRow[]>,
  create: (moduleKey: string, dto: any) =>
    http.post(`/modules/${moduleKey}/environments`, dto) as Promise<ModuleEnvRow>,
  update: (moduleKey: string, id: string, dto: any) =>
    http.put(`/modules/${moduleKey}/environments/${id}`, dto) as Promise<ModuleEnvRow>,
  remove: (moduleKey: string, id: string) =>
    http.delete(`/modules/${moduleKey}/environments/${id}`) as Promise<{
      ok: boolean
      cascade: { deployments: number; routes: number; canaryRules: number; versions: number }
    }>,
}

/* ========== Modules（模块注册表） ========== */
export const moduleApi = {
  list: () => http.get('/modules') as Promise<any[]>,
  get: (key: string) => http.get(`/modules/${key}`) as Promise<any>,
  create: (dto: any) => http.post('/modules', dto) as Promise<any>,
  update: (key: string, dto: any) => http.put(`/modules/${key}`, dto) as Promise<any>,
  remove: (key: string) => http.delete(`/modules/${key}`) as Promise<any>,
  /** 列出模块对应代码目录的 git 远程分支（origin/*），含当前分支与 HEAD */
  branches: (key: string) =>
    http.get(`/modules/${key}/branches`) as Promise<{
      branches: string[]
      current: string | null
      head: string | null
    }>,
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

/* ========== Pipelines（发布流水线） ========== */

/**
 * 流水线节点（终态：只有 shell / approval 两类）。
 *
 * - `shell`：跑命令的节点（拉代码 / 构建 / 发布…）；平台能力（写版本、切指针…）
 *   是它里面的一个 `service` action，不再是节点类型；
 * - `approval`：审批节点，执行到它挂起、批准后从其后继续；
 * - `script` / `platform`：**历史数据**（旧名 / 旧平台节点），仅读取兼容。
 */
export interface TemplateNode {
  kind: 'shell' | 'script' | 'platform' | 'approval'
  /** 节点 key（git | build | release | 自定义）；version/pointer 为保留字不可用作节点名 */
  key: string
  /** shell/approval 节点展示名（旧 platform 由前端映射） */
  label?: string
  /** shell：未配脚本时跳过发布（默认必配 fail-fast） */
  optional?: boolean
  /** script：该节点失败触发自动回滚（全局仅 1 个） */
  watchdog?: boolean
  timeoutSec?: number
}

/**
 * 保留字节点名（不可作为节点 key；stage_commands 也不可写）。
 * 终态：git 已放开（拉码是普通 shell 节点）；version/pointer 保留——
 * 它们的能力已变成 `service` action，同名节点会造成语义误读。
 */
export const PLATFORM_NODE_KEYS = ['version', 'pointer'] as const

/** platform 节点展示 label（前端映射，避免每次传） */
export const PLATFORM_NODE_LABELS: Record<string, string> = {
  git: 'git · 拉取代码',
  version: '写版本号',
  pointer: '切指针',
}

/** 流水线（流程定义；模块下可建多条） */
export interface PipelineTemplate {
  id: string
  moduleKey: string
  name: string
  /** 流水线 key（slug，产物命名空间用：modules/<模块>/<key>/<版本>/） */
  key?: string
  /** 归属环境（local/dev/prod…）；一个模块默认三条流水线；null=全局流水线不限环境 */
  env?: string | null
  description?: string
  /** 活动阶段子集（null=全量九阶段） */
  steps?: string[] | null
  /** v5 节点序列：null=legacy（steps 语义）；platform+script */
  nodes?: TemplateNode[] | null
  skipVerify: boolean
  /** verify 失败自动回滚 previous/none */
  rollbackOnFailure?: 'previous' | 'none'
  approval: 'inherit' | 'always' | 'never'
  defaultTarget: 'auto' | 'local' | 'remote'
  enabled: boolean
  builtin: boolean
  /**
   * 流水线级审批人（用户名）。仅作白名单，能否审批仍看权限码
   * `deploy:pipeline:approve`；节点未指定 approvers 时继承这里。
   */
  approvers?: string[] | null
  createdAt: string
  updatedAt: string
}

/** 工具目录项（service=平台内置执行器；shell=外部 CLI） */
export interface ToolItem {
  code: string
  name: string
  kind: 'service' | 'shell'
  category: string
  description?: string
  example?: string
  /** 可复用命令正文（shell 工具，可被阶段命令编辑器插入） */
  command?: string
  available: boolean
  builtin: boolean
  updatedAt?: string
}

/** 可审批人（来自 user-service，按权限码筛选） */
export interface ApproverUser {
  id: string
  username: string
  nickname?: string
  roles: string[]
}

/** 任务级执行状态（镜像自 servers/deploy-console/src/pipeline-orchestration/orchestration-engine.ts） */
export type TaskRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'awaiting' | 'cancelled'

export interface PipelineItem {
  id: string
  env: string
  moduleKey: string
  versionTag?: string
  mode: string
  /**
   * pending-approval=提交被审批门禁阻断（尚未执行任何阶段）
   * awaiting-approval=执行到 approval 节点挂起（批准后从该节点之后继续）
   */
  status:
    | 'pending'
    | 'pending-approval'
    | 'awaiting-approval'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
  templateId?: string
  /** 流水线名快照（旧实例为 null → 展示「默认」） */
  templateName?: string
  skipVerify?: boolean
  /** 活动阶段快照（null=全量九阶段） */
  steps?: string[] | null
  /** v5 节点快照：null=legacy（steps 语义）；platform+script */
  nodes?: TemplateNode[] | null
  /**
   * 编排快照（新引擎实例）：步骤→任务→动作整树；null=旧链路（nodes/legacy）。
   * 详情页画布据此渲染与编辑页同构的只读流程图（specs/pipeline-task-status/design.md）。
   * 引擎快照内 id 必有值（编辑器类型里 id 可选是新建态语义）。
   */
  orchestration?: OrchestrationStep[] | null
  /** 任务级执行状态（key=`${step.id}/${task.id}`）；null=未记录（旧实例） */
  taskStates?: Record<string, TaskRunStatus> | null
  rollbackOnFailure?: 'previous' | 'none'
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

/** 发布版本候选行：`versionTag` 是完整引用（`default/91f744b`），`commit` 是纯短哈希（提交用） */
export interface ReleaseCandidate {
  versionTag: string
  /** 纯 commit（由 versionTag 末段推导）——提交接口只接受纯短哈希 */
  commit: string
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
}

/**
 * 从版本引用取纯 commit（`default/91f744b` → `91f744b`）。
 *
 * 为什么需要：版本列表给的是**完整引用**，而提交接口的 `commitId` 按纯短哈希设计
 * （白名单不含 `/`）——直接透传会 400「目标 commit 含非法字符」。UI 侧统一在这里收敛。
 */
export function commitOf(versionTag: string): string {
  const i = (versionTag || '').lastIndexOf('/')
  return i >= 0 ? versionTag.slice(i + 1) : versionTag
}

export const pipelineRunsApi = {
  /** 按分支列最近提交（origin/<branch> git log；提交发布时选 commit，留空=最新） */
  branchCommits: (branch: string, limit = 20) =>
    http.get(`/pipelines/branch-commits`, { params: { branch, limit } }) as Promise<
      { hash: string; short: string; subject: string; author: string; date: string }[]
    >,

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
    /** 流水线 ID（不传 = 模块默认流水线） */
    templateId?: string
    confirm?: boolean
  }) => http.post('/pipelines', dto) as Promise<{ jobId: string; status: string }>,

  list: (params?: { env?: string; moduleKey?: string; pipelineId?: string; limit?: number }) =>
    http.get('/pipelines', { params: params ?? {} }) as Promise<PipelineItem[]>,

  get: (id: string) => http.get(`/pipelines/${id}`) as Promise<PipelineItem>,

  cancel: (id: string) => http.post(`/pipelines/${id}/cancel`) as Promise<{ id: string; status: string }>,

  /** 重试失败的实例（相同参数重新提交新流水线） */
  retry: (id: string) =>
    http.post(`/pipelines/${id}/retry`) as Promise<{ jobId: string; status: string }>,

  /** 审批通过（待审批流水线；通过后自动执行） */
  /** 审批通过；nodeKey 指定节点（节点级挂起时用，缺省审批当前待决的那条） */
  approve: (id: string, comment?: string, nodeKey?: string) =>
    http.post(`/pipelines/${id}/approve`, { comment, nodeKey }) as Promise<{
      id: string
      status: string
      resumedFrom?: string
    }>,

  /** 审批拒绝（拒绝必填意见） */
  reject: (id: string, comment: string, nodeKey?: string) =>
    http.post(`/pipelines/${id}/reject`, { comment, nodeKey }) as Promise<{ id: string; status: string }>,

  promote: (id: string) =>
    http.post(`/pipelines/${id}/promote`) as Promise<{ id: string; versionTag: string }>,

  /** 删除执行记录（纯清理：不动版本指针/产物；running/pending 返回 400） */
  remove: (id: string) =>
    http.delete(`/pipelines/${id}`) as Promise<{ ok: boolean }>,

  /**
   * 可审批人：admin 系统中持有 `deploy:pipeline:approve` 权限的用户。
   * `degraded=true` 表示权限服务不可用/清单为空 —— 此时后端**不做审批校验**。
   */
  approvers: () =>
    http.get('/pipelines/meta/approvers') as Promise<{
      users: ApproverUser[]
      degraded: boolean
      reason?: string
      permission: string
    }>,

  /** 可发布版本（含磁盘上未登记版本表的历史产物）；行内带纯 commit，供「Commit」下拉直接提交 */
  releases: (env?: string, component?: string) =>
    (
      http.get('/pipelines/meta/releases', {
        params: { ...(env ? { env } : {}), ...(component ? { component } : {}) },
      }) as Promise<Omit<ReleaseCandidate, 'commit'>[]>
    ).then((rows) => (rows ?? []).map((r) => ({ ...r, commit: commitOf(r.versionTag) }))),

  /** 各流水线运行摘要：{ [templateId]: { total, ok, latest } } */
  summary: () =>
    http.get('/pipelines/meta/summary') as Promise<
      Record<string, { total: number; ok: number; latest: PipelineItem | null }>
    >,
}

/* ========== Pipeline（流水线：流程定义） ========== */

/** 流水线（全局定义，不绑模块；moduleKey='*'） */
export const pipelinesApi = {
  /** 可用流水线：传 moduleKey 返回「全局+该模块专属」；不传返回全部 */
  list: (moduleKey?: string) =>
    http.get('/pipeline-templates', {
      params: moduleKey ? { moduleKey } : {},
    }) as Promise<PipelineTemplate[]>,
  create: (dto: Partial<PipelineTemplate>) =>
    http.post('/pipeline-templates', dto) as Promise<PipelineTemplate>,
  duplicate: (id: string) =>
    http.post(`/pipeline-templates/${id}/duplicate`) as Promise<PipelineTemplate>,
  update: (id: string, dto: Partial<PipelineTemplate>) =>
    http.put(`/pipeline-templates/${id}`, dto) as Promise<PipelineTemplate>,
  remove: (id: string) =>
    http.delete(`/pipeline-templates/${id}`) as Promise<{ ok: boolean }>,
}

/* ========== 流水线变量（属于某条流水线；不复用配置中心） ========== */

/** 流水线变量（deploy_pipeline_vars） */
export interface PipelineVar {
  id: string
  key: string
  /** 密钥值对外掩码为 ******** */
  value: string
  isSecret: boolean
  description?: string
  enabled: boolean
  updatedBy?: string
}

export const pipelineVarApi = {
  /** 某条流水线的变量（密钥掩码） */
  list: (pipelineId: string) =>
    http.get('/pipeline-vars', { params: { pipelineId } }) as Promise<PipelineVar[]>,
  create: (pipelineId: string, dto: { key: string; value?: string; isSecret?: boolean; description?: string }) =>
    http.post('/pipeline-vars', { ...dto, pipelineId }) as Promise<PipelineVar>,
  update: (id: string, dto: Partial<Pick<PipelineVar, 'key' | 'value' | 'isSecret' | 'description' | 'enabled'>>) =>
    http.put(`/pipeline-vars/${id}`, dto) as Promise<PipelineVar>,
  remove: (id: string) => http.delete(`/pipeline-vars/${id}`) as Promise<{ ok: boolean }>,
}

/* ========== Pipeline Step Commands（流水线节点命令：R6 新真相源） ========== */

/** 流水线节点命令行（deploy_pipeline_step_commands） */
export interface PipelineStepCommand {
  nodeKey: string
  command: string
  actions?: StageAction[] | null
  /**
   * 环境分支配置（envId → 该环境脚本）—— 已由「步骤任务」实体取代，仅兼容存量。
   */
  envBranches?: Record<string, string> | null
  /** 步骤执行条件（gate）：不满足则跳过整个步骤；null/空 = 恒执行 */
  condition?: string | null
  enabled: boolean
  /** 平台托管（locked）：接口拒写、页面只读（如 git） */
  locked?: boolean
  timeoutSec?: number | null
  updatedBy?: string | null
  updatedAt?: string | null
}

/** 步骤任务（分支）：步骤 1:N 任务，运行时按条件命中 */
export interface StepBranch {
  id?: string
  name: string
  label?: string | null
  /** 匹配条件；null/空 = 默认任务（兜底） */
  condition?: string | null
  script: string
  sort?: number
}

export const stepBranchApi = {
  list: (templateId: string, nodeKey: string) =>
    http.get(`/pipeline-templates/${templateId}/steps/${nodeKey}/branches`) as Promise<StepBranch[]>,

  save: (templateId: string, nodeKey: string, branches: StepBranch[]) =>
    http.put(`/pipeline-templates/${templateId}/steps/${nodeKey}/branches`, { branches }) as Promise<
      StepBranch[]
    >,

  clear: (templateId: string, nodeKey: string) =>
    http.delete(`/pipeline-templates/${templateId}/steps/${nodeKey}/branches`) as Promise<{
      ok: boolean
    }>,
}

/**
 * 编排新模型：步骤 → 任务 → 动作（specs/pipeline-step-task/design.md）。
 * 动作一律 shell 脚本；调用平台能力（写版本记录）= 脚本内调平台工具。
 */
export interface OrchestrationAction {
  id?: string
  name: string
  script: string
  /** 平台托管动作（git/build）：不可删除、不可改名 */
  managed?: boolean
  sort?: number
  enabled?: boolean
}

export interface OrchestrationTask {
  id?: string
  kind: 'script' | 'approval'
  name: string
  /** 执行条件；空 = 恒执行（多选一用互斥条件，不提供默认兜底） */
  condition?: string | null
  env?: Record<string, string> | null
  approval?: { approvers: string[]; timeoutSec?: number; timeoutAction?: 'skip' | 'fail'; onReject?: 'fail' | 'skip' } | null
  sort?: number
  enabled?: boolean
  actions?: OrchestrationAction[]
}

export interface OrchestrationStep {
  id?: string
  name: string
  description?: string | null
  sort?: number
  enabled?: boolean
  tasks?: OrchestrationTask[]
}

export const orchestrationApi = {
  /** 整树：步骤（含任务，任务含动作）；空数组 = 该流水线未迁移新模型（走旧画布） */
  getTree: (pipelineId: string) =>
    http.get(`/pipelines/${pipelineId}/steps`) as Promise<OrchestrationStep[]>,

  /** 步骤全量保存（带 id = 更新可改名，任务保留；不带 = 新建；空数组=清空） */
  saveSteps: (pipelineId: string, steps: { id?: string; name: string; description?: string | null; sort?: number; enabled?: boolean }[]) =>
    http.put(`/pipelines/${pipelineId}/steps`, { steps }) as Promise<OrchestrationStep[]>,

  /** 某步骤任务全量保存（含各自动作）；managed 动作不可删/不可改名 */
  saveTasks: (pipelineId: string, stepId: string, tasks: OrchestrationTask[]) =>
    http.put(`/pipelines/${pipelineId}/steps/${stepId}/tasks`, { tasks }) as Promise<OrchestrationStep[]>,

  /** 删除步骤（级联任务与动作） */
  deleteStep: (pipelineId: string, stepId: string) =>
    http.delete(`/pipelines/${pipelineId}/steps/${stepId}`) as Promise<{ deleted: string }>,
}

export const pipelineStepApi = {
  /** 某流水线各节点命令 */
  list: (templateId: string) =>
    http.get(`/pipeline-templates/${templateId}/steps`) as Promise<
      {
        nodeKey: string
        configured: boolean
        command: string | null
        actions: StageAction[]
        /** 环境分支配置（envId → 脚本）；null = 未启用（已由步骤任务取代） */
        envBranches?: Record<string, string> | null
        /** 步骤执行条件（gate）；null/空 = 恒执行 */
        condition?: string | null
        enabled: boolean
        locked: boolean
        timeoutSec: number | null
      }[]
    >,

  /** 某流水线某节点命令（含 actions；未配置返回 null） */
  get: (templateId: string, nodeKey: string) =>
    http.get(`/pipeline-templates/${templateId}/steps/${nodeKey}`) as Promise<
      PipelineStepCommand | null
    >,

  /** 保存节点命令（保存前 bash -n 语法校验） */
  save: (
    templateId: string,
    nodeKey: string,
    dto: {
      command?: string
      timeoutSec?: number
      actions?: StageAction[]
      /** 环境分支（envId → 脚本）：非空=启用并生成执行体；null=关闭 */
      envBranches?: Record<string, string> | null
      /** 步骤执行条件（gate）：不满足则跳过整个步骤；null/空串=恒执行 */
      condition?: string | null
    },
  ) =>
    http.put(`/pipeline-templates/${templateId}/steps/${nodeKey}`, dto) as Promise<PipelineStepCommand>,

  /** 删除节点命令（该节点回落流程内置逻辑） */
  remove: (templateId: string, nodeKey: string) =>
    http.delete(`/pipeline-templates/${templateId}/steps/${nodeKey}`) as Promise<{ ok: boolean }>,

  /** 仅语法校验（不保存） */
  validate: (templateId: string, nodeKey: string, command: string) =>
    http.post(`/pipeline-templates/${templateId}/steps/${nodeKey}/validate`, { command }) as Promise<{
      ok: boolean
      message: string
    }>,

  /** 按模块类型返回默认构建命令模板 */
  templates: (type: string) =>
    http.get('/pipeline-templates/steps/templates', { params: { type } }) as Promise<{
      template: string | null
    }>,
}

/* ========== Tools（工具目录：service 执行器 / shell CLI） ========== */

export const toolApi = {
  list: (params?: { category?: string; kind?: string }) =>
    http.get('/tools', { params: params ?? {} }) as Promise<ToolItem[]>,
  create: (dto: { name: string; kind?: string; category?: string; description?: string; example?: string; command?: string }) =>
    http.post('/tools', dto) as Promise<ToolItem>,
  update: (code: string, dto: Partial<ToolItem>) =>
    http.put(`/tools/${code}`, dto) as Promise<ToolItem>,
  remove: (code: string) => http.delete(`/tools/${code}`) as Promise<{ ok: boolean }>,
}

/** 阶段命令：发布流水线唯一执行真相源 */
/** v4 操作：阶段内的一个执行动作（阶段可含 1..N 个，顺序执行） */
export interface StageAction {
  id: string
  /** shell=自写脚本 / service=引用工具目录里的内置工具 */
  type: 'shell' | 'service'
  name: string
  code?: string
  tool?: string
  /** 操作级超时（秒） */
  timeoutSec?: number
  /** continueOnError：失败不中断阶段（护栏类操作用） */
  cont?: boolean
  enabled?: boolean
  /** 平台内置操作（不可删除） */
  builtin?: boolean
}

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
  /** 单节点配置（v5：任意 script key 读取，含 actions；未配置返回 null） */
  get: (key: string, stage: string) =>
    http.get(`/modules/${key}/stage-commands/${stage}`) as Promise<{
      id?: string
      moduleKey: string
      stage: string
      command: string
      actions?: StageAction[] | null
      enabled: boolean
      timeoutSec?: number | null
      updatedAt?: string
      updatedBy?: string | null
    } | null>,
  /**
   * 保存阶段命令。
   *
   * v4 支持两种形态（后端均兼容）：
   * - 多操作：`{ actions: [...] }`（推荐，按 actions 顺序执行）
   * - 单命令：`{ command, timeoutSec }`（存量形态，后端包装成 1 个操作）
   */
  save: (
    key: string,
    stage: string,
    payload: { command?: string; timeoutSec?: number; actions?: StageAction[] },
  ) =>
    http.put(`/modules/${key}/stage-commands/${stage}`, payload) as Promise<{
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
  /**
   * 流水线脚本视图（ModuleDetail「发布脚本」Tab / PipelineDetail 实例步骤展开使用）。
   *
   * 合并展示：
   *  - 模块已配置 shell → source=configured（含原文 + 编辑人 + 时间）
   *  - 未配置走流程内置 → source=builtin（含「pipeline 内置做什么」说明）
   *  - 必填阶段未配置 → source=required-unset（提示「发布将失败」）
   *  - 语义真相源（version/pointer） → source=semantic（不可改）
   *
   * 单一真相源仍是 `deploy_module_stage_commands` 表；该端点合并 + 加视图，不写库。
   */
  scriptView: (key: string) =>
    http.get(`/modules/${key}/pipeline-script-view`) as Promise<
      {
        stage: string
        source: 'configured' | 'builtin' | 'required-unset' | 'semantic'
        command: string | null
        enabled: boolean
        timeoutSec: number | null
        updatedAt: string | null
        updatedBy: string | null
        title: string
        builtin: string
        commandMode: 'base' | 'required' | 'override' | 'none'
      }[]
    >,
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

/* ========== 微前端域 · 环境（站点 + envId） ========== */

/** 站点（入口域名） */
export interface SiteRow {
  key: string
  host: string
  name: string
  defaultEnvId: string
  switchable: boolean
  enabled: boolean
}

/** 环境（envId 即产物目录名） */
export interface EnvRow {
  envId: string
  name: string
  siteKey: string
  isProd: boolean
  builtin: boolean
  sort: number
  enabled: boolean
  createdAt?: string
}

/** 环境详情里的「后端服务指向」行 */
export interface EnvServiceRouteRow {
  serviceKey: string
  serviceName: string
  kind?: string
  configured: boolean
  /** 主机**组名**（引用 deploy_hosts.name） */
  hostName: string | null
  /** 主机组解析出的可解析地址（展示用，让「组名 ≠ 地址」可见） */
  hostAddress?: string | null
  port: number | null
  upstreamUrl: string | null
  replicas: number
  runtime: 'pm2' | 'docker' | null
  healthPath?: string | null
  enabled: boolean
}

/* ========== 基础设施 · 主机管理 ========== */

export type HostRuntime = 'pm2' | 'docker'

/** 主机（组）：服务环境指向的地址来源 */
export interface HostRow {
  id: string
  name: string
  host: string
  sshUser: string
  sshKeyPath?: string | null
  remoteDir: string
  runtime: HostRuntime
  labels?: Record<string, string> | null
  enabled: boolean
}

export const hostsApi = {
  /** 主机组列表（enabledOnly=true 供下拉只出可用项） */
  list: (params?: { enabledOnly?: boolean }) =>
    http.get('/hosts', { params: { enabledOnly: params?.enabledOnly ? '1' : undefined } }) as Promise<HostRow[]>,
  get: (name: string) => http.get(`/hosts/${name}`) as Promise<HostRow>,
  create: (dto: {
    name: string
    host: string
    sshUser: string
    sshKeyPath?: string
    remoteDir: string
    runtime?: HostRuntime
    enabled?: boolean
  }) => http.post('/hosts', dto) as Promise<HostRow>,
  update: (
    name: string,
    dto: {
      host?: string
      sshUser?: string
      sshKeyPath?: string | null
      remoteDir?: string
      runtime?: HostRuntime
      enabled?: boolean
    },
  ) => http.put(`/hosts/${name}`, dto) as Promise<HostRow>,
  remove: (name: string) =>
    http.delete(`/hosts/${name}`) as Promise<{ removed: boolean; occupants: string[] }>,
}

export const envsApi = {
  /** 站点列表（local/dev/prod） */
  sites: () => http.get('/envs/sites') as Promise<SiteRow[]>,
  /** 环境列表（站点筛选 + 关键字 + 分页） */
  list: (params?: { siteKey?: string; q?: string; page?: number; pageSize?: number }) =>
    http.get('/envs', { params }) as Promise<{
      items: EnvRow[]
      total: number
      page: number
      pageSize: number
    }>,
  get: (envId: string) => http.get(`/envs/${envId}`) as Promise<EnvRow>,
  /** 新建环境：envId 由后端自增，前端只传名称 + 站点 */
  create: (dto: { name: string; siteKey: string }) => http.post('/envs', dto) as Promise<EnvRow>,
  update: (envId: string, dto: { name?: string; sort?: number; enabled?: boolean }) =>
    http.put(`/envs/${envId}`, dto) as Promise<EnvRow>,
  remove: (envId: string) =>
    http.delete(`/envs/${envId}`) as Promise<{ removed: boolean; occupants: string[] }>,
  /** 运行时解析（找不到回退 dev） */
  resolve: (envId?: string) =>
    http.get('/envs/resolve', { params: { envId } }) as Promise<{ envId: string }>,
  /** 该环境的后端服务指向 */
  serviceRoutes: (envId: string) =>
    http.get(`/envs/${envId}/service-routes`) as Promise<{ env: EnvRow; items: EnvServiceRouteRow[] }>,
  /** 改某服务在该环境的指向（主机必填） */
  updateServiceRoute: (
    envId: string,
    serviceKey: string,
    dto: {
      hostName: string
      port?: number
      upstreamUrl?: string
      replicas?: number
      runtime?: 'pm2' | 'docker'
      healthPath?: string
      enabled?: boolean
    },
  ) => http.put(`/envs/${envId}/service-routes/${serviceKey}`, dto) as Promise<EnvServiceRouteRow>,
  /** 环境切换审计上报（不阻断切换） */
  switchLog: (dto: { envId: string; siteKey?: string }) =>
    http.post('/envs/switch-log', dto) as Promise<{ ok: boolean }>,
}

/* ========== 微前端域 · 应用 ========== */

export type AppKind = 'shell' | 'micro-frontend' | 'spa' | 'mini-app'
export type AppDeployMode = 'env-dir' | 'site-version'

/** shell 挂载路由 */
export interface AppRouteRow {
  id: string
  appKey: string
  mountPath: string
  activeRule: string
  requireAuth: boolean
  sort: number
  enabled: boolean
}

/** 应用 × 环境版本行 */
export interface AppEnvVersionRow {
  envId: string
  envName?: string
  siteKey?: string
  isProd?: boolean
  currentVersion: string | null
  previousVersion?: string | null
  status?: string
  deployedAt?: string | null
  deployedBy?: string | null
  /** 磁盘指针实际指向（与 DB 不一致可用于排查） */
  pointerVersion?: string | null
  availableVersions?: string[]
  entryUrl?: string
}

export interface AppRow {
  key: string
  name: string
  kind: AppKind
  parentKey?: string | null
  repoDir: string
  entry?: string | null
  publicPath?: string | null
  externals?: string[] | null
  deployMode: AppDeployMode
  description?: string | null
  builtin?: boolean
  enabled: boolean
  envVersions?: AppEnvVersionRow[]
}

export const appsApi = {
  meta: () => http.get('/apps/meta') as Promise<{ kinds: AppKind[]; deployModes: AppDeployMode[] }>,
  list: (params?: {
    kind?: string
    q?: string
    parentKey?: string
    page?: number
    pageSize?: number
    includeDeleted?: string
  }) =>
    http.get('/apps', { params }) as Promise<{
      items: AppRow[]
      total: number
      page: number
      pageSize: number
    }>,
  get: (key: string) =>
    http.get(`/apps/${key}`) as Promise<AppRow & { routes: AppRouteRow[]; envVersions: AppEnvVersionRow[] }>,
  create: (dto: {
    key: string
    name: string
    kind?: AppKind
    parentKey?: string
    repoDir: string
    entry?: string
    publicPath?: string
    externals?: string[]
    description?: string
  }) => http.post('/apps', dto) as Promise<AppRow>,
  update: (key: string, dto: Record<string, unknown>) =>
    http.put(`/apps/${key}`, dto) as Promise<AppRow>,
  remove: (key: string) =>
    http.delete(`/apps/${key}`) as Promise<{ removed: boolean; activeEnvs: string[] }>,

  routes: (key: string) => http.get(`/apps/${key}/routes`) as Promise<AppRouteRow[]>,
  createRoute: (
    key: string,
    dto: { mountPath: string; activeRule?: string; requireAuth?: boolean; sort?: number; enabled?: boolean },
  ) => http.post(`/apps/${key}/routes`, dto) as Promise<AppRouteRow>,
  updateRoute: (key: string, id: string, dto: Record<string, unknown>) =>
    http.put(`/apps/${key}/routes/${id}`, dto) as Promise<AppRouteRow>,
  removeRoute: (key: string, id: string) =>
    http.delete(`/apps/${key}/routes/${id}`) as Promise<{ removed: boolean }>,

  /** 环境 × 版本矩阵 */
  envs: (key: string) =>
    http.get(`/apps/${key}/envs`) as Promise<{ app: AppRow; items: AppEnvVersionRow[] }>,
  /** 某环境可选版本（切换弹窗用） */
  versions: (key: string, envId: string) =>
    http.get(`/apps/${key}/versions`, { params: { envId } }) as Promise<{
      appKey: string
      envId: string
      currentVersion: string | null
      previousVersion: string | null
      availableVersions: { ref: string; isCurrent: boolean; isPrevious: boolean }[]
    }>,
  /** 切换版本（只改指针，不重新构建） */
  switchVersion: (key: string, dto: { envId: string; version: string }) =>
    http.post(`/apps/${key}/switch`, dto) as Promise<{
      appKey: string
      envId: string
      from: string | null
      to: string
      unchanged?: boolean
    }>,
  /** 回滚（不传 version 回到上一版本） */
  rollback: (key: string, dto: { envId: string; version?: string }) =>
    http.post(`/apps/${key}/rollback`, dto) as Promise<{
      appKey: string
      envId: string
      from: string | null
      to: string
    }>,
}

/* ========== API 网关域 · 服务 ========== */

export type ServiceKind = 'nest' | 'express' | 'mcp' | 'static'
export type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL'
export type EndpointAuthMode = 'inherit' | 'passthrough' | 'jwt' | 'service_key' | 'none'
export type RouteAuthMode = 'passthrough' | 'service_key' | 'jwt'

/** 服务（含列表页聚合计数） */
export interface ServiceRow {
  key: string
  name: string
  kind: ServiceKind
  repoDir: string
  pm2Name?: string | null
  defaultPort?: number | null
  healthPath: string
  unknownPolicy: 'allow' | 'deny'
  deployChannel: 'managed' | 'legacy'
  description?: string | null
  builtin?: boolean
  enabled: boolean
  routeCount?: number
  endpointCount?: number
  configuredEnvs?: string[]
  routes?: ServiceRouteRow[]
  endpoints?: EndpointRow[]
  envs?: ServiceEnvRow[]
}

/** 网关转发规则（前缀级） */
export interface ServiceRouteRow {
  id: string
  serviceKey: string
  envId?: string | null
  pathPrefix: string
  stripPrefix?: string | null
  rewriteTo?: string | null
  upstreamOverride?: string | null
  timeoutMs: number
  authMode: RouteAuthMode
  priority: number
  enabled: boolean
  /** 前缀包含关系告警（不阻断；提示需要关注匹配优先级） */
  warnings?: { pathPrefix: string; priority: number; relation: 'shorter' | 'longer' }[]
}

/** 接口（方法 + 路径级） */
export interface EndpointRow {
  id: string
  serviceKey: string
  method: EndpointMethod
  pathPattern: string
  code?: string | null
  summary?: string | null
  authMode: EndpointAuthMode
  permissionCode?: string | null
  rateLimitPerMin?: number | null
  timeoutMs?: number | null
  deprecated: boolean
  source: 'manual' | 'openapi' | 'scan'
  enabled: boolean
}

/** 服务 × 环境（只读；编辑入口在环境详情） */
export interface ServiceEnvRow {
  envId: string
  envName: string
  siteKey: string
  isProd: boolean
  /** 主机组名与端口都齐才算已配置 */
  configured: boolean
  /** 主机**组名**（引用 deploy_hosts.name，不是地址） */
  hostName: string | null
  /** 主机组解析出的可解析地址（转发/探活实际用它） */
  hostAddress?: string | null
  port: number | null
  upstreamUrl: string | null
  replicas: number
  runtime: 'pm2' | 'docker' | null
  status: string
}

export const servicesApi = {
  meta: () =>
    http.get('/services/meta') as Promise<{
      kinds: ServiceKind[]
      methods: EndpointMethod[]
      endpointAuthModes: EndpointAuthMode[]
      routeAuthModes: RouteAuthMode[]
    }>,
  list: (params?: { q?: string; kind?: string; page?: number; pageSize?: number }) =>
    http.get('/services', { params }) as Promise<{
      items: ServiceRow[]
      total: number
      page: number
      pageSize: number
    }>,
  get: (key: string) => http.get(`/services/${key}`) as Promise<ServiceRow>,
  create: (dto: {
    key: string
    name: string
    kind?: ServiceKind
    repoDir: string
    pm2Name?: string
    defaultPort?: number
    healthPath?: string
    unknownPolicy?: 'allow' | 'deny'
    deployChannel?: 'managed' | 'legacy'
    description?: string
  }) => http.post('/services', dto) as Promise<ServiceRow>,
  update: (key: string, dto: Record<string, unknown>) =>
    http.put(`/services/${key}`, dto) as Promise<ServiceRow>,
  remove: (key: string) => http.delete(`/services/${key}`) as Promise<{ removed: boolean }>,

  // 转发规则
  routes: (key: string, envId?: string) =>
    http.get(`/services/${key}/routes`, { params: { envId } }) as Promise<ServiceRouteRow[]>,
  createRoute: (key: string, dto: Record<string, unknown>) =>
    http.post(`/services/${key}/routes`, dto) as Promise<ServiceRouteRow>,
  updateRoute: (key: string, id: string, dto: Record<string, unknown>) =>
    http.put(`/services/${key}/routes/${id}`, dto) as Promise<ServiceRouteRow>,
  removeRoute: (key: string, id: string) =>
    http.delete(`/services/${key}/routes/${id}`) as Promise<{ removed: boolean }>,

  // 接口清单
  endpoints: (
    key: string,
    params?: { method?: string; q?: string; deprecated?: string; page?: number; pageSize?: number },
  ) =>
    http.get(`/services/${key}/endpoints`, { params }) as Promise<{
      items: EndpointRow[]
      total: number
      page: number
      pageSize: number
    }>,
  createEndpoint: (key: string, dto: Record<string, unknown>) =>
    http.post(`/services/${key}/endpoints`, dto) as Promise<EndpointRow>,
  updateEndpoint: (key: string, id: string, dto: Record<string, unknown>) =>
    http.put(`/services/${key}/endpoints/${id}`, dto) as Promise<EndpointRow>,
  removeEndpoint: (key: string, id: string) =>
    http.delete(`/services/${key}/endpoints/${id}`) as Promise<{ removed: boolean }>,
  /** 批量导入（UPSERT 只补空字段，不覆盖人工配置） */
  importEndpoints: (
    key: string,
    dto: { source?: 'manual' | 'openapi' | 'scan'; items: Record<string, unknown>[] },
  ) =>
    http.post(`/services/${key}/endpoints/import`, dto) as Promise<{
      total: number
      created: number
      filled: number
      skipped: number
      details: { key: string; action: 'created' | 'filled' | 'skipped'; fields?: string[] }[]
    }>,

  // 环境指向（只读）与探活
  envs: (key: string) =>
    http.get(`/services/${key}/envs`) as Promise<{ service: ServiceRow; items: ServiceEnvRow[] }>,
  health: (key: string, envId: string) =>
    http.post(`/services/${key}/health`, { envId }) as Promise<{
      ok: boolean
      status: number
      target: string
      latencyMs: number
      error?: string
    }>,

  /**
   * 部署某环境（**与构建发布分离**）：重启进程 + 探活。
   * 「构建发布」走流水线（拉码 → 构建 → 上传产物，不动进程），部署才让新产物生效。
   */
  deploy: (key: string, envId: string) =>
    http.post(`/services/${key}/deploy`, { envId }) as Promise<{
      serviceKey: string
      envId: string
      upstreamUrl: string
      target: string
      /** 已重启的 pm2 进程名；null = 未执行（如本机 pm2 未纳管） */
      restarted: string | null
      restartNote: string | null
      health: { ok: boolean; status: number; latencyMs: number; error?: string }
      ok: boolean
    }>,
}

export default http
