<script setup lang="ts">
/**
 * 发起发布抽屉（共用组件）—— 2026-09-21 从 `PipelineCenter.vue` 的内联实现抽出。
 *
 * 为什么抽：三个入口要用**同一个抽屉**（字段一致），且服务详情页要求「点构建发布原地弹，不跳页」
 * —— 原实现是 `router.push('/pipelines?module=&env=')`，再由流水线页读 query 打开抽屉，
 * 用户会被带离当前服务上下文。
 *
 * 入口与锁定策略（见 docs/ui/page-specs/pipeline-product-logic-v1.md §12）：
 *  - 流水线页（PipelineCenter）：模块可选（行内「执行」时按流水线锁定）；环境可选；
 *  - 服务详情页页头（ServiceDetail）：模块锁定为当前服务；环境可选（默认第一项）；
 *  - 服务详情页「环境与发布」行内：模块锁定 + **环境锁定并禁用**（`lock-env`，值为该行 envId）。
 *
 * 提交成功后只 `emit('submitted', jobId)`，由调用方决定刷新自己的数据（刷新什么只有调用方知道）。
 */
import { computed, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineRunsApi,
  environmentApi,
  deployApi,
  pipelinesApi,
  type PipelineTemplate,
} from '@/api'
import BranchSelect from '@/components/BranchSelect.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 锁定模块（服务详情传服务 key；流水线页行内「执行」传该流水线绑定的模块） */
    fixedModuleKey?: string
    /** 预选模块（**不锁定**，用户可改）：如流水线页点模块卡「提交」时预填该模块 */
    initialModuleKey?: string
    /** 锁定流水线模板 */
    fixedTemplateId?: string
    /** 模板绑定环境：环境被改动后解除模板锁定（无 env 的模板视为环境无关） */
    fixedTemplateEnv?: string
    /** 打开时的默认环境 */
    defaultEnv?: string
    /** 环境锁定（服务详情行内进入）：下拉保持外观但**点不动** */
    lockEnv?: boolean
  }>(),
  { lockEnv: false },
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submitted', jobId: string): void
}>()

// ===== 状态 =====
const submitting = ref(false)
const env = ref('dev')
const environments = ref<{ id: string; name: string }[]>([])
interface ModuleItem {
  key: string
  name: string
  type: string
  defaultEnv?: string
}
const modules = ref<ModuleItem[]>([])
/** 可发布模块：后端 / 前端 / 微前端（mini-app 不在流水线能力范围） */
const availableModules = computed(() =>
  modules.value.filter((m) => ['micro-frontend', 'frontend', 'backend'].includes(m.type)),
)
const form = ref({
  moduleKey: '',
  branch: 'master',
  commitId: undefined as string | undefined,
  mode: 'direct' as 'direct' | 'grayscale',
  grayscaleType: 'percent' as 'percent' | 'user-list' | 'header',
  percentValue: 10,
  userIds: '',
  headerKey: 'x-canary',
  headerValues: 'on',
  templateId: undefined as string | undefined,
})
/** 可发布版本候选：versionTag=完整引用（展示用），commit=纯短哈希（提交用） */
const releases = ref<{ versionTag: string; commit?: string; note?: string }[]>([])
/** 分支最近提交（后端 SWR 秒回；见 PipelineCenter 同款实现与 pipeline.service.ts 注释） */
const branchCommits = ref<
  { hash: string; short: string; subject: string; author: string; date: string }[]
>([])
const loadingCommits = ref(false)
const availTemplates = ref<PipelineTemplate[]>([])
/** 被锁定模板所属的环境：环境改动后解除模板锁定，允许另选模板 */
const lockedTplEnv = ref('')

/** 模板是否仍保持锁定：来自行内执行、且用户没有改环境 */
const templateLocked = computed(
  () => !!props.fixedTemplateId && (!lockedTplEnv.value || lockedTplEnv.value === env.value),
)
/** 模块是否锁定（服务详情 / 行内执行）：锁定时不可改选 */
const moduleLocked = computed(() => !!props.fixedModuleKey)

