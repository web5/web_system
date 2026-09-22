import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isWithinRoot,
  resolveStoragePath,
  StoragePathError,
} from '@web-system/shared';
import { SettingsService } from '../settings/settings.service';

/* ── 配置键 / 环境变量 ─────────────────────────────────────────── */

/** 上传根目录（**权威源**，系统管理页面可改；upload-service 启动时读它） */
export const STORAGE_UPLOAD_DIR_KEY = 'storage.upload_dir';
/** 目录浏览降级开关（'1' 开 / '0' 关，默认开）—— 异常时一键回到纯文本输入 */
export const STORAGE_BROWSE_ENABLED_KEY = 'storage.browse_enabled';
/** 允许根白名单（逗号分隔，**追加**在用户家目录之后，用于放开数据盘） */
export const STORAGE_ALLOWED_ROOTS_ENV = 'STORAGE_ALLOWED_ROOTS';
/** 兜底上传目录（系统配置缺失时使用） */
export const STORAGE_UPLOAD_DIR_ENV = 'STORAGE_UPLOAD_DIR';
/** 跨平台默认上传根：`~/web_system/uploads` */
export const DEFAULT_UPLOAD_DIR = path.join(os.homedir(), 'web_system', 'uploads');

/* ── 目录浏览的规模限制（design §1.5）───────────────────────────── */

/** 单层返回目录条数上限（超出只截断不报错，并置 truncated） */
export const BROWSE_MAX_ENTRIES = 200;
/** 浏览深度上限：请求路径相对允许根的最大层级 */
export const BROWSE_MAX_DEPTH = 5;
/** 单次列目录超时（ms）：防超大/卡死的网络盘拖垮请求 */
export const BROWSE_TIMEOUT_MS = 3000;

/** 上传目录来源 —— 前端要能说清「这个值从哪来」 */
export type UploadDirSource = 'system_configs' | 'env' | 'default';

export interface ConfiguredUploadDir {
  path: string;
  source: UploadDirSource;
}

export interface StorageDirCheck {
  ok: boolean;
  /** 解析后的绝对路径；路径本身非法（越界/空）时为 null */
  resolvedPath: string | null;
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
  /** 剩余可用空间（字节）；取不到为 null（不阻断保存） */
  freeSpace: number | null;
  /** 本次调用是否创建了目录（仅 `create: true` 时可能为 true） */
  created: boolean;
  /** 失败时的稳定错误码（如 `UPLOAD_DIR_OUT_OF_SCOPE`） */
  code?: string;
  message: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  /** 是否为符号链接（前端可提示「链接目录」） */
  symlink: boolean;
}

export interface BrowseResult {
  path: string;
  /** 命中的允许根：层级与越界判定的基准 */
  root: string;
  /** 上一级；已在根上时为 null */
  parent: string | null;
  depth: number;
  entries: BrowseEntry[];
  /** 是否因条数上限被截断 */
  truncated: boolean;
}

/** 展开 `~` / `~/`（与 shared 的 storage-path 语义一致，仅用于允许根白名单解析） */
function expandHome(input: string, home = os.homedir()): string {
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return home + input.slice(1);
  return input;
}

