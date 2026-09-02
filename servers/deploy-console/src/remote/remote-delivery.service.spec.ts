import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RemoteDeliveryService } from './remote-delivery.service';

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
});
