import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveStoragePath, SERVICE_URL_DEFAULTS, StoragePathError } from '@web-system/shared';

/**
 * 上传根目录的解析与启动自检（A3）。
 *
 * 三级优先级（specs/backend-consolidation/design.md §1.2）：
 * ```
 * system_configs['storage.upload_dir']  ← 权威（system-service 持有，页面可改）
 *   ↓ 取不到 / 为空
 * env STORAGE_UPLOAD_DIR                ← 部署注入，兜底
 *   ↓ 缺失
 * ~/web_system/uploads                  ← 跨平台默认
 * ```
 *
 * 两条硬约定：
 * 1. **重启生效**：只在此处（启动期）解析一次，之后进程内不再重读配置 ——
 *    运行中改配置不会让「配置是新的、实际写的是旧目录」悄悄发生。
 * 2. **fail-fast**：解析出的目录不可创建/不可写时**直接拒绝启动**，不静默回落 cwd；
 *    否则文件会散落到进程工作目录，比启动失败更难排查。
 */

export const STORAGE_UPLOAD_DIR_ENV = 'STORAGE_UPLOAD_DIR';
export const STORAGE_ALLOWED_ROOTS_ENV = 'STORAGE_ALLOWED_ROOTS';
export const SYSTEM_SERVICE_URL_ENV = 'SYSTEM_SERVICE_URL';
export const INTERNAL_API_KEY_ENV = 'INTERNAL_API_KEY';

/** 跨平台默认上传根：`~/web_system/uploads` */
export const DEFAULT_UPLOAD_DIR = path.join(os.homedir(), 'web_system', 'uploads');

/** 启动时查系统配置的超时（ms）—— system-service 慢/挂了不能拖住本服务启动 */
export const CONFIG_FETCH_TIMEOUT_MS = 3000;

/**
 * 目录值**经哪一级**取得（不是「配置表里有没有」）：
 * - `system_service`：经 system-service 的权威接口拿到（它内部可能是配置表 / 它的 env / 它的默认，
 *   具体会在 notes 里注明，避免把「平台默认」说成「有人在配置中心设过」）；
 * - `env`：本服务的 `STORAGE_UPLOAD_DIR`；
 * - `default`：本服务内置默认 `~/web_system/uploads`。
 */
export type UploadDirSource = 'system_service' | 'env' | 'default';

export interface UploadDirResolution {
  /** 解析后的绝对路径（该 OS 原生分隔符） */
  dir: string;
  source: UploadDirSource;
  /** 过程性告警（如「系统配置非法已忽略」），由调用方打日志，便于排查为什么落到了兜底值 */
  notes: string[];
}

/** system-service `GET /internal/storage/path` 返回的「配置值本身来自哪一级」 */
export type UpstreamSource = 'system_configs' | 'env' | 'default';

export interface FetchConfiguredUploadDirOptions {
  systemServiceUrl?: string;
  internalKey?: string;
  timeoutMs?: number;
  /** 便于单测注入；默认全局 fetch */
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** 允许根：当前用户家目录 + `STORAGE_ALLOWED_ROOTS`（逗号分隔，用于放开数据盘） */
export function allowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = os.homedir();
  const raw = (env[STORAGE_ALLOWED_ROOTS_ENV] || '').trim();
  const extra = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const expanded = s === '~' ? home : s.startsWith('~/') ? home + s.slice(1) : s;
          return path.resolve(expanded);
        })
    : [];
  return [...new Set([path.resolve(home), ...extra])];
}

/** 解析一个候选上传目录（唯一实现走 shared 的 resolveStoragePath，越界即抛） */
export function resolveUploadDirInput(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveStoragePath(input, { allowRoots: allowedRoots(env) });
}

/**
 * 向 system-service 读权威上传目录。
 *
 * @returns `path` 为 null 表示「没取到」（网络失败 / 未配内部密钥 / 配置为空），
 *          调用方据此回落下一级；`error` 仅用于日志解释原因。
 */