// ===== 数据加载 =====
async function loadEnvironments() {
  try {
    environments.value = await environmentApi.list()
  } catch {
    message.error('加载环境列表失败')
  }
}
async function loadModules() {
  try {
    modules.value = await deployApi.modules()
  } catch {
    message.error('加载模块列表失败')
  }
}
async function loadReleases() {
  try {
    releases.value = await pipelineRunsApi.releases(env.value, form.value.moduleKey)
  } catch {
    releases.value = []
  }
}
async function loadAvailTemplates() {
  try {
    const all = (await pipelinesApi.list(form.value.moduleKey)) || []
    // 环境是运行期参数（envId 动态创建）：模板按**模块**绑定，本环境绑定的模板优先排序，其余作为候选
    const score = (t: any) => (t.env === env.value ? 0 : !t.env ? 1 : 2)
    availTemplates.value = [...all].sort((a: any, b: any) => score(a) - score(b))
    const stillValid = availTemplates.value.some((t) => t.id === form.value.templateId)
    if (!stillValid) {
      // 切换环境/模块后重选：行内锁定的优先，否则取排序第一条
      form.value.templateId =
        props.fixedTemplateId || availTemplates.value[0]?.id || undefined
    }
  } catch (e: any) {
    availTemplates.value = []
    message.error(e?.response?.data?.message || '加载流水线列表失败')
  }
}

/**
 * 分支提交内存缓存（切回已看过的分支秒显；后端另有 SWR 缓存，这里省掉一次往返）。
 * 与 PipelineCenter 同一套实现：竞态保护 + 分支级缓存 + 首取后补一次（刚 push 的提交）。
 */
const commitCache = new Map<string, typeof branchCommits.value>()
let commitSeq = 0

async function loadBranchCommits() {
  const branch = (form.value.branch || 'master').trim()
  if (!branch || !form.value.moduleKey) {
    branchCommits.value = []
    return
  }
  const seq = ++commitSeq
  const cached = commitCache.get(branch)
  branchCommits.value = cached ?? []
  loadingCommits.value = !cached
  try {
    const rows = await pipelineRunsApi.branchCommits(branch, 20)
    if (seq !== commitSeq) return // 已被更晚的分支请求取代
    branchCommits.value = rows
    commitCache.set(branch, rows)
    if (!cached) {
      // 首次返回的是本地引用：补取一次（此时后台 fetch 已完成）让「刚 push 的提交」自动出现
      setTimeout(() => {
        if (seq === commitSeq) void loadBranchCommits()
      }, 1500)
    }
  } catch {
    if (seq === commitSeq && !cached) branchCommits.value = []
  } finally {
    if (seq === commitSeq) loadingCommits.value = false
  }
}

// ===== 打开时初始化（每次打开都按调用方给的锁定参数重置） =====
watch(
  () => props.open,
  (v) => {
    if (v) void init()
  },
)

async function init() {
  form.value.branch = 'master'
  form.value.commitId = undefined
  form.value.mode = 'direct'
  form.value.templateId = props.fixedTemplateId || undefined
  lockedTplEnv.value = props.fixedTemplateEnv || ''
  form.value.moduleKey = props.fixedModuleKey || props.initialModuleKey || ''

  await Promise.all([loadEnvironments(), loadModules()])

  // 环境：优先调用方指定（服务详情行内 = 该行 envId → 锁定），否则回落第一个环境
  if (props.defaultEnv && environments.value.some((e) => e.id === props.defaultEnv)) {
    env.value = props.defaultEnv
  } else if (!environments.value.find((e) => e.id === env.value)) {
    env.value = environments.value[0]?.id || 'dev'
  }
  if (!form.value.moduleKey) form.value.moduleKey = availableModules.value[0]?.key || ''

  await Promise.all([loadReleases(), loadAvailTemplates(), loadBranchCommits()])
}

// ===== 联动 =====
async function onEnvChange() {
  await Promise.all([loadReleases(), loadAvailTemplates()])
}
async function onModuleChange() {
  const mod = modules.value.find((m) => m.key === form.value.moduleKey)
  if (mod?.defaultEnv && environments.value.some((e) => e.id === mod.defaultEnv)) {
    env.value = mod.defaultEnv
  }
  // 灰度仅对前端/微前端（gateway resolveCanary 作用于页面静态资源）；后端服务只支持全量
  if (mod && mod.type === 'backend') form.value.mode = 'direct'
  await Promise.all([loadReleases(), loadAvailTemplates(), loadBranchCommits()])
}
/** 环境下拉变更（显式赋值，避免模板里对 ref 直接赋值的隐式行为） */
function onEnvPicked(v: any) {
  env.value = String(v)
  void onEnvChange()
}
/** 模块下拉变更 */
function onModulePicked(v: any) {
  form.value.moduleKey = String(v)
  void onModuleChange()
}

