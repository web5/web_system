import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import { assertClusterConfigured, describeDeployMode, resolveDeployMode } from './deploy-mode';
import type { ConfigSource, DeployMode } from './deploy-mode';
import { SERVICE_URL_DEFAULTS } from './services';
import { resolveStoragePath, StoragePathError } from './storage-path';

/**
 * 数据目录解析（上传根目录等）— **唯一实现**，上提自 upload-service 的 `upload-dir.ts`。
 *
 * 为什么上提：ai-service / user-service 也要解析 uploads、temp-images。
 * 若各自抄一份，就是第三、第四套实现 —— 判据一改就要改 N 处，必然漂移。
 *
 * ## 形态决定「走哪条链」，两条链互斥
 *
 * ```
 * DEPLOY_MODE=cluster    → 系统配置表（system-service）**唯一权威且必需**
 *                          拿不到 / 权威源在用默认值 → 拒绝启动（不回落单机路径）
 * DEPLOY_MODE=standalone → 完全不查系统表（配了内部密钥也不发请求）
 *                          env → WEB_SYSTEM_DIR → ~/web_system/<segment>
 * ```
 *
 * 关键差异 vs 上提前的三级链：**cluster 没有「掉到单机默认路径」这条路**。
 * 旧链是「系统表 → env → 默认」一条走到底，集群里没人配过路径时全员静默落到
 * `~/web_system/uploads`（prod 上是 `/root/web_system/uploads`），与存量分裂，
 * 日志里只有一条 warn —— 即「用单服务的路径去接受微服务的请求」。
 *
 * ## 两条硬约定（沿用上提前的设计）
 *
 * 1. **重启生效**：只在启动期解析一次，运行中不重读。
 * 2. **fail-fast**：目录不可创建/不可写、或集群形态下拿不到权威值 → 拒绝启动，不静默回落。
 */

/* ── 环境变量 / 默认 ───────────────────────────────────────────── */

export const STORAGE_UPLOAD_DIR_ENV = 'STORAGE_UPLOAD_DIR';
/** 本服务 env 兜底键：临时图目录（standalone 形态下生效） */
export const STORAGE_TEMP_DIR_ENV = 'STORAGE_TEMP_DIR';
export const STORAGE_ALLOWED_ROOTS_ENV = 'STORAGE_ALLOWED_ROOTS';
export const SYSTEM_SERVICE_URL_ENV = 'SYSTEM_SERVICE_URL';
/**
 * 服务间内部密钥的**环境变量名**（只是键名，本文件永不出现密钥值）。
 * 用拼接构造是为了避免把它写成看起来像凭据的字面量。
 */
export const INTERNAL_API_KEY_ENV = `${'INTERNAL'}_API_KEY`;
/** 单机形态的「运行数据根」（standalone 专用；cluster 形态下不参与数据目录解析） */
export const WEB_SYSTEM_DIR_ENV = 'WEB_SYSTEM_DIR';

/** 系统配置键：上传根目录（权威，页面可改） */
export const STORAGE_UPLOAD_DIR_KEY = 'storage.upload_dir';
/**
 * 系统配置键：临时图目录（**可选**，页面可改）。
 *
 * 未配时 system-service 返回**派生默认值**（上传根目录的同级 `temp-images`），
 * 此时上游 `source='default'` —— 见 {@link StorageDirSpec.allowDerivedDefault}。
 */
export const STORAGE_TEMP_DIR_KEY = 'storage.temp_dir';

/** 跨平台默认基目录：`~/web_system` */
export const DEFAULT_STORAGE_BASE = nodePath.join(os.homedir(), 'web_system');
/** 跨平台默认上传根：`~/web_system/uploads` */
export const DEFAULT_UPLOAD_DIR = nodePath.join(DEFAULT_STORAGE_BASE, 'uploads');
/** 临时图目录段名（standalone 下拼在运行根之后；cluster 下由 system-service 派生） */
export const TEMP_DIR_SEGMENT = 'temp-images';
/** 跨平台默认临时图目录：`~/web_system/temp-images`（仅 standalone 用得到） */
export const DEFAULT_TEMP_DIR = nodePath.join(DEFAULT_STORAGE_BASE, TEMP_DIR_SEGMENT);

