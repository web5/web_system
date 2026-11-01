/**
 * 「干净重启」（restart-clean）的调用构造层 —— 纯函数，零 Nest 依赖，可单测。
 *
 * 背景（2026-10-31 实测，prod ai-service）：
 *   `pm2 restart`（in-place）的进程环境 = 上次存下的 pm2_env（merge 语义），
 *   叠加 `@nestjs/config` 只补不覆盖已存在键（config.module.js:188
 *   `filter(key => !(key in process.env))`）→ **新增键生效，改已有键的值永久失效**。
 *   只有 `pm2 delete` + `env -i` 能把进程环境清零，让 `.env` 成为唯一配置源。
 *
 * 松耦合约定（用户 2026-10-31 明确）：
 *   - **实现只有一份**，放在工具目录 `deploy_tool_catalog.command`（kind=shell）；
 *   - 本文件**不保存正文**，只负责「取正文 + 算参数」，平台不掌握重启的实现细节；
 *   - 取不到正文 / 前置不满足 → 返回 null，由调用方回落旧行为（渐进加固，不硬切断）。
 *
 * 本文件不认识任何具体服务：服务目录、端口、进程名全部由调用方注入。
 */

/** 工具目录里的能力 code（唯一实现所在） */
export const RESTART_CLEAN_TOOL = 'restart-clean';

/** 干净重启超时（含脚本内健康断言，默认 60s 探活 + 启动开销） */
export const RESTART_CLEAN_TIMEOUT_MS = 150_000;

export interface RestartCleanParams {
  /** 模块 key（ai-service / gateway …） */
  moduleKey: string;
  /** 服务目录（含 dist/ 与 .env） */
  svcDir: string;
  /** 监听端口；为空则不走干净重启（脚本必需） */
  port?: string | null;
  /** pm2 进程名（实际存在的那个） */
  pm2Name?: string | null;
  /** pm2 可执行文件绝对路径 */
  pm2Bin?: string | null;
  /** 发布根目录（脚本用它推导 RELEASE_DIR 布局，可选） */
  releaseDir?: string | null;
  /** 探活超时秒数 */
  healthTimeoutSec?: number | null;
  /** 额外注入进程环境的变量（空格分隔 K=V，如 gateway 静态根） */
  extraEnv?: string | null;
}

/** 从 `.env` 文本里取 PORT（忽略注释行与空值） */
export function parseEnvPort(content?: string | null): string | null {
  if (!content) return null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    if (key !== 'PORT') continue;
    const val = line
      .slice(idx + 1)
      .split('#')[0]
      .trim();
    if (val) return val;
  }
  return null;
}

/** 解析 `pm2 jlist` 输出为进程名列表（非法输入 → 空数组，绝不抛错） */
export function parsePm2Names(json?: string | null): string[] {
  try {
    const arr = JSON.parse(json ?? '');
    if (!Array.isArray(arr)) return [];
    return arr.map((p: any) => p?.name).filter((n: any) => typeof n === 'string' && n);
  } catch {
    return [];
  }
}

/** 从 `pm2 jlist` 里按候选名顺序取第一个有 PORT 的进程端口（pm2_env.PORT / pm2_env.env.PORT） */
export function parsePm2Port(json: string | null | undefined, names: string[]): string | null {
  try {
    const arr = JSON.parse(json ?? '');
    if (!Array.isArray(arr)) return null;
    for (const n of names) {
      const p = arr.find((x: any) => x?.name === n);
      if (!p) continue;
      const port = p?.pm2_env?.PORT ?? p?.pm2_env?.env?.PORT;
      if (port !== undefined && port !== null && String(port) !== '') return String(port);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * pm2 进程名候选（与 restart-clean 脚本 `resolve_name` 完全一致）：
 * 注册表名 → web-<key> → web-<base> → key → base（base = 去掉 `-service` 后缀）。
 */
export function pm2NameCandidates(moduleKey: string, pm2?: string | null): string[] {
  // 与 restart-clean 脚本 `resolve_name` 一致：去掉末尾 `-service`（8 字符）
  const base = moduleKey.endsWith('-service') ? moduleKey.slice(0, -'-service'.length) : moduleKey;
  return Array.from(
    new Set([pm2, `web-${moduleKey}`, `web-${base}`, moduleKey, base].filter(Boolean) as string[]),
  );
}

/** 候选名里第一个真实存在的进程名；都不存在返回 null */
export function pickPm2Name(candidates: string[], running: string[]): string | null {
  for (const c of candidates) if (running.includes(c)) return c;
  return null;
}

/**
 * 构造 restart-clean 的执行环境。
 *
 * @returns 环境变量表；**PORT 缺失返回 null**（脚本 `: ${PORT:?}` 会直接 die，
 *          由调用方回落旧行为而不是让部署失败）。
 */
export function buildRestartCleanEnv(p: RestartCleanParams): Record<string, string> | null {
  const port = (p.port ?? '').trim();
  if (!port) return null;
  const env: Record<string, string> = {
    MODULE_KEY: p.moduleKey,
    SVC_DIR: p.svcDir,
    PORT: port,
    // dist 落地与备份由调用方（applyBackendVersion）完成，脚本不重复落地；
    // 但重启失败时**允许回滚**（用 dist.bak-* 复原并重新拉起），避免「删了没起来」。
    ROLLBACK: '1',
    // 进程必须已在 pm2 纳管；未纳管不擅自新建（名字/入口没共识，宁可回落旧行为）
    PM2_ALLOW_NEW: '0',
    DRY_RUN: '0',
  };
  if (p.releaseDir) env.RELEASE_DIR = p.releaseDir;
  if (p.pm2Name) env.PM2_NAME = p.pm2Name;
  if (p.pm2Bin) env.PM2_BIN = p.pm2Bin;
  if (p.healthTimeoutSec && p.healthTimeoutSec > 0) {
    env.HEALTH_TIMEOUT = String(p.healthTimeoutSec);
  }
  if (p.extraEnv) env.EXTRA_ENV = p.extraEnv;
  return env;
}