export async function fetchConfiguredUploadDir(
  options: FetchConfiguredUploadDirOptions = {},
): Promise<{ path: string | null; upstreamSource?: UpstreamSource; error?: string }> {
  const env = options.env ?? process.env;
  const base = (
    options.systemServiceUrl ||
    (env[SYSTEM_SERVICE_URL_ENV] || '').trim() ||
    SERVICE_URL_DEFAULTS.system
  ).replace(/\/+$/, '');
  const internalKey = (
    options.internalKey ??
    (env[INTERNAL_API_KEY_ENV] || '')
  ).trim();
  if (!internalKey) {
    // 没配内部密钥就别打这个接口（必然 401，白白等一次超时）
    return { path: null, error: `${INTERNAL_API_KEY_ENV} 未配置，跳过系统配置查询` };
  }

  const timeoutMs = options.timeoutMs ?? CONFIG_FETCH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/internal/storage/path`, {
      headers: { 'x-internal-key': internalKey },
      signal: controller.signal,
    });
    if (!res.ok) return { path: null, error: `system-service 返回 ${res.status}` };
    const body = (await res.json()) as {
      data?: { path?: string; source?: UpstreamSource };
    };
    const value = (body?.data?.path || '').trim();
    return value
      ? { path: value, upstreamSource: body?.data?.source }
      : { path: null, error: '系统配置里的路径为空' };
  } catch (e) {
    const err = e as Error;
    return {
      path: null,
      error: err.name === 'AbortError' ? `查询超时（>${timeoutMs}ms）` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 按三级优先级解析出启动要用的上传根目录（不碰文件系统） */
export async function resolveUploadDirAtStartup(
  options: FetchConfiguredUploadDirOptions = {},
): Promise<UploadDirResolution> {
  const env = options.env ?? process.env;
  const notes: string[] = [];

  const configured = await fetchConfiguredUploadDir(options);
  if (configured.path) {
    try {
      const dir = resolveUploadDirInput(configured.path, env);
      // 说清「系统配置」到底是配置表里设了值，还是 system-service 自己落到了默认/env
      const origin =
        configured.upstreamSource === 'system_configs'
          ? '配置表 storage.upload_dir'
          : configured.upstreamSource === 'env'
            ? 'system-service 的环境变量'
            : 'system-service 的默认值';
      notes.push(`上传根目录经 system-service 取得（其来源：${origin}）`);
      return { dir, source: 'system_service', notes };
    } catch (e) {
      notes.push(
        `系统配置的上传目录不可用（${(e as Error).message}），已忽略并回落下一级`,
      );
    }
  } else if (configured.error) {
    notes.push(`读取系统配置失败：${configured.error}，回落下一级`);
  }

  const fromEnv = ((env[STORAGE_UPLOAD_DIR_ENV] || '') as string).trim();
  if (fromEnv) {
    return { dir: resolveUploadDirInput(fromEnv, env), source: 'env', notes };
  }

  return { dir: path.resolve(DEFAULT_UPLOAD_DIR), source: 'default', notes };
}

/**
 * 确保目录存在且可写 —— 启动期最后一道防线。
 *
 * 为什么不能只看 `fs.access(W_OK)`：NFS / 只读挂载上它会给假阳性，
 * 真的写一个探测文件才算数（写完立刻删掉）。
 *
 * @throws Error 带明确原因（调用方据此 fail-fast 并打印）
 */
export function ensureWritableDir(dir: string): void {
  // 先判类型再创建：`mkdirSync(file, {recursive:true})` 只会抛 EEXIST，
  // 报出来是「无法创建」，而运维真正需要看到的是「这个路径是个文件」
  if (fs.existsSync(dir)) {
    let isDir = false;
    try {
      isDir = fs.statSync(dir).isDirectory();
    } catch (e) {
      throw new Error(`上传根目录不可访问：${dir}（${(e as Error).message}）`);
    }
    if (!isDir) {
      throw new Error(`上传根目录不是目录：${dir}（该路径已存在且是文件）`);
    }
  } else {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      throw new Error(`上传根目录无法创建：${dir}（${(e as Error).message}）`);
    }
  }

  const probe = path.join(dir, `.ws-write-probe-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    try {
      fs.unlinkSync(probe);
    } catch {
      /* 探测文件可能没建出来 */
    }
    throw new Error(
      `上传根目录不可写：${dir}（${(e as Error).message}）—— 请检查属主/权限，或改系统配置 storage.upload_dir`,
    );
  }
}

/** 供调用方给出「路径越界」等可读原因（保留 StoragePathError 的稳定语义） */
export function describePathError(e: unknown): string {
  if (e instanceof StoragePathError) return `${e.message}（${e.code}）`;
  return (e as Error)?.message ?? String(e);
}
