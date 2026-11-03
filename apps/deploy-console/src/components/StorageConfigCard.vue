<script setup lang="ts">
/**
 * 存储配置卡片（A6）——「上传根目录」与「临时图目录」的查看与修改。
 *
 * 原型（已人审通过）：`docs/ui/prototypes/deploy-console-domain.html` → 系统设置 → 存储配置
 * 后端契约（system-service）：`specs/backend-consolidation/page-spec-storage-config.md`
 *
 * 四条不可丢的语义：
 * 1. **重启生效**：消费服务只在启动时读配置，保存后必须重启才切换目录 → 徽标与提示都要说清；
 *    （上传根目录 → upload-service；临时图目录 → ai-service）
 * 2. **双值**：「当前生效目录」（服务内存值，由 system-service 代问）vs「待生效目录」（权威配置值）；
 *    临时图目录尚无消费服务上报生效值，只展示权威值。
 * 3. **校验前置**：保存前必须校验通过；唯一例外是「目录不存在」（后端 PUT 会自动创建）。
 * 4. **两个目录各自独立**：改哪个就校验哪个，没改的不用陪着校验；后端「先全校验再落库」，
 *    前端同样不允许只提交一半（未改动的目录不提交，语义是「保持原样」）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  FolderOutlined,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue'
import {
  storageSettingsApi,
  type StorageBrowseResult,
  type StorageConfig,
  type StorageDirCheck,
} from '@/api'

/** 可编辑的目录目标 */
type Target = 'upload' | 'temp'

const TARGET_META: Record<Target, { label: string; hint: string; service: string }> = {
  upload: {
    label: '上传根目录',
    hint: '头像、素材等对外交付的长期文件',
    service: 'upload-service',
  },
  temp: {
    label: '临时图目录',
    hint: '变变 AI 图等中间产物（生成后可回收）',
    service: 'ai-service',
  },
}

const loading = ref(false)
const saving = ref(false)
const checking = ref(false)
const treeLoading = ref(false)

const cfg = ref<StorageConfig | null>(null)
/** 当前正在编辑的目标（目录树选择 / 校验都作用于它） */
const target = ref<Target>('upload')
const mode = ref<'tree' | 'manual'>('tree')
const tree = ref<StorageBrowseResult | null>(null)

/** 每个目标一份「待保存值 + 校验结果」，互不干扰 */
interface Slot {
  pending: string
  check: StorageDirCheck | null
  /** 该校验结果对应的输入值 —— 防止改了输入还拿旧结果去保存 */
  checkedFor: string
}
const slots = reactive<Record<Target, Slot>>({
  upload: { pending: '', check: null, checkedFor: '' },
  temp: { pending: '', check: null, checkedFor: '' },
})

const current = computed(() => slots[target.value])
const currentLabel = computed(() => TARGET_META[target.value].label)

/** 目标当前的权威配置值 */
function configuredOf(t: Target): string {
  return t === 'upload' ? cfg.value?.uploadDir ?? '' : cfg.value?.tempDir ?? ''
}

/** 是否被改动过 —— 没改就不用校验、也不用提交 */
function dirtyOf(t: Target): boolean {
  return slots[t].pending.trim() !== configuredOf(t)
}

/** 能否浏览服务器目录：后端已按 storage:browse 判定（仅 super_admin），再叠加降级开关 */
const canBrowse = computed(() => !!cfg.value?.canBrowse && !!cfg.value?.browseEnabled)

/** 「待重启生效」＝ 权威值 与 upload-service 当前生效值 不一致 */
const pendingRestart = computed(
  () => !!cfg.value?.effectivePath && cfg.value.uploadDir !== cfg.value.effectivePath,
)

/** 单个目标是否已具备保存条件（未改动视为已具备） */
function readyOf(t: Target): boolean {
  const s = slots[t]
  if (!dirtyOf(t)) return true
  const v = s.pending.trim()
  if (!v || !s.check || s.checkedFor !== v) return false
  // 唯一例外：目录不存在（后端保存时会自动创建）
  return s.check.ok || (!s.check.code && s.check.message.startsWith('目录不存在'))
}

