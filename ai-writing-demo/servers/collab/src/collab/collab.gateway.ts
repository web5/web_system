import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Socket } from 'net'
import { Logger } from '@nestjs/common'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const messageSync = 0
const messageAwareness = 1
const docs = new Map<string, WSSharedDoc>()

// awareness 变更回调的载荷（y-protocols 未导出该类型，这里显式声明，避免 any）
interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

class WSSharedDoc extends Y.Doc {
  name: string
  conns: Map<WebSocket, Set<number>> = new Map()
  awareness: awarenessProtocol.Awareness
  constructor(name: string) {
    super({ gc: true })
    this.name = name
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)

    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange) => {
      const changed = added.concat(updated, removed)
      if (changed.length === 0) return
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, messageAwareness)
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      )
      const buf = encoding.toUint8Array(enc)
      this.conns.forEach((_, conn) => send(this, conn, buf))
    })

    this.on('update', (update: Uint8Array) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, messageSync)
      syncProtocol.writeUpdate(enc, update)
      const buf = encoding.toUint8Array(enc)
      this.conns.forEach((_, conn) => send(this, conn, buf))
    })
  }
}

function getDoc(name: string): WSSharedDoc {
  let d = docs.get(name)
  if (!d) {
    d = new WSSharedDoc(name)
    docs.set(name, d)
  }
  return d
}

function send(doc: WSSharedDoc, conn: WebSocket, msg: Uint8Array) {
  if (conn.readyState !== WebSocket.OPEN && conn.readyState !== WebSocket.CONNECTING) {
    closeConn(doc, conn)
    return
  }
  try {
    conn.send(msg)
  } catch {
    closeConn(doc, conn)
  }
}

function closeConn(doc: WSSharedDoc, conn: WebSocket) {
  const controlled = doc.conns.get(conn)
  if (controlled) {
    doc.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlled), null)
  }
  try {
    conn.close()
  } catch {
    /* noop */
  }
}

function messageListener(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array) {
  try {
    const encoder = encoding.createEncoder()
    const decoder = decoding.createDecoder(message)
    const type = decoding.readVarUint(decoder)
    switch (type) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
        if (encoding.length(encoder) > 1) send(doc, conn, encoding.toUint8Array(encoder))
        break
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        )
        break
    }
  } catch (err) {
    console.error('[collab] message error', err)
  }
}

export function startCollabServer(port: number) {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' })
    res.end('Yjs collab endpoint requires WebSocket')
  })
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url || '/default'
    let room = decodeURIComponent(url.slice(1).split('?')[0])
    if (!room) room = 'default'
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const doc = getDoc(room)
      const controlled = new Set<number>()
      doc.conns.set(ws, controlled)
      ws.binaryType = 'arraybuffer'

      // 把该连接产生的 awareness client 记录下来，便于断开时清理
      const onAwarenessUpdate = (
        { added, updated, removed }: AwarenessChange,
        origin: unknown,
      ) => {
        if (origin === ws) {
          added.concat(updated, removed).forEach((id: number) => controlled.add(id))
        }
      }
      doc.awareness.on('update', onAwarenessUpdate)

      // 初始同步：sync step1 + 现有 awareness
      const enc1 = encoding.createEncoder()
      encoding.writeVarUint(enc1, messageSync)
      syncProtocol.writeSyncStep1(enc1, doc)
      send(doc, ws, encoding.toUint8Array(enc1))

      const states = doc.awareness.getStates()
      if (states.size > 0) {
        const aenc = encoding.createEncoder()
        encoding.writeVarUint(aenc, messageAwareness)
        encoding.writeVarUint8Array(
          aenc,
          awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())),
        )
        send(doc, ws, encoding.toUint8Array(aenc))
      }

      ws.on('message', (data: ArrayBuffer) => {
        messageListener(ws, doc, new Uint8Array(data))
      })
      ws.on('close', () => {
        doc.awareness.off('update', onAwarenessUpdate)
        closeConn(doc, ws)
      })
    })
  })

  server.listen(port, '0.0.0.0', () => {
    new Logger('CollabGateway').log(`Yjs relay listening on :${port} (room = ws path)`)
  })
}
