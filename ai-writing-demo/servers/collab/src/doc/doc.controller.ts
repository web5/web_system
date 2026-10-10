import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

// 文档落盘：把"编辑保存"做成真接口（Yjs 负责协同，这里负责服务端持久化快照）
const DATA_DIR = path.join(process.cwd(), 'data')
const DOC_FILE = path.join(DATA_DIR, 'docs.json')

type DocStore = Record<string, { content: string; savedAt: number }>

function readAll(): DocStore {
  try {
    if (!fs.existsSync(DOC_FILE)) return {}
    const raw = fs.readFileSync(DOC_FILE, 'utf-8')
    return raw ? (JSON.parse(raw) as DocStore) : {}
  } catch (e) {
    console.error('[doc] 读取失败，按空库处理：', e)
    return {}
  }
}

function writeAll(data: DocStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DOC_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

@Controller('doc')
export class DocController {
  @Get(':docId')
  get(@Param('docId') docId: string) {
    const all = readAll()
    return all[docId] || { content: '', savedAt: 0 }
  }

  @Post('save')
  save(@Body() body: { docId: string; content: string }) {
    const all = readAll()
    const savedAt = Date.now()
    all[body?.docId || 'demo-doc'] = { content: body?.content || '', savedAt }
    writeAll(all)
    return { ok: true, savedAt }
  }
}
