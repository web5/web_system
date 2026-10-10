import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { markRaw } from 'vue'

// 致命点：Y.Doc 绝不能进 ref（Vue 深响应代理会让字符级更新触发巨量依赖追踪，直接卡死）
// 必须用 markRaw 绕过 Vue 响应式
export function createDoc(docId: string) {
  const ydoc = markRaw(new Y.Doc())
  const persistence = new IndexeddbPersistence(`doc:${docId}`, ydoc)

  // 主干文档：交给 Tiptap Collaboration，真实内容是 ydoc 的 XmlFragment('default')。
  // 所以这里【不】再单独持有 Y.Text —— 之前用 ydoc.getText('content') 读主干，
  // 结果永远为空（编辑器根本不写这个字段），AI 才会收到空文档。
  //
  // AI 建议层（ghost）：独立的 Y.Text，只在「接受」时才把文本并入主干（不污染正文）。
  const ySuggestion = ydoc.getText('ai-suggestion')

  return { ydoc, persistence, ySuggestion }
}
