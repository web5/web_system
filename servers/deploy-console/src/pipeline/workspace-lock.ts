/**
 * 工作区文件锁 —— 构建工作区（RELEASE_DIR）跨 run 互斥。
 *
 * 背景（2026-10-27 content-hub 构建失败根因，见
 * docs/development/reports/2026-10-27-构建失败诊断-流水线并发抢工作区.md）：
 * 两条流水线并发抢同一构建工作区，package 流程「查 dist → 拷 dist」窗口被对方
 * 的「bundle 换入」打断，拷到运行时包 → inspect 裸 ENOENT。
 * 准入锁粒度是 (module_key, env)，拦不住跨 env / 跨模块的工作区竞争。
 *
 * 本锁横跨 run 的「git → prebuild → build → package」工作区临界区（在
 * PipelineService.run 的生命周期里 acquire / finally release），与 prebuild 脚本
 * withBuildLock 同风格：mkdir 原子锁目录、持有者标识、排队等待 + 超时、陈旧锁清理。
 *
 * 锁目录放在**工作区之外**（os.tmpdir()/web-system-ws-locks/）：
 * 工作区内放锁会被本 run 自己的 `git clean -nd` 预览挡下（清理预览非空即拒绝），
 * 或被 `git clean -fd` 把锁删掉——锁必须活过 git 阶段，故不落在 checkout 里。
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 锁选项 */
export interface WorkspaceLockOptions {
  /** 陈旧锁阈值（毫秒）：超过视为崩溃残留，清理后重试。默认 10min（对齐 prebuild withBuildLock） */
  staleMs?: number;
  /** 排队等待超时（毫秒）：超时抛 WorkspaceLockTimeoutError。默认 20min（须 > staleMs，让等待方能熬过陈旧锁清理） */
  timeoutMs?: number;
  /** 轮询间隔（毫秒），默认 500 */
  pollIntervalMs?: number;
  /** 锁根目录（测试注入用），默认 os.tmpdir()/web-system-ws-locks */
  lockRoot?: string;
  /** 时钟（测试注入用） */
  now?: () => number;
  /** 等待（测试注入用） */
  sleep?: (ms: number) => Promise<void>;
}

/** 释放锁的句柄（幂等；只删自己持有的锁） */
export type WorkspaceLockRelease = () => void;

/**
 * 锁等待超时 —— 与「构建失败」明确区分：
 * 错误消息以「工作区锁等待超时」开头，调用方/日志据此归类，不与业务失败混淆。
 */
export class WorkspaceLockTimeoutError extends Error {
  readonly code = 'WORKSPACE_LOCK_TIMEOUT';
  constructor(
    readonly lockPath: string,
    readonly holder: string | null,
    readonly waitedMs: number,
  ) {
    super(
      `工作区锁等待超时: ${lockPath}` +
        `（当前持有者: ${holder ?? '未知'}，已等待 ${Math.round(waitedMs / 1000)}s）` +
        '——锁等待超时，非构建失败；持有者可能仍在执行构建/打包，请稍后重试或检查持有者运行是否卡死',
    );
    this.name = 'WorkspaceLockTimeoutError';
  }
}

/** 读持有者标识（owner.json）；读不到返回 null */
function readHolder(lockDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8');
    const data = JSON.parse(raw) as { owner?: unknown };
    return typeof data.owner === 'string' && data.owner ? data.owner : null;
  } catch {
    return null;
  }
}

/** 锁目录是否陈旧（mtime 超过阈值）；目录已消失视为非陈旧（等下一轮重试即可） */
function isStale(lockDir: string, staleMs: number, now: number): boolean {
  try {
    return now - fs.statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return false;
  }
}

/** 计算锁目录：锁根 + 工作区 realpath 的 sha256 前 16 位（跨进程稳定、与工作区路径解耦） */
export function resolveWorkspaceLockDir(workspace: string, lockRoot?: string): string {
  let canonical: string;
  try {
    canonical = fs.realpathSync(workspace);
  } catch {
    canonical = path.resolve(workspace);
  }
  const key = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const root = lockRoot ?? path.join(os.tmpdir(), 'web-system-ws-locks');
  return path.join(root, key + '.lock');
}

/**
 * 抢工作区锁：抢不到则排队等待，超时抛 WorkspaceLockTimeoutError（含当前持有者）。
 *
 * 语义与 withBuildLock 对齐：
 *  - mkdir 原子性保证同一时刻只有一个持有者；
 *  - 陈旧锁（默认 10min）视为崩溃残留，清理后重试；
 *  - 返回释放句柄，只删自己持有的锁（owner 不匹配则不删，避免误删别人抢到的锁）。
 */
export async function acquireWorkspaceLock(
  workspace: string,
  owner: string,
  options: WorkspaceLockOptions = {},
): Promise<WorkspaceLockRelease> {
  if (!workspace || !owner) throw new Error('工作区锁需要 workspace 与 owner（runId）');
  const staleMs = options.staleMs ?? 600_000;
  const timeoutMs = options.timeoutMs ?? 1_200_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lockDir = resolveWorkspaceLockDir(workspace, options.lockRoot);
  const root = path.dirname(lockDir);
  fs.mkdirSync(root, { recursive: true });

  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (isStale(lockDir, staleMs, now())) {
        // 陈旧锁：清理后立即重试（不 sleep，减少空窗）
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
        } catch {
          /* 对方刚好释放/重建，下一轮再看 */
        }
        continue;
      }
      const waited = timeoutMs - Math.max(0, deadline - now());
      if (now() >= deadline) {
        throw new WorkspaceLockTimeoutError(lockDir, readHolder(lockDir), waited);
      }
      await sleep(pollIntervalMs);
    }
  }

  try {
    fs.writeFileSync(
      path.join(lockDir, 'owner.json'),
      JSON.stringify({ owner, acquiredAt: new Date(now()).toISOString() }),
    );
  } catch {
    /* 持有者标识写失败不阻断持锁（互斥已成立），错误信息里 holder 显示未知 */
  }

  let released = false;
  const release: WorkspaceLockRelease = () => {
    if (released) return;
    released = true;
    try {
      // 只删自己持有的锁：等待期间若被误清/抢占，owner 已不是自己，绝不动手
      if (readHolder(lockDir) === owner) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      /* 锁已消失 = 已释放 */
    }
  };
  return release;
}
