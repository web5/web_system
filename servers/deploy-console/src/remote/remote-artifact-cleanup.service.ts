import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SshExecService } from './ssh-exec.service';
import { resolveStaticTarget } from '../apps/static-target';
import { defaultReleaseWorkspace } from '../pipeline/release-paths';
import { KEEP_MIN_AGE_MS, KEEP_VERSIONS } from '../artifact/artifact-store.service';

/**
 * 远端产物保留策略（诊断 #10）。
 *
 * 为什么必须做：**prod 的产物根本不在 console 本机**。prod gateway 的静态根外置在
 * prod 机（`/data/web_system_static/public`，见诊断 #3），而 `ArtifactStoreService.cleanup`
 * 只扫本机 `RELEASE_WORKSPACE` —— 也就是说清理在 prod 上**从来没发生过**，
 * `<key>/<env>/<commit>/` 只增不减（诊断 #9 的远端版）。
 *
 * 远端 `rm -rf` 是高危操作，故分两步且**默认只观测**：
 * - `scan` 只读：列出远端该目录的条目（名称 + mtime）
 * - `cleanup` 计算保留/删除计划；`REMOTE_CLEANUP_ENABLED=true` 才真正执行，
 *   否则只把「会删哪些、占多少版本」写进 result 与日志，供人工确认后再开。
 *
 * 保留规则与本地 `ArtifactStoreService.cleanup` 一致（同一套语义，避免两处漂移）：
 * ① 受保护版本（当前版本 / 指针指向的版本）② 最近 keep 个 ③ 未满 minAge 的。
 */

export interface RemoteEntry {
  name: string;
  /** 远端 mtime（毫秒） */
  mtime: number;
}

export interface RetainPlan {
  keep: string[];
  remove: string[];
}

/**
 * 保留策略（纯函数，便于单测）：按 mtime 倒序，受保护 / 最近 keep 个 / 未满 minAge 的保留。
 *
 * 与本地清理的差别只有一处：这里**只看一级目录**，因为远端布局在调用前已定位到
 * `<staticRoot>/static/modules/<key>/<env>/` 这一层，其下直接就是 `<commit>/`。
 */
export function planRetain(
  entries: RemoteEntry[],
  opts: {
    keep?: number;
    protectedVersions?: ReadonlySet<string>;
    minAgeMs?: number;
    now?: number;
  } = {},
): RetainPlan {
  const keep = opts.keep ?? KEEP_VERSIONS;
  const protect = opts.protectedVersions ?? new Set<string>();
  const minAgeMs = opts.minAgeMs ?? KEEP_MIN_AGE_MS;
  const now = opts.now ?? Date.now();

  const sorted = [...entries].sort((a, b) => b.mtime - a.mtime);
  const out: RetainPlan = { keep: [], remove: [] };
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const withinMinAge = minAgeMs > 0 && now - e.mtime < minAgeMs;
    if (protect.has(e.name) || out.keep.length < keep || withinMinAge) {
      out.keep.push(e.name);
    } else {
      out.remove.push(e.name);
    }
  }
  return out;
}

/**
 * 远端目录名形态校验：只允许看起来像版本号的目录进入删除列表。
 *
 * 这是**最后一道闸**：远端 rm -rf 一旦带上了 `..`、`/`、`dist` 之类，
 * 就是一次线上事故。宁可少删，也不能错删。
 */
export function isSafeVersionName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  // 7-40 位十六进制（commit 短/长哈希）或 vX.Y.Z 形态；其余一律不碰
  return /^[0-9a-f]{7,40}$/.test(name) || /^v\d+(\.\d+){0,3}(-[0-9a-zA-Z.-]+)?$/.test(name);
}

export interface RemoteCleanupResult extends RetainPlan {
  /** 远端实际扫描到的条目数 */
  scanned: number;
  /** 是否真的执行了删除（false = 只观测） */
  applied: boolean;
  /** 未执行的原因（如开关关闭 / 目录不存在） */
  reason?: string;
  /** 远端目标目录（脱敏后仅用于日志展示） */
  dir: string;
}

@Injectable()
export class RemoteArtifactCleanupService {
  private readonly logger = new Logger(RemoteArtifactCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly ssh: SshExecService,
  ) {}