function formatBytes(n: number | null): string {
  if (n === null) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 存储配置的**唯一权威实现**（system-service）。
 *
 * 三件事：
 * 1. 解析上传根目录（系统配置 → 环境变量 → 跨平台默认，见 design §1.2）；
 * 2. 保存前校验（可解析 / 存在 / 可写 / 剩余空间，见 §1.3）；
 * 3. 安全目录浏览（只列目录、锁范围、限深度与条数，见 §1.5）。
 *
 * 关键约定：
 * - 路径解析**只走** `@web-system/shared` 的 `resolveStoragePath`，不自己拼；
 * - 允许根默认只有当前用户家目录，额外的盘用 `STORAGE_ALLOWED_ROOTS` 显式放开；
 * - `checkStorageDir` **不抛路径类异常**（返回 `ok:false` + code），
 *   便于「校验」接口原样回给前端；保存接口再把 `ok:false` 转成 400。
 */
@Injectable()
export class StorageService {
  constructor(private readonly settings: SettingsService) {}

  /** 允许根列表：当前用户家目录 + `STORAGE_ALLOWED_ROOTS`（逗号分隔） */
  allowedRoots(env: Record<string, string | undefined> = process.env): string[] {
    const home = os.homedir();
    const raw = (env[STORAGE_ALLOWED_ROOTS_ENV] || '').trim();
    const extra = raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => path.resolve(expandHome(s, home)))
      : [];
    const roots = [path.resolve(home), ...extra];
    return [...new Set(roots)];
  }

  /** 目录浏览是否开启（默认开；`storage.browse_enabled=0` 关闭） */
  async isBrowseEnabled(): Promise<boolean> {
    return this.settings.getBoolean(STORAGE_BROWSE_ENABLED_KEY, true);
  }

  /**
   * 解析**权威**上传目录：系统配置 → `STORAGE_UPLOAD_DIR` → `~/web_system/uploads`。
   *
   * 注意：这是「配置值」。upload-service 启动时采纳的值才是「当前生效值」，
   * 两者在改配置后、重启前会不一致（design §1.2 明确要求页面展示双值）。
   */
  async resolveConfiguredUploadDir(): Promise<ConfiguredUploadDir> {
    const configured = (await this.settings.get(STORAGE_UPLOAD_DIR_KEY))?.trim();
    if (configured) {
      return { path: this.resolveOrThrow(configured), source: 'system_configs' };
    }
    const fromEnv = (process.env[STORAGE_UPLOAD_DIR_ENV] || '').trim();
    if (fromEnv) {
      return { path: this.resolveOrThrow(fromEnv), source: 'env' };
    }
    return { path: path.resolve(DEFAULT_UPLOAD_DIR), source: 'default' };
  }

  /** 写入权威上传目录（只写配置，不碰文件系统；调用方须先 checkStorageDir） */
  async setUploadDir(resolvedPath: string): Promise<void> {
    await this.settings.set(STORAGE_UPLOAD_DIR_KEY, resolvedPath);
  }

  /**
   * 校验一个待保存的目录：解析 → 存在 → 可写（真写一个临时文件）→ 剩余空间。
   *
   * @param create 不存在时是否创建（保存路径用 true：新挂的盘往往还是空目录；
   *               纯校验接口用 false，只回报「不存在」）
   */
  async checkStorageDir(
    input: string,
    options: { create?: boolean } = {},
  ): Promise<StorageDirCheck> {
    const base: StorageDirCheck = {
      ok: false,
      resolvedPath: null,
      exists: false,
      isDirectory: false,
      writable: false,
      freeSpace: null,
      created: false,
      message: '',
    };

    let resolved: string;
    try {
      resolved = this.resolveOrThrow(input);
    } catch (e) {
      const err = e as BadRequestException;
      const payload = err.getResponse() as { code?: string; message?: string };
      return {
        ...base,
        code: payload?.code ?? 'UPLOAD_DIR_INVALID',
        message: payload?.message ?? err.message,
      };
    }

    let created = false;
    let exists = fs.existsSync(resolved);
    if (!exists && options.create) {
      try {
        fs.mkdirSync(resolved, { recursive: true });
        created = true;
        exists = true;
      } catch (e) {
        return {
          ...base,
          resolvedPath: resolved,
          code: 'UPLOAD_DIR_CREATE_FAILED',
          message: `目录不存在且创建失败：${(e as Error).message}`,
        };
      }
    }

    if (!exists) {
      return {
        ...base,
        resolvedPath: resolved,
        message: `目录不存在：${resolved}（可直接保存，保存时会自动创建）`,
      };
    }

    let isDirectory = false;
    try {
      isDirectory = fs.statSync(resolved).isDirectory();
    } catch (e) {
      return {
        ...base,
        resolvedPath: resolved,
        exists: true,
        code: 'UPLOAD_DIR_STAT_FAILED',
        message: `无法读取目录属性：${(e as Error).message}`,
      };
    }
    if (!isDirectory) {
      return {
        ...base,
        resolvedPath: resolved,
        exists: true,
        code: 'UPLOAD_DIR_NOT_DIRECTORY',
        message: `该路径是文件而不是目录：${resolved}`,
      };
    }

    const writable = this.probeWritable(resolved);
    const freeSpace = this.freeSpaceOf(resolved);

    if (!writable) {
      return {
        ...base,
        resolvedPath: resolved,
        exists: true,
        isDirectory: true,
        created,
        freeSpace,
        code: 'UPLOAD_DIR_NOT_WRITABLE',
        message: `目录不可写：${resolved}（请检查属主 / 权限）`,
      };
    }

    return {
      ok: true,
      resolvedPath: resolved,
      exists: true,
      isDirectory: true,
      writable: true,
      freeSpace,
      created,
      message: `可写${freeSpace === null ? '' : `，剩余 ${formatBytes(freeSpace)}`}`,
    };
  }

  /**
   * 列出**允许根之下**的目录（只列目录，不列文件、不返回内容）。
   *
   * @param rawPath 目标路径；缺省为第一个允许根（家目录）
   * @throws BadRequestException 路径越界 / 层级超限 / 列目录超时
   * @throws ForbiddenException  浏览开关关闭 / 无权限读取该目录
   * @throws NotFoundException   目录不存在
   */
  async browse(rawPath?: string): Promise<BrowseResult> {
    if (!(await this.isBrowseEnabled())) {
      throw new ForbiddenException('目录浏览已关闭（storage.browse_enabled=0）');
    }

    const roots = this.allowedRoots();
    const target = rawPath?.trim() ? this.resolveOrThrow(rawPath) : path.resolve(roots[0]);
    // 命中「最深」的允许根：白名单可能包含家目录的父级，取最长匹配才不会被上一级吞掉
    const root =
      roots.filter((r) => isWithinRoot(target, [r])).sort((a, b) => b.length - a.length)[0] ??
      roots[0];

    const rel = path.relative(root, target);
    const depth = rel ? rel.split(path.sep).filter(Boolean).length : 0;
    if (depth > BROWSE_MAX_DEPTH) {
      throw new BadRequestException({
        code: 'BROWSE_DEPTH_EXCEEDED',
        message: `目录层级超出上限（相对 ${root} 最多 ${BROWSE_MAX_DEPTH} 层，当前 ${depth} 层）`,
      });
    }

    const dirents = await this.readdir(target);

    // 先收集候选（名称/是否链接），**排序后再截断** —— readdir 顺序依赖文件系统，
    // 不排序会让「截断到 200」变成随机结果。
    const candidates = dirents
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => ({ name: d.name, symlink: d.isSymbolicLink() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const truncated = candidates.length > BROWSE_MAX_ENTRIES;
    const picked = candidates.slice(0, BROWSE_MAX_ENTRIES);

    // 符号链接判定必须**两侧都取 realpath**：macOS 上 `/var` 本身是指向 `/private/var`
    // 的链接，若只 realpath 目标、拿字面根去比，根内的合法链接会被误判成越界。
    const realRoots = this.realRoots(roots);

    const entries: BrowseEntry[] = [];
    for (const c of picked) {
      const full = path.join(target, c.name);
      if (c.symlink) {
        // 符号链接：解链后必须仍在允许根内、且真的是目录，否则跳过（不静默跟随到根外）
        try {
          const real = await fs.promises.realpath(full);
          if (!isWithinRoot(real, realRoots)) continue;
          if (!fs.statSync(real).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      entries.push({ name: c.name, path: full, symlink: c.symlink });
    }

    return {
      path: target,
      root,
      parent: path.relative(root, target) === '' ? null : path.dirname(target),
      depth,
      entries,
      truncated,
    };
  }

  /* ── 内部工具 ────────────────────────────────────────────────── */

  /** 解析路径并做范围校验；失败抛 400（带稳定 code） */
  private resolveOrThrow(input: string): string {
    try {
      return resolveStoragePath(input, { allowRoots: this.allowedRoots() });
    } catch (e) {
      if (e instanceof StoragePathError) {
        const code =
          e.code === 'OUT_OF_SCOPE'
            ? 'UPLOAD_DIR_OUT_OF_SCOPE'
            : e.code === 'EMPTY'
              ? 'UPLOAD_DIR_EMPTY'
              : 'UPLOAD_DIR_ENV_UNRESOLVED';
        throw new BadRequestException({ code, message: e.message });
      }
      throw e;
    }
  }

  /** 允许根的 realpath 版本（根不存在/无权访问时退回字面值，不因此让浏览整体失败） */
  private realRoots(roots: string[]): string[] {
    return roots.map((r) => {
      try {
        return fs.realpathSync(r);
      } catch {
        return r;
      }
    });
  }

  /** 真写一个临时文件再删掉 —— `access(W_OK)` 在 NFS/只读挂载上会给出假阳性 */
  private probeWritable(dir: string): boolean {
    const probe = path.join(dir, `.ws-write-probe-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return true;
    } catch {
      try {
        fs.unlinkSync(probe);
      } catch {
        /* 探测文件可能压根没建出来 */
      }
      return false;
    }
  }

  /** 剩余可用空间（字节）；平台不支持时返回 null（不阻断保存） */
  private freeSpaceOf(dir: string): number | null {
    try {
      const st = fs.statfsSync(dir);
      return Number(st.bsize) * Number(st.bavail);
    } catch {
      return null;
    }
  }

  /** 列目录 + 超时保护，并把 errno 翻译成明确的 HTTP 语义 */
  private async readdir(dir: string): Promise<fs.Dirent[]> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new BadRequestException({
              code: 'BROWSE_TIMEOUT',
              message: `列目录超时（>${BROWSE_TIMEOUT_MS}ms）：${dir}`,
            }),
          ),
        BROWSE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([
        fs.promises.readdir(dir, { withFileTypes: true }),
        timeout,
      ]);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (e instanceof BadRequestException) throw e;
      if (err.code === 'ENOENT') {
        throw new NotFoundException({ code: 'BROWSE_NOT_FOUND', message: `目录不存在：${dir}` });
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new ForbiddenException({
          code: 'BROWSE_FORBIDDEN',
          message: `无权限读取该目录：${dir}`,
        });
      }
      throw new BadRequestException({
        code: 'BROWSE_FAILED',
        message: `列目录失败：${err.message}`,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
