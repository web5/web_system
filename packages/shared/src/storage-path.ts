import * as nodePath from 'path';
import * as os from 'os';

/**
 * 跨平台存储路径解析 — 唯一实现，禁止各服务自行拼路径。
 *
 * 背景：上传根目录要支持用户在系统管理页面自定义，且要跑在
 * Windows / macOS / Linux 上；`~`、`%USERPROFILE%`、盘符、正反斜杠混写
 * 都必须被正确理解，同时要挡住 `..` 穿越。
 *
 * 用法：
 * ```ts
 * resolveStoragePath('~/web_system/uploads');                 // /Users/x/web_system/uploads
 * resolveStoragePath('%USERPROFILE%/data', { platform: 'win32' }); // C:\Users\x\data
 * resolveStoragePath('/var/data', { allowRoots: ['/var'] });   // 允许根显式放开
 * ```
 *
 * 设计取舍：
 * - **存储该 OS 的原生路径**（不强行转 posix）。路径可能落库、也可能被其它服务读取，
 *   统一成 `/` 会与 Windows 上真实文件系统不一致。
 * - **不做任意环境变量展开**，只认白名单（`WINDOWS_ENV_ALLOWLIST`），
 *   避免把路径字符串变成变量注入面。
 * - `platform` / `home` / `env` 可注入，便于在 macOS 上单测 Windows 分支。
 */

/** Windows 环境变量展开白名单（仅这些，不做任意展开） */
export const WINDOWS_ENV_ALLOWLIST = [
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMDATA',
  'PUBLIC',
  'TEMP',
  'TMP',
  'SystemDrive',
  'HOMEDRIVE',
  'HOMEPATH',
] as const;

export interface ResolveStoragePathOptions {
  /**
   * 允许根列表。解析结果必须落在其中之一之下，否则抛错（防 `..` 穿越）。
   * 默认只允许用户家目录；运维想指向新挂的数据盘时须显式传此项。
   */
  allowRoots?: string[];
  /** 目标平台，默认取当前进程。用于跨平台单测。 */
  platform?: NodeJS.Platform;
  /** 家目录，默认 os.homedir()。用于单测。 */
  home?: string;
  /** 环境变量表，默认 process.env。用于单测。 */
  env?: Record<string, string | undefined>;
  /** 是否展开 Windows 环境变量白名单，默认 true */
  expandEnv?: boolean;
}

export class StoragePathError extends Error {
  constructor(
    message: string,
    /** 稳定错误码，便于上层映射 HTTP 状态码 */
    readonly code: 'EMPTY' | 'OUT_OF_SCOPE' | 'UNRESOLVED_ENV',
  ) {
    super(message);
    this.name = 'StoragePathError';
  }
}

function pathFor(platform: NodeJS.Platform): typeof nodePath {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/** 展开 `~` / `~user`（仅 posix 语义；Windows 不展开，交 resolve 处理） */
function expandHome(input: string, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') return input;
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return home + input.slice(1);
  }
  // ~user 形态：不展开（无法在本进程内可靠解析其它用户家目录），保持原样交由 resolve
  return input;
}

/** 展开 Windows 环境变量白名单（%VAR%），未命中且存在于白名单则视为未配置 */
function expandWindowsEnv(
  input: string,
  env: Record<string, string | undefined>,
): string {
  return input.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
    const upper = name.toUpperCase();
    if (!(WINDOWS_ENV_ALLOWLIST as readonly string[]).includes(upper)) {
      // 非白名单变量：保持原样，不做展开
      return whole;
    }
    const value = env[name] ?? env[upper];
    if (!value) {
      throw new StoragePathError(`环境变量 ${whole} 未配置`, 'UNRESOLVED_ENV');
    }
    return value;
  });
}

/**
 * 判断 target 是否落在 roots 之一之下（任一命中即可）。
 *
 * 用 `relative` 判断而非字符串前缀：前缀比较会把 `/var/data-2` 误判为
 * 在 `/var/data` 之下。
 */
export function isWithinRoot(
  target: string,
  roots: string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  const p = pathFor(platform);
  const resolvedTarget = p.resolve(target);
  return roots.some((root) => {
    const resolvedRoot = p.resolve(root);
    if (resolvedTarget === resolvedRoot) return true;
    const rel = p.relative(resolvedRoot, resolvedTarget);
    return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
  });
}

/**
 * 解析存储路径：展开家目录 → 展开环境变量（Windows 白名单）→ resolve → 校验范围。
 *
 * @throws {StoragePathError} 空输入 / 越界 / 白名单变量未配置
 */
export function resolveStoragePath(
  input: string,
  options: ResolveStoragePathOptions = {},
): string {
  const {
    allowRoots,
    platform = process.platform,
    home = os.homedir(),
    env = process.env as Record<string, string | undefined>,
    expandEnv = true,
  } = options;

  const p = pathFor(platform);
  const trimmed = input.trim();
  if (!trimmed) {
    throw new StoragePathError('存储路径不能为空', 'EMPTY');
  }

  let value = expandHome(trimmed, platform, home);
  if (platform === 'win32' && expandEnv) {
    value = expandWindowsEnv(value, env);
  }

  const resolved = p.resolve(p.normalize(value));

  const roots = allowRoots?.length ? allowRoots : [home];
  if (!isWithinRoot(resolved, roots, platform)) {
    throw new StoragePathError(
      `存储路径越界：必须位于允许根之下（${roots.join(', ')}），实际解析为 ${resolved}`,
      'OUT_OF_SCOPE',
    );
  }

  return resolved;
}
