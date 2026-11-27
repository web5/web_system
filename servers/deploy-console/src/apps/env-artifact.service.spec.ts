import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ENTRY_UNRESOLVABLE,
  EnvArtifactService,
  extractEntryAssetRefs,
  legacyVersionCandidates,
  listCdnCommitDirs,
  resolveEntryRefPaths,
} from './env-artifact.service';

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

  // ── #9027 核验修正：legacy 分支归一兜底（救 DB 里的 <templateKey>/<commit> 脏值）──

  it('#9027：带前缀输入经 legacy 归一命中单级目录（prod 真实形态 <app>/<env>/<commit>）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-artifact-'));
    const dir = path.join(root, 'static/modules/portal/prod/b6ec9950');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), 'x');
    const { svc, execAsync } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });

    expect(await svc.resolveVersion('prod', 'portal', 'portal/b6ec9950')).toBe('b6ec9950');
    expect(await svc.hasVersion('prod', 'portal', 'portal/b6ec9950')).toBe(true);
    expect(await svc.hasVersion('prod', 'portal', 'b6ec9950')).toBe(true);
    expect(await svc.hasVersion('prod', 'portal', 'portal/deadbeef')).toBe(false);
    expect(execAsync).not.toHaveBeenCalled();

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('#9027：原始值优先 —— 流水线命名空间目录 default/<commit> 不被归一拆坏', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-artifact-'));
    const dir = path.join(root, 'static/modules/portal/prod/default/abc1234');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), 'x');
    const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });

    expect(await svc.resolveVersion('prod', 'portal', 'default/abc1234')).toBe('default/abc1234');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('#9027：writePointer 用磁盘实际目录名（脏值不写出指向不存在目录的指针）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-artifact-'));
    const dir = path.join(root, 'static/modules/portal/prod/b6ec9950');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), 'x');
    const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });

    await svc.writePointer('prod', 'portal', 'portal/b6ec9950');
    const js = fs.readFileSync(path.join(root, 'static/modules/portal/prod/index.js'), 'utf8');
    expect(js).toContain('./b6ec9950/index.js');
    expect(js).not.toContain('portal/b6ec9950');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('legacyVersionCandidates：原始值优先、归一兜底、拒绝越界段', () => {
    expect(legacyVersionCandidates('portal/b6ec9950')).toEqual(['portal/b6ec9950', 'b6ec9950']);
    expect(legacyVersionCandidates('b6ec9950')).toEqual(['b6ec9950']);
    expect(legacyVersionCandidates('default/abc1234')).toEqual(['default/abc1234', 'abc1234']);
    expect(legacyVersionCandidates('portal/../etc')).toEqual([]);
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

    // 先有一次 test -f 探活（版本的磁盘实际目录名），写指针是第二个 ssh 调用
    const cmd = execAsync.mock.calls
      .map((c) => c[0] as string)
      .find((c) => c.includes('base64 -d')) as string;
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

/**
 * 台账 #9087 · 入口可解析性校验（`index.html` 存在 ≠ 能服务）。
 *
 * 白屏成因：`6e7b2690` / `4ea6d64` 的 index.html 引用
 * `/static/modules/shell/shell-dev/…`，prod 落点没有该目录 ⇒ 页面 200、JS 404。
 * 本组用例锁死三件事：**缺失必抛 / 可解析不误杀 / 远端不可达不静默通过**。
 */
describe('EnvArtifactService（入口可解析性校验 · #9087）', () => {
  const PROD_ROOT = '/data/web_system_static/public';
  const PROD_SSH = 'root@106.52.176.246';

  type ExecResult = { ok: boolean; stdout: string; stderr: string };

  function makeSvc(
    env: Record<string, string>,
    execImpl?: (cmd: string) => ExecResult,
  ) {
    const config = { get: (k: string) => env[k] };
    const execAsync = jest.fn<Promise<ExecResult>, [string, string, Record<string, string>, number]>(
      async (cmd: string) => (execImpl ? execImpl(cmd) : { ok: true, stdout: '', stderr: '' }),
    );
    const svc = new EnvArtifactService(config as never, { execAsync } as never);
    return { svc, execAsync };
  }

  /** 在临时静态根下造一个 shell 版本目录，返回 [root, versionDir] */
  function makeVersionDir(html: string): [string, string] {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-'));
    const vdir = path.join(root, 'static/modules/shell/prod/abc1234');
    fs.mkdirSync(path.join(vdir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vdir, 'index.html'), html);
    return [root, vdir];
  }

  it('extractEntryAssetRefs：只留 js/css，去 query/hash，跳过外链与图片', () => {
    const html = [
      '<link rel="stylesheet" href="./assets/index.111.css?v=2">',
      '<link rel="icon" href="/favicon.ico">',
      '<script src="assets/index.abc.js?v=1"></script>',
      '<script src="https://cdn.example.com/lib.js"></script>',
      '<script src="//cdn.example.com/x.js"></script>',
      '<script src="data:text/javascript,void 0"></script>',
      '<img src="assets/logo.png">',
      '<link rel="modulepreload" href="assets/vendor.js#hash">',
      "<script src='assets/quote.js'></script>",
    ].join('\n');
    expect(extractEntryAssetRefs(html)).toEqual([
      './assets/index.111.css',
      'assets/index.abc.js',
      'assets/vendor.js',
      'assets/quote.js',
    ]);
  });

  it('resolveEntryRefPaths：/static 落静态根；/shell 落「版本目录 + 固定目录」；其余不判定', () => {
    const vdir = `${PROD_ROOT}/static/modules/shell/prod/abc1234`;
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '/static/modules/shell/shell-dev/abc1234/assets/x.js')).toEqual([
      `${PROD_ROOT}/static/modules/shell/shell-dev/abc1234/assets/x.js`,
    ]);
    // 相对路径：版本目录
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, 'assets/x.js')).toEqual([`${vdir}/assets/x.js`]);
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, './assets/x.js')).toEqual([`${vdir}/assets/x.js`]);
    // /shell/：网关两条解析路径都要试（版本目录优先，固定目录兜底）
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '/shell/assets/index.abc.js')).toEqual([
      `${vdir}/assets/index.abc.js`,
      `${PROD_ROOT}/shell/assets/index.abc.js`,
    ]);
    // 其余 /… 前缀：不判定（方案 §2 明确不做）
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '/assets/x.js')).toEqual([]);
    // 越界一律不判定
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '../other/assets/x.js')).toEqual([]);
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '/static/../etc/passwd.js')).toEqual([]);
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '/shell/../etc/passwd.js')).toEqual([]);
    expect(resolveEntryRefPaths(PROD_ROOT, vdir, '/shell//abs/x.js')).toEqual([]);
  });

  it('#9087 本机：引用缺失 → ENTRY_UNRESOLVABLE 并列出缺失的磁盘路径', async () => {
    const [root, vdir] = makeVersionDir(
      '<script src="assets/index.ok.js"></script><script src="assets/index.miss.js"></script>',
    );
    fs.writeFileSync(path.join(vdir, 'assets/index.ok.js'), '//ok');
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).rejects.toThrow(
        /ENTRY_UNRESOLVABLE.*index\.miss\.js/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：全部可解析 → 静默通过（不误杀）', async () => {
    const [root, vdir] = makeVersionDir(
      '<link rel="stylesheet" href="assets/index.ok.css"><script src="assets/index.ok.js"></script>',
    );
    fs.writeFileSync(path.join(vdir, 'assets/index.ok.js'), '//ok');
    fs.writeFileSync(path.join(vdir, 'assets/index.ok.css'), '/*ok*/');
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).resolves.toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：跨环境绝对引用（shell-dev）缺失 → 抛（线上白屏成因）', async () => {
    const [root] = makeVersionDir(
      '<script src="/static/modules/shell/shell-dev/abc1234/assets/index.js"></script>',
    );
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).rejects.toThrow(
        /ENTRY_UNRESOLVABLE.*shell-dev/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * `/shell/assets/*` 是**存量基座产物最常见的 entry 形态**（`2ea0468` / `a6013f8` 实测
   * `→ /shell/assets/index.<hash>.js`）。网关对它有两条解析路径（`main.ts` + `resolveShellAssetPath`
   * + ServeStatic 兜底），所以本条只能「两处都在才放行 / 两处都缺才拒绝」。
   * 旧实现把 `/shell/…` 一律跳过 ⇒ 这些版本的 entry js/css **完全不被判定**，等于本单白做。
   */
  it('#9087 本机：/shell/ 引用落在版本目录内 → 放行（不误杀）', async () => {
    const [root, vdir] = makeVersionDir(
      '<script type="module" crossorigin src="/shell/assets/index.abc.js"></script>',
    );
    fs.writeFileSync(path.join(vdir, 'assets/index.abc.js'), '//ok');
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).resolves.toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：/shell/ 引用只在固定 shell/ 目录（ServeStatic 兜底）→ 放行', async () => {
    const [root] = makeVersionDir('<link rel="stylesheet" href="/shell/assets/index.abc.css">');
    fs.mkdirSync(path.join(root, 'shell/assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shell/assets/index.abc.css'), '/*ok*/');
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).resolves.toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：/shell/ 引用两处都缺 → 抛（堵住「版本目录缺 assets 仍放行」的漏杀）', async () => {
    const [root] = makeVersionDir(
      '<script type="module" src="/shell/assets/index.miss.js"></script>' +
        '<link rel="stylesheet" href="/shell/assets/index.miss.css">',
    );
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).rejects.toThrow(
        /ENTRY_UNRESOLVABLE.*index\.miss\.js/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：真实构建产物形态（type=module/crossorigin + /static/cdn + /static/modules）→ 放行', async () => {
    // 取自 servers/gateway/public/shell/index.html（2026-09-28 真实构建）的引用骨架
    const [root, vdir] = makeVersionDir(
      [
        '<script defer src="/static/cdn/vue.js"></script>',
        '<script type="module" crossorigin src="/static/modules/shell/prod/abc1234/assets/index.DaEBmOZv.js"></script>',
        '<link rel="stylesheet" crossorigin href="/static/modules/shell/prod/abc1234/assets/index.CjS37t13.css">',
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      ].join('\n'),
    );
    fs.mkdirSync(path.join(root, 'static/cdn'), { recursive: true });
    fs.writeFileSync(path.join(root, 'static/cdn/vue.js'), '//ok');
    fs.writeFileSync(path.join(vdir, 'assets/index.DaEBmOZv.js'), '//ok');
    fs.writeFileSync(path.join(vdir, 'assets/index.CjS37t13.css'), '/*ok*/');
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).resolves.toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：无 js/css 引用（纯内联页）→ 放行', async () => {
    const [root] = makeVersionDir('<h1>hello</h1><script>void 0</script>');
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'abc1234')).resolves.toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 本机：版本目录不存在 → ENTRY_UNRESOLVABLE（不误报为可解析）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-'));
    try {
      const { svc } = makeSvc({ STATIC_PUBLIC_ROOT_PROD: root });
      await expect(svc.assertArtifactResolvable('prod', 'shell', 'ghost')).rejects.toThrow(
        /ENTRY_UNRESOLVABLE/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('#9087 远端：cat 读入口 + 一条 ssh 批量判定（缺失项按 stdout 行返回）', async () => {
    const missing = `${PROD_ROOT}/static/modules/shell/prod/v1/assets/miss.js`;
    const { svc, execAsync } = makeSvc(
      { STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH },
      (cmd) => {
        if (cmd.includes('cat ')) {
          return {
            ok: true,
            stdout: '<script src="assets/ok.js"></script><script src="assets/miss.js"></script>',
            stderr: '',
          };
        }
        if (cmd.includes('base64 -d')) return { ok: true, stdout: `${missing}\n`, stderr: '' };
        return { ok: true, stdout: '', stderr: '' }; // test -f index.html
      },
    );

    await expect(svc.assertArtifactResolvable('prod', 'shell', 'v1')).rejects.toThrow(
      /ENTRY_UNRESOLVABLE/,
    );
    // 三次 ssh：test -f(index.html) → cat → 批量 test；不存在逐文件多次往返
    expect(execAsync).toHaveBeenCalledTimes(3);
    const batch = execAsync.mock.calls.map((c) => c[0] as string).find((c) => c.includes('base64 -d'))!;
    const script = Buffer.from(batch.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1], 'base64').toString('utf-8');
    expect(script).toContain(`${PROD_ROOT}/static/modules/shell/prod/v1/assets/ok.js`);
    expect(script).toContain(missing);
    expect(script.match(/\[ -e /g)).toHaveLength(2); // 两个引用合并成一条脚本
  });

  it('#9087 远端：/shell/ 两条候选合并进同一条批量脚本，且「有一个在」即放行', async () => {
    const { svc, execAsync } = makeSvc(
      { STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH },
      (cmd) => {
        if (cmd.includes('cat ')) {
          return { ok: true, stdout: '<script src="/shell/assets/index.abc.js"></script>', stderr: '' };
        }
        if (cmd.includes('base64 -d')) {
          // 版本目录里没有，固定 shell/ 目录里有 → 网关 ServeStatic 能兜住 → 不能拒
          return {
            ok: true,
            stdout: `${PROD_ROOT}/static/modules/shell/prod/v1/assets/index.abc.js\n`,
            stderr: '',
          };
        }
        return { ok: true, stdout: '', stderr: '' }; // test -f index.html
      },
    );
    await expect(svc.assertArtifactResolvable('prod', 'shell', 'v1')).resolves.toBeUndefined();
    const batch = execAsync.mock.calls.map((c) => c[0] as string).find((c) => c.includes('base64 -d'))!;
    const script = Buffer.from(batch.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1], 'base64').toString('utf-8');
    expect(script).toContain(`${PROD_ROOT}/static/modules/shell/prod/v1/assets/index.abc.js`);
    expect(script).toContain(`${PROD_ROOT}/shell/assets/index.abc.js`);
    expect(execAsync).toHaveBeenCalledTimes(3); // 仍是一条批量往返，不逐文件
  });

  it('#9087 远端：stdout 掺入 banner/告警行 → 不当作缺失路径（防误杀）', async () => {
    const { svc } = makeSvc(
      { STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH },
      (cmd) => {
        if (cmd.includes('cat ')) {
          return { ok: true, stdout: '<script src="assets/a.js"></script>', stderr: '' };
        }
        if (cmd.includes('base64 -d')) {
          return {
            ok: true,
            stdout: 'Welcome to Ubuntu 22.04 LTS\nLast login: never\n',
            stderr: '',
          };
        }
        return { ok: true, stdout: '', stderr: '' };
      },
    );
    await expect(svc.assertArtifactResolvable('prod', 'shell', 'v1')).resolves.toBeUndefined();
  });

  it('#9087 远端：批量判定 ssh 失败 → 抛错（不静默通过）', async () => {
    const { svc } = makeSvc(
      { STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH },
      (cmd) => {
        if (cmd.includes('cat ')) return { ok: true, stdout: '<script src="assets/a.js"></script>', stderr: '' };
        if (cmd.includes('base64 -d')) return { ok: false, stdout: '', stderr: 'timed out' };
        return { ok: true, stdout: '', stderr: '' };
      },
    );
    await expect(svc.assertArtifactResolvable('prod', 'shell', 'v1')).rejects.toThrow(/入口资源校验失败/);
  });

  it('#9087 远端：cat 读不到 → 抛错（不返回「可解析」）', async () => {
    const { svc } = makeSvc(
      { STATIC_PUBLIC_ROOT_PROD: PROD_ROOT, STATIC_SSH_TARGET_PROD: PROD_SSH },
      (cmd) =>
        cmd.includes('cat ')
          ? { ok: false, stdout: '', stderr: 'No such file' }
          : { ok: true, stdout: '', stderr: '' },
    );
    await expect(svc.assertArtifactResolvable('prod', 'shell', 'v1')).rejects.toThrow(/入口文件读取失败/);
  });

  it('ENTRY_UNRESOLVABLE 是对外契约：错误码字符串不得改动', () => {
    expect(ENTRY_UNRESOLVABLE).toBe('ENTRY_UNRESOLVABLE');
  });
});