/** Commit 候选过滤：分支提交匹配短哈希/说明/作者，历史版本匹配 versionTag */
function filterCommitOption(input: string, option: any) {
  const text = `${option.value ?? ''} ${option.title ?? ''}`.toLowerCase()
  return text.includes(input.trim().toLowerCase())
}

/** 当前所选模块是否支持灰度（后端服务不支持） */
const canGrayscale = computed(() => {
  const m = modules.value.find((x) => x.key === form.value.moduleKey)
  return !!m && m.type !== 'backend'
})
function buildGrayscaleRule(): Record<string, unknown> | undefined {
  if (form.value.mode !== 'grayscale') return undefined
  if (form.value.grayscaleType === 'percent') {
    return { type: 'percent', value: Number(form.value.percentValue) }
  }
  if (form.value.grayscaleType === 'user-list') {
    const ids = form.value.userIds.split(/[,\s]+/).filter(Boolean)
    if (!ids.length) throw new Error('灰度用户名单不能为空')
    return { type: 'user-list', userIds: ids }
  }
  const values = form.value.headerValues.split(/[,\s]+/).filter(Boolean)
  if (!values.length) throw new Error('灰度请求头取值不能为空')
  return { type: 'header', key: form.value.headerKey, values }
}

// ===== 提交 =====
function doSubmit(confirm: boolean) {
  submitting.value = true
  const run = async () => {
    try {
      const rule = buildGrayscaleRule()
      const res = await pipelineRunsApi.submit({
        env: env.value,
        moduleKey: form.value.moduleKey,
        branch: form.value.branch || 'master',
        commitId: form.value.commitId || undefined,
        mode: form.value.mode,
        grayscaleRule: rule,
        templateId: form.value.templateId || undefined,
        confirm,
      })
      if ((res as any).status === 'pending-approval') {
        message.info(`已提交审批（${res.jobId}），审批通过后将自动发布`)
      } else {
        message.success(`已提交: ${res.jobId}`)
      }
      emit('update:open', false)
      emit('submitted', res.jobId)
    } catch (e: any) {
      // 失败**不关抽屉**，可在原地改参数重试（见规格 §12）
      message.error(e?.response?.data?.message || e?.message || '提交流水线失败')
    } finally {
      submitting.value = false
    }
  }
  void run()
}
function handleSubmit() {
  if (!form.value.moduleKey) {
    message.warning('请选择要发布的模块')
    return
  }
  if (!form.value.templateId) {
    message.warning('请选择要使用的流水线')
    return
  }
  const isProd = env.value === 'prod'
  const desc = `按「${
    availTemplates.value.find((t) => t.id === form.value.templateId)?.name || '流水线'
  }」发布 ${form.value.moduleKey} 到 ${env.value}（分支 ${form.value.branch}${
    form.value.commitId ? ` @ ${form.value.commitId}` : ' 最新'
  }）`
  if (isProd) {
    Modal.confirm({
      title: '确认发布到生产环境',
      content: `${desc}。生产发布需审批：提交后将进入「待审批」状态，审批通过才会执行。确认提交？`,
      okText: '提交审批',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => doSubmit(true),
    })
    return
  }
  doSubmit(false)
}
</script>

