<script setup lang="ts">
/**
 * 选版本部署抽屉（与发布流水线解耦的独立部署动作，共用组件）
 *
 * 两个数据源（对应两套指针机制，specs/version-deploy/design.md §2.1 裁决）：
 * - 版本部署页（部署域）：versions 由父组件从 GET /deploy/versions 映射，
 *   部署动作 = POST /deploy/modules/:k/envs/:env/deploy
 * - 应用详情（应用域）：versions 由 GET /apps/:key/versions 映射，
 *   部署动作 = POST /apps/:key/switch-version
 * 抽屉本身数据源无关：只接收统一视图模型 + emit deploy。
 *
 * 环境选择在抽屉内（环境可数十个，页面不放环境维度）；
 * 切环境 emit('update:env')，父组件负责重新加载版本列表。
 */
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'

export interface DrawerEnv {
  id: string
  name: string
}

export interface DrawerVersion {
  /** 版本标识（部署域 = versionTag；应用域 = 磁盘目录 ref） */
  tag: string
  /** 元信息描述行（两域各自拼好：分支 · commit · 时间 · 发布人 / 磁盘版本目录等） */
  meta?: string
  isCurrent: boolean
}

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 模块名（标题展示用） */
    moduleName: string
    moduleKey: string
    /** 环境选项（GET /environments；可能数十个 → show-search） */
    envs: DrawerEnv[]
    /** 目标环境（v-model:env，抽屉内可切换） */
    env: string
    /** 版本列表加载中 */
    loading: boolean
    /** 版本列表加载失败（错误态文案；null = 正常） */
    loadError: string | null
    versions: DrawerVersion[]
    /** 所选环境的当前版本（置灰标记；空 = 尚未部署） */
    currentVersion?: string | null
    /** 部署请求进行中 */
    deploying: boolean
    /** true = 确认弹窗带「换产物目录 + 重启 pm2」警告（后端服务） */
    backend?: boolean
  }>(),
  { currentVersion: null, backend: false },
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'update:env', env: string): void
  (e: 'retry'): void
  (e: 'deploy', versionTag: string): void
}>()

const router = useRouter()
const selected = ref('')

watch(
  () => props.open,
  (v) => {
    if (v) selected.value = ''
  },
)
// 切环境清空已选版本
watch(
  () => props.env,
  () => {
    selected.value = ''
  },
)

function onClose() {
  emit('update:open', false)
}

function onEnvChange(v: any) {
  emit('update:env', String(v))
}

function goPipeline() {
  onClose()
  router.push({ name: 'PipelineCenter' })
}

function onDeployClick() {
  if (!selected.value) return
  const from = props.currentVersion || '—'
  const head = `将把 ${props.env} / ${props.moduleName}（${props.moduleKey}）的版本从 ${from} 切换到 ${selected.value}。`
  Modal.confirm({
    title: '确认部署',
    content: props.backend
      ? `${head}\n后端服务部署将替换版本产物目录并重启 pm2 进程，服务预计短暂中断（约 3~5 秒），请避开业务高峰操作。`
      : `${head}\n前端模块仅切换版本指针，用户刷新页面即加载新版本，不影响任何运行中进程。`,
    okText: '确认部署',
    okType: props.backend ? 'danger' : undefined,
    cancelText: '取消',
    onOk: () => {
      emit('deploy', selected.value)
    },
  })
}
</script>

