<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Editor, { type EditorHandle } from './Editor.vue'
import { loadDoc, saveDoc } from '../api/docClient'
// 显式类型：Y.Doc / WebsocketProvider 不用 any（仓内 TS 红线 R4）
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

const props = defineProps<{
  ydoc: Y.Doc
  provider: WebsocketProvider
  user: { name: string; color: string }
  docId: string
  humanEditCount: number
  agentStateLabel: string
  overlapWarning: boolean
}>()

const emit = defineEmits<{ (e: 'human-update'): void }>()

const editorRef = ref<EditorHandle | null>(null)
const savedAt = ref(0)
const dirty = ref(false)
const charCount = ref(0)
const saving = ref(false)

const fmt = (ts: number) =>
  ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : ''

const refreshStats = () => {
  charCount.value = editorRef.value?.getText()?.length ?? 0
}

const onHumanUpdate = () => {
  refreshStats()
  dirty.value = true
  emit('human-update')
}

const getText = (): string => editorRef.value?.getText() ?? ''
const setText = (t: string) => {
  editorRef.value?.setText(t)
  refreshStats()
}
const undo = () => {
  editorRef.value?.undo()
  refreshStats()
}
const redo = () => {
  editorRef.value?.redo()
  refreshStats()
}

const onSave = async () => {
  saving.value = true
  try {
    const r = await saveDoc(props.docId, getText())
    savedAt.value = r.savedAt
    dirty.value = false
  } catch (e) {
    console.error('[doc] 保存失败', e)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  // 等 Yjs / 中继先同步一轮，避免把服务端存档重复灌进已有内容的协同文档
  setTimeout(async () => {
    const saved = await loadDoc(props.docId)
    if (saved?.content && !getText().trim()) {
      setText(saved.content)
      savedAt.value = saved.savedAt
      dirty.value = false
    } else if (saved?.savedAt) {
      savedAt.value = saved.savedAt
    }
    refreshStats()
  }, 800)
})

defineExpose({ getText, setText, undo, redo })
</script>

<template>
  <div class="doc">
    <div class="doc-head">
      <h3>文档</h3>
      <span class="hint">
        {{ dirty ? '● 未保存' : savedAt ? `✓ 已保存 ${fmt(savedAt)}` : '尚未保存' }}
        · {{ charCount }} 字 · 最近人改 {{ humanEditCount }} 处 · {{ agentStateLabel }}
      </span>
    </div>

    <div class="toolbar">
      <button class="primary" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button @click="undo">撤销</button>
      <button @click="redo">重做</button>
    </div>

    <div v-if="overlapWarning" class="banner">
      ⚠️ 上一次 AI 改动与你的修改发生<b>交叉</b>：已按 AI 版本写入。
      可在左侧对话里点「撤销本次改动」回滚到 AI 改动前。
    </div>

    <Editor
      ref="editorRef"
      :ydoc="ydoc"
      :provider="provider"
      :user="user"
      @human-update="onHumanUpdate"
    />
  </div>
</template>

<style scoped>
.doc { display: flex; flex-direction: column; height: 100%; background: #15151a; border: 1px solid #2a2a30; border-radius: 10px; padding: 12px; }
.doc-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.doc-head h3 { margin: 0; font-size: 15px; }
.hint { color: #9aa; font-size: 12px; }
.toolbar { display: flex; gap: 8px; margin: 10px 0; }
button { background: #23232b; color: #f5f5f5; border: 1px solid #333; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
button:hover { border-color: #F97316; color: #F97316; }
button.primary { background: #F97316; border-color: #F97316; color: #111; font-weight: 600; }
button.primary:hover { color: #111; opacity: 0.9; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.banner { background: #4a2a08; border: 1px solid #a55a12; color: #ffd9b0; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; line-height: 1.6; margin-bottom: 10px; }
</style>
