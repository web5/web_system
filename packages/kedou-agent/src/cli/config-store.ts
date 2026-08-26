/**
 * CLI 持久化配置：交互引导用户配置大模型 API key，存于 ~/.kedou（权限 600，不进 git，不随 npm 发布）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

export interface ModelCred {
  apiKey: string;
  baseUrl?: string;
}

/** 联网搜索凭据（web-search 用，全部可选） */
export interface SearchCred {
  /** 腾讯云 SecretId */
  tencentSecretId?: string;
  /** 腾讯云 SecretKey */
  tencentSecretKey?: string;
  /** Bing Web Search API Key */
  bingApiKey?: string;
}

export interface AgentCliConfig {
  version: number;
  models: Record<string, ModelCred>;
  defaultModel: string;
  /** 联网搜索凭据（可选，0.2.0 起持久化） */
  search?: SearchCred;
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

/** 搜索 key 映射（可选配置，供 web-search） */
const SEARCH_ENV_KEYS = ['BING_SEARCH_API_KEY', 'BOCHA_API_KEY', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'];

/** 搜索凭据字段 → 环境变量名 映射（持久化与恢复用） */
const SEARCH_ENV_MAP: Record<keyof SearchCred, string> = {
  tencentSecretId: 'TENCENT_SECRET_ID',
  tencentSecretKey: 'TENCENT_SECRET_KEY',
  bingApiKey: 'BING_SEARCH_API_KEY',
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

  /** 掩码输入（secret）。复用同一个 readline 接口，避免 setRawMode 与 readline 混用导致输入流错乱。 */
  secret(q: string): Promise<string> {
    if (!this.tty || !this.rl) return this.question(q);
    const rl = this.rl;
    return new Promise((resolve) => {
      // 保存原始输出方法（用于恢复）
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      const typedRl = rl as unknown as {
        _writeToOutput: (s: string) => void;
        _prompt: string;
        setPrompt(p: string): void;
      };
      // 掩码：仅拦截用户输入回显；提示语（prompt）原样显示
      typedRl._writeToOutput = (s: string) => {
        // 重绘 prompt（提示语）时原样显示，避免被掩码/清行覆盖
        if (s === typedRl._prompt) {
          write.call(rl, s);
          return;
        }
        const c = s.charAt(0);
        if (c === '\n' || c === '\r' || c === '\u001b' || c === '\u0007') {
          write.call(rl, s); // 换行/控制字符透传（含 readline 的清行/光标控制序列）
        } else if (c === '\u007f' || c === '\b') {
          process.stdout.write('\b \b'); // 退格
        } else {
          process.stdout.write('*'); // 用户输入回显一律掩码
        }
      };
      rl.question(q, (ans) => {
        typedRl._writeToOutput = write;
        process.stdout.write('\n');
        resolve(ans);
      });
    });
  }

  close(): void {
    this.rl?.close();
  }
}

function secret(src: LineSource, question: string): Promise<string> {
  return src.secret(question);
}

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

export function saveConfig(cfg: AgentCliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

/** 交互式引导配置（大模型 key + 可选搜索 key），并持久化 */
export async function promptConfig(): Promise<AgentCliConfig> {
  const src = new LineSource();
  console.log(c('\n首次使用，需要配置大模型（仅保存在本机 ~/.kedou，不会上传，也不会随代码提交）', 'yellow'));
  console.log(c('可用的模型：', 'bold'));
  KNOWN_MODELS.forEach((m, i) => console.log(`  ${i + 1}. ${c(m.id, 'cyan')} - ${m.name}`));
  console.log(c('提示：可配置多个，用逗号分隔编号；留空会重新要求输入，不会默认选中某个模型', 'gray'));

  // 收集模型编号：留空不自动选，必须显式输入有效编号
  let chosen: Array<(typeof KNOWN_MODELS)[number]> = [];
  while (chosen.length === 0) {
    const sel = await src.question('请选择要配置的模型编号（如 1 或 1,2）: ');
    const picks = (sel ?? '')
      .split(',')
      .map((x) => parseInt(x.trim(), 10) - 1)
      .filter((i) => !Number.isNaN(i) && i >= 0 && i < KNOWN_MODELS.length);
    if (picks.length > 0) {
      chosen = picks.map((i) => KNOWN_MODELS[i]);
    } else {
      console.log(c('输入无效或为空，请输入可用的模型编号（1-' + KNOWN_MODELS.length + '）', 'red'));
    }
  }

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

  // 可选：搜索凭据（web-search 用，优先腾讯云 WSA，未配置则回退 Bing）
  const search = await promptSearchConfig(src);

  src.close();
  const cfg: AgentCliConfig = { version: 1, models, defaultModel, search };
  saveConfig(cfg);
  // 将搜索凭据注入环境变量（供 harness 读取）
  applySearchToEnv(search);
  console.log(c(`\n✓ 配置已保存到 ${CONFIG_PATH}（权限 600，仅本人可读）`, 'green'));
  return cfg;
}

/** 便捷入口：仅补配联网搜索凭据（用于已配置模型、只想加搜索密钥的场景） */
export async function promptSearchOnly(): Promise<SearchCred | null> {
  const src = new LineSource();
  const search = await promptSearchConfig(src);
  src.close();
  if (!search.tencentSecretId && !search.tencentSecretKey && !search.bingApiKey) return null;
  return search;
}

/** 交互引导联网搜索凭据（可跳过，返回收集到的凭据对象） */
async function promptSearchConfig(src: LineSource): Promise<SearchCred> {
  const search: SearchCred = {};
  console.log(c('\n可选配置联网搜索（web-search 需要，可跳过）', 'yellow'));
  const tencentSecretId = await secret(src, '  腾讯云 SecretId（回车跳过）: ');
  if (tencentSecretId) search.tencentSecretId = tencentSecretId;
  const tencentSecretKey = await secret(src, '  腾讯云 SecretKey（回车跳过）: ');
  if (tencentSecretKey) search.tencentSecretKey = tencentSecretKey;
  const bingKey = await secret(src, '  Bing Web Search API Key（回车跳过）: ');
  if (bingKey) search.bingApiKey = bingKey;
  return search;
}

/** 将搜索凭据注入 process.env（供 WebSearchTool/WsaProvider/BingProvider 读取） */
function applySearchToEnv(search?: SearchCred): void {
  if (!search) return;
  (Object.keys(SEARCH_ENV_MAP) as Array<keyof SearchCred>).forEach((k) => {
    const val = search[k];
    if (val) process.env[SEARCH_ENV_MAP[k]] = val;
  });
}

export async function ensureConfig(): Promise<AgentCliConfig> {
  const existing = loadConfig();
  if (existing && Object.keys(existing.models).length > 0) return existing;
  return promptConfig();
}

/** 将配置文件中的凭据注入 process.env（在构建 harness 之前调用，优先级高于已有 env） */
export function applyConfigToEnv(cfg: AgentCliConfig): void {
  for (const [id, cred] of Object.entries(cfg.models)) {
    const env = ENV_MAP[id];
    if (!env) continue;
    if (cred.apiKey) process.env[env.key] = cred.apiKey;
    if (cred.baseUrl) process.env[env.base] = cred.baseUrl;
  }
  // 注入联网搜索凭据
  applySearchToEnv(cfg.search);
}

/** 列出当前已配置的搜索 key 状态（结合持久化配置 + 环境变量判断） */
export function listSearchKeyStatus(): Array<{ id: string; available: boolean }> {
  const cfg = loadConfig();
  const search = cfg?.search;
  return SEARCH_ENV_KEYS.map((k) => {
    // 从持久化配置中按 env 名反查（SEARCH_ENV_MAP 的 value 即 env 名）
    let persisted = '';
    (Object.keys(SEARCH_ENV_MAP) as Array<keyof SearchCred>).forEach((field) => {
      if (SEARCH_ENV_MAP[field] === k && search?.[field]) persisted = search[field]!;
    });
    return { id: k, available: !!(process.env[k]?.trim() || persisted.trim()) };
  });
}
