import { ConflictException } from '@nestjs/common';
import { FactCollectService } from './fact-collect.service';

const WS = '/ws';
const ROOT = '/srv/public';

type Cfg = Record<string, string>;

function makeRepo() {
  const qb: Record<string, unknown> = {};
  const chain = ['select', 'where', 'orderBy', 'limit'] as const;
  for (const m of chain) qb[m] = jest.fn(() => qb);
  qb.getRawOne = jest.fn(async () => ({ batchId: 'batch-1' }));
  return {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async () => []),
    find: jest.fn(async () => []),
    createQueryBuilder: jest.fn(() => qb),
  };
}

function makeSvc(opts: {
  cfg?: Cfg;
  versions?: Record<string, unknown>[];
  services?: Record<string, unknown>[];
  /** 本机命令 → 输出（ok）或 { fail: 原因 } */
  local?: (cmd: string) => string | { fail: string };
  sshOut?: (cmd: string) => string;
}) {
  const local = opts.local ?? (() => '');
  const command = {
    execAsync: jest.fn(async (cmd: string) => {
      const r = local(cmd);
      return typeof r === 'string' ? { ok: true, stdout: r, stderr: '' } : { ok: false, stdout: '', stderr: r.fail };
    }),
  };
  const ssh = {
    run: jest.fn(async (_env: string, cmd: string) => (opts.sshOut ? opts.sshOut(cmd) : '')),
  };
  const versionRepo = { find: jest.fn(async () => opts.versions ?? []) };
  const serviceEnvRepo = { find: jest.fn(async () => opts.services ?? []) };
  const repo = makeRepo();
  const cfg = {
    get: (k: string) => ({ RELEASE_WORKSPACE: WS, STATIC_PUBLIC_ROOT_DEV: ROOT, ...(opts.cfg ?? {}) })[k],
  };
  const svc = new FactCollectService(
    cfg as never,
    ssh as never,
    command as never,
    versionRepo as never,
    serviceEnvRepo as never,
    repo as never,
  );
  return { svc, command, ssh, repo, versionRepo, serviceEnvRepo };
}

