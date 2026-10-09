<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { splitParagraphs } from '../lib/diff'
// 显式类型：Y.Doc / WebsocketProvider 不用 any（仓内 TS 红线 R4）
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

export interface EditorHandle {
  getText: () => string
  setText: (text: string) => void
  undo: () => void
  redo: () => void
}

const props = defineProps<{
  ydoc: Y.Doc
  provider: WebsocketProvider
  user: { name: string; color: string }
}>()

const emit = defineEmits<{ (e: 'human-update'): void }>()

// AI 落地 / 撤销回滚 / 加载存档 都是"程序化写入"，不能算作人类编辑
let applyingProgrammatic = false

// 注意：Collaboration 自带 yUndoManager，必须关闭 StarterKit 的 history，否则冲突报错
const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }),
    Collaboration.configure({ document: props.ydoc }),
    CollaborationCursor.configure({ provider: props.provider, user: props.user }),
  ],
  content: '',
  onUpdate: () => {
    if (applyingProgrammatic) return
    // 主干（XmlFragment）发生真实内容变化 → 通知上层（本地或远端的人类编辑）
    emit('human-update')
  },
})

function paragraphsToDoc(text: string) {
  const paras = splitParagraphs(text)
  return paras.length
    ? paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }))
    : [{ type: 'paragraph' }]
}

const getText = (): string => editor.value?.getText() ?? ''

// 整体写入（AI 落地 / 撤销回滚 / 加载存档），emitUpdate=false 所以不会误判成人改
const setText = (text: string) => {
  if (!editor.value) return
  applyingProgrammatic = true
  editor.value.chain().setContent(paragraphsToDoc(text)).run()
  applyingProgrammatic = false
}

// 撤销/重做走 Tiptap Collaboration 自带的 yUndoManager（默认只回滚本地来源，符合"不误伤他人"）
const undo = () => editor.value?.chain().focus().undo().run()
const redo = () => editor.value?.chain().focus().redo().run()

defineExpose({ getText, setText, undo, redo, editor })
</script>

<template>
  <div class="editor">
    <EditorContent :editor="editor" />
  </div>
</template>

<style scoped>
.editor :deep(.ProseMirror) {
  min-height: 360px;
  max-height: 460px;
  border: 1px solid #2a2a30;
  border-radius: 8px;
  padding: 12px;
  outline: none;
  background: #15151a;
  color: #f5f5f5;
  line-height: 1.8;
  overflow-y: auto;
}
.editor :deep(.ProseMirror p) {
  margin: 0 0 0.7em;
}
</style>