<template>
  <a-drawer
    :open="open"
    :title="`部署 ${moduleName}（${moduleKey}）`"
    placement="right"
    :width="520"
    @close="onClose"
  >
    <!-- 目标环境（唯一环境入口；环境可数十个 → 下拉可搜索） -->
    <div class="env-bar">
      <span class="env-label">目标环境</span>
      <a-select
        :value="env"
        show-search
        option-filter-prop="label"
        placeholder="选择目标环境"
        style="width: 220px"
        @change="onEnvChange"
      >
        <a-select-option v-for="e in envs" :key="e.id" :value="e.id" :label="`${e.id}（${e.name}）`">
          {{ e.id }}（{{ e.name }}）
        </a-select-option>
      </a-select>
      <span class="env-hint">切换环境将重新加载版本记录</span>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="state">
      <a-spin />
      <p>加载版本记录中…</p>
    </div>

    <!-- 错误态（可重试） -->
    <div v-else-if="loadError" class="state">
      <h4 class="state-title state-err">版本记录加载失败</h4>
      <p>{{ loadError }}</p>
      <a-button size="small" @click="emit('retry')">重试</a-button>
    </div>

    <!-- 空态（原因 + 出路） -->
    <div v-else-if="!versions.length" class="state">
      <h4 class="state-title">暂无发布版本</h4>
      <p>该模块在 {{ env }} 环境还没有任何版本记录。<br />先去发布流水线发布一次，产出可部署的版本。</p>
      <a-button type="primary" size="small" @click="goPipeline">去发布流水线</a-button>
    </div>

    <!-- 版本列表 -->
    <template v-else>
      <div class="cur-box">
        当前版本：<span class="ws-mono cur-tag">{{ currentVersion || '—' }}</span>
      </div>
      <div class="ver-list">
        <div
          v-for="v in versions"
          :key="v.tag"
          class="ver-item"
          :class="{ sel: selected === v.tag, cur: v.isCurrent }"
          @click="!v.isCurrent && !deploying && (selected = v.tag)"
        >
          <span class="radio-dot" />
          <div class="ver-main">
            <div class="ver-tag-line">
              <span class="ws-mono ver-tag">{{ v.tag }}</span>
              <a-tag v-if="v.isCurrent" color="success">当前</a-tag>
            </div>
            <div v-if="v.meta" class="ver-meta">{{ v.meta }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- footer 必须为 a-drawer 直接子级（v-if 与主区显示条件一致） -->
    <template #footer>
      <div v-if="!loading && !loadError && versions.length" class="drawer-foot">
        <a-button :disabled="deploying" @click="onClose">取消</a-button>
        <a-tooltip :title="selected ? '' : '先选择要部署的版本'">
          <a-button type="primary" :loading="deploying" :disabled="!selected" @click="onDeployClick">
            部署到 {{ env }}
          </a-button>
        </a-tooltip>
      </div>
    </template>
  </a-drawer>
</template>

<style scoped>
.env-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--ws-border);
  margin-bottom: 14px;
}
.env-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-text-secondary);
  flex-shrink: 0;
}
.env-hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.cur-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--ws-bg-subtle);
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md, 8px);
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12.5px;
  color: var(--ws-text-secondary);
}
.cur-tag {
  font-weight: 600;
  color: var(--ws-text-primary);
}
.ver-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ver-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1.5px solid var(--ws-border);
  border-radius: var(--ws-radius-md, 8px);
  padding: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.ver-item:hover {
  border-color: var(--ws-brand-500);
  background: var(--ws-brand-50);
}
.ver-item.sel {
  border-color: var(--ws-brand-500);
  background: var(--ws-brand-50);
}
.ver-item.cur {
  cursor: not-allowed;
  opacity: 0.6;
}
.ver-item.cur:hover {
  border-color: var(--ws-border);
  background: var(--ws-bg-surface);
}
.radio-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--ws-text-tertiary);
  flex-shrink: 0;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ver-item.sel .radio-dot {
  border-color: var(--ws-brand-500);
}
.ver-item.sel .radio-dot::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ws-brand-500);
}
.ver-main {
  flex: 1;
  min-width: 0;
}
.ver-tag-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ver-tag {
  font-size: 13px;
  font-weight: 600;
}
.ver-meta {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 4px;
}
.state {
  text-align: center;
  padding: 48px 16px;
  color: var(--ws-text-tertiary);
  font-size: 13px;
  line-height: 1.9;
}
.state-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-secondary);
  margin-bottom: 6px;
}
.state-err {
  color: var(--ws-error-500);
}
.state :deep(.ant-btn) {
  margin-top: 14px;
}
.drawer-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
</style>
