import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactStoreService, KEEP_VERSIONS } from './artifact-store.service';

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

    const res = svc.cleanup('admin', 2, new Set(['v2']));
    // 按 mtime 倒序：v5 v4 保留；v3 删；v2 受保护保留；v1 删 → kept=[v5,v4,v2] removed=[v3,v1]
    expect(res.kept).toEqual(['v5', 'v4', 'v2']);
    expect(res.removed).toEqual(['v3', 'v1']);
    expect(fs.existsSync(path.join(moduleRoot(), 'v5'))).toBe(true);
    expect(fs.existsSync(path.join(moduleRoot(), 'v2'))).toBe(true);
    expect(fs.existsSync(path.join(moduleRoot(), 'v1'))).toBe(false);
    expect(svc.exists('admin', 'v3')).toBe(false);
  });

  it('KEEP_VERSIONS 默认保留 5 个', () => {
    expect(KEEP_VERSIONS).toBe(5);
  });

  it('cleanup：目录不存在时不抛错', () => {
    expect(svc.cleanup('missing', 5)).toEqual({ kept: [], removed: [] });
  });
});