  /** 某环境静态根（诊断 #3 的落点配置；未配则回落本机发布目录，此时远端扫描无意义） */
  private staticRootOf(env: string): { root: string; remote: boolean } {
    const t = resolveStaticTarget(env, (k) => this.configService.get<string>(k), defaultReleaseWorkspace());
    return { root: t.root, remote: !!t.sshTarget };
  }

  /** 远端版本目录：`<staticRoot>/static/modules/<moduleKey>/<envId>` */
  private versionDir(env: string, moduleKey: string, envId: string): string {
    const { root } = this.staticRootOf(env);
    return `${root}/static/modules/${moduleKey}/${envId}`;
  }

  /**
   * 只读扫描：列出远端版本目录下的条目（名称 + mtime，秒级精度足够）。
   * 目录不存在返回空数组（不抛错 —— 清理不该让流水线红掉）。
   */
  async scan(env: string, moduleKey: string, envId = env): Promise<RemoteEntry[]> {
    // env-dir 的静态根没配 SSH 目标 = 本机目录，不该走 ssh 去扫（否则本机发布会被误连）
    const { remote } = this.staticRootOf(env);
    if (!remote) {
      this.logger.warn(
        `环境 ${env} 未配置 STATIC_SSH_TARGET_${env.toUpperCase()}，无法扫描远端产物（本机目录不被视作远端）`,
      );
      return [];
    }
    return this.scanDir(env, this.versionDir(env, moduleKey, envId), `cleanup-scan:${moduleKey}@${envId}`);
  }

