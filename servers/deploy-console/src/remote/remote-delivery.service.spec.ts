import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  pickSshKeyPath,
  resolveRemoteModulesRoot,
  resolveRemoteScriptVars,
  resolveRemoteSshTarget,
  RemoteDeliveryService,
} from './remote-delivery.service';

describe('RemoteDeliveryService（远程投递工具）', () => {
  let cfg: { get: jest.Mock };
  let command: { exec: jest.Mock };
  let svc: RemoteDeliveryService;

  beforeEach(() => {
    cfg = { get: jest.fn(() => undefined) };
    command = { exec: jest.fn(() => '') };
    svc = new RemoteDeliveryService(cfg as never, command as never);
  });

  describe('resolveTarget（服务器地址解析）', () => {
    it('dev 环境读 DEV_SERVER/DEV_USER', () => {
      cfg.get.mockImplementation((k: string) =>
        k === 'DEV_SERVER' ? '10.0.0.1' : k === 'DEV_USER' ? 'deploy' : undefined,
      );
      expect(svc.resolveTarget('dev')).toEqual({ remoteHost: '10.0.0.1', remoteUser: 'deploy' });
    });

    it('prod 环境读 PROD_SERVER/PROD_USER', () => {
      cfg.get.mockImplementation((k: string) =>
        k === 'PROD_SERVER' ? '1.2.3.4' : k === 'PROD_USER' ? 'root' : undefined,
      );
      expect(svc.resolveTarget('prod')).toEqual({ remoteHost: '1.2.3.4', remoteUser: 'root' });
    });

    it('未配置服务器地址 → 抛 BadRequestException（提示可 target=local）', () => {
      expect(() => svc.resolveTarget('dev')).toThrow(BadRequestException);
    });
  });

  describe('uploadDist（tar+scp+ssh）', () => {
    it('按 tar → scp → ssh 解压 顺序执行，返回远端目标', async () => {
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
      fs.writeFileSync(path.join(src, 'index.js'), 'x');
      cfg.get.mockImplementation((k: string) =>
        k === 'DEV_SERVER' ? '10.0.0.1' : k === 'DEV_USER' ? 'deploy' : undefined,
      );

      const res = svc.uploadDist({ env: 'dev', moduleKey: 'admin', version: 'v1', srcDir: src });
      expect(res.sshTarget).toBe('deploy@10.0.0.1');
      expect(res.dest).toBe('/data/web_system/servers/gateway/public/static/modules/admin/v1');

      const cmds = command.exec.mock.calls.map((c) => c[0] as string);
      expect(cmds[0]).toContain(`tar czf /tmp/admin-v1.tar.gz -C ${src} .`);
      expect(cmds[1]).toContain(`scp -o ConnectTimeout=15 /tmp/admin-v1.tar.gz deploy@10.0.0.1:/tmp/`);
      expect(cmds[2]).toContain('ssh -o ConnectTimeout=15 deploy@10.0.0.1');
      expect(cmds[2]).toContain('mkdir -p /data/web_system/servers/gateway/public/static/modules/admin/v1');
      fs.rmSync(src, { recursive: true, force: true });
    });

    it('无 remoteUser 时 ssh 目标为裸 host', async () => {
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
      cfg.get.mockImplementation((k: string) => (k === 'DEV_SERVER' ? '10.0.0.1' : undefined));
      const res = svc.uploadDist({ env: 'dev', moduleKey: 'admin', version: 'v1', srcDir: src });
      expect(res.sshTarget).toBe('10.0.0.1');
      fs.rmSync(src, { recursive: true, force: true });
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

    it('uploadDist 的 dest 走按环境的根（不再写死）', () => {
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
      fs.writeFileSync(path.join(src, 'index.js'), 'x');
      cfg.get.mockImplementation((k: string) =>
        k === 'PROD_SERVER'
          ? '1.2.3.4'
          : k === 'PROD_USER'
            ? 'root'
            : k === 'STATIC_PUBLIC_ROOT_PROD'
              ? '/data/web_system_static/public'
              : undefined,
      );
      const res = svc.uploadDist({ env: 'prod', moduleKey: 'portal', version: 'v9', srcDir: src });
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
      const get = getter({
        DEV_SERVER: '10.0.0.9',
        DEV_USER: 'ubuntu',
        REMOTE_MODULES_ROOT_DEV: '/data/mods',
      });
      const v = resolveRemoteScriptVars(get, {
        env: 'dev',
        moduleKey: 'admin',
        version: 'v1',
        exists: () => false,
      });
      expect(v.REMOTE_SSH_TARGET).toBe('ubuntu@10.0.0.9');
      expect(v.REMOTE_MODULES_ROOT).toBe('/data/mods');
      expect(v.REMOTE_DEST_DIR).toBe('/data/mods/admin/v1');
      // 与 uploadDist 的 dest 必须逐字相同（换条断言方式：直接比 former 与 latter）
      expect(v.REMOTE_DEST_DIR).toBe(
        `${resolveRemoteModulesRoot(get, 'dev')}/admin/v1`,
      );
    });

    it('目标机未登记 → 目标与目标目录都为空（平台不猜默认机，脚本据此显式报错）', () => {
      const v = resolveRemoteScriptVars(getter({}), {
        env: 'staging',
        moduleKey: 'admin',
        version: 'v1',
        exists: () => false,
      });
      expect(v.REMOTE_SSH_TARGET).toBe('');
      // 静态根没配时三级链回落到旧常量，这个要与既有行为一致 —— 空非法：
      // 值为空会让脚本在 scp 阶段才炸，且报的是「Permission denied」而非「未配置」
      expect(v.REMOTE_DEST_DIR).not.toBe('');
    });

    it('无 version → 不出 DEST 目录（半条路径比没有更危险）', () => {
      const v = resolveRemoteScriptVars(getter({ DEV_SERVER: 'h' }), {
        env: 'dev',
        moduleKey: 'admin',
        exists: () => false,
      });
      expect(v.REMOTE_DEST_DIR).toBe('');
    });

    it('resolveRemoteSshTarget：无 user 时返回裸 host；未配置返回空串', () => {
      expect(resolveRemoteSshTarget(getter({ PROD_SERVER: '1.2.3.4' }), 'prod')).toBe('1.2.3.4');
      expect(resolveRemoteSshTarget(getter({}), 'prod')).toBe('');
    });

    describe('pickSshKeyPath（私钥路径）', () => {
      it('显式路径存在即用它', () => {
        expect(pickSshKeyPath('/keys/a', { exists: (p) => p === '/keys/a' })).toBe('/keys/a');
      });

      it('显式路径不存在 → 回落默认私钥（存在才用）', () => {
        const exists = (p: string) => p === '/home/u/.ssh/id_ed25519_servers';
        expect(pickSshKeyPath('/keys/missing', { exists, home: '/home/u' })).toBe(
          '/home/u/.ssh/id_ed25519_servers',
        );
      });

      it('一个都不存在 → 空串（脚本按本机 ssh 默认行为连接，而不是拿着错路径去连）', () => {
        expect(pickSshKeyPath(undefined, { exists: () => false, home: '/home/u' })).toBe('');
      });

      it('~ 展开到给定 HOME', () => {
        const exists = (p: string) => p === '/home/u/.ssh/id_ed25519_servers';
        expect(pickSshKeyPath('~/.ssh/id_ed25519_servers', { exists, home: '/home/u' })).toBe(
          '/home/u/.ssh/id_ed25519_servers',
        );
      });
    });
  });
});
