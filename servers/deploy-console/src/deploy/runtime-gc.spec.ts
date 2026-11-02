import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
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
    require('node:fs').utimesSync(dir, at, at);
  });
  return { root, envDir, dirs };
}

const pm2 = (rows: Array<Record<string, unknown>>) => ({
  run: (file: string, args: string[]) => {
    if (file === 'pm2' && args[0] === 'jlist') return JSON.stringify(rows);
    if (file === 'du') return '1024\t' + args[1];
    throw new Error('unexpected command: ' + file);
  },
});

const PM2_ROWS = [{ name: 'todo-service', pm2_env: { pm_exec_path: '/data/web_system/servers/todo-service/dist/main.js', pm_cwd: '/data/web_system/servers/todo-service' } }];

describe('executeRuntimeGc', () => {
  it('每个 <module>/<env> 只保留最近 keep 份，删掉更旧的', async () => {
    const { root, dirs } = fixture(5);
    const result = await executeRuntimeGc(
      { roots: [root], protectDirs: [], keep: 2 },
      pm2(PM2_ROWS),
    );
    expect(result.scanned).toBe(5);
    expect(result.deleted.map(d => d.path).sort()).toEqual(dirs.slice(0, 3).sort());
    expect(dirs.slice(0, 3).every(d => !existsSync(d))).toBe(true);
    expect(dirs.slice(3).every(d => existsSync(d))).toBe(true);
  });

  it('软链指向的版本目录永不删除（dist 软链事故的直接回归）', async () => {
    const { root, envDir, dirs } = fixture(4);
    const serviceDir = mkdtempSync(join(tmpdir(), 'gc-svc-'));
    const dist = join(serviceDir, 'dist');
    symlinkSync(dirs[0], dist); // 最旧的一份正被 dist 软链引用
    mkdirSync(join(serviceDir, 'nested'), { recursive: true });
    const result = await executeRuntimeGc(
      { roots: [root], protectDirs: [serviceDir], keep: 1 },
      pm2(PM2_ROWS),
    );
    expect(existsSync(dirs[0])).toBe(true);
    expect(result.kept.filter(k => k.reason === 'protected').map(k => k.path)).toContain(dirs[0]);
    expect(result.deleted.map(d => d.path)).toEqual(expect.arrayContaining([dirs[1], dirs[2]]));
  });

  it('pm2 引用路径所在的版本目录不删', async () => {
    const { root, dirs } = fixture(3);
    const rows = [{ name: 'todo-service', pm2_env: { pm_exec_path: join(dirs[0], 'main.js'), pm_cwd: dirs[0] } }];
    const result = await executeRuntimeGc({ roots: [root], protectDirs: [], keep: 1 }, pm2(rows));
    expect(existsSync(dirs[0])).toBe(true);
    expect(result.kept.some(k => k.path === dirs[0] && k.reason === 'protected')).toBe(true);
  });

  it('pm2 清单读不到 → 拒绝删除（保护集不完整比不回收更糟）', async () => {
    const { root, dirs } = fixture(3);
    await expect(
      executeRuntimeGc({ roots: [root], protectDirs: [] }, { run: () => { throw new Error('pm2 not found'); } }),
    ).rejects.toThrow(/拒绝回收/);
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('pm2 清单为空 → 拒绝删除', async () => {
    const { root, dirs } = fixture(3);
    await expect(executeRuntimeGc({ roots: [root], protectDirs: [] }, pm2([]))).rejects.toThrow(
      /pm2 进程清单为空/,
    );
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('非版本目录（runtime-checkpoint / bin）不在删除集合内', async () => {
    const { root } = fixture(2);
    const checkpoint = join(root, 'todo-service', 'runtime-checkpoint');
    mkdirSync(checkpoint, { recursive: true });
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    const before = readdirSync(join(root, 'todo-service'));
    await executeRuntimeGc({ roots: [root], protectDirs: [], keep: 0 }, pm2(PM2_ROWS));
    expect(existsSync(checkpoint)).toBe(true);
    expect(existsSync(bin)).toBe(true);
    expect(before.length).toBeGreaterThan(0);
  });

  it('dry-run 只算不删', async () => {
    const { root, dirs } = fixture(4);
    const result = await executeRuntimeGc(
      { roots: [root], protectDirs: [], keep: 1, apply: false },
      pm2(PM2_ROWS),
    );
    expect(result.dryRun).toBe(true);
    expect(result.deleted).toHaveLength(3);
    expect(dirs.every(d => existsSync(d))).toBe(true);
  });

  it('root 不存在 → 空结果，不抛错', async () => {
    const result = await executeRuntimeGc(
      { roots: [join(temporary, 'nope')], protectDirs: [], keep: 1 },
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
    expect(program).toContain('process.exitCode=1'); // 失败必须非零退出
    expect(program).toContain('JSON.stringify(result)');
  });

  it('程序体内不出现 ES import（目标机是裸 node 执行）', () => {
    expect(program).not.toContain('import ');
    expect(program).not.toContain('export ');
  });
});
