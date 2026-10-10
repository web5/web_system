import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Logger } from '@nestjs/common'

const logger = new Logger('LlmLoader')

// 启动时尝试读取 ~/env_config/llm.env，仅补齐未设置的环境变量（不覆盖已设值）
export function loadLlmEnv() {
  const p = path.join(os.homedir(), 'env_config', 'llm.env')
  if (!fs.existsSync(p)) {
    logger.warn('未找到 ~/env_config/llm.env，将依赖 process.env / mock')
    return
  }
  const txt = fs.readFileSync(p, 'utf-8')
  let count = 0
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*export\s+([A-Za-z0-9_]+)\s*=\s*"?([^"\r\n]*?)"?\s*$/)
    if (m) {
      const key = m[1]
      const val = m[2]
      if (process.env[key] === undefined) {
        process.env[key] = val
        count++
      }
    }
  }
  logger.log(`已从 ${p} 补齐 ${count} 个环境变量`)
}
