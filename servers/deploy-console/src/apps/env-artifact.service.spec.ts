import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnvArtifactService, listCdnCommitDirs } from './env-artifact.service';

/**
 * 落点路由的正确性（诊断 #3）：
 * - 本机环境 → 直接 fs，不产生任何 ssh
 * - 远端环境（prod）→ 命令里必须带正确的静态根与 ssh 目标
 *
 * 只 fake 命令执行（CommandService.execAsync），断言**构造出的命令**，
 * 避免单测真的连生产机器。
 */
describe('EnvArtifactService（按环境路由产物读写）', () => {
  const PROD_ROOT = '/data/web_system_static/public';
  const PROD_SSH = 'root@106.52.176.246';

  type ExecResult = { ok: boolean; stdout: string; stderr: string };

  function makeSvc(env: Record<string, string>) {
    const config = { get: (k: string) => env[k] };
    const execAsync = jest.fn<Promise<ExecResult>, [string, string, Record<string, string>, number]>(
      async () => ({ ok: true, stdout: '', stderr: '' }),
    );
    const svc = new EnvArtifactService(config as never, { execAsync } as never);
    return { svc, execAsync };
  }

  it('本机环境：列版本不产生 ssh（走 fs）', async () => {
    const { svc, execAsync } = makeSvc({ RELEASE_WORKSPACE: '/nonexistent-ws' });
    const versions = await svc.listVersions('dev', 'portal');
    expect(versions).toEqual([]);
    expect(execAsync).not.toHaveBeenCalled();
  });

  it('远端环境：校验产物 → 静态根 + ssh 目标 + 版本目录（prod 真实形态）', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    const ok = await svc.hasVersion('prod', 'portal', '6e7b2690');
    expect(ok).toBe(true);
    const cmd = execAsync.mock.calls[0][0] as string;
    expect(cmd).toContain(PROD_SSH);
    expect(cmd).toContain(`${PROD_ROOT}/static/modules/portal/prod/6e7b2690/index.js`);
    expect(cmd).toContain('BatchMode=yes');
  });

  it('远端不可达：校验返回 false（调用方据此 fail-fast）', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({ ok: false, stdout: '', stderr: 'timed out' });
    expect(await svc.hasVersion('prod', 'portal', 'x')).toBe(false);
  });

  it('shell 校验 index.html，不把微前端入口当作站点产物', async () => {
    const { svc, execAsync } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH });
    expect(await svc.hasVersion('prod', 'shell', 'abc1234', 'index.html')).toBe(true);
    expect(execAsync.mock.calls[0][0]).toContain('/shell/prod/abc1234/index.html');
  });

  it('远端列版本：脚本内 cd 到静态根，输出按 mtime 倒序（指针自身被排除）', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({ ok: true, stdout: '6e7b2690\ncdb055bc\n', stderr: '' });
    expect(await svc.listVersions('prod', 'portal')).toEqual(['6e7b2690', 'cdb055bc']);
    const cmd = execAsync.mock.calls[0][0] as string;
    // 命令是 base64 传递的，解码后应能看到静态根与 mindepth=2 的排除条件
    const b64 = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    expect(b64).toBeTruthy();
    const script = Buffer.from(b64![1], 'base64').toString('utf-8');
    expect(script).toContain(`cd '${PROD_ROOT}/static/modules/portal/prod'`);
    expect(script).toContain('-mindepth 2');
  });

  it('远端列版本失败 → 降级空数组（页面仍可用）', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({ ok: false, stdout: '', stderr: 'no route to host' });
    expect(await svc.listVersions('prod', 'portal')).toEqual([]);
  });

  it('lists remote Shell HTML artifacts without requiring a JS pointer', async () => {
    const { svc, execAsync } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH });
    execAsync.mockResolvedValue({ ok: true, stdout: 'e1618537\na82270f9\n', stderr: '' });
    await expect(svc.listVersions('prod', 'shell', 'index.html')).resolves.toEqual(['e1618537', 'a82270f9']);
    const encoded = execAsync.mock.calls[0][0].match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    const script = Buffer.from(encoded![1], 'base64').toString('utf8');
    expect(script).toContain("-name 'index.html'");
    expect(script).not.toContain('-name index.js');
  });

  it('远端写指针：一次 ssh 完成备份 + 写 js（+ 有 css 才写 css）', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({ ok: true, stdout: 'WS_HAS_CSS\n', stderr: '' });
    const r = await svc.writePointer('prod', 'portal', '6e7b2690');
    expect(r.js).toBe(`${PROD_ROOT}/static/modules/portal/prod/index.js`);
    expect(r.css).toBe(`${PROD_ROOT}/static/modules/portal/prod/index.css`);

    const cmd = execAsync.mock.calls[0][0] as string;
    const b64 = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    const script = Buffer.from(b64![1], 'base64').toString('utf-8');
    expect(script).toContain(`mkdir -p '${PROD_ROOT}/static/modules/portal/prod'`);
    expect(script).toContain("./6e7b2690/index.js"); // 指针内容指向目标版本
    expect(script).toContain('WS_EOF');
    expect(script).toContain('.bak-'); // 写前备份
  });

  it('远端写指针：产物无 css 时 css 返回 null', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({ ok: true, stdout: '', stderr: '' });
    const r = await svc.writePointer('prod', 'portal', 'v');
    expect(r.css).toBeNull();
  });

  it('远端写指针失败 → 抛错（由调用方回滚指针表）', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({ ok: false, stdout: '', stderr: 'permission denied' });
    await expect(svc.writePointer('prod', 'portal', 'v')).rejects.toThrow(/远端写入口指针失败/);
  });

  it('读指针：远端 cat 回读并解析版本', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: PROD_ROOT,
      STATIC_SSH_TARGET_PROD: PROD_SSH,
    });
    execAsync.mockResolvedValue({
      ok: true,
      stdout: "System.register(['./69d9e5f9/index.js'], function (_export) {});\n",
      stderr: '',
    });
    expect(await svc.readPointer('prod', 'portal')).toBe('69d9e5f9');
    const cmd = execAsync.mock.calls[0][0] as string;
    expect(cmd).toContain(`${PROD_ROOT}/static/modules/portal/prod/index.js`);
  });
});

