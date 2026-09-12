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
});
