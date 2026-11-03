import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRuntimeGc, runtimeGcProgram } from './runtime-gc';

const temporary = mkdtempSync(join(tmpdir(), 'gc-'));

/** 造一棵运行时根：<root>/<module>/<env>/<sha> × n，越新 mtime 越大 */
function fixture(count = 5) {
  const root = mkdtempSync(join(tmpdir(), 'gc-root-'));
  const envDir = join(root, 'todo-service', 'todo-service-dev');
  mkdirSync(envDir, { recursive: true });
  const dirs: string[] = [];
  for (let i = 0; i < count; i++) {
    const dir = join(envDir, 'a'.repeat(7) + i);
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.js'), 'x');
    dirs.push(dir);
  }
  // mtime 递增：索引越大越新（utimesSync 精度到秒即可区分）
  dirs.forEach((dir, i) => {
    const at = new Date(Date.now() - (count - i) * 60_000);
    utimesSync(dir, at, at);
  });
  return { root, envDir, dirs };
}

/** 在同一根下再造一个「别人的模块」，带若干很旧的版本目录 */
function otherModule(root: string, count = 4): string[] {
  const envDir = join(root, 'other-service', 'other-service-dev');
  mkdirSync(envDir, { recursive: true });
  const dirs: string[] = [];
  for (let i = 0; i < count; i++) {
    const dir = join(envDir, 'b'.repeat(7) + i);
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.js'), 'x');
    const at = new Date(Date.now() - (100 + i) * 60_000); // 全部很旧，若被全根扫描必然进删除集
    utimesSync(dir, at, at);
    dirs.push(dir);
  }
  return dirs;
}

const pm2 = (rows: Array<Record<string, unknown>>) => ({
  run: (file: string, args: string[]) => {
    if (file === 'pm2' && args[0] === 'jlist') return JSON.stringify(rows);
    if (file === 'du') return '1024\t' + args[1];
    throw new Error('unexpected command: ' + file);
  },
});

const PM2_ROWS = [{ name: 'todo-service', pm2_env: { pm_exec_path: '/data/web_system/servers/todo-service/dist/main.js', pm_cwd: '/data/web_system/servers/todo-service' } }];

/** 每个用例都显式带作用域（流水线 gc 节点的硬要求） */
const SCOPE = { module: 'todo-service' };

