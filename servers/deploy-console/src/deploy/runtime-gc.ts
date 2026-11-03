/**
 * L1 能力程序：历史版本目录回收（dev / prod 通用）。
 *
 * 方案 B（2026-11-01）分层：本函数是**能力程序**的源码真身，
 * 由 console 的 `gc-runtime` 内置步骤落盘到目标机
 * （`$HOME/web_system_runtimes/bin/gc-runtime.js`，sha256 幂等），
 * 编排脚本只写一行 `node <path>` —— 不把源码抄进数据（抄 = 化石脚本）。
 *
 * ⚠️ 序列化约束（与 `backend-runtime.ts` 同源）：本函数会被 `toString()`
 * 后 ssh 到目标机执行，**所有辅助逻辑必须定义在函数体内**，
 * 函数体外的任何符号在目标机上都不存在。
 *
 * 为什么保护集这么重（2026-11-02 事故教训）：一次「解不可变版本目录冲突」
 * 把隔离根的某个版本目录移走，而两个服务的 `dist` 软链正指向它 →
 * 软链悬空 10 分钟（进程在内存跑没事，重启即挂）。
 * 因此本程序的删除判据是「三层都确认安全」：
 *   1. pm2 正在引用的路径（pm_exec_path / pm_cwd）—— 拿不到就**拒绝删除**
 *   2. 保护目录下所有软链的 realpath（含 `servers/<m>/dist`）
 *   3. 只删形如 git sha 的版本目录（`runtime-checkpoint` 之类永不命中）
 *
 * ⚠️ 作用域（2026-11-03，A6）：本程序 = **流水线 gc 节点**的能力程序，**只回收单模块**。
 *   `scope.module` 必带；缺失即抛错拒绝，绝不退化成「扫全根」。
 *   为什么：并发发布时全根扫描会碰到别的模块 —— pm2 引用保护只覆盖已注册进程，
 *   `runtime-checkpoint` 之类目录根本不在保护集里，误删会毁掉别的模块的历史版本。
 *   作用域外的模块目录**连遍历都不做**：直接定位 `<root>/<scope.module>`，
 *   不 readdir 根（readdir 根会把别的模块暴露出来，是越界的第一步）。
 *   作用域按**模块**整棵生效（覆盖该模块下所有 `<env>` 子目录）：磁盘上的环境目录名
 *   （如 `todo-service-dev`）并不等于流水线环境（`dev`），故刻意不按环境收窄 ——
 *   模块级已严格保证「不触碰其它任何模块」。
 *
 * ⚠️ 两层职责，代码里不要耦合：
 *   ① 流水线 gc 节点（本程序）：带作用域、发布流程内触发，只收本次发布的模块。
 *   ② 全量运维回收（独立运维动作 `gc_runtimes.py`）：扫全根是合法的，
 *      但那是人工运维脚本，**不是流水线节点、不经过本程序、也不由本程序调用**。
 *      本程序不具备、也不提供「全根扫描」模式 —— 全根只能是那个运维动作。
 */
export interface RuntimeGcScope {
  /** 作用域模块名（= 本次发布模块 moduleKey）。只允许回收 `<root>/<module>` 下的版本目录 */
  module: string;
}

export interface RuntimeGcInput {
  /** 作用域（流水线 gc 节点必带）：缺 module 即抛错拒绝，绝不退化成全根扫描 */
  scope?: RuntimeGcScope;
  /** 待回收的根（结构 `<root>/<module>/<env>/<version>`） */
  roots?: string[];
  /** 需要扫描软链以建立保护集的目录（软链目标永不删除） */
  protectDirs?: string[];
  /** 每个 `<module>/<env>` 保留的份数 */
  keep?: number;
  /** false = 只算不删（dry-run） */
  apply?: boolean;
}

export interface RuntimeGcAdapters {
  run?: (file: string, args: string[]) => string;
  log?: (line: string) => void;
}

export interface RuntimeGcResult {
  action: 'gc';
  dryRun: boolean;
  keep: number;
  /** 本次作用域模块（审计用；缺作用域会抛错，成功结果里必有值） */
  scopeModule: string;
  scanned: number;
  deleted: Array<{ path: string; bytes: number }>;
  kept: Array<{ path: string; reason: 'recent' | 'protected' }>;
  freedBytes: number;
  /** 保护集（pm2 引用 + 软链目标），审计用 */
  protectedPaths: string[];
}

