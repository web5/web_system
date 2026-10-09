import { EnvArtifactService } from './env-artifact.service';

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