describe('executeRuntimeGc', () => {
  it('每个 <module>/<env> 只保留最近 keep 份，删掉更旧的', async () => {
    const { root, dirs } = fixture(5);
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [root], protectDirs: [], keep: 2 },
      pm2(PM2_ROWS),
    );
    expect(result.scanned).toBe(5);
    expect(result.deleted.map(d => d.path).sort()).toEqual(dirs.slice(0, 3).sort());
    expect(dirs.slice(0, 3).every(d => !existsSync(d))).toBe(true);
    expect(dirs.slice(3).every(d => existsSync(d))).toBe(true);
  });

  it('只删目标模块，不动其它任何模块（作用域外目录连遍历都不做）', async () => {
    const { root, dirs } = fixture(5);
    const others = otherModule(root, 4);
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [root], protectDirs: [], keep: 1 },
      pm2(PM2_ROWS),
    );
    // 目标模块：只保留最新 1 份，其余删除
    expect(result.deleted.map(d => d.path).sort()).toEqual(dirs.slice(0, 4).sort());
    expect(dirs.slice(4).every(d => existsSync(d))).toBe(true);
    // 别人的模块：一个都不碰（即使全部很旧、满足删除条件）
    expect(others.every(d => existsSync(d))).toBe(true);
    expect(result.deleted.some(d => d.path.includes('other-service'))).toBe(false);
    expect(result.scanned).toBe(5); // 只扫描了目标模块的 5 份，没把其它模块计入
  });

  it('作用域模块不存在时不退化成全根扫描（其它模块保持不动）', async () => {
    const { root, dirs } = fixture(3);
    const others = otherModule(root, 3);
    const result = await executeRuntimeGc(
      { scope: { module: 'does-not-exist' }, roots: [root], protectDirs: [], keep: 0 },
      pm2(PM2_ROWS),
    );
    expect(result.scanned).toBe(0);
    expect(result.deleted).toEqual([]);
    expect(dirs.every(d => existsSync(d))).toBe(true);
    expect(others.every(d => existsSync(d))).toBe(true);
  });

  it('软链指向的版本目录永不删除（dist 软链事故的直接回归）', async () => {
    const { root, envDir, dirs } = fixture(4);
    const serviceDir = mkdtempSync(join(tmpdir(), 'gc-svc-'));
    const dist = join(serviceDir, 'dist');
    symlinkSync(dirs[0], dist); // 最旧的一份正被 dist 软链引用
    mkdirSync(join(serviceDir, 'nested'), { recursive: true });
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [root], protectDirs: [serviceDir], keep: 1 },
      pm2(PM2_ROWS),
    );
    expect(existsSync(dirs[0])).toBe(true);
    expect(result.kept.filter(k => k.reason === 'protected').map(k => k.path)).toContain(dirs[0]);
    expect(result.deleted.map(d => d.path)).toEqual(expect.arrayContaining([dirs[1], dirs[2]]));
  });

  it('pm2 引用保护（pm_exec_path / pm_cwd）仍然生效', async () => {
    const { root, dirs } = fixture(3);
    const rows = [{ name: 'todo-service', pm2_env: { pm_exec_path: join(dirs[0], 'main.js'), pm_cwd: dirs[0] } }];
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [root], protectDirs: [], keep: 1 },
      pm2(rows),
    );
    expect(existsSync(dirs[0])).toBe(true);
    expect(result.kept.some(k => k.path === dirs[0] && k.reason === 'protected')).toBe(true);
  });

  it('pm2 清单读不到 → 拒绝删除（保护集不完整比不回收更糟）', async () => {
    const { root, dirs } = fixture(3);
    await expect(
      executeRuntimeGc(
        { scope: SCOPE, roots: [root], protectDirs: [] },
        { run: () => { throw new Error('pm2 not found'); } },
      ),
    ).rejects.toThrow(/拒绝回收/);
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('pm2 清单为空 → 拒绝删除', async () => {
    const { root, dirs } = fixture(3);
    await expect(
      executeRuntimeGc({ scope: SCOPE, roots: [root], protectDirs: [] }, pm2([])),
    ).rejects.toThrow(/pm2 进程清单为空/);
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('无作用域参数 → 拒绝执行并说清原因（绝不静默全根扫描）', async () => {
    const { root, dirs } = fixture(4);
    const others = otherModule(root, 3);
    await expect(
      executeRuntimeGc({ roots: [root], protectDirs: [], keep: 0 }, pm2(PM2_ROWS)),
    ).rejects.toThrow(/拒绝回收|缺少有效作用域|禁止全根扫描/);
    // 拒绝时一个目录都不能动
    expect(dirs.every(d => existsSync(d))).toBe(true);
    expect(others.every(d => existsSync(d))).toBe(true);
  });

  it('作用域非法（空 / .. / 含斜杠）→ 拒绝，防止目录穿越', async () => {
    const { root, dirs } = fixture(3);
    for (const bad of ['', '  ', '..', 'a/b']) {
      await expect(
        executeRuntimeGc({ scope: { module: bad }, roots: [root], protectDirs: [] }, pm2(PM2_ROWS)),
      ).rejects.toThrow(/拒绝回收|缺少有效作用域/);
    }
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('结果带 scopeModule 审计字段，日志写明作用域与其它模块不遍历', async () => {
    const { root } = fixture(3);
    const lines: string[] = [];
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [root], protectDirs: [], keep: 2 },
      { ...pm2(PM2_ROWS), log: (l: string) => lines.push(l) },
    );
    expect(result.scopeModule).toBe('todo-service');
    expect(lines.join('\n')).toContain('作用域锁定：module=todo-service');
    expect(lines.join('\n')).toContain('其它模块目录不遍历、不删除');
  });

  it('非版本目录（runtime-checkpoint / bin）不在删除集合内', async () => {
    const { root } = fixture(2);
    const checkpoint = join(root, 'todo-service', 'runtime-checkpoint');
    mkdirSync(checkpoint, { recursive: true });
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    const before = readdirSync(join(root, 'todo-service'));
    await executeRuntimeGc({ scope: SCOPE, roots: [root], protectDirs: [], keep: 0 }, pm2(PM2_ROWS));
    expect(existsSync(checkpoint)).toBe(true);
    expect(existsSync(bin)).toBe(true);
    expect(before.length).toBeGreaterThan(0);
  });

  it('dry-run 只算不删', async () => {
    const { root, dirs } = fixture(4);
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [root], protectDirs: [], keep: 1, apply: false },
      pm2(PM2_ROWS),
    );
    expect(result.dryRun).toBe(true);
    expect(result.deleted).toHaveLength(3);
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('root 不存在 → 空结果，不抛错', async () => {
    const result = await executeRuntimeGc(
      { scope: SCOPE, roots: [join(temporary, 'nope')], protectDirs: [], keep: 1 },
      pm2(PM2_ROWS),
    );
    expect(result.scanned).toBe(0);
    expect(result.deleted).toEqual([]);
  });
});

describe('runtimeGcProgram', () => {
  const program = runtimeGcProgram();

  it('是自带入参 + 输出约定的可执行程序（不含对外部符号的引用）', () => {
    expect(program.startsWith('(')).toBe(true);
    expect(program).toContain('GC_KEEP');
    expect(program).toContain('GC_DRY_RUN');
    expect(program).toContain('GC_SCOPE_MODULE'); // 作用域硬门禁经环境变量注入
    expect(program).toContain('process.exitCode=1'); // 失败必须非零退出
    expect(program).toContain('JSON.stringify(result)');
  });

  it('程序体内不出现 ES import（目标机是裸 node 执行）', () => {
    expect(program).not.toContain('import ');
    expect(program).not.toContain('export ');
  });
});
