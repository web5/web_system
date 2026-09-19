import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppArtifactService } from './app-artifact.service';

/**
 * 应用产物投递 + 激活单测（P1 · 验收判据 V5 的机器可执行部分）
 *
 * 锁定三件事：
 * ① 产物落到 `<appKey>/<envId>/<version>/`（不再是一级 `<key>/<version>/`）；
 * ② 投递后 `<appKey>/<envId>/index.js` 指针指向该版本；
 * ③ 版本表 previous/current 正确滚动，且**旧版本目录保留**（回滚前提）。
 */
describe('AppArtifactService（投递 envId/<version>/ + 改指针）', () => {
  let ws: string;
  let svc: AppArtifactService;
  let rows: any[];
  let versionRepo: any;
  let appsService: any;
  let envsService: any;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-app-'));
    rows = [];
    versionRepo = {
      findOne: jest.fn(
        async ({ where }: any) =>
          rows.find((r) => r.appKey === where.appKey && r.envId === where.envId) || null,
      ),
      create: jest.fn((x: any) => ({ ...x })),
      save: jest.fn(async (row: any) => {
        if (!rows.includes(row)) rows.push(row);
        return row;
      }),
    };
    appsService = {
      getApp: jest.fn(async () => ({ key: 'admin', repoDir: 'admin', deployMode: 'env-dir' })),
    };
    envsService = { getEnv: jest.fn(async () => ({ envId: '1' })) };
    const cfg = {
      get: jest.fn((k: string) => (k === 'RELEASE_WORKSPACE' ? ws : undefined)),
    };
    svc = new AppArtifactService(cfg as never, versionRepo, appsService, envsService);
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  /** 造一份构建产物（约定 apps/<repoDir>/dist） */
  const mkDist = (marker: string) => {
    const dir = path.join(ws, 'apps', 'admin', 'dist');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), `// ${marker}`);
    fs.writeFileSync(path.join(dir, 'chunk-abc123.js'), `// ${marker}-chunk`);
  };

  const envRoot = () =>
    path.join(ws, 'servers', 'gateway', 'public', 'static', 'modules', 'admin', '1');
  const pointer = () => {
    const f = path.join(envRoot(), 'index.js');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null;
  };

  it('产物写入 <key>/<envId>/<version>/ 并生成指向它的入口指针', async () => {
    mkDist('v1');
    const res = await svc.publishLocal('admin', '1', 'v1', 'tester');

    expect(res.artifactDir).toBe(path.join(envRoot(), 'v1'));
    expect(res.entryUrl).toBe('/static/modules/admin/1/index.js');
    expect(fs.readFileSync(path.join(envRoot(), 'v1', 'index.js'), 'utf-8')).toBe('// v1');
    expect(pointer()).toContain("./v1/index.js");
    expect(rows[0].currentVersion).toBe('v1');
    expect(res.previousVersion).toBeNull();
    expect(rows[0].status).toBe('deployed');
    expect(rows[0].deployedBy).toBe('tester');
  });

  it('连续投递滚动 previous/current，且旧版本目录保留（回滚前提）', async () => {
    mkDist('v1');
    await svc.publishLocal('admin', '1', 'v1');
    mkDist('v2');
    const res = await svc.publishLocal('admin', '1', 'v2');

    expect(res.previousVersion).toBe('v1');
    expect(rows[0].currentVersion).toBe('v2');
    expect(rows[0].previousVersion).toBe('v1');
    expect(pointer()).toContain("./v2/index.js");
    // v1 仍在磁盘 → 回滚可用、旧页面分包不 404
    expect(fs.existsSync(path.join(envRoot(), 'v1', 'index.js'))).toBe(true);
  });

  it('重复投递同版本幂等：目录清空后整拷，不留旧文件', async () => {
    mkDist('v1');
    await svc.publishLocal('admin', '1', 'v1');
    fs.writeFileSync(path.join(envRoot(), 'v1', 'stale.js'), 'old');

    mkDist('v1');
    const res = await svc.publishLocal('admin', '1', 'v1');

    expect(res.version).toBe('v1');
    expect(fs.existsSync(path.join(envRoot(), 'v1', 'stale.js'))).toBe(false);
    expect(rows.length).toBe(1);
  });

  it('缺构建产物或缺入口文件 → 拒绝投递', async () => {
    await expect(svc.publishLocal('admin', '1', 'v1')).rejects.toThrow(/构建产物不存在/);

    // 有 dist 目录但没有 index.js 同样拒绝
    const dir = path.join(ws, 'apps', 'admin', 'dist');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'other.js'), 'x');
    await expect(svc.publishLocal('admin', '1', 'v1')).rejects.toThrow(/缺入口文件/);
  });

  it('基座（site-version）不允许走环境目录投递', async () => {
    mkDist('v1');
    appsService.getApp.mockResolvedValueOnce({
      key: 'shell',
      repoDir: 'shell',
      deployMode: 'site-version',
    });
    await expect(svc.publishLocal('shell', '1', 'v1')).rejects.toThrow(/不走环境目录投递/);
  });

  it('版本标签非法（含路径穿越）→ 拒绝', async () => {
    mkDist('v1');
    await expect(svc.publishLocal('admin', '1', '../../etc')).rejects.toThrow(/版本标签非法/);
    await expect(svc.publishLocal('admin', '1', 'a/b')).rejects.toThrow(/版本标签非法/);
  });

  it('buildOutputDir 由 repoDir 推导（不接受调用方传路径）', () => {
    expect(svc.buildOutputDir('admin')).toBe(path.join(ws, 'apps', 'admin', 'dist'));
  });
});
