import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { COLLAB_WS } from '../config'

// 连自建 NestJS 中继；room = docId（后端按 ws path 解析房间）
export function createProvider(docId: string, ydoc: Y.Doc) {
  return new WebsocketProvider(COLLAB_WS, docId, ydoc)
}
