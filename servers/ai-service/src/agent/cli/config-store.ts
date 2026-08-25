import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

/** 单个模型的凭据 */
export interface ModelCred {
  apiKey: string;
  baseUrl?: string;
}

/** CLI 持久化配置（存于用户主目录，不进 git，绝不随 npm 包发布） */
export interface AgentCliConfig {
  version: number;
  models: Record<string, ModelCred>;
  defaultModel: string;
}

/** 已知模型清单（用于交互引导） */
export const KNOWN_MODELS: Array<{ id: string; name: string; defaultBase?: string }> = [
  { id: 'hy3', name: '混元 Turbo（腾讯 MaaS TokenHub）', defaultBase: 'https://tokenhub.tencentmaas.com/v1' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
];

/** 模型 id → 环境变量名 映射（供注入 process.env） */
const ENV_MAP: Record<string, { key: string; base: string }> = {
  hy3: { key: 'HY3_API_KEY', base: 'HY3_BASE_URL' },
  'deepseek-v4-flash': { key: 'DEPSEEK_API_KEY', base: 'DEPSEEK_BASE_URL' },
};

const CONFIG_DIR = path.join(os.homedir(), '.kedou');
const CONFIG_PATH = path.join(CONFIG_DIR, 'agent-cli.config.json');

const COLORS: Record<string, string> = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};
function c(text: string, color: string): string {
  return `${COLORS[color] ?? ''}${text}${COLORS.reset}`;
}

/**
 * 统一的行输入源：
 * - TTY（真实交互）：用 readline.question 逐行读取
 * - 非 TTY（管道/文件重定向，如 `printf ... | cli`）：一次性预读全部输入，按需出队
 */
class LineSource {
  private rl?: readline.Interface;
  private lines: string[] = [];
  private tty: boolean;

  constructor() {
    this.tty = !!process.stdin.isTTY;
    if (!this.tty) {
      try {
        const all = fs.readFileSync(0, 'utf-8');
        this.lines = all.split(/\r?\n/).map((s) => s.trim());
      } catch {
        this.lines = [];
      }
    } else {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
  }

  question(q: string): Promise<string> {
    return new Promise((resolve) => {
      if (this.tty && this.rl) {
        this.rl.question(q, (a) => resolve(a.trim()));
      } else {
        process.stdout.write(q);
        resolve(this.lines.shift() ?? '');
      }
    });
  }

  close(): void {
    this.rl?.close();
  }
}

/** 隐藏式输入（TTY 逐字符回显 *；非 TTY 降级明文，管道场景无回显问题） */
function secret(src: LineSource, question: string): Promise<string> {
  if (!process.stdin.isTTY) return src.question(question);
  return new Promise((resolve) => {
    process.stdout.write(question);
    let buf = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      for (const ch of s) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        } else {
          buf += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

/** 读取本地配置；不存在或损坏返回 null */
export function loadConfig(): AgentCliConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as AgentCliConfig;
    if (cfg && cfg.models && typeof cfg.models === 'object') return cfg;
    return null;
  } catch {
    return null;
  }
}

/** 写入本地配置（权限 600，仅本人可读） */
export function saveConfig(cfg: AgentCliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** 交互式引导用户配置大模型，并持久化 */
export async function promptConfig(): Promise<AgentCliConfig> {
  const src = new LineSource();
  console.log(c('\n首次使用，需要配置大模型（仅保存在你本机 ~/.kedou，不会上传，也不会随代码提交）', 'yellow'));
  console.log(c('可用的模型：', 'bold'));
  KNOWN_MODELS.forEach((m, i) => console.log(`  ${i + 1}. ${c(m.id, 'cyan')} - ${m.name}`));
  console.log(c('提示：可配置多个，用逗号分隔编号；留空默认只配置 1', 'gray'));

  const sel = await src.question('请选择要配置的模型编号（如 1 或 1,2）: ');
  const picks = (sel || '1')
    .split(',')
    .map((x) => parseInt(x.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < KNOWN_MODELS.length);
  const chosen = picks.length ? picks.map((i) => KNOWN_MODELS[i]) : [KNOWN_MODELS[0]];

  const models: Record<string, ModelCred> = {};
  for (const m of chosen) {
    console.log(c(`\n配置模型: ${m.id} (${m.name})`, 'bold'));
    const key = await secret(src, `  请输入 ${m.id} 的 API Key: `);
    if (!key) {
      console.log(c('  API Key 不能为空，跳过该模型', 'red'));
      continue;
    }
    const base = m.defaultBase
      ? (await src.question(`  Base URL（回车用默认 ${m.defaultBase}）: `)) || m.defaultBase
      : await src.question(`  Base URL（可留空）: `);
    models[m.id] = { apiKey: key, ...(base ? { baseUrl: base } : {}) };
  }

  if (Object.keys(models).length === 0) {
    console.log(c('未配置任何模型，无法继续。请重新运行并提供 API Key。', 'red'));
    process.exit(1);
  }

  let defaultModel = chosen[0].id;
  if (Object.keys(models).length > 1) {
    const def = await src.question(`默认模型（回车用 ${defaultModel}）: `);
    if (def && models[def]) defaultModel = def;
  }

  src.close();
  const cfg: AgentCliConfig = { version: 1, models, defaultModel };
  saveConfig(cfg);
  console.log(c(`\n✓ 配置已保存到 ${CONFIG_PATH}（权限 600，仅本人可读）`, 'green'));
  return cfg;
}

/** 确保配置存在：有则返回，无则交互引导并保存 */
export async function ensureConfig(): Promise<AgentCliConfig> {
  const existing = loadConfig();
  if (existing && Object.keys(existing.models).length > 0) return existing;
  return promptConfig();
}

/** 将配置文件中的凭据注入 process.env（在构建 harness 之前调用，优先级高于 .env） */
export function applyConfigToEnv(cfg: AgentCliConfig): void {
  for (const [id, cred] of Object.entries(cfg.models)) {
    const env = ENV_MAP[id];
    if (!env) continue;
    if (cred.apiKey) process.env[env.key] = cred.apiKey;
    if (cred.baseUrl) process.env[env.base] = cred.baseUrl;
  }
}