const canSave = computed(() => !!slots.upload.pending.trim() && readyOf('upload') && readyOf('temp'))

/** 底部提示：说清「还差哪一步」，而不是只把按钮置灰 */
const saveHint = computed(() => {
  const blocker = (['upload', 'temp'] as Target[]).find((t) => !readyOf(t))
  if (blocker) return `「${TARGET_META[blocker].label}」已修改，请先校验通过再保存`
  if (!dirtyOf('upload') && !dirtyOf('temp')) return '当前没有待保存的改动'
  return '校验通过，可保存（保存后仍需重启对应服务）'
})

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return '未知'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function errMsg(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.message || fallback
}

async function load() {
  loading.value = true
  try {
    const r = await storageSettingsApi.get()
    cfg.value = r
    slots.upload = { pending: r.uploadDir, check: null, checkedFor: '' }
    slots.temp = { pending: r.tempDir, check: null, checkedFor: '' }
    mode.value = r.canBrowse && r.browseEnabled ? 'tree' : 'manual'
    if (mode.value === 'tree') await loadTree()
  } catch (e) {
    message.error(errMsg(e, '加载存储配置失败'))
  } finally {
    loading.value = false
  }
}

async function loadTree(path?: string) {
  treeLoading.value = true
  try {
    tree.value = await storageSettingsApi.browse(path)
  } catch (e) {
    message.error(errMsg(e, '读取目录失败'))
  } finally {
    treeLoading.value = false
  }
}

function useDefault() {
  current.value.pending =
    target.value === 'upload' ? cfg.value?.defaultDir || '' : cfg.value?.defaultTempDir || ''
  current.value.check = null
  message.info(`已填入默认目录：${current.value.pending}（尚未保存）`)
}

function pick(path: string) {
  current.value.pending = path
  current.value.check = null
  message.info(`${currentLabel.value}已选择 ${path}（尚未保存）`)
}

async function validate() {
  const s = slots[target.value]
  const v = s.pending.trim()
  if (!v) {
    message.warning(`请先填写${currentLabel.value}`)
    return
  }
  checking.value = true
  try {
    // 只校验当前目标：另一份目录没改动时不该被拖着一起校验
    const r = await storageSettingsApi.validate(
      target.value === 'upload' ? v : cfg.value?.uploadDir ?? '',
      target.value === 'temp' ? v : undefined,
    )
    s.check = target.value === 'temp' ? r.tempDir ?? r : r
    s.checkedFor = v
  } catch (e) {
    message.error(errMsg(e, '校验失败'))
  } finally {
    checking.value = false
  }
}

