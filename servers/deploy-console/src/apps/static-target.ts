import * as path from 'path';

/**
 * 静态产物落点解析（按环境分流，诊断 #3 修复）
 *
 * 背景（2026-10-09 实测）：控制台把磁盘入口指针**一律**写到 console 本机
 * `RELEASE_WORKSPACE` 下的 `servers/gateway/public`，但各环境真正的静态伺服根
 * 并不在同一处：
 *
 * | 环境 | gateway 静态根 | 所在机器 |
 * |------|----------------|----------|
 * | dev  | `/data/web_system/servers/gateway/public` | console 本机（南京） |
 * | prod | `/data/web_system_static/public`（`STATIC_PUBLIC_ROOT`） | prod 机（广州 106.52.176.246） |
 *
 * 后果有两层：
 * 1. **落点错**：prod 切换写到了 dev 机的目录，线上读的是 prod 外置静态根 →
 *    磁盘指针与 DB 指针长期撕裂（实测：DB=6e7b2690 / prod 磁盘=69d9e5f9）
 * 2. **校验走错机器**：`hasEnvVersion` 在 console 本机校验 prod 产物，
 *    而 prod 产物只在 prod 机上 → 「切不回线上版本」（E2E 已复现）
 *
 * 解法：落点变成**环境的一等属性**，配置驱动：
 * - `STATIC_PUBLIC_ROOT_<ENV>`：该环境静态根（目标机上的绝对路径）
 * - `STATIC_SSH_TARGET_<ENV>`：静态根所在机器（user@host）；不配 = console 本机
 * - `STATIC_PUBLIC_ROOT`：全局兜底（不区分环境）
 * - 都没配 → 回落 `<RELEASE_WORKSPACE>/servers/gateway/public`（**与修复前逐字节一致**）
 *
 * 未配置时行为零变化，本地开发 / dev 环境不受影响。
 */

export interface StaticTarget {
  env: string;
  /** gateway 静态伺服根（目标机器上的绝对路径） */
  root: string;
  /** ssh 目标（user@host）；null = console 本机，直接 fs 读写 */
  sshTarget: string | null;
}

/** 环境 → 配置键后缀（`staging-1` → `STAGING_1`） */
export function envKeySuffix(env: string): string {
  return env.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** 环境级配置键（如 `STATIC_PUBLIC_ROOT_PROD`） */
export function envConfigKey(prefix: string, env: string): string {
  return `${prefix}_${envKeySuffix(env)}`;
}

/** 本机默认静态根（未配置时，与历史行为一致） */
export function defaultStaticRoot(releaseWorkspace: string): string {
  return path.join(releaseWorkspace, 'servers', 'gateway', 'public');
}

/**
 * 解析某环境的静态落点。
 * @param get 配置读取器（ConfigService#get 或测试桩）
 */
export function resolveStaticTarget(
  env: string,
  get: (key: string) => string | undefined,
  releaseWorkspace: string,
): StaticTarget {
  const root = (
    get(envConfigKey('STATIC_PUBLIC_ROOT', env)) ||
    get('STATIC_PUBLIC_ROOT') ||
    defaultStaticRoot(releaseWorkspace)
  )
    .trim()
    .replace(/\/+$/, '');
  const ssh = (get(envConfigKey('STATIC_SSH_TARGET', env)) || '').trim();
  return { env, root, sshTarget: ssh || null };
}

/** 落点的人类可读描述（日志 / 报错文案用） */
export function describeTarget(t: StaticTarget): string {
  return t.sshTarget ? `${t.sshTarget}:${t.root}` : `本机 ${t.root}`;
}

/** ssh 前缀（BatchMode：不卡在密码输入上） */
export function sshPrefix(sshTarget: string): string {
  return `ssh -o ConnectTimeout=10 -o BatchMode=yes ${sshTarget}`;
}

/** 环境产物目录（相对静态根，posix 分隔符 —— 远端 shell 用） */
export function envArtifactsRel(appKey: string, env: string): string {
  return `static/modules/${appKey}/${env}`;
}
