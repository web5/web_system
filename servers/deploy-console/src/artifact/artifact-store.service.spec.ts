import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactStoreService, KEEP_MIN_AGE_MS, KEEP_VERSIONS } from './artifact-store.service';

describe('ArtifactStoreService（产物目录 fs 工具）', () => {
  let tmpWs: string;
  let svc: ArtifactStoreService;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-ws-'));
    const cfg = { get: jest.fn((k: string) => (k === 'RELEASE_WORKSPACE' ? tmpWs : undefined)) };
    svc = new ArtifactStoreService(cfg as never);
  });

  afterEach(() => {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  });

  const moduleRoot = () => path.join(tmpWs, 'servers', 'gateway', 'public', 'static', 'modules', 'admin');
  const mkVersion = (v: string, mtime: number) => {
    const dir = path.join(moduleRoot(), v);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), `// ${v}`);
    fs.utimesSync(dir, new Date(mtime), new Date(mtime));
  };

  it('exists：按产物入口文件判断', () => {
    mkVersion('abc1234', Date.now());
    expect(svc.exists('admin', 'abc1234')).toBe(true);
    expect(svc.exists('admin', 'nope')).toBe(false);
  });

  it('listVersions：按 mtime 倒序返回产物版本', () => {
    mkVersion('v1', Date.now() - 3000);
    mkVersion('v2', Date.now() - 1000);
    mkVersion('v3', Date.now());
    expect(svc.listVersions('admin')).toEqual(['v3', 'v2', 'v1']);
    expect(svc.listVersions('unknown')).toEqual([]);
  });

  it('uploadLocal：清空旧内容后整拷 dist', () => {
    mkVersion('v1', Date.now());
    fs.writeFileSync(path.join(moduleRoot(), 'v1', 'stale.txt'), 'old');

    const src = path.join(tmpWs, 'dist');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'index.js'), 'new');
    fs.writeFileSync(path.join(src, 'asset.js'), 'a');

    const dest = svc.uploadLocal('admin', 'v1', src);
    expect(dest).toBe(path.join(moduleRoot(), 'v1'));
    expect(fs.existsSync(path.join(dest, 'stale.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(dest, 'index.js'), 'utf-8')).toBe('new');
    expect(fs.readFileSync(path.join(dest, 'asset.js'), 'utf-8')).toBe('a');
  });

  it('cleanup：保留最近 keep 个，受保护版本不删', () => {
    mkVersion('v1', Date.now() - 4000);
    mkVersion('v2', Date.now() - 3000);
    mkVersion('v3', Date.now() - 2000);
    mkVersion('v4', Date.now() - 1000);
    mkVersion('v5', Date.now());

    const res = svc.cleanup('admin', 2, new Set(['v2']), 0); // minAgeMs=0：本用例只验证「数量 + 保护」两个维度
    // 按 mtime 倒序：v5 v4 保留；v3 删；v2 受保护保留；v1 删 → kept=[v5,v4,v2] removed=[v3,v1]
    expect(res.kept).toEqual(['v5', 'v4', 'v2']);
    expect(res.removed).toEqual(['v3', 'v1']);
    expect(fs.existsSync(path.join(moduleRoot(), 'v5'))).toBe(true);
    expect(fs.existsSync(path.join(moduleRoot(), 'v2'))).toBe(true);
    expect(fs.existsSync(path.join(moduleRoot(), 'v1'))).toBe(false);
    expect(svc.exists('admin', 'v3')).toBe(false);
  });

  it('cleanup：未满 minAgeMs 的版本即使超出 keep 也保留（高频发布保护）', () => {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    mkVersion('v1', now - 4 * HOUR);
    mkVersion('v2', now - 3 * HOUR);
    mkVersion('v3', now - 2 * HOUR);
    mkVersion('v4', now - HOUR);
    mkVersion('v5', now);

    const res = svc.cleanup('admin', 2); // 走默认 24h 下限
    expect(res.removed).toEqual([]);
    expect(res.kept).toHaveLength(5);
  });

  it('cleanup：超出 minAgeMs 且不在最近 keep 内的版本才被清理', () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    mkVersion('old1', now - 30 * DAY);
    mkVersion('old2', now - 20 * DAY);
    mkVersion('v1', now - 3 * DAY);
    mkVersion('v2', now - 2 * DAY);
    mkVersion('v3', now - 60 * 1000);

    const res = svc.cleanup('admin', 2); // 最近 2 个 = v3 v2；v1 已超 24h 且不在 keep → 删
    expect(res.kept).toEqual(['v3', 'v2']);
    expect(res.removed.sort()).toEqual(['old1', 'old2', 'v1']);
  });

  it('KEEP_VERSIONS 默认保留 5 个', () => {
    expect(KEEP_VERSIONS).toBe(5);
  });

  it('KEEP_MIN_AGE_MS 默认 24 小时', () => {
    expect(KEEP_MIN_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('cleanup：目录不存在时不抛错', () => {
    expect(svc.cleanup('missing', 5)).toEqual({ kept: [], removed: [] });
  });

  // ── 诊断 #9：env-dir（微前端）布局 ──
  // modules/<key>/<env>/index.js 是**入口指针**，版本在 modules/<key>/<env>/<commit>/
  // 旧判定「一级含 index.js = 版本」会把 env 层误判成版本，导致 ① commit 目录永不清理
  // ② 更危险：env 层超龄后走 legacy 分支被整个 rmSync（连指针带所有版本）

  /** 造 env-dir 布局：env 层写指针（指向 current），下面挂若干 commit 版本目录 */
  const mkEnvDir = (env: string, commits: { v: string; mtime: number }[], pointerTo?: string) => {
    const envDir = path.join(moduleRoot(), env);
    fs.mkdirSync(envDir, { recursive: true });
    for (const c of commits) {
      const d = path.join(envDir, c.v);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'index.js'), `// ${c.v}`);
      fs.utimesSync(d, new Date(c.mtime), new Date(c.mtime));
    }
    if (pointerTo) {
      fs.writeFileSync(
        path.join(envDir, 'index.js'),
        `System.register(['./${pointerTo}/index.js'], function(){});`,
      );
    }
    fs.utimesSync(envDir, new Date(Date.now()), new Date(Date.now()));
  };

  it('#9：env-dir 的 env 层不再被当成版本（listVersions 返回 env/commit）', () => {
    const now = Date.now();
    mkEnvDir('prod', [{ v: 'aaa1111', mtime: now - 2000 }, { v: 'bbb2222', mtime: now }], 'bbb2222');
    expect(svc.listVersions('admin')).toEqual(['prod/bbb2222', 'prod/aaa1111']);
  });

  it('#9：env-dir 的过期 commit 目录会被清理（此前永不清理）', () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    mkEnvDir(
      'prod',
      [
        { v: 'old1', mtime: now - 30 * DAY },
        { v: 'old2', mtime: now - 20 * DAY },
        { v: 'cur1', mtime: now },
      ],
      'cur1',
    );
    const res = svc.cleanup('admin', 1, new Set(), 0); // minAge=0 只看数量
    expect(res.removed.sort()).toEqual(['prod/old1', 'prod/old2']);
    expect(res.kept).toContain('prod/cur1');
  });

  it('#9：env 层本身（含指针）绝不删除 —— 旧逻辑会 rmSync 整个 env 目录', () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // env 层 mtime 很旧（超龄），若被误判为 legacy 版本就会整个被删
    mkEnvDir('prod', [{ v: 'cur1', mtime: now - 30 * DAY }], 'cur1');
    fs.utimesSync(path.join(moduleRoot(), 'prod'), new Date(now - 30 * DAY), new Date(now - 30 * DAY));

    svc.cleanup('admin', 1, new Set(), 0);
    expect(fs.existsSync(path.join(moduleRoot(), 'prod'))).toBe(true);
    expect(fs.existsSync(path.join(moduleRoot(), 'prod', 'index.js'))).toBe(true);
  });

  it('#9：指针当前指向的版本受保护（即使它最旧、且不在 keep 内）', () => {
    const now = Date.now();
    // 指针指向最旧的那个，且 keep=1 —— 若只按 mtime 保留，线上正在服务的版本会被删
    mkEnvDir(
      'prod',
      [{ v: 'cur1', mtime: now - 10000 }, { v: 'v2', mtime: now - 5000 }, { v: 'v3', mtime: now }],
      'cur1',
    );
    const res = svc.cleanup('admin', 1, new Set(), 0);
    expect(res.removed).not.toContain('prod/cur1');
    expect(fs.existsSync(path.join(moduleRoot(), 'prod', 'cur1', 'index.js'))).toBe(true);
  });

  it('#9：版本清空后 env 层仍保留（指针不能丢）；无指针的空目录才移除', () => {
    const now = Date.now();
    mkEnvDir('prod', [{ v: 'cur1', mtime: now }], 'cur1');
    fs.rmSync(path.join(moduleRoot(), 'prod', 'cur1'), { recursive: true, force: true });
    svc.cleanup('admin', 1, new Set(), 0);
    expect(fs.existsSync(path.join(moduleRoot(), 'prod', 'index.js'))).toBe(true);

    // 对照：没有 index.js 的空命名空间目录会被移除
    const emptyNs = path.join(moduleRoot(), 'emptyns');
    fs.mkdirSync(emptyNs, { recursive: true });
    svc.cleanup('admin', 1, new Set(), 0);
    expect(fs.existsSync(emptyNs)).toBe(false);
  });

  it('#9：readPointerTarget 解析不出版本时返回 null（不误保护、不误判）', () => {
    const now = Date.now();
    // 一级目录含 index.js 但内容是真实产物（不含 './<v>/index.js' 引用）→ legacy 版本
    mkVersion('abc1234', now);
    expect(svc.listVersions('admin')).toEqual(['abc1234']);
    expect(svc.cleanup('admin', 1, new Set(), 0).kept).toEqual(['abc1234']);
  });
});