/**
 * CDN 布局（Phase 2 去指针化）分流：
 * - 微前端（index.js）→ 入口机 `<env>/<app>/<commit>` 布局，无磁盘指针
 * - shell 基座（index.html）→ 仍走 legacy（不进 CDN）
 * - readPointer 返回 null、writePointer fail-fast
 * 未设 `CDN_LAYOUT_MODE` 时逐字节零变化（上面主 describe 已覆盖）。
 */
describe('EnvArtifactService（CDN 布局去指针化）', () => {
  const CDN_ROOT = '/data/cdn';
  const CDN_SSH = 'root@cdn-entry.local';

  type ExecResult = { ok: boolean; stdout: string; stderr: string };

  function makeSvc(env: Record<string, string>) {
    const config = { get: (k: string) => env[k] };
    const execAsync = jest.fn<Promise<ExecResult>, [string, string, Record<string, string>, number]>(
      async () => ({ ok: true, stdout: '', stderr: '' }),
    );
    const svc = new EnvArtifactService(config as never, { execAsync } as never);
    return { svc, execAsync };
  }

  it('hasVersion（远端）：校验入口机 commit 目录，version 引用归一化为纯 commit', async () => {
    const { svc, execAsync } = makeSvc({
      CDN_LAYOUT_MODE: 'cdn',
      CDN_ROOT,
      CDN_SSH_TARGET: CDN_SSH,
    });
    // 完整引用 default/6e7b2690 → 归一化为 6e7b2690
    const ok = await svc.hasVersion('prod', 'portal', 'default/6e7b2690');
    expect(ok).toBe(true);
    const cmd = execAsync.mock.calls[0][0] as string;
    expect(cmd).toContain(CDN_SSH);
    expect(cmd).toContain(`${CDN_ROOT}/prod/portal/6e7b2690/index.js`);
    expect(cmd).not.toContain('static/modules');
    expect(cmd).toContain('BatchMode=yes');
  });

  it('hasVersion（本机）：CDN 根未配 ssh target 时走 fs，路径为 <env>/<app>/<commit>/index.js', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-hv-'));
    try {
      const commit = path.join(base, 'dev', 'portal', 'a1b2c3d');
      fs.mkdirSync(commit, { recursive: true });
      fs.writeFileSync(path.join(commit, 'index.js'), '//x');
      const { svc, execAsync } = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ROOT: base });
      expect(await svc.hasVersion('dev', 'portal', 'a1b2c3d')).toBe(true);
      expect(await svc.hasVersion('dev', 'portal', 'missing')).toBe(false);
      expect(execAsync).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('listVersions（远端）：脚本 cd 到 <env>/<app>，一级目录即 commit（mindepth 2）', async () => {
    const { svc, execAsync } = makeSvc({
      CDN_LAYOUT_MODE: 'cdn',
      CDN_ROOT,
      CDN_SSH_TARGET: CDN_SSH,
    });
    execAsync.mockResolvedValue({ ok: true, stdout: '6e7b2690\ncdb055bc\n', stderr: '' });
    expect(await svc.listVersions('prod', 'portal')).toEqual(['6e7b2690', 'cdb055bc']);
    const cmd = execAsync.mock.calls[0][0] as string;
    const m = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    expect(m).toBeTruthy();
    const script = Buffer.from(m![1], 'base64').toString('utf-8');
    expect(script).toContain(`cd '${CDN_ROOT}/prod/portal'`);
    expect(script).toContain('-mindepth 2 -maxdepth 2');
  });

  it('readPointer：CDN 模式磁盘无指针，返回 null 且不产生 ssh', async () => {
    const { svc, execAsync } = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ROOT, CDN_SSH_TARGET: CDN_SSH });
    expect(await svc.readPointer('prod', 'portal')).toBeNull();
    expect(execAsync).not.toHaveBeenCalled();
  });

  it('writePointer：CDN 模式去指针化，调用即 fail-fast', async () => {
    const { svc } = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ROOT, CDN_SSH_TARGET: CDN_SSH });
    await expect(svc.writePointer('prod', 'portal', 'v')).rejects.toThrow(/去指针化/);
  });

  it('shell 基座（index.html）在 CDN 模式下仍走 legacy 布局', async () => {
    const { svc, execAsync } = makeSvc({
      CDN_LAYOUT_MODE: 'cdn',
      CDN_ROOT,
      CDN_SSH_TARGET: CDN_SSH,
      STATIC_PUBLIC_ROOT_PROD: '/data/legacy-static',
      STATIC_SSH_TARGET_PROD: 'root@legacy-static.local',
    });
    expect(await svc.hasVersion('prod', 'shell', 'abc1234', 'index.html')).toBe(true);
    const cmd = execAsync.mock.calls[0][0] as string;
    expect(cmd).toContain('/shell/prod/abc1234/index.html');
    expect(cmd).not.toContain(CDN_ROOT);
  });

  it('listCdnCommitDirs：本机列 commit 目录，按 mtime 倒序、跳过无入口文件的目录', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-ls-'));
    try {
      fs.mkdirSync(path.join(base, 'aaa'), { recursive: true });
      fs.mkdirSync(path.join(base, 'bbb'), { recursive: true });
      fs.mkdirSync(path.join(base, 'empty'), { recursive: true });
      fs.writeFileSync(path.join(base, 'aaa', 'index.js'), '//a');
      fs.writeFileSync(path.join(base, 'bbb', 'index.js'), '//b');
      fs.utimesSync(path.join(base, 'aaa'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
      fs.utimesSync(path.join(base, 'bbb'), new Date(), new Date());
      expect(listCdnCommitDirs(base, 'index.js')).toEqual(['bbb', 'aaa']);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('默认（未设 CDN_LAYOUT_MODE）：hasVersion 仍走 legacy，不受影响', async () => {
    const { svc, execAsync } = makeSvc({
      STATIC_PUBLIC_ROOT_PROD: '/data/legacy-static',
      STATIC_SSH_TARGET_PROD: 'root@legacy-static.local',
    });
    expect(await svc.hasVersion('prod', 'portal', '6e7b2690')).toBe(true);
    const cmd = execAsync.mock.calls[0][0] as string;
    expect(cmd).toContain('/data/legacy-static/static/modules/portal/prod/6e7b2690/index.js');
  });
});