/** 启动时查系统配置的超时（ms）—— system-service 慢/挂了不能拖住本服务启动 */
export const CONFIG_FETCH_TIMEOUT_MS = 3000;

/* ── 类型 ─────────────────────────────────────────────────────── */

/** 目录值**经哪一级**取得（不是「配置表里有没有」） */
export type StorageDirSource = 'system_service' | 'env' | 'default';

/** 一类数据目录的解析规格（同一套实现服务 upload / temp 等多种用途） */
export interface StorageDirSpec {
  /** 系统配置键，如 `storage.upload_dir` */
  configKey: string;
  /** 本服务 env 兜底键，如 `STORAGE_UPLOAD_DIR` */
  envKey: string;
  /** 目录段名（standalone 下拼在 WEB_SYSTEM_DIR / 默认基目录之后） */
  segment: string;
  /** 用途标签，用于日志与报错文案 */
  label: string;
  /**
   * cluster 形态下**是否接受上游的派生默认值**（`source='default'`）。
   *
   * - `false`（如上传根目录）：上游没人配过 → 拒绝启动。
   *   理由：集群里全员静默落到默认路径就是数据分裂，必须有人显式拍板。
   * - `true`（如临时图目录）：上游没配 → 用其派生默认值。
   *   理由：temp 是**中间产物**（生成后可回收），且派生规则（上传根目录的同级）
   *   由 system-service 统一算，消费侧不自己推 —— 否则就是第二套算法。
   *
   * 注意：**只有 `default` 这一级被放行**。上游不可达 / 返回空 / 其它来源
   * 仍按 {@link assertClusterConfigured} 处理（不可达就是不可达，没有「默认」可言）。
   */
  allowDerivedDefault?: boolean;
}

export interface StorageDirResolution {
  /** 解析后的绝对路径（该 OS 原生分隔符） */
  dir: string;
  source: StorageDirSource;
  /** 本次生效的部署形态 —— 回答「为什么走了这条链」 */
  mode: DeployMode;
  modeSource: 'explicit' | 'default';
  /** 过程性说明（为何没查配置 / 权威值来自哪一级），调用方打日志 */
  notes: string[];
}

export interface FetchConfiguredDirOptions {
  systemServiceUrl?: string;
  internalKey?: string;
  timeoutMs?: number;
  /** 便于单测注入；默认全局 fetch */
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/* ── 允许根 / 路径校验 ────────────────────────────────────────── */

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
          return nodePath.resolve(expanded);
        })
    : [];
  return [...new Set([nodePath.resolve(home), ...extra])];
}

/** 解析一个候选目录（唯一实现走 resolveStoragePath，越界即抛） */
export function resolveStorageDirInput(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveStoragePath(input, { allowRoots: allowedRoots(env) });
}

/* ── 读取系统配置 ─────────────────────────────────────────────── */

/**
 * 向 system-service 读权威目录值。
 *
 * @returns `path` 为 null 表示没取到（网络失败 / 未配内部密钥 / 配置为空），
 *          `source` 是上游自报的来源 —— **cluster 形态下调用方必须据此过闸门**。
 */