export async function executeRuntimeGc(
  input: RuntimeGcInput = {},
  adapters: RuntimeGcAdapters = {},
): Promise<RuntimeGcResult> {
  const fs: typeof import('node:fs') = require('node:fs');
  const path: typeof import('node:path') = require('node:path');
  const child: typeof import('node:child_process') = require('node:child_process');
  const os: typeof import('node:os') = require('node:os');
  const run =
    adapters.run ??
    ((file: string, args: string[]) =>
      child
        .execFileSync(file, args, {
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 32 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        .toString());
  const log = adapters.log ?? ((line: string) => process.stdout.write(line + '\n'));

  const roots =
    input.roots && input.roots.length
      ? input.roots
      : [path.join(os.homedir(), 'web_system_runtimes')];
  const protectDirs = input.protectDirs ?? ['/data/web_system', '/data/web_system_static'];
  const keep = input.keep ?? 3;
  const apply = input.apply !== false;

  // ── 作用域（硬门禁）────────────────────────────────────────────────
  // 流水线 gc 节点 = 单模块回收。没有作用域就拒绝，绝不「默认扫全根」。
  // 全根扫描是独立运维动作（gc_runtimes.py）的事，不属于本程序。
  // 放在保护集之前 = fail-fast：还没确定「只收谁」就别去读 pm2、别碰任何目录。
  const scopeModule =
    input.scope && typeof input.scope.module === 'string' ? input.scope.module.trim() : '';
  if (
    !scopeModule ||
    scopeModule === '.' ||
    scopeModule === '..' ||
    !/^[A-Za-z0-9_.-]+$/.test(scopeModule)
  ) {
    throw new Error(
      '拒绝回收：缺少有效作用域 GC_SCOPE_MODULE。流水线 gc 节点必须带本模块作用域，禁止全根扫描' +
        '（全量回收是独立运维动作 gc_runtimes.py，不在本程序职责内；并发发布全根扫描会误删别的模块）',
    );
  }

  // ── 保护集 ───────────────────────────────────────────────────────────
  // 1) pm2 引用。读不到就必须放弃：保护集不完整时的「成功删除」比不删更糟。
  const protectedPaths: string[] = [];
  let pm2Rows: Array<Record<string, any>>;
  try {
    pm2Rows = JSON.parse(run('pm2', ['jlist']) || '[]');
  } catch (error) {
    throw new Error(
      '无法读取 pm2 进程清单，拒绝回收（保护集不完整会误删正在运行的版本目录）: ' +
        (error as Error).message,
    );
  }
  if (!Array.isArray(pm2Rows) || pm2Rows.length === 0) {
    throw new Error('pm2 进程清单为空，拒绝回收（无法确认哪些版本目录正在被引用）');
  }
  for (const row of pm2Rows) {
    const env = row && row.pm2_env ? row.pm2_env : {};
    for (const key of ['pm_exec_path', 'pm_cwd']) {
      const value = env[key];
      if (!value) continue;
      try {
        protectedPaths.push(fs.realpathSync(String(value)));
      } catch {
        protectedPaths.push(path.resolve(String(value)));
      }
    }
  }

  // 2) 保护目录下的软链目标（典型：`servers/<module>/dist` → 隔离根版本目录）。
  //    node_modules / .git 跳过：它们是数量级最大的目录，且不可能指向版本目录。
  const SKIP_DIRS = ['node_modules', '.git', '.pm2', 'web_system_runtimes'];
  const collectLinks = (dir: string, depth: number) => {
    if (depth > 5) return;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      let stat: import('node:fs').Stats;
      try {
        stat = fs.lstatSync(file);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        try {
          protectedPaths.push(fs.realpathSync(file));
        } catch {
          /* 悬空软链：没有目标可保护 */
        }
        continue;
      }
      if (stat.isDirectory() && SKIP_DIRS.indexOf(name) < 0) collectLinks(file, depth + 1);
    }
  };
  for (const dir of protectDirs) collectLinks(dir, 0);

  const canonical = (value: string) => {
    try {
      return fs.realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  // 双向包含：待删目录包含保护路径（如 dist 软链目标在版本目录内）**或**
  // 待删目录本身位于某条保护路径之下 —— 任一成立都不许删。
  const isProtected = (target: string) => {
    const real = canonical(target);
    for (const p of protectedPaths) {
      const protectedReal = canonical(p);
      if (real === protectedReal) return true;
      const relative = path.relative(real, protectedReal);
      if (relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep)) return true;
      const back = path.relative(protectedReal, real);
      if (back !== '' && back !== '..' && !back.startsWith('..' + path.sep)) return true;
    }
    return false;
  };

  const sizeOf = (dir: string) => {
    try {
      return Number(run('du', ['-sb', dir]).split(/\s+/)[0]) || 0;
    } catch {
      return 0;
    }
  };

  // ── 回收 ─────────────────────────────────────────────────────────────
  const VERSION_NAME = /^[0-9a-f]{7,40}$/;
  const result: RuntimeGcResult = {
    action: 'gc',
    dryRun: !apply,
    keep,
    scopeModule,
    scanned: 0,
    deleted: [],
    kept: [],
    freedBytes: 0,
    protectedPaths,
  };

  // 日志可证：把作用域与「不遍历其它模块」写进 stdout，随结果 JSON 回传给节点。
  log(
    `[gc] 作用域锁定：module=${scopeModule}（roots=${roots.join(',')}）；` +
      `仅遍历 <root>/${scopeModule}，其它模块目录不遍历、不删除`,
  );

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    // 作用域外的模块目录连遍历都不做：直接定位 `<root>/<scope.module>`，
    // 不 readdir 根（readdir 根会把别的模块暴露出来，是越界的第一步）。
    const moduleDir = path.join(root, scopeModule);
    if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
      log(`[gc] 作用域模块 ${scopeModule} 在根 ${root} 下不存在，跳过该根`);
      continue;
    }
    let envs: string[];
    try {
      envs = fs.readdirSync(moduleDir).sort();
    } catch {
      continue;
    }
    for (const env of envs) {
      const envDir = path.join(moduleDir, env);
      if (!fs.statSync(envDir).isDirectory()) continue;
      const versions = fs
        .readdirSync(envDir)
        .filter(name => VERSION_NAME.test(name))
        .map(name => path.join(envDir, name))
        .filter(file => fs.lstatSync(file).isDirectory())
        .map(file => ({ file, mtime: fs.statSync(file).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      const recent = versions.slice(0, keep).map(v => v.file);
      for (const version of versions) {
        result.scanned += 1;
        if (recent.indexOf(version.file) >= 0) {
          result.kept.push({ path: version.file, reason: 'recent' });
          continue;
        }
        if (isProtected(version.file)) {
          result.kept.push({ path: version.file, reason: 'protected' });
          continue;
        }
        const bytes = sizeOf(version.file);
        if (apply) fs.rmSync(version.file, { recursive: true, force: true });
        result.deleted.push({ path: version.file, bytes });
        result.freedBytes += bytes;
      }
    }
  }

  log(
    `[gc] 作用域 ${scopeModule}：扫描 ${result.scanned} 个版本目录，删除 ${result.deleted.length} 个` +
      `（释放 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MiB），保留 ${result.kept.length} 个` +
      `${apply ? '' : '（dry-run，未实际删除）'}`,
  );
  return result;
}

/**
 * 生成能力程序正文（纯字符串，可独立落盘）。
 *
 * 与 `backendRuntimeProgram()` 同构：把函数体序列化 + 环境变量入参 + 输出约定。
 * 入参全部走环境变量，编排可通过 `GC_SCOPE_MODULE` / `GC_KEEP` / `GC_DRY_RUN`
 * 调整，不必改代码。`GC_SCOPE_MODULE` 是作用域硬门禁：不传 → 程序内抛错 → 非零退出。
 */
export function runtimeGcProgram(): string {
  return (
    '(' +
    executeRuntimeGc.toString() +
    ')({' +
    'scope:(process.env.GC_SCOPE_MODULE?{module:process.env.GC_SCOPE_MODULE}:undefined),' +
    'roots:(process.env.GC_ROOTS?process.env.GC_ROOTS.split(",").filter(Boolean):[]),' +
    'protectDirs:(process.env.GC_PROTECT_DIRS?process.env.GC_PROTECT_DIRS.split(",").filter(Boolean):[]),' +
    'keep:Number(process.env.GC_KEEP||3),' +
    'apply:process.env.GC_DRY_RUN!=="1"' +
    '}).then(result=>process.stdout.write(JSON.stringify(result)+"\\n"))' +
    '.catch(error=>{console.error(error.message);process.exitCode=1;});'
  );
}