describe('FactCollectService', () => {
  it('本机采集：版本与目录都一致 → ok', async () => {
    const { svc, repo, command } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: (cmd) =>
        cmd.startsWith('cat')
          ? 'System.register(["./5ba74517/index.js"])'
          : cmd.includes('| wc -l')
            ? '3\n'
            : '',
    });
    const r = await svc.collect('dev');
    expect(r.host).toBe('local');
    expect(r.status).toBe('ok');
    expect(r.items.map((i) => `${i.kind}:${i.status}`)).toEqual(['version:ok', 'dir:ok']);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(command.execAsync).toHaveBeenCalled();
  });

  it('指针指的版本 ≠ 平台登记版本 → drift（这正是 prod 双树那类问题）', async () => {
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: (cmd) => (cmd.startsWith('cat') ? 'System.register(["./69d9e5f9/index.js"])' : '3\n'),
    });
    const r = await svc.collect('dev');
    expect(r.status).toBe('drift');
    expect(r.items[0]).toMatchObject({ kind: 'version', expected: '5ba74517', actual: '69d9e5f9', status: 'drift' });
  });

  it('版本目录为空 → missing（登记的版本产物不在了）', async () => {
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: (cmd) => (cmd.startsWith('cat') ? 'System.register(["./5ba74517/index.js"])' : '0\n'),
    });
    const r = await svc.collect('dev');
    expect(r.items[1]).toMatchObject({ kind: 'dir', status: 'missing' });
    expect(r.missing).toBe(1);
  });

  it('采集命令失败 → error 且带原因（与 drift 区分：这是采集机制问题）', async () => {
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: () => ({ fail: 'pm2: command not found' }),
    });
    const r = await svc.collect('dev');
    expect(r.status).toBe('error');
    expect(r.error).toBe(2);
    expect(r.items[0].detail?.reason).toContain('command not found');
  });

  it('pm2 进程缺失 → missing；端口未监听 → missing', async () => {
    const { svc } = makeSvc({
      services: [{ serviceKey: 'gateway', envId: 'dev', port: 6000, status: 'active', pm2Name: null }],
      local: (cmd) => (cmd === 'pm2 jlist' ? '[]' : cmd === 'ss -ltn' ? 'State\n' : ''),
    });
    const r = await svc.collect('dev');
    expect(r.items).toEqual([
      expect.objectContaining({ kind: 'process', targetKey: 'gateway', status: 'missing' }),
      expect.objectContaining({ kind: 'port', targetKey: 'gateway', status: 'missing' }),
    ]);
  });

  it('pm2 进程 online 且端口在监听 → ok', async () => {
    const { svc } = makeSvc({
      services: [{ serviceKey: 'gateway', envId: 'dev', port: 6000, status: 'active', pm2Name: null }],
      local: (cmd) =>
        cmd === 'pm2 jlist'
          ? JSON.stringify([{ name: 'gateway', pid: 1, pm2_env: { status: 'online', pm_cwd: '/data/x', restart_time: 0 } }])
          : 'LISTEN 0 128 0.0.0.0:6000',
    });
    const r = await svc.collect('dev');
    expect(r.status).toBe('ok');
  });

  it('配置了 STATIC_SSH_TARGET → 走 SshExecService，且 host 记为目标机', async () => {
    const { svc, ssh, command } = makeSvc({
      cfg: { STATIC_SSH_TARGET_DEV: 'ubuntu@10.0.0.9' },
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      sshOut: (cmd) => (cmd.startsWith('cat') ? 'System.register(["./5ba74517/index.js"])' : '2\n'),
    });
    const r = await svc.collect('dev');
    expect(r.host).toBe('ubuntu@10.0.0.9');
    expect(ssh.run).toHaveBeenCalled();
    expect(command.execAsync).not.toHaveBeenCalled();
  });

  it('没有登记任何期望态 → skipped 并给出原因（不算失败）', async () => {
    const { svc, repo } = makeSvc({});
    const r = await svc.collect('dev');
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('没有登记的期望态');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('同一环境并发采集 → ConflictException（手动连点 / 与定时撞车）', async () => {
    let release!: (v: { ok: boolean; stdout: string; stderr: string }) => void;
    const gate = new Promise<{ ok: boolean; stdout: string; stderr: string }>((res) => {
      release = res;
    });
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: 'v1' }],
    });
    // 第一次卡在命令上，第二次必须被拒
    (svc as unknown as { command: { execAsync: jest.Mock } }).command.execAsync.mockReturnValueOnce(gate);
    const p = svc.collect('dev');
    await expect(svc.collect('dev')).rejects.toBeInstanceOf(ConflictException);
    release({ ok: true, stdout: 'System.register(["./v1/index.js"])', stderr: '' });
    await p.catch(() => undefined);
  });

  it('指针不存在，但版本目录里有 index.html（入口型产物）→ skipped，不算漂移', async () => {
    // dev 真实形态：shell 的产物是 index.html + assets + version.json，
    // 从来不会生成 SystemJS 的 index.js 指针。报成漂移 = 永久假告警，会淹没真信号。
    const { svc } = makeSvc({
      versions: [{ appKey: 'shell', envId: 'dev', currentVersion: 'a82270f9' }],
      local: (cmd) =>
        cmd.startsWith('cat')
          ? { fail: 'cat: /x/shell/dev/index.js: No such file or directory' }
          : '1\n',
    });
    const r = await svc.collect('dev');
    const v = r.items.find((i) => i.kind === 'version')!;
    expect(v.status).toBe('skipped');
    expect(v.detail?.pointerApplicable).toBe(false);
    // skipped 不进告警清单：既不算漂移，也不能算缺失或故障
    expect([r.drift, r.missing, r.error]).toEqual([0, 0, 0]);
  });

  it('指针不存在，版本目录也没有 index.html → missing（真的缺指针）', async () => {
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: (cmd) => {
        if (cmd.startsWith('cat')) return { fail: 'cat: /x/portal/dev/index.js: No such file or directory' };
        // 版本目录：3 个条目（有产物）；index.html：不存在 → 0
        return cmd.includes('/index.html') ? '0\n' : '3\n';
      },
    });
    const r = await svc.collect('dev');
    expect(r.items.find((i) => i.kind === 'version')).toMatchObject({ status: 'missing' });
    expect(r.missing).toBe(1);
  });

  it('指针不存在，且形态探测自身失败 → 保守按 missing（不能确认它没缺，就不说没问题）', async () => {
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: (cmd) => {
        if (cmd.startsWith('cat')) return { fail: 'cat: /x/portal/dev/index.js: No such file or directory' };
        return { fail: 'ls: cannot access: Permission denied' };
      },
    });
    const r = await svc.collect('dev');
    const v = r.items.find((i) => i.kind === 'version')!;
    expect(v.status).toBe('missing');
    expect(String(v.detail?.probeError)).toContain('Permission denied');
  });

  it('非「不存在」的失败仍是 error（采集机制问题，不放行成 missing）', async () => {
    const { svc } = makeSvc({
      versions: [{ appKey: 'portal', envId: 'dev', currentVersion: '5ba74517' }],
      local: (cmd) => {
        if (cmd.startsWith('cat')) return { fail: 'cat: /x/portal/dev/index.js: Permission denied' };
        return '3\n';
      },
    });
    const r = await svc.collect('dev');
    expect(r.items.find((i) => i.kind === 'version')).toMatchObject({
      status: 'error',
    });
  });

  it('allowedEnvs 默认 dev；prod 必须显式加入', () => {
    expect(makeSvc({}).svc.allowedEnvs()).toEqual(['dev']);
    expect(makeSvc({ cfg: { FACT_SNAPSHOT_ENVS: 'dev,prod' } }).svc.allowedEnvs()).toEqual(['dev', 'prod']);
  });
});
