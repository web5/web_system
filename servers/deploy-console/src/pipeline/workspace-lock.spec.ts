import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  acquireWorkspaceLock,
  resolveWorkspaceLockDir,
  WorkspaceLockTimeoutError,
} from './workspace-lock';

/**
 * 工作区文件锁（方案 B 治本项）：
 * 横跨 git→package 临界区的跨 run 互斥。与 prebuild withBuildLock 同风格的 mkdir 原子锁。
 */
describe('workspace-lock（构建工作区跨 run 互斥）', () => {
  let temporary: string;
  let workspace: string;
  let lockRoot: string;

  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-lock-'));
    workspace = path.join(temporary, 'build');
    lockRoot = path.join(temporary, 'locks');
    fs.mkdirSync(workspace, { recursive: true });
  });

  afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

  const opts = (over: Partial<Parameters<typeof acquireWorkspaceLock>[2]> = {}) => ({
    lockRoot,
    pollIntervalMs: 5,
    staleMs: 60_000,
    timeoutMs: 200,
    ...over,
  });

  it('acquire → release 正常路径：锁目录出现后消失，可再次抢到', async () => {
    const release = await acquireWorkspaceLock(workspace, 'run-a', opts());
    const lockDir = resolveWorkspaceLockDir(workspace, lockRoot);
    expect(fs.existsSync(lockDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).owner).toBe('run-a');
    release();
    expect(fs.existsSync(lockDir)).toBe(false);
    // 释放后能再次抢到（不死锁）
    const again = await acquireWorkspaceLock(workspace, 'run-b', opts());
    again();
  });

  it('互斥：A 持锁期间 B 抢不到，B 超时报「锁等待超时」且含持有者 A', async () => {
    const releaseA = await acquireWorkspaceLock(workspace, 'run-a', opts());
    await expect(acquireWorkspaceLock(workspace, 'run-b', opts({ timeoutMs: 80 }))).rejects.toThrow(
      WorkspaceLockTimeoutError,
    );
    try {
      await acquireWorkspaceLock(workspace, 'run-b', opts({ timeoutMs: 80 }));
    } catch (e) {
      const err = e as WorkspaceLockTimeoutError;
      expect(err.code).toBe('WORKSPACE_LOCK_TIMEOUT');
      // 错误信息必须区分「锁等待超时」与「构建失败」，且写明当前持有者
      expect(err.message).toContain('工作区锁等待超时');
      expect(err.message).toContain('非构建失败');
      expect(err.message).toContain('run-a');
      expect(err.holder).toBe('run-a');
    }
    releaseA();
    // A 释放后 B 能拿到
    const releaseB = await acquireWorkspaceLock(workspace, 'run-b', opts());
    releaseB();
  });

  it('串行化：A 释放前 B 排队等待，A 释放后 B 拿到（不直接拒绝）', async () => {
    let releaseA!: () => void;
    const aHeld = acquireWorkspaceLock(workspace, 'run-a', opts({ timeoutMs: 5000 })).then((r) => {
      releaseA = r;
    });
    await aHeld;

    let bAcquired = false;
    const b = acquireWorkspaceLock(workspace, 'run-b', opts({ timeoutMs: 5000, pollIntervalMs: 5 })).then((r) => {
      bAcquired = true;
      return r;
    });
    // B 在排队，还没拿到
    await new Promise((r) => setTimeout(r, 30));
    expect(bAcquired).toBe(false);

    releaseA();
    const releaseB = await b;
    expect(bAcquired).toBe(true);
    releaseB();
  });

  it('陈旧锁清理：崩溃残留（mtime 超阈值）被清掉后可抢到，且错误信息里能看到残留持有者', async () => {
    const lockDir = resolveWorkspaceLockDir(workspace, lockRoot);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, 'owner.json'),
      JSON.stringify({ owner: 'crashed-run', acquiredAt: '2026-01-01T00:00:00Z' }),
    );
    // 把 mtime 拨老（超过 staleMs）
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lockDir, old, old);

    const release = await acquireWorkspaceLock(workspace, 'fresh-run', opts({ staleMs: 60_000, timeoutMs: 200 }));
    expect(fs.existsSync(path.join(lockDir, 'owner.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).owner).toBe('fresh-run');
    release();
  });

  it('新鲜锁不被误清：未超阈值的锁不清理，等待方正常超时', async () => {
    const releaseA = await acquireWorkspaceLock(workspace, 'holder-live', opts());
    // A 的锁是新鲜的（mtime=现在），B 不能把它当陈旧锁清掉
    await expect(
      acquireWorkspaceLock(workspace, 'run-b', opts({ timeoutMs: 60, staleMs: 60_000 })),
    ).rejects.toThrow(/工作区锁等待超时.*holder-live/s);
    releaseA();
  });

  it('release 幂等，且不删别人的锁（owner 不匹配不动手）', async () => {
    const releaseA = await acquireWorkspaceLock(workspace, 'run-a', opts());
    const lockDir = resolveWorkspaceLockDir(workspace, lockRoot);
    // 模拟被别人接手（owner 换人）
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ owner: 'run-other' }));
    releaseA();
    releaseA(); // 幂等，不抛
    // 别人的锁还在（A 没误删）
    expect(fs.existsSync(lockDir)).toBe(true);
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it('同一工作区不同路径（经 realpath）落到同一把锁', async () => {
    const viaSymlink = path.join(temporary, 'alias-build');
    fs.symlinkSync(workspace, viaSymlink, 'dir');
    expect(resolveWorkspaceLockDir(viaSymlink, lockRoot)).toBe(resolveWorkspaceLockDir(workspace, lockRoot));
  });

  it('不同工作区互不影响（锁 key 不同）', async () => {
    const other = path.join(temporary, 'other-build');
    fs.mkdirSync(other);
    expect(resolveWorkspaceLockDir(other, lockRoot)).not.toBe(resolveWorkspaceLockDir(workspace, lockRoot));
    const r1 = await acquireWorkspaceLock(workspace, 'a', opts());
    const r2 = await acquireWorkspaceLock(other, 'b', opts()); // 不同工作区，立刻拿到
    r1();
    r2();
  });

  it('并发冒烟：两个 run 同时抢同一 fixture 工作区 → 全部串行通过、无一失败', async () => {
    const order: string[] = [];
    const critical = async (name: string) => {
      const release = await acquireWorkspaceLock(workspace, name, opts({ timeoutMs: 5000, pollIntervalMs: 2 }));
      order.push(name + ':enter');
      // 模拟 git→package 临界区（制造交错窗口）
      await new Promise((r) => setTimeout(r, 15));
      order.push(name + ':exit');
      release();
    };
    await Promise.all([critical('run-a'), critical('run-b'), critical('run-c')]);
    // 串行：enter/exit 成对、中间没有别人插入
    expect(order).toEqual([
      expect.stringMatching(/^run-.+:enter$/),
      expect.stringMatching(/^run-.+:exit$/),
      expect.stringMatching(/^run-.+:enter$/),
      expect.stringMatching(/^run-.+:exit$/),
      expect.stringMatching(/^run-.+:enter$/),
      expect.stringMatching(/^run-.+:exit$/),
    ]);
    // 两两不交叠
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].replace(':enter', '')).toBe(order[i + 1].replace(':exit', ''));
    }
    // 锁已清干净
    expect(fs.existsSync(resolveWorkspaceLockDir(workspace, lockRoot))).toBe(false);
  });

  it('并发冒烟（git→package 临界区）：两个 run 同一 fixture 工作区串行通过、产物无互踩', async () => {
    // fixture：共享构建工作区（dist 为双方争抢的产物目录）
    const dist = path.join(workspace, 'servers/mod/dist');
    fs.mkdirSync(dist, { recursive: true });
    const runCritical = async (runId: string) => {
      const release = await acquireWorkspaceLock(workspace, runId, opts({ timeoutMs: 5000, pollIntervalMs: 2 }));
      try {
        // git：reset 覆盖 dist（模拟对方 run 的 renameSync 换入窗口的同型竞争面）
        fs.rmSync(dist, { recursive: true, force: true });
        fs.mkdirSync(dist, { recursive: true });
        fs.writeFileSync(path.join(dist, 'main.js'), `module.exports = "${runId}";`);
        // TOCTOU 窗口（package 的「查 dist → 拷 dist」之间）
        await new Promise((r) => setTimeout(r, 10));
        // package：读 dist/main.js → 写进自己的产物目录
        const artifact = path.join(temporary, 'artifacts', runId);
        fs.mkdirSync(artifact, { recursive: true });
        fs.copyFileSync(path.join(dist, 'main.js'), path.join(artifact, 'main.js'));
        return fs.readFileSync(path.join(artifact, 'main.js'), 'utf8');
      } finally {
        release();
      }
    };
    const [a, b] = await Promise.all([runCritical('run-a'), runCritical('run-b')]);
    // 无互踩：各自产物是自己的 runId（拷到了自己刚写的 dist，而不是对方换入的）
    expect(a).toBe('module.exports = "run-a";');
    expect(b).toBe('module.exports = "run-b";');
    expect(fs.existsSync(resolveWorkspaceLockDir(workspace, lockRoot))).toBe(false);
  });
});
