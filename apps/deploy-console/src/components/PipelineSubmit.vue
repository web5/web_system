<script setup lang="ts">
/**
 * 发起发布抽屉（发布看板 / 流水线页 / 流水线详情页共用）。
 * 支持全部启用的模块（后端/前端/微前端/小程序）走流水线发布；
 * fixedTemplateId 传入后模板固定为该流水线（隐藏模板下拉）。
 */
import { ref, computed, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  pipelineApi,
  environmentApi,
  deployApi,
  pipelineTemplateApi,
  moduleApi,
  type PipelineTemplate,
} from '@/api'

const props = defineProps<{
  open: boolean
  initialEnv?: string
  initialModuleKey?: string
  /** 传值 = 固定使用该流水线（隐藏模板选择） */
  fixedTemplateId?: string
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submitted'): void
}>()

const environments = ref<{ id: string; name: string }[]>([])
const modules = ref<any[]>([])
const availableModules = computed(() => modules.value.filter((m: any) => m.enabled !== false))
const availTemplates = ref<PipelineTemplate[]>([])
const releases = ref<{ versionTag: string; note?: string }[]>([])
/** 模块代码目录的远程 git 分支（origin/*） */
const gitBranches = ref<string[]>([])
/** 发布目录当前分支（HEAD 提示用） */
const gitCurrent = ref<string | null>(null)
const submitting = ref(false)

/** 当 initialModuleKey 传入（即从模块详情/列表点击进入）时，隐藏模块下拉 */
const lockModule = computed(() => !!props.initialModuleKey)
const gitBranchesLoading = ref(false)

