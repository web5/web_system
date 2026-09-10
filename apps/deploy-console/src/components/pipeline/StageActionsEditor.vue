<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { stageCommandApi, type StageAction } from '@/api'

/** 编辑器输入项：来自 stageCommandApi.scriptView 中某项（阶段命令统一视图） */
export interface EditorItem {
  stage: string
  source: 'configured' | 'builtin' | 'required-unset' | 'semantic'
  command: string | null
  actions?: StageAction[]
  enabled: boolean
  timeoutSec: number | null
  title?: string
}

const props = defineProps<{
  moduleKey: string
  item: EditorItem
}>()

const emit = defineEmits<{
  /** 保存成功（父级负责刷新 scriptView 与收起编辑器） */
  (e: 'saved'): void
  (e: 'cancel'): void
}>()

/** 编辑中的操作序列（深拷贝，避免污染只读视图） */
const draft = ref<StageAction[]>([])
/** 当前聚焦的操作下标 */
const actIdx = ref(0)
const saving = ref(false)

onMounted(() => {
  actIdx.value = 0
  const acts = (props.item.actions || []) as StageAction[]
  // 单命令形态（后端已包装成 1 个操作）与多操作形态在此统一为可编辑序列
  draft.value = acts.length
    ? JSON.parse(JSON.stringify(acts))
    : [
        {
          id: 'a1',
          type: 'shell' as const,
          name: '主操作',
          code: props.item.command || '',
          timeoutSec: props.item.timeoutSec || undefined,
        },
      ]
})

function addAction() {
  draft.value.push({
    id: `a${draft.value.length + 1}_${Date.now().toString(36)}`,
    type: 'shell',
    name: '新操作',
    code: '# 在此编写脚本',
    timeoutSec: 60,
    cont: false,
  })
  actIdx.value = draft.value.length - 1
}

function delAction(i: number) {
  if (draft.value[i]?.builtin) {
    message.warning('内置操作不可删除')
    return
  }
  draft.value.splice(i, 1)
  if (actIdx.value >= draft.value.length) actIdx.value = Math.max(0, draft.value.length - 1)
}

function moveAction(i: number, dir: -1 | 1) {
  const to = i + dir
  if (to < 0 || to >= draft.value.length) return
  const arr = draft.value
  ;[arr[i], arr[to]] = [arr[to], arr[i]]
  actIdx.value = to
}

async function validateDraft() {
  const shells = draft.value.filter((a) => a.type === 'shell' && a.code?.trim())
  if (!shells.length) {
    message.warning('没有可校验的 shell 操作')
    return
  }
  try {
    for (const a of shells) {
      await stageCommandApi.validate(props.moduleKey, props.item.stage, a.code as string)
    }
    message.success(`语法校验通过（${shells.length} 个 shell 操作）`)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '语法校验失败')
  }
}