async function save() {
  if (!canSave.value) {
    message.warning(saveHint.value)
    return
  }
  saving.value = true
  try {
    const uploadDir = slots.upload.pending.trim()
    // 未改动就不提交 —— 后端对「不提交」的语义是「保持原样」，不会误清空
    const tempDir = dirtyOf('temp') ? slots.temp.pending.trim() : undefined
    const r = await storageSettingsApi.save(uploadDir, tempDir)
    message.success(r.message || '已保存，将在服务重启后生效')
    slots.upload.check = null
    slots.temp.check = null
    await load()
  } catch (e) {
    message.error(errMsg(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <a-card title="存储配置" :loading="loading" style="margin-top: 16px;">
    <template #extra>
      <a-tag v-if="cfg" :color="pendingRestart ? 'warning' : 'success'">
        {{ pendingRestart ? '待重启生效' : '已生效' }}
      </a-tag>
    </template>

    <template v-if="cfg">
      <!-- 双值：当前生效（服务内存值） vs 待生效（权威配置值） -->
      <a-descriptions :column="1" size="small" style="max-width: 900px;">
        <a-descriptions-item label="上传根目录 · 当前生效">
          <span class="mono">{{ cfg.effectivePath || '读取失败（upload-service 未启动或内部密钥未配置）' }}</span>
          <a-tag v-if="cfg.effectiveSource" style="margin-left: 8px;">{{ cfg.effectiveSource }}</a-tag>
          <span v-if="cfg.effectiveStartedAt" class="hint" style="margin-left: 8px;">
            采纳于 {{ new Date(cfg.effectiveStartedAt).toLocaleString() }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="上传根目录 · 待生效">
          <span class="mono">{{ cfg.uploadDir }}</span>
          <a-tag style="margin-left: 8px;">{{ cfg.source }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="临时图目录 · 待生效">
          <span class="mono">{{ cfg.tempDir }}</span>
          <a-tag style="margin-left: 8px;">{{ cfg.tempSource }}</a-tag>
          <a-tag v-if="!cfg.tempConfigured" color="warning" style="margin-left: 8px;">
            未配置（随上传根目录变化）
          </a-tag>
          <span v-if="cfg.tempEnvOverride" class="hint" style="margin-left: 8px;">
            环境变量 STORAGE_TEMP_DIR 正在兜底
          </span>
        </a-descriptions-item>
      </a-descriptions>

      <a-alert
        v-if="pendingRestart"
        type="warning"
        show-icon
        style="margin: 12px 0;"
        message="已保存但尚未生效"
        description="服务只在启动时读取该配置，需重启后才切换目录（不做运行时热切换）。"
      />

      <!-- 编辑目标 -->
      <div class="row" style="margin-top: 12px;">
        <span class="label">编辑目标</span>
        <a-radio-group v-model:value="target" button-style="solid">
          <a-radio-button value="upload">上传根目录</a-radio-button>
          <a-radio-button value="temp">临时图目录</a-radio-button>
        </a-radio-group>
        <span class="hint">
          {{ TARGET_META[target].hint }}（生效服务：{{ TARGET_META[target].service }}）
        </span>
        <a-tag v-if="dirtyOf(target)" color="processing">已修改</a-tag>
      </div>

      <!-- 选择方式 -->
      <div class="row" style="margin-top: 8px;">
        <span class="label">选择方式</span>
        <a-radio-group v-model:value="mode" button-style="solid">
          <a-radio-button value="tree" :disabled="!canBrowse">目录树选择</a-radio-button>
          <a-radio-button value="manual">手动输入</a-radio-button>
        </a-radio-group>
        <a-button type="link" @click="useDefault">使用默认目录</a-button>
        <a-button type="link" @click="load"><ReloadOutlined /> 重新读取</a-button>
      </div>

      <a-alert
        v-if="!cfg.canBrowse"
        type="info"
        show-icon
        style="margin: 12px 0 0;"
        message="目录树浏览需要 super_admin（权限点 storage:browse）"
        description="当前账号不能浏览服务器目录，请用文本输入填写绝对路径。"
      />
      <a-alert
        v-else-if="!cfg.browseEnabled"
        type="info"
        show-icon
        style="margin: 12px 0 0;"
        message="目录浏览已关闭（storage.browse_enabled=0）"
        description="请用文本输入填写绝对路径。"
      />

      <!-- 目录树 -->
      <div v-if="mode === 'tree' && canBrowse" class="tree">
        <div class="tree-head">
          <span class="label">浏览范围</span>
          <span class="mono">{{ tree?.path || cfg.allowedRoots[0] }}</span>
          <div style="flex: 1;"></div>
          <a-button v-if="tree?.parent" size="small" @click="loadTree(tree.parent)">上一级</a-button>
          <a-button size="small" type="primary" ghost @click="pick(tree?.path || cfg.allowedRoots[0])">
            用作{{ currentLabel }}
          </a-button>
        </div>
        <a-spin :spinning="treeLoading">
          <div class="tree-body">
            <template v-if="tree?.entries?.length">
              <div v-for="e in tree.entries" :key="e.path" class="dir-row">
                <LinkOutlined v-if="e.symlink" class="ic" />
                <FolderOutlined v-else class="ic" />
                <span class="mono">{{ e.name }}</span>
                <a-tag v-if="e.symlink" style="margin-left: 6px;">符号链接</a-tag>
                <div style="flex: 1;"></div>
                <a-button type="link" size="small" @click="loadTree(e.path)">进入</a-button>
              </div>
              <div v-if="tree.truncated" class="hint" style="padding: 6px 10px;">
                仅显示前 200 项（按名称排序），其余已截断
              </div>
            </template>
            <a-empty v-else :image="null" description="该目录下没有子目录" style="padding: 18px 0;" />
          </div>
          <div class="hint" style="padding: 6px 10px;">
            只列出目录，不展示文件内容；解链后越界的符号链接会被跳过
          </div>
        </a-spin>
      </div>

      <!-- 手动输入 -->
      <div v-else style="margin-top: 12px;">
        <div class="row">
          <a-input
            v-model:value="current.pending"
            class="mono-input"
            :placeholder="target === 'upload' ? '~/web_system/uploads' : '~/web_system/temp-images'"
            style="max-width: 520px;"
            @press-enter="validate"
          />
          <a-button :loading="checking" @click="validate">校验{{ currentLabel }}</a-button>
        </div>
        <div class="hint" style="margin-top: 6px;">
          允许根：{{ cfg.allowedRoots.join('、') }}（指向数据盘等其它位置需在部署侧配白名单
          <code>STORAGE_ALLOWED_ROOTS</code>）
        </div>
      </div>

      <!-- 校验结果 -->
      <a-descriptions
        v-if="current.check"
        :column="1"
        size="small"
        bordered
        style="margin-top: 12px; max-width: 900px;"
      >
        <a-descriptions-item :label="`${currentLabel} · 校验结果`">
          <a-tag :color="current.check.ok ? 'success' : 'error'">{{ current.check.ok ? '通过' : '未通过' }}</a-tag>
          <span v-if="current.check.code" class="mono" style="margin-left: 8px;">{{ current.check.code }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="current.check.resolvedPath" label="解析结果">
          <span class="mono">{{ current.check.resolvedPath }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="存在 / 可写">
          {{ current.check.exists ? '存在' : '不存在' }} · {{ current.check.writable ? '可写' : '不可写' }}
          <span v-if="current.check.freeSpace !== null" class="hint" style="margin-left: 8px;">
            剩余 {{ formatBytes(current.check.freeSpace) }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="说明">
          <span :class="{ danger: !current.check.ok }">{{ current.check.message }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 底部操作 -->
      <div class="row" style="margin-top: 16px;">
        <span class="hint">
          <CheckCircleOutlined v-if="canSave && (dirtyOf('upload') || dirtyOf('temp'))" />
          {{ saveHint }}
        </span>
        <div style="flex: 1;"></div>
        <a-button type="primary" :loading="saving" :disabled="!canSave" @click="save">
          <SaveOutlined /> 保存
        </a-button>
      </div>
    </template>
  </a-card>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.label {
  font-size: 12px;
  color: var(--ws-text-secondary);
}
.hint {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.danger {
  color: var(--ws-danger);
}
.mono,
.mono-input :deep(input) {
  font-family: var(--ws-font-mono), ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
}
.tree {
  margin-top: 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  overflow: hidden;
}
.tree-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--ws-bg-subtle);
  border-bottom: 1px solid var(--ws-border);
  flex-wrap: wrap;
}
.tree-body {
  max-height: 220px;
  overflow: auto;
}
.dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  border-bottom: 1px solid var(--ws-border-subtle);
}
.dir-row:last-child {
  border-bottom: none;
}
.dir-row:hover {
  background: var(--ws-bg-hover);
}
.dir-row .ic {
  color: var(--ws-text-tertiary);
}
</style>