<template>
  <a-drawer
    :open="open"
    title="发起发布"
    placement="right"
    :width="720"
    @close="emit('update:open', false)"
  >
    <a-form layout="vertical">
      <a-row :gutter="12">
        <a-col :span="12">
          <a-form-item label="环境" required>
            <!-- lock-env：从「环境与发布」某行进来 → 保持下拉外观但点不动（用户 2026-09-21） -->
            <a-select :value="env" :disabled="lockEnv" @change="onEnvPicked">
              <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
                {{ e.name }}（{{ e.id }}）
              </a-select-option>
            </a-select>
            <div v-if="lockEnv" class="field-hint">
              由所点击的<b>环境行</b>决定，不可修改（避免误发到其它环境）
            </div>
            <div v-else class="field-hint">
              环境是运行期参数，可在此改（含自建环境 1/2/3…）；默认取所选流水线绑定的环境
            </div>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="模块（后端/前端/微前端均可走流水线发布）" required>
            <a-select
              :value="form.moduleKey"
              placeholder="选择模块"
              :disabled="moduleLocked"
              @change="onModulePicked"
            >
              <a-select-option v-for="m in availableModules" :key="m.key" :value="m.key">
                {{ m.name }}（{{ m.key }}）
              </a-select-option>
            </a-select>
            <div v-if="moduleLocked" class="field-hint">由当前上下文决定，不可修改</div>
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item v-if="!templateLocked" label="使用流水线" required>
        <a-select v-model:value="form.templateId" placeholder="选择流水线">
          <a-select-option v-for="t in availTemplates" :key="t.id" :value="t.id">
            {{ t.name }}<template v-if="t.env"> · {{ t.env }}</template>
            <template v-if="t.builtin">（默认）</template>
            <template v-if="t.approval === 'always'">（强制审批）</template>
            <template v-if="t.approval === 'never'">（免审批）</template>
          </a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item v-else label="使用流水线">
        <a-tag color="blue">
          {{ availTemplates.find((t) => t.id === fixedTemplateId)?.name || '本流水线' }}
        </a-tag>
        <span class="field-hint-inline">环境已改为 {{ env }}，将按同一流水线流程发布到该环境</span>
      </a-form-item>

      <a-row :gutter="12">
        <a-col :span="12">
          <a-form-item label="分支">
            <BranchSelect
              v-model="form.branch"
              :module-key="form.moduleKey"
              @update:model-value="loadBranchCommits"
            />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="Commit（留空=分支最新提交）">
            <a-select
              v-model:value="form.commitId"
              show-search
              allow-clear
              :loading="loadingCommits"
              placeholder="留空=最新；可从分支提交列表选，或输入短哈希"
              :filter-option="filterCommitOption"
            >
              <a-select-opt-group label="分支最近提交（刚 push 的在这里）">
                <a-select-option
                  v-for="c in branchCommits"
                  :key="c.hash"
                  :value="c.short"
                  :title="c.subject"
                >
                  {{ c.short }} · {{ c.subject }}<span class="opt-meta">（{{ c.author }} · {{ c.date }}）</span>
                </a-select-option>
                <a-select-option v-if="!branchCommits.length" :value="'__none__'" disabled>
                  {{ loadingCommits ? '加载分支提交中…' : '未取到分支提交（仍可留空=最新，或直接输入短哈希）' }}
                </a-select-option>
              </a-select-opt-group>
              <a-select-opt-group v-if="releases.length" label="历史发布版本（产物已存在，可复用跳过构建）">
                <a-select-option v-for="r in releases" :key="r.versionTag" :value="r.commit || r.versionTag">
                  {{ r.versionTag }}{{ r.note ? ` · ${r.note}` : '' }}
                </a-select-option>
              </a-select-opt-group>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item v-if="canGrayscale" label="模式">
        <a-radio-group v-model:value="form.mode">
          <a-radio value="direct">全量</a-radio>
          <a-radio value="grayscale">灰度</a-radio>
        </a-radio-group>
      </a-form-item>

      <a-form-item v-if="form.mode === 'grayscale'" label="灰度规则">
        <a-space wrap>
          <a-select v-model:value="form.grayscaleType" style="width: 130px;">
            <a-select-option value="percent">百分比</a-select-option>
            <a-select-option value="user-list">用户名单</a-select-option>
            <a-select-option value="header">请求头</a-select-option>
          </a-select>
          <a-input-number
            v-if="form.grayscaleType === 'percent'"
            v-model:value="form.percentValue"
            :min="1"
            :max="100"
            addon-after="%"
          />
          <a-input
            v-if="form.grayscaleType === 'user-list'"
            v-model:value="form.userIds"
            placeholder="用户 ID，逗号分隔"
            style="width: 260px;"
          />
          <template v-if="form.grayscaleType === 'header'">
            <a-input v-model:value="form.headerKey" placeholder="请求头名" style="width: 140px;" />
            <a-input v-model:value="form.headerValues" placeholder="取值，逗号分隔" style="width: 140px;" />
          </template>
        </a-space>
      </a-form-item>

      <a-alert
        type="info"
        show-icon
        style="margin-bottom: 12px;"
        message="产物投递由系统自动决定：测试环境(local/dev)=本机，正式发布按配置投递到生产服务器。发布基于远程仓库分支 + commit（隔离发布目录 git 拉取），请先 commit & push 再发布"
      />
      <a-button
        type="primary"
        :loading="submitting"
        :danger="env === 'prod'"
        block
        @click="handleSubmit"
      >
        提交{{ env === 'prod' ? '（生产，需审批）' : '发布' }}
      </a-button>
    </a-form>
  </a-drawer>
</template>

<style scoped>
.field-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
  line-height: 1.7;
}
.field-hint-inline {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
</style>
