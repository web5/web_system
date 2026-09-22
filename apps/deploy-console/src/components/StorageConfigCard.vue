<script setup lang="ts">
/**
 * 存储配置卡片（A6）——「上传根目录」的查看与修改。
 *
 * 原型（已人审通过）：`docs/ui/prototypes/deploy-console-domain-split.html` → 系统设置 → 存储配置
 * 后端契约（system-service）：`specs/backend-consolidation/page-spec-storage-config.md`
 *
 * 三条不可丢的语义：
 * 1. **重启生效**：upload-service 只在启动时读配置，保存后必须重启才切换目录 → 徽标与提示都要说清；
 * 2. **双值**：「当前生效目录」（upload-service 内存值，由 system-service 代问）vs「待生效目录」（权威配置值）；
 * 3. **校验前置**：保存前必须校验通过；唯一例外是「目录不存在」（后端 PUT 会自动创建）。
 */
import { computed, onMounted, ref } from 'vue'
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

const loading = ref(false)
const saving = ref(false)
const checking = ref(false)
const treeLoading = ref(false)

const cfg = ref<StorageConfig | null>(null)
/** 待保存值（手动输入框 / 树里选中的目录） */
const pending = ref('')
const check = ref<StorageDirCheck | null>(null)
const mode = ref<'tree' | 'manual'>('tree')
const tree = ref<StorageBrowseResult | null>(null)

/** 能否浏览服务器目录：后端已按 storage:browse 判定（仅 super_admin），再叠加降级开关 */
const canBrowse = computed(() => !!cfg.value?.canBrowse && !!cfg.value?.browseEnabled)

/** 「待重启生效」＝ 权威值 与 upload-service 当前生效值 不一致 */
const pendingRestart = computed(
  () => !!cfg.value?.effectivePath && cfg.value.uploadDir !== cfg.value.effectivePath,
)

/** 保存可用性：先校验；「目录不存在」允许保存（PUT 会自动 mkdir -p） */
const canSave = computed(() => {
  const c = check.value
  if (!c || !pending.value.trim()) return false
  if (c.ok) return true
  return !c.code && c.message.startsWith('目录不存在')
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
    pending.value = r.uploadDir
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
  pending.value = cfg.value?.defaultDir || ''
  check.value = null
  message.info(`已填入默认目录：${pending.value}（尚未保存）`)
}

function pick(path: string) {
  pending.value = path
  check.value = null
  message.info(`已选择 ${path}（尚未保存）`)
}

async function validate() {
  const v = pending.value.trim()
  if (!v) {
    message.warning('请先填写上传根目录')
    return
  }
  checking.value = true
  try {
    check.value = await storageSettingsApi.validate(v)
  } catch (e) {
    message.error(errMsg(e, '校验失败'))
  } finally {
    checking.value = false
  }
}

async function save() {
  if (!canSave.value) {
    message.warning('请先通过校验再保存')
    return
  }
  saving.value = true
  try {
    const r = await storageSettingsApi.save(pending.value.trim())
    message.success(r.message || '已保存，将在 upload-service 重启后生效')
    check.value = null
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
      <!-- 双值：当前生效（upload-service 内存值） vs 待生效（权威配置值） -->
      <a-descriptions :column="1" size="small" style="max-width: 900px;">
        <a-descriptions-item label="当前生效目录">
          <span class="mono">{{ cfg.effectivePath || '读取失败（upload-service 未启动或内部密钥未配置）' }}</span>
          <a-tag v-if="cfg.effectiveSource" style="margin-left: 8px;">{{ cfg.effectiveSource }}</a-tag>
          <span v-if="cfg.effectiveStartedAt" class="hint" style="margin-left: 8px;">
            采纳于 {{ new Date(cfg.effectiveStartedAt).toLocaleString() }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="待生效目录">
          <span class="mono">{{ cfg.uploadDir }}</span>
          <a-tag style="margin-left: 8px;">{{ cfg.source }}</a-tag>
        </a-descriptions-item>
      </a-descriptions>

      <a-alert
        v-if="pendingRestart"
        type="warning"
        show-icon
        style="margin: 12px 0;"
        message="已保存但尚未生效"
        description="upload-service 只在启动时读取该配置，需重启后才切换目录（不做运行时热切换）。"
      />

      <!-- 选择方式 -->
      <div class="row" style="margin-top: 12px;">
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
            使用此目录
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
            v-model:value="pending"
            class="mono-input"
            placeholder="~/web_system/uploads"
            style="max-width: 520px;"
            @press-enter="validate"
          />
          <a-button :loading="checking" @click="validate">校验</a-button>
        </div>
        <div class="hint" style="margin-top: 6px;">
          允许根：{{ cfg.allowedRoots.join('、') }}（指向数据盘等其它位置需在部署侧配白名单
          <code>STORAGE_ALLOWED_ROOTS</code>）
        </div>
      </div>

      <!-- 校验结果 -->
      <a-descriptions v-if="check" :column="1" size="small" bordered style="margin-top: 12px; max-width: 900px;">
        <a-descriptions-item label="校验结果">
          <a-tag :color="check.ok ? 'success' : 'error'">{{ check.ok ? '通过' : '未通过' }}</a-tag>
          <span v-if="check.code" class="mono" style="margin-left: 8px;">{{ check.code }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="check.resolvedPath" label="解析结果">
          <span class="mono">{{ check.resolvedPath }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="存在 / 可写">
          {{ check.exists ? '存在' : '不存在' }} · {{ check.writable ? '可写' : '不可写' }}
          <span v-if="check.freeSpace !== null" class="hint" style="margin-left: 8px;">
            剩余 {{ formatBytes(check.freeSpace) }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="说明">
          <span :class="{ danger: !check.ok }">{{ check.message }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 底部操作 -->
      <div class="row" style="margin-top: 16px;">
        <span class="hint">
          <template v-if="canSave">
            <CheckCircleOutlined /> 校验通过，可保存（保存后仍需重启 upload-service）
          </template>
          <template v-else>
            保存前需先通过校验：路径越界 / 不可写会被拒绝；目录不存在会自动创建
          </template>
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