  /**
   * 扫描任意远端目录（env-dir 与后端布局共用）。
   *
   * `remote` 判定：没配 `STATIC_SSH_TARGET_<ENV>` 时，env-dir 那套远端扫描无意义
   * （本机目录不该走 ssh）；**后端布局不受此限** —— 它本来就在业务机上。
   */
  async scanDir(env: string, dir: string, tag: string): Promise<RemoteEntry[]> {
    // 只列一级目录；stat 取 mtime（秒 → 毫秒）。入口指针 index.js 是文件，天然被排除。
    const cmd =
      `cd '${dir}' 2>/dev/null || { echo ""; exit 0; }; ` +
      `for d in */; do n="\${d%/}"; [ -d "$n" ] || continue; ` +
      `printf '%s\\t%s\\n' "$(stat -c %Y "$n")" "$n"; done`;
    const out = await this.ssh.run(env, cmd, tag);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [mtime, name] = l.split('\t');
        return { name: (name ?? '').trim(), mtime: Number(mtime) * 1000 };
      })
      .filter((e) => e.name && Number.isFinite(e.mtime));
  }

  /** 远端业务机上的工作目录（`WEB_SYSTEM_DIR_<ENV>` → `WEB_SYSTEM_DIR` → /data/web_system） */
  remoteWorkspaceRoot(env: string): string {
    const e = (env || '').toUpperCase();
    const perEnv = (this.configService.get<string>(`WEB_SYSTEM_DIR_${e}`) || '').trim();
    if (perEnv) return perEnv.replace(/\/+$/, '');
    return (this.configService.get<string>('WEB_SYSTEM_DIR') || '/data/web_system').replace(/\/+$/, '');
  }

  /**
   * 后端服务的远端版本目录：`<workspace>/servers/<dir>`，其下直接是 `<versionTag>/`。
   *
   * 与 env-dir 的差别：后端**没有 env 层**（产物跟着环境走是另一套：`dist` 只有一个），
   * 且根目录是业务机的工作目录，不是静态根。
   */
  backendVersionDir(env: string, dir: string): string {
    return `${this.remoteWorkspaceRoot(env)}/servers/${dir}`;
  }

  /**
   * 计算并执行保留策略。默认**只观测不删除**（`REMOTE_CLEANUP_ENABLED`）。
   */
  /** env-dir（微前端）产物清理：`<静态根>/static/modules/<key>/<env>/<version>` */
  async cleanup(
    env: string,
    moduleKey: string,
    opts: {
      envId?: string;
      keep?: number;
      protectedVersions?: ReadonlySet<string>;
      minAgeMs?: number;
    } = {},
  ): Promise<RemoteCleanupResult> {
    const envId = opts.envId ?? env;
    return this.cleanupDir(env, this.versionDir(env, moduleKey, envId), opts, `${moduleKey}@${envId}`);
  }

  /**
   * 后端服务产物清理（诊断 #10 遗留）：`<workspace>/servers/<dir>/<version>`。
   *
   * #10 当初只覆盖了前端产物，后端每次发布在远端留一个 `<commit>` 目录，
   * 长期同样会堆积（今天实测 portal/prod 前端就堆了 11 个版本）。
   * 策略与前端共用 `planRetain`：受保护版本 / 最近 keep 个 / 未满 minAge 的都保留。
   *
   * ⚠️ 后端目录里 `dist` 是**正在跑的**目录，`planRetain` 不会碰它（不在扫描结果里：
   * 扫描只列目录，`dist` 会被列到！）—— 故后端布局额外把 `dist` 与 `dist.bak-*` 加入保护名单。
   */
  async cleanupBackend(
    env: string,
    dir: string,
    opts: {
      keep?: number;
      protectedVersions?: ReadonlySet<string>;
      minAgeMs?: number;
    } = {},
  ): Promise<RemoteCleanupResult> {
    const protect = new Set(opts.protectedVersions ?? []);
    // dist / dist.bak-* 永远不删：前者在跑，后者是回滚兜底（applyBackendVersion 会用它恢复）
    protect.add('dist');
    return this.cleanupDir(env, this.backendVersionDir(env, dir), { ...opts, protectedVersions: protect }, `backend:${dir}`);
  }

  /** 清理执行体（两种布局共用） */
  private async cleanupDir(
    env: string,
    dir: string,
    opts: {
      keep?: number;
      protectedVersions?: ReadonlySet<string>;
      minAgeMs?: number;
    },
    tag: string,
  ): Promise<RemoteCleanupResult> {
    let entries: RemoteEntry[] = [];
    try {
      entries = await this.scanDir(env, dir, `cleanup-scan:${tag}`);
    } catch (e) {
      // 扫描失败不阻断发布：清理是维护性动作
      this.logger.warn(`远端产物扫描失败（${tag}）：${(e as Error).message}`);
      return { scanned: 0, keep: [], remove: [], applied: false, reason: `scan-failed: ${(e as Error).message}`, dir };
    }

    const plan = planRetain(entries, {
      keep: opts.keep,
      protectedVersions: opts.protectedVersions,
      minAgeMs: opts.minAgeMs,
    });

    const enabled = String(this.configService.get<string>('REMOTE_CLEANUP_ENABLED')) === 'true';
    const safe = plan.remove.filter(isSafeVersionName);
    const skipped = plan.remove.filter((n) => !isSafeVersionName(n));

    if (!enabled) {
      if (safe.length) {
        this.logger.warn(
          `远端产物待清理（${tag}，${dir}）：共 ${entries.length} 个版本，超出保留策略的有 ${safe.length} 个` +
            `（${safe.slice(0, 10).join(', ')}${safe.length > 10 ? ' …' : ''}）。` +
            `当前 REMOTE_CLEANUP_ENABLED 未开启，只观测不删除。`,
        );
      }
      return {
        ...plan,
        remove: safe,
        scanned: entries.length,
        applied: false,
        reason: 'REMOTE_CLEANUP_ENABLED 未开启（只观测）',
        dir,
      };
    }

    if (skipped.length) {
      this.logger.warn(`以下目录名形态异常，已跳过删除（防误删）：${skipped.join(', ')}`);
    }
    if (!safe.length) {
      return { ...plan, remove: [], scanned: entries.length, applied: true, dir };
    }

    const cmd =
      `cd '${dir}' || exit 1; ` +
      safe
        .map((n) => `if [ -d '${n}' ] && [ '${n}' != dist ] && [ '${n}' != '.' ]; then rm -rf -- '${n}'; fi;`)
        .join(' ');
    try {
      await this.ssh.run(env, cmd, `cleanup:${tag}`);
    } catch (e) {
      this.logger.error(`远端产物清理失败（${tag}）：${(e as Error).message}`);
      return {
        ...plan,
        remove: [],
        scanned: entries.length,
        applied: false,
        reason: `cleanup-failed: ${(e as Error).message}`,
        dir,
      };
    }
    this.logger.log(`远端产物清理完成（${tag}）：删除 ${safe.length} 个，保留 ${plan.keep.length} 个`);
    return { ...plan, remove: safe, scanned: entries.length, applied: true, dir };
  }
}