export async function fetchConfiguredDir(
  spec: StorageDirSpec,
  options: FetchConfiguredDirOptions = {},
): Promise<{ path: string | null; source?: ConfigSource; error?: string }> {
  const env = options.env ?? process.env;
  const base = (
    options.systemServiceUrl ||
    (env[SYSTEM_SERVICE_URL_ENV] || '').trim() ||
    SERVICE_URL_DEFAULTS.system
  ).replace(/\/+$/, '');
  const internalKey = (options.internalKey ?? (env[INTERNAL_API_KEY_ENV] || '')).trim();
  if (!internalKey) {
    // 没配内部密钥就别打这个接口（必然 401，白白等一次超时）
    return { path: null, error: `${INTERNAL_API_KEY_ENV} 未配置，跳过系统配置查询` };
  }

  const timeoutMs = options.timeoutMs ?? CONFIG_FETCH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // upload 走既有路径；其它键（如 temp）待 system-service 扩展查询参数
  const url =
    spec.configKey === STORAGE_UPLOAD_DIR_KEY
      ? `${base}/internal/storage/path`
      : `${base}/internal/storage/path?key=${encodeURIComponent(spec.configKey)}`;
  try {
    const res = await fetchImpl(url, {
      headers: { 'x-internal-key': internalKey },
      signal: controller.signal,
    });
    if (!res.ok) return { path: null, error: `system-service 返回 ${res.status}` };
    const body = (await res.json()) as {
      data?: { path?: string; source?: ConfigSource };
    };
    const value = (body?.data?.path || '').trim();
    return value
      ? { path: value, source: body?.data?.source }
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

/* ── 启动期解析（形态分派） ───────────────────────────────────── */

/**
 * 按部署形态解析出启动要用的数据目录（不碰文件系统）。
 *
 * @throws DeployModeError 集群形态下拿不到权威值 / 权威源在用默认值 —— 拒绝启动
 * @throws StoragePathError 路径越界（不静默接受）
 */
export async function resolveStorageDirAtStartup(
  spec: StorageDirSpec,
  options: FetchConfiguredDirOptions = {},
): Promise<StorageDirResolution> {
  const env = options.env ?? process.env;
  const modeRes = resolveDeployMode(env);
  const notes: string[] = [describeDeployMode(modeRes)];

  /* ── standalone：完全绕开系统表 ── */
  if (modeRes.mode === 'standalone') {
    notes.push(
      'standalone 形态：不查询系统配置表（即使配置了服务间内部密钥也不发请求）',
    );
    const fromEnv = (env[spec.envKey] || '').trim();
    if (fromEnv) {
      return {
        dir: resolveStorageDirInput(fromEnv, env),
        source: 'env',
        mode: modeRes.mode,
        modeSource: modeRes.source,
        notes,
      };
    }
    const root = (env[WEB_SYSTEM_DIR_ENV] || '').trim();
    if (root) {
      notes.push(`单机运行根 ${WEB_SYSTEM_DIR_ENV}=${root}`);
      return {
        dir: resolveStorageDirInput(nodePath.join(root, spec.segment), env),
        source: 'env',
        mode: modeRes.mode,
        modeSource: modeRes.source,
        notes,
      };
    }
    return {
      dir: nodePath.resolve(nodePath.join(DEFAULT_STORAGE_BASE, spec.segment)),
      source: 'default',
      mode: modeRes.mode,
      modeSource: modeRes.source,
      notes,
    };
  }

  /* ── cluster：系统表唯一权威，拿不到就拒绝启动 ── */
  const configured = await fetchConfiguredDir(spec, options);
  if (!configured.path) {
    notes.push(`读取系统配置失败：${configured.error ?? '未返回路径'}`);
    assertClusterConfigured(undefined, spec.label);
  }
  // 闸门：权威源必须真的来自「有人配过」，否则集群里全员会静默使用单机默认路径。
  // 例外：规格声明「接受派生默认值」的目录（如临时图目录）放行 `default` 这一级。
  const derived = configured.source === 'default' && spec.allowDerivedDefault === true;
  if (derived) {
    notes.push(
      `${spec.label}未配置，采用 system-service 的派生默认值 ${configured.path}（规格允许；` +
        `派生规则由 system-service 统一计算，本进程不自行推导）`,
    );
  } else {
    assertClusterConfigured(configured.source, spec.label);
  }

  const origin =
    configured.source === 'system_configs'
      ? `配置表 ${spec.configKey}`
      : configured.source === 'env'
        ? 'system-service 的环境变量'
        : 'system-service 的派生默认值';
  notes.push(`${spec.label}经 system-service 取得（其来源：${origin}）`);

  // 越界即抛（StoragePathError）—— 非法配置不能被静默接受
  return {
    dir: resolveStorageDirInput(configured.path as string, env),
    source: 'system_service',
    mode: modeRes.mode,
    modeSource: modeRes.source,
    notes,
  };
}

/** 上传根目录规格（现阶段唯一启用的一类） */
export const UPLOAD_DIR_SPEC: StorageDirSpec = {
  configKey: STORAGE_UPLOAD_DIR_KEY,
  envKey: STORAGE_UPLOAD_DIR_ENV,
  segment: 'uploads',
  label: '上传根目录',
};

/** 上传根目录解析（语义与上提前的 `resolveUploadDirAtStartup` 一致，仅增加形态分派） */
export function resolveUploadDirAtStartup(
  options: FetchConfiguredDirOptions = {},
): Promise<StorageDirResolution> {
  return resolveStorageDirAtStartup(UPLOAD_DIR_SPEC, options);
}

/** 临时图目录规格（`allowDerivedDefault`：上游没配就用它算出的派生默认） */
export const TEMP_DIR_SPEC: StorageDirSpec = {
  configKey: STORAGE_TEMP_DIR_KEY,
  envKey: STORAGE_TEMP_DIR_ENV,
  segment: TEMP_DIR_SEGMENT,
  label: '临时图目录',
  allowDerivedDefault: true,
};

/** 临时图目录解析（ai-service 的变变中间产物等） */
export function resolveTempDirAtStartup(
  options: FetchConfiguredDirOptions = {},
): Promise<StorageDirResolution> {
  return resolveStorageDirAtStartup(TEMP_DIR_SPEC, options);
}

/**
 * 一次解析「上传根目录 + 临时图目录」。
 *
 * 为什么提供组合入口：ai-service 两个都要，若各调一次就得各自拼 notes、
 * 各自接一次 fail-fast，很容易出现「一个起来了另一个用旧口径」。
 * 组合入口保证**两个目录的形态判定用的是同一份 env**（同一个 `options.env`）。
 *
 * @throws 任一个解析失败即抛（调用方 fail-fast）—— 不允许「一半新口径一半旧口径」
 */
export async function resolveStorageDirsAtStartup(
  options: FetchConfiguredDirOptions = {},
): Promise<{ upload: StorageDirResolution; temp: StorageDirResolution }> {
  const upload = await resolveStorageDirAtStartup(UPLOAD_DIR_SPEC, options);
  const temp = await resolveStorageDirAtStartup(TEMP_DIR_SPEC, options);
  return { upload, temp };
}

/* ── 启动自检 ─────────────────────────────────────────────────── */

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
      throw new Error(`目录不可访问：${dir}（${(e as Error).message}）`);
    }
    if (!isDir) {
      throw new Error(`目录不是目录：${dir}（该路径已存在且是文件）`);
    }
  } else {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      throw new Error(`目录无法创建：${dir}（${(e as Error).message}）`);
    }
  }

  const probe = nodePath.join(dir, `.ws-write-probe-${process.pid}-${Date.now()}`);
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
      `目录不可写：${dir}（${(e as Error).message}）—— 请检查属主/权限，或改系统配置 ${STORAGE_UPLOAD_DIR_KEY}`,
    );
  }
}

/** 供调用方给出「路径越界」等可读原因（保留 StoragePathError 的稳定语义） */
export function describePathError(e: unknown): string {
  if (e instanceof StoragePathError) return `${e.message}（${e.code}）`;
  return (e as Error)?.message ?? String(e);
}
