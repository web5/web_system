import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveRemoteModulesRoot,
  resolveRemoteScriptVars,
  toRemoteScriptSsh,
  RemoteDeliveryService,
} from './remote-delivery.service';
import { SshTarget } from './ssh-exec.service';

/** 造一台「主机管理」解析出来的目标机 */
const target = (over: Partial<SshTarget> = {}): SshTarget => ({
  host: '10.0.0.1',
  port: 22,
  username: 'deploy',
  privateKey: Buffer.from('KEY'),
  keyPath: '/home/u/.ssh/id_ed25519_servers',
  ...over,
});

describe('RemoteDeliveryService（远程投递工具）', () => {
  let cfg: { get: jest.Mock };
  let command: { exec: jest.Mock };
  let sshExec: { resolve: jest.Mock };
  let svc: RemoteDeliveryService;

  beforeEach(() => {
    cfg = { get: jest.fn(() => undefined) };
    command = { exec: jest.fn(() => '') };
    sshExec = { resolve: jest.fn(async () => target()) };
    svc = new RemoteDeliveryService(cfg as never, command as never, sshExec as never);
  });

  /**
   * 诊断 #15：目标机此前按 `DEV_SERVER/PROD_SERVER` 环境变量在本文件算一份，
   * 而发布/监控走的是「主机管理 → 服务器管理」（SshExecService）。两份口径漂移的代价是
   * 「配了脚本和没配脚本投到不同机器」，且两边日志都写「投递成功」。
   */
  describe('resolveTarget（目标机解析：只认主机管理）', () => {
    it('主机管理解析出什么就用什么（不再读 DEV_SERVER 这类环境变量）', async () => {
      cfg.get.mockImplementation((k: string) => (k === 'DEV_SERVER' ? '1.1.1.1' : undefined));
      await expect(svc.resolveTarget('dev')).resolves.toEqual({
        remoteHost: '10.0.0.1',
        remoteUser: 'deploy',
      });
      expect(sshExec.resolve).toHaveBeenCalledWith('dev');
      expect(cfg.get).not.toHaveBeenCalled();
    });

    it('未登记主机 → 原样透传解析方的错误（不回落本机、不回落环境变量）', async () => {
      sshExec.resolve.mockRejectedValue(new Error('环境 dev 无可用主机'));
      await expect(svc.resolveTarget('dev')).rejects.toThrow(/无可用主机/);
    });
  });

  describe('uploadDist（tar+scp+ssh）', () => {
    it('按 tar → scp → ssh 解压 顺序执行，返回远端目标', async () => {
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
      fs.writeFileSync(path.join(src, 'index.js'), 'x');

      const res = await svc.uploadDist({ env: 'dev', moduleKey: 'admin', version: 'v1', srcDir: src });
      expect(res.sshTarget).toBe('deploy@10.0.0.1');
      expect(res.dest).toBe('/data/web_system/servers/gateway/public/static/modules/admin/v1');

      const cmds = command.exec.mock.calls.map((c) => c[0] as string);
      expect(cmds[0]).toContain(`tar czf /tmp/admin-v1.tar.gz -C ${src} .`);
      expect(cmds[1]).toContain(`scp -o ConnectTimeout=15 /tmp/admin-v1.tar.gz deploy@10.0.0.1:/tmp/`);
      expect(cmds[2]).toContain('ssh -o ConnectTimeout=15 deploy@10.0.0.1');
      expect(cmds[2]).toContain('mkdir -p /data/web_system/servers/gateway/public/static/modules/admin/v1');
      fs.rmSync(src, { recursive: true, force: true });
    });

    it('解析不到目标机 → 整个投递失败（不带着空目标机 scp）', async () => {
      sshExec.resolve.mockRejectedValue(new Error('环境 dev 无可用主机'));
      await expect(
        svc.uploadDist({ env: 'dev', moduleKey: 'admin', version: 'v1', srcDir: '/tmp/none' }),
      ).rejects.toThrow(/无可用主机/);
      expect(command.exec).not.toHaveBeenCalled();
    });
  });

  /**
   * 诊断 #3 遗留：远端产物根此前是硬编码常量（`/data/web_system/servers/gateway/public/...`），
   * 而 prod 的静态根是 `/data/web_system_static/public` —— 硬编码意味着换环境就是
   * 「投递成功但页面 404」，且日志里看不出落点错了。
   */
  describe('remoteModulesRoot（远端产物根按环境取值）', () => {
    it('显式 REMOTE_MODULES_ROOT_<ENV> 优先', () => {
      cfg.get.mockImplementation((k: string) =>
        k === 'REMOTE_MODULES_ROOT_PROD' ? '/data/prod/modules/' : undefined,
      );
      // 结尾斜杠要剥掉，否则会出现 `//moduleKey` 这种落点
      expect(svc.remoteModulesRoot('prod')).toBe('/data/prod/modules');
    });

    it('回落 STATIC_PUBLIC_ROOT_<ENV> + /static/modules（与 #3 的静态根同口径）', () => {
      cfg.get.mockImplementation((k: string) =>
        k === 'STATIC_PUBLIC_ROOT_PROD' ? '/data/web_system_static/public' : undefined,
      );
      expect(svc.remoteModulesRoot('prod')).toBe(
        '/data/web_system_static/public/static/modules',
      );
    });

    it('都没配 → 旧常量（未配置时不会突然改投递落点）', () => {
      cfg.get.mockImplementation(() => undefined);
      expect(svc.remoteModulesRoot('dev')).toBe(
        '/data/web_system/servers/gateway/public/static/modules',
      );
    });

    it('uploadDist 的 dest 走按环境的根（不再写死）', async () => {
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
      fs.writeFileSync(path.join(src, 'index.js'), 'x');
      cfg.get.mockImplementation((k: string) =>
        k === 'STATIC_PUBLIC_ROOT_PROD' ? '/data/web_system_static/public' : undefined,
      );
      sshExec.resolve.mockResolvedValue(
        target({ host: '1.2.3.4', username: 'root', keyPath: '/home/u/.ssh/id_ed25519_servers' }),
      );
      const res = await svc.uploadDist({ env: 'prod', moduleKey: 'portal', version: 'v9', srcDir: src });
      expect(res.dest).toBe('/data/web_system_static/public/static/modules/portal/v9');
      fs.rmSync(src, { recursive: true, force: true });
    });
  });

  /**
   * S1（2026-10-13）边界脚本化：upload/cleanup 节点改由**脚本**做 scp/ssh，
   * 但「投到哪台机器、落到哪个目录」仍由平台裁决 —— 这四个变量就是裁决结果。
   *
   * 关键判据：同一套解析必须同时喂给脚本变量与平台执行体，否则又会长出两份真相
   * （正是 upload/cleanup 的 override 在 v5 被漏掉那一类漂移）。
   */
  describe('resolveRemoteScriptVars（给边界脚本的远端变量）', () => {
    const getter = (map: Record<string, string | undefined>) => (k: string) => map[k];

    it('落点与 service 的 remoteModulesRoot 同源（同一次装配两种走法必须一致）', () => {
      const get = getter({ REMOTE_MODULES_ROOT_DEV: '/data/mods' });
      const v = resolveRemoteScriptVars(get, {
        env: 'dev',
        moduleKey: 'admin',
        version: 'v1',
        ssh: toRemoteScriptSsh(target()),
      });
      expect(v.REMOTE_SSH_TARGET).toBe('deploy@10.0.0.1');
      expect(v.SSH_KEY_PATH).toBe('/home/u/.ssh/id_ed25519_servers');
      expect(v.REMOTE_MODULES_ROOT).toBe('/data/mods');
      expect(v.REMOTE_DEST_DIR).toBe('/data/mods/admin/v1');
      // 与 uploadDist 的 dest 必须逐字相同（换条断言方式：直接比 former 与 latter）
      expect(v.REMOTE_DEST_DIR).toBe(
        `${resolveRemoteModulesRoot(get, 'dev')}/admin/v1`,
      );
    });

    it('目标机未解析到 → SSH 两个变量都为空（平台不猜默认机，脚本据此显式报错）', () => {
      const v = resolveRemoteScriptVars(getter({}), {
        env: 'staging',
        moduleKey: 'admin',
        version: 'v1',
        ssh: null,
      });
      expect(v.REMOTE_SSH_TARGET).toBe('');
      expect(v.SSH_KEY_PATH).toBe('');
      // 静态根没配时三级链回落到旧常量，这个要与既有行为一致 —— 值为空非法：
      // 为空会让脚本在 scp 阶段才炸，且报的是「Permission denied」而非「未配置」
      expect(v.REMOTE_DEST_DIR).not.toBe('');
    });

    it('无 version → 不出 DEST 目录（半条路径比没有更危险）', () => {
      const v = resolveRemoteScriptVars(getter({}), {
        env: 'dev',
        moduleKey: 'admin',
        ssh: toRemoteScriptSsh(target()),
      });
      expect(v.REMOTE_DEST_DIR).toBe('');
    });

    it('目标机变量只来自传入的解析结果（平台侧不再按环境变量推导第二份）', () => {
      const get = getter({ DEV_SERVER: '应该用不到', DEV_USER: 'nobody' });
      const v = resolveRemoteScriptVars(get, {
        env: 'dev',
        moduleKey: 'admin',
        version: 'v1',
        ssh: null,
      });
      expect(v.REMOTE_SSH_TARGET).toBe('');
    });
  });

  describe('toRemoteScriptSsh（解析结果 → 脚本变量形状）', () => {
    it('拼 user@host，私钥路径原样透传', () => {
      expect(toRemoteScriptSsh(target({ host: 'h', username: 'u', keyPath: '/k/a' }))).toEqual({
        target: 'u@h',
        keyPath: '/k/a',
      });
    });
  });
});