const form = ref({
  env: 'dev',
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

const TYPE_OPTIONS: Record<string, { label: string; color: string }> = {
  backend: { label: '后端服务', color: 'blue' },
  frontend: { label: '前端模块', color: 'green' },
  'micro-frontend': { label: '微前端', color: 'purple' },
  'mini-app': { label: '小程序', color: 'orange' },
}

async function loadEnvironments() {
  try {
    environments.value = await environmentApi.list()
    if (props.initialEnv && environments.value.some((e) => e.id === props.initialEnv)) {
      form.value.env = props.initialEnv
    } else if (!environments.value.some((e) => e.id === form.value.env)) {
      form.value.env = environments.value[0]?.id || 'dev'
    }
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
async function loadTemplates() {
  availTemplates.value = []
  try {
    availTemplates.value = await pipelineTemplateApi.list(form.value.moduleKey)
    if (props.fixedTemplateId) {
      form.value.templateId = props.fixedTemplateId
      return
    }
    if (!form.value.templateId && availTemplates.value.length) {
      form.value.templateId = availTemplates.value[0].id
    }
  } catch {
    availTemplates.value = []
  }
}
async function loadReleases() {
  try {
    releases.value = await pipelineApi.releases(form.value.env, form.value.moduleKey)
  } catch {
    releases.value = []
  }
}
async function loadBranches(moduleKey: string) {
  if (!moduleKey) {
    gitBranches.value = []
    gitCurrent.value = null
    return
  }
  gitBranchesLoading.value = true
  try {
    const r = await moduleApi.branches(moduleKey)
    gitBranches.value = r.branches || []
    gitCurrent.value = (r.current && r.current !== 'HEAD') ? r.current : null
    // 若当前分支未在列表中（例如刚切换未推送），把当前分支补进列表以便默认选中
    if (gitCurrent.value && !gitBranches.value.includes(gitCurrent.value)) {
      gitBranches.value = [gitCurrent.value, ...gitBranches.value]
    }
  } catch {
    gitBranches.value = []
    gitCurrent.value = null
  } finally {
    gitBranchesLoading.value = false
  }
}

function resetForm() {
  form.value.moduleKey = props.initialModuleKey || ''
  form.value.branch = gitCurrent.value && gitCurrent.value !== 'HEAD' ? gitCurrent.value : 'master'
  form.value.commitId = undefined
  form.value.mode = 'direct'
  form.value.grayscaleType = 'percent'
  form.value.percentValue = 10
  form.value.userIds = ''
  form.value.headerKey = 'x-canary'
  form.value.headerValues = 'on'
  form.value.templateId = props.fixedTemplateId
  submitting.value = false
}

watch(
  () => props.open,
  async (v) => {
    if (!v) return
    resetForm()
    await Promise.all([loadEnvironments(), loadModules()])
    if (!form.value.moduleKey && availableModules.value.length) {
      form.value.moduleKey = availableModules.value[0].key
    }
    await Promise.all([loadTemplates(), loadReleases(), loadBranches(form.value.moduleKey)])
    // 加载完分支后：若用户未选过，落到当前分支；否则保持
    if (!form.value.branch || form.value.branch === 'master') {
      if (gitCurrent.value) form.value.branch = gitCurrent.value
    }
  },
)

/** 当加载到的当前分支覆盖默认 master（用户首次打开抽屉时希望看到当前分支） */
watch(gitCurrent, (cur) => {
  if (cur && (!form.value.branch || form.value.branch === 'master')) {
    form.value.branch = cur
  }
})

function onModuleChange() {
  void Promise.all([loadTemplates(), loadReleases(), loadBranches(form.value.moduleKey)])
}
function onEnvChange() {
  void Promise.all([loadReleases(), loadTemplates()])
}

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

function doSubmit(confirm: boolean) {
  submitting.value = true
  const run = async () => {
    try {
      const rule = buildGrayscaleRule()
      const res = await pipelineApi.submit({
        env: form.value.env,
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
      emit('submitted')
    } catch (e: any) {
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
  const isProd = form.value.env === 'prod'
  const tplName =
    availTemplates.value.find((t) => t.id === form.value.templateId)?.name ||
    (props.fixedTemplateId ? '本流水线' : '流水线')
  const desc = `按「${tplName}」发布 ${form.value.moduleKey} 到 ${form.value.env}（分支 ${form.value.branch}${
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

const envLabel = (id: string) => {
  const e = environments.value.find((x) => x.id === id)
  return e ? `${e.name}（${e.id}）` : id
}
</script>

<template>
  <a-drawer
    :open="props.open"
    title="发起发布"
    placement="right"
    :width="720"
    @close="emit('update:open', false)"
  >
    <a-form layout="vertical">
      <a-row :gutter="12">
        <a-col :span="12">
          <a-form-item label="环境" required>
            <a-select v-model:value="form.env" @change="onEnvChange">
              <a-select-option v-for="e in environments" :key="e.id" :value="e.id">
                {{ e.name }}（{{ e.id }}）
              </a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item v-if="!lockModule" label="模块" required>
            <a-select
              v-model:value="form.moduleKey"
              placeholder="选择模块（后端/前端/微前端均可用）"
              @change="onModuleChange"
            >
              <a-select-option v-for="m in availableModules" :key="m.key" :value="m.key">
                {{ m.name }}（{{ m.key }}）
                <a-tag :color="TYPE_OPTIONS[m.type]?.color" style="margin-left: 4px; font-size: 11px;">
                  {{ TYPE_OPTIONS[m.type]?.label || m.type }}
                </a-tag>
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item v-else label="模块">
            <a-tag color="blue" style="font-size: 13px;">
              {{ availableModules.find((m: any) => m.key === form.moduleKey)?.name || form.moduleKey }}
              <span style="font-family: monospace; color: #888; margin-left: 4px;">{{ form.moduleKey }}</span>
              <a-tag
                v-if="availableModules.find((m: any) => m.key === form.moduleKey)"
                :color="TYPE_OPTIONS[availableModules.find((m: any) => m.key === form.moduleKey)?.type]?.color"
                style="margin-left: 6px; font-size: 11px;"
              >
                {{ TYPE_OPTIONS[availableModules.find((m: any) => m.key === form.moduleKey)?.type]?.label
                  || availableModules.find((m: any) => m.key === form.moduleKey)?.type }}
              </a-tag>
            </a-tag>
            <a-typography-text type="secondary" style="margin-left: 8px; font-size: 12px;">
              从模块点击进入，模块已锁定
            </a-typography-text>
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item v-if="!props.fixedTemplateId" label="使用流水线" required>
        <a-select v-model:value="form.templateId" placeholder="选择流水线">
          <a-select-option v-for="t in availTemplates" :key="t.id" :value="t.id">
            {{ t.name }}
            <template v-if="t.builtin">（默认）</template>
            <template v-if="t.approval === 'always'">（强制审批）</template>
            <template v-if="t.approval === 'never'">（免审批）</template>
            <template v-if="t.skipVerify">（跳过探活）</template>
          </a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item v-else label="使用流水线">
        <a-tag color="blue">
          {{ availTemplates.find((t) => t.id === props.fixedTemplateId)?.name || '本流水线' }}
        </a-tag>
      </a-form-item>

      <a-row :gutter="12">
        <a-col :span="12">
          <a-form-item label="分支">
            <a-select
              v-model:value="form.branch"
              show-search
              allow-clear
              :placeholder="gitBranches.length ? '选择分支（可直接输入）' : '加载分支中…'"
              :filter-option="(input: string, opt: any) => (opt?.value || '').toString().toLowerCase().includes(input.toLowerCase())"
              :loading="gitBranchesLoading"
            >
              <a-select-option v-for="b in gitBranches" :key="b" :value="b">
                {{ b }}{{ b === gitCurrent ? '（当前）' : '' }}
              </a-select-option>
              <template v-if="!gitBranches.length" #notFoundContent>
                <a-typography-text type="secondary" style="padding: 8px;">
                  暂无可用分支，请先 git push
                </a-typography-text>
              </template>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="Commit（留空=分支最新提交）">
            <a-select
              v-model:value="form.commitId"
              allow-clear
              placeholder="留空=最新"
            >
              <a-select-option v-for="r in releases" :key="r.versionTag" :value="r.versionTag">
                {{ r.versionTag }}{{ r.note ? ` · ${r.note}` : '' }}
              </a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>
      <div v-if="gitCurrent" style="margin: -8px 0 12px; font-size: 12px; color: #888;">
        <span style="margin-right: 8px;">发布目录当前分支：<b>{{ gitCurrent }}</b></span>
        <span v-if="gitBranches.length === 0" style="color: #fa8c16;">
          未拉取到远程分支，确认 origin 是否可达
        </span>
      </div>

      <a-form-item label="模式">
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
        :message="`发布目标环境：${envLabel(form.env)}。产物投递由系统自动决定：测试环境(local/dev)=本机，正式发布按配置投递到生产服务器。流水线基于远程仓库分支 + commit（隔离发布目录 git 拉取），请先 commit & push 再发布。`"
      />
      <a-button
        type="primary"
        :loading="submitting"
        :danger="form.env === 'prod'"
        block
        @click="handleSubmit"
      >
        提交{{ form.env === 'prod' ? '（生产，需审批）' : '发布' }}
      </a-button>
    </a-form>
  </a-drawer>
</template>