async function saveDraft() {
  if (!draft.value.length) {
    message.warning('至少需要一个操作')
    return
  }
  if (draft.value.some((a) => !a.name?.trim())) {
    message.warning('每个操作都需要名称')
    return
  }
  if (new Set(draft.value.map((a) => a.id)).size !== draft.value.length) {
    message.warning('操作 id 不能重复')
    return
  }
  saving.value = true
  try {
    // 以 actions 数组整体提交；command 回填首个 shell 脚本（后端非空约束）
    const firstShell = draft.value.find((a) => a.type === 'shell' && a.code?.trim())
    await stageCommandApi.save(props.moduleKey, props.item.stage, {
      actions: draft.value,
      command: firstShell?.code?.trim() || '',
    })
    message.success(`已保存（${draft.value.length} 个操作）`)
    emit('saved')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="editor-head">
      <span style="font-family: monospace; color: #999; font-size: 12px;">{{ item.stage }}</span>
      <span style="font-weight: 600;">操作序列（{{ draft.length }}）</span>
      <span style="color: #999; font-size: 12px; margin-left: auto;">
        作用模块：<span style="font-family: monospace;">{{ moduleKey }}</span>
      </span>
    </div>

    <div class="editor-body">
      <!-- 操作列表 -->
      <div class="op-list">
        <div
          v-for="(a, i) in draft"
          :key="a.id"
          class="op-item"
          :class="{ active: actIdx === i }"
          @click="actIdx = i"
        >
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1;">
            <span style="font-family: monospace; color: #999; font-size: 11px;">op{{ i + 1 }}</span>
            <a-tag :color="a.type === 'service' ? 'purple' : 'blue'" style="margin: 0;">
              {{ a.type === 'service' ? '工具' : 'shell' }}
            </a-tag>
            <span style="font-size: 12px;">{{ a.name }}</span>
            <a-tag v-if="a.cont" color="orange" style="margin: 0;">容错</a-tag>
            <a-tag v-if="a.builtin" style="margin: 0;">内置</a-tag>
          </div>
          <a-space :size="2">
            <a-button size="small" type="text" :disabled="i === 0" @click.stop="moveAction(i, -1)">↑</a-button>
            <a-button size="small" type="text" :disabled="i === draft.length - 1" @click.stop="moveAction(i, 1)">↓</a-button>
          </a-space>
        </div>
        <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">
          <a-button size="small" @click="addAction">+ 操作</a-button>
          <a-button size="small" danger :disabled="!draft.length || draft[actIdx]?.builtin" @click="delAction(actIdx)">
            删除
          </a-button>
        </div>
      </div>

      <!-- 当前操作的编辑区 -->
      <div class="op-editor">
        <template v-if="draft[actIdx]">
          <a-space size="small" style="margin-bottom: 8px;" wrap>
            <a-input
              v-model:value="draft[actIdx].name"
              size="small"
              style="width: 150px;"
              placeholder="操作名称"
            />
            <a-select v-model:value="draft[actIdx].type" size="small" style="width: 96px;">
              <a-select-option value="shell">shell</a-select-option>
              <a-select-option value="service">工具</a-select-option>
            </a-select>
            <a-input-number
              v-model:value="draft[actIdx].timeoutSec"
              size="small"
              :min="1"
              style="width: 96px;"
            />
            <a-checkbox v-model:checked="draft[actIdx].cont">
              容错（失败不中断）
            </a-checkbox>
          </a-space>

          <a-textarea
            v-if="draft[actIdx].type === 'shell'"
            v-model:value="draft[actIdx].code"
            :rows="10"
            spellcheck="false"
            placeholder="在此编写 shell 脚本，可用变量：${MODULE_KEY} ${PM2_NAME} ${PORT} ${PUBLIC_PATH} ${ARTIFACT_DIR} ${WS_RESULT_FILE}"
            style="font-family: monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4;"
          />
          <template v-else>
            <a-alert type="info" show-icon message="工具型操作由内置工具执行，无需脚本" />
            <a-input
              v-model:value="draft[actIdx].tool"
              size="small"
              placeholder="工具 code（deploy_tool_catalog.code）"
              style="margin-top: 6px;"
            />
          </template>
        </template>
        <a-empty v-else description="暂无操作" />

        <div style="margin-top: 10px;">
          <a-space>
            <a-button size="small" type="primary" :loading="saving" @click="saveDraft">
              保存
            </a-button>
            <a-button size="small" @click="validateDraft">语法校验</a-button>
            <a-button size="small" @click="emit('cancel')">取消</a-button>
          </a-space>
        </div>
        <div style="margin-top: 6px; color: #999; font-size: 12px;">
          操作自上而下顺序执行；标记「容错」的操作失败不中断阶段，其余失败即阶段失败。
          保存以 actions 数组整体提交。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 6px 6px 0 0;
  border: 1px solid #f0f0f0;
  border-bottom: none;
}
.editor-body {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 0 0 6px 6px;
  background: #fff;
}
.op-list {
  width: 250px;
  flex-shrink: 0;
}
.op-item {
  display: flex;
  align-items: center;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  cursor: pointer;
  background: #fff;
  gap: 4px;
}
.op-item.active {
  border-color: #1677ff;
  background: #e6f4ff;
}
.op-editor {
  flex: 1;
  min-width: 280px;
}
</style>
